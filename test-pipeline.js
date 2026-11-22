'use strict';
/* Integration test for the FFmpeg + multi-voice pipeline (not shipped as a
   test suite; run manually with `node test-pipeline.js`).
   Tests: test-clip creation, music bed, multi-voice voiceover script-only
   mode, assemble with one timed voice track per voice (tones standing in
   for real TTS audio), captions incl. dialogue with speaker names,
   and the honest 4K-upscale flag. */
const fs = require('fs');
const path = require('path');
const { runFfmpeg, probe, assemble } = require('./src/ffmpeg');
const { getMusicBed } = require('./src/music');
const { generateVoiceover } = require('./src/voiceover');
const { buildStoryboard } = require('./src/storyboard');

const TMP = path.join(__dirname, 'storage', 'tmp', 'pipeline-test');
fs.mkdirSync(TMP, { recursive: true });

async function volumedetect(file) {
  const { runCmd } = require('./src/ffmpeg');
  const { stderr } = await runCmd('ffmpeg', [
    '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  const m = stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  return m ? parseFloat(m[1]) : null;
}

async function main() {
  console.log('== 1. make 2 test clips (720x1280, 8s each) ==');
  const clip1 = path.join(TMP, 'clip1.mp4');
  const clip2 = path.join(TMP, 'clip2.mp4');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=720x1280:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip1]);
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=720x1280:rate=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', clip2]);
  console.log('clips:', (await probe(clip1)).duration, (await probe(clip2)).duration);

  console.log('== 2. storyboard: dialogue + per-character voices ==');
  const sb = buildStoryboard({
    prompt: 'Abdullah saves his father from a tiger in the jungle',
    mode: 'cartoon',
    durationSeconds: 60,
    language: 'ur',
    aspect: '9:16',
    quality: '720p',
  });
  console.log('scenes:', sb.scenes.length, '| totalSeconds:', sb.totalSeconds);
  if (sb.scenes.length !== 8) throw new Error('BAD STORYBOARD SCENE COUNT');
  for (const s of sb.scenes) {
    if (!Array.isArray(s.dialogue) || s.dialogue.length < 1) throw new Error(`Scene ${s.index} has no dialogue`);
    for (const d of s.dialogue) {
      if (!d.character || !d.line || !d.voiceId || !d.voiceProvider) throw new Error(`Scene ${s.index} dialogue missing fields`);
    }
    if (typeof s.narrationStartSec !== 'number' || typeof s.narrationEndSec !== 'number') throw new Error(`Scene ${s.index} missing narration window`);
    if (!s.videoPrompt.includes("Levi's hoodie")) throw new Error(`Scene ${s.index} videoPrompt missing Levi's hoodie`);
    if (!s.videoPrompt.includes('blue-grey sneakers')) throw new Error(`Scene ${s.index} videoPrompt missing blue-grey sneakers`);
  }
  console.log('characterLock:', sb.characterLock.slice(0, 120), '...');
  console.log('scene 1 dialogue:', JSON.stringify(sb.scenes[0].dialogue));
  console.log('scene 8 dialogue (4s finale, 1 line):', JSON.stringify(sb.scenes[7].dialogue));

  console.log('== 3. music bed (placeholder, no library tracks) ==');
  const bed = await getMusicBed({ durationSec: 16, outDir: TMP });
  console.log('bed:', bed.source, bed.musicPath, fs.existsSync(bed.musicPath));

  console.log('== 4. multi-voice voiceover without TTS key (must be script-only, no fake audio) ==');
  const segments = [];
  for (const s of sb.scenes.slice(0, 2)) {
    segments.push({
      text: s.narration, startSec: s.narrationStartSec, endSec: s.narrationEndSec,
      role: 'narration', character: 'Narrator', voice: s.narrationVoice,
    });
    for (const d of s.dialogue) {
      segments.push({
        text: d.line, startSec: d.startSec, endSec: d.endSec,
        role: 'dialogue', character: d.character,
        voice: { provider: d.voiceProvider, voiceId: d.voiceId, pitch: 0 },
      });
    }
  }
  const vo = await generateVoiceover({ segments, language: 'ur', outDir: TMP, tmpDir: TMP });
  console.log('voiceover status:', vo.status, '| voiceTracks:', vo.voiceTracks.length, '| script exists:', fs.existsSync(vo.scriptPath));
  if (vo.status !== 'script-only' || vo.voiceTracks.length !== 0) throw new Error('VOICEOVER MUST BE SCRIPT-ONLY WITHOUT A KEY');
  const script = JSON.parse(fs.readFileSync(vo.scriptPath, 'utf8'));
  if (script.segments.length !== segments.length) throw new Error('SCRIPT SEGMENT COUNT MISMATCH');
  const roles = new Set(script.segments.map((s) => s.role));
  if (!roles.has('narration') || !roles.has('dialogue')) throw new Error('SCRIPT MUST HAVE NARRATION + DIALOGUE');
  console.log('script segments:', script.segments.length, '| roles:', [...roles].join(', '));

  console.log('== 5. assemble with one voice track per voice (tone tracks stand in for TTS) ==');
  // Two per-voice timed tracks: Abdullah (440 Hz tone, 0–4s) + Abbu (330 Hz, 4–8s).
  const trackAbdullah = path.join(TMP, 'voice-abdullah.mp3');
  const trackAbbu = path.join(TMP, 'voice-abbu.mp3');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-af', 'adelay=0:all=1,apad', '-t', '16', '-c:a', 'libmp3lame', '-q:a', '3', trackAbdullah]);
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4',
    '-af', 'adelay=4000:all=1,apad', '-t', '16', '-c:a', 'libmp3lame', '-q:a', '3', trackAbbu]);
  const out = path.join(TMP, 'output.mp4');
  const res = await assemble({
    clips: [
      { path: clip1, durationSec: 8, transition: 'dissolve', sourceHeight: 1280 },
      { path: clip2, durationSec: 8, transition: 'fade to black', sourceHeight: 1280 },
    ],
    captions: [
      { startSec: 0, endSec: 8, text: 'Ruko! Ye kahani aap ko end tak baandh kar rakhegi.' },
      { startSec: 4, endSec: 6, text: 'Abdullah: Aaj ka din meri zindagi badal dega!' },
      { startSec: 8, endSec: 16, text: 'Moral: sachhi bahaduri dil mein hoti hai.' },
    ],
    voiceTracks: [
      { path: trackAbdullah, voice: { provider: 'google-tts', voiceId: 'ur-IN-Wavenet-B' }, character: 'Abdullah' },
      { path: trackAbbu, voice: { provider: 'google-tts', voiceId: 'ur-IN-Standard-B' }, character: 'Abbu' },
    ],
    musicPath: bed.musicPath,
    outputPath: out,
    width: 720,
    height: 1280,
    fps: 30,
    upscale4K: false,
    aspect: '9:16',
    tmpDir: TMP,
  });
  console.log('assemble result:', JSON.stringify(res));
  if (res.voiceTracksUsed !== 2) throw new Error('VOICE TRACKS NOT MIXED');
  const info = await probe(out);
  console.log('output probe:', info.width, 'x', info.height, '| duration:', info.duration.toFixed(2), '| hasAudio:', info.hasAudio, '| size:', fs.statSync(out).size, 'bytes');
  if (!fs.existsSync(out) || info.duration < 14 || info.duration > 17) throw new Error('BAD OUTPUT');
  const meanVol = await volumedetect(out);
  console.log('output mean volume:', meanVol, 'dB');
  if (meanVol === null || meanVol < -60) throw new Error('OUTPUT AUDIO TOO QUIET / MISSING');

  console.log('== 6. assemble with 4K upscale (honesty flag) ==');
  const out4k = path.join(TMP, 'output-4k.mp4');
  const res4k = await assemble({
    clips: [
      { path: clip1, durationSec: 8, transition: 'cut', sourceHeight: 1280 },
      { path: clip2, durationSec: 8, transition: 'cut', sourceHeight: 1280 },
    ],
    captions: [],
    voiceTracks: [],
    musicPath: null,
    outputPath: out4k,
    width: 1080,
    height: 1920,
    fps: 30,
    upscale4K: true,
    aspect: '9:16',
    tmpDir: TMP,
  });
  const info4k = await probe(out4k);
  console.log('4k result:', JSON.stringify(res4k), '| probe:', info4k.width, 'x', info4k.height);
  if (!res4k.upscaled4K || info4k.width !== 2160 || info4k.height !== 3840) throw new Error('BAD 4K OUTPUT');

  console.log('ALL PIPELINE TESTS PASSED');
}

main().catch((err) => {
  console.error('PIPELINE TEST FAILED:', err);
  process.exit(1);
});
