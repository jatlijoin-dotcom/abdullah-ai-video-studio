'use strict';
/* REAL AUDIO PIPELINE TEST — TEST HARNESS ONLY.
 *
 * Uses Google Translate TTS (translate.google.com/translate_tts) via curl to
 * fetch REAL Urdu speech for 2 dialogue lines (different characters) + 1
 * narration line, then places each line at its scene time with ffmpeg,
 * mixes them with a music bed, assembles a real MP4 with captions
 * (dialogue with the speaker's name + narration), and probes the output.
 * This proves the multi-voice timing / mixing / caption mechanism
 * end-to-end for free.
 *
 * Google Translate TTS is used ONLY in this file. It is NOT wired into
 * src/voiceover.js or the production voice-over path — production uses
 * ElevenLabs or Google Cloud TTS with a key (see src/voiceover.js).
 *
 * Run: node test-audio-pipeline.js
 * Cleans up its own temp files afterwards (only the printed results remain).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { runFfmpeg, probe, assemble, runCmd } = require('./src/ffmpeg');
const { getMusicBed } = require('./src/music');

const TMP = path.join(__dirname, 'storage', 'tmp', 'audio-test');
fs.mkdirSync(TMP, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function ttsFetch(text, outPath) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ur&client=tw-ob`;
  execFileSync('curl', ['-s', '-A', UA, '-o', outPath, url], { timeout: 60000 });
  const size = fs.statSync(outPath).size;
  if (size < 1000) throw new Error(`TTS fetch failed for "${text.slice(0, 30)}..." — only ${size} bytes`);
  return size;
}

async function volumedetect(file) {
  const { stderr } = await runCmd('ffmpeg', [
    '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  const m = stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  return m ? parseFloat(m[1]) : null;
}

async function main() {
  console.log('== 1. fetch real Urdu speech (Google Translate TTS, test harness only) ==');
  const lines = [
    { role: 'dialogue', character: 'Abdullah', text: 'Abbu, main aa gaya! Aap ko kuch nahi hoga!', delayMs: 4000 },
    { role: 'dialogue', character: 'Abbu', text: 'Beta, tum ne kar dikhaya, tum bahadur ho!', delayMs: 8000 },
    { role: 'narration', character: 'Narrator', text: 'Moral: sachhi bahaduri dil mein hoti hai, taqat mein nahi.', delayMs: 12000 },
  ];
  const segs = [];
  for (let i = 0; i < lines.length; i++) {
    const p = path.join(TMP, `seg${i}.mp3`);
    const size = ttsFetch(lines[i].text, p);
    console.log(`  ${lines[i].character} (${lines[i].role}): ${size} bytes`);
    segs.push({ ...lines[i], path: p });
  }

  console.log('== 2. build one timed track per voice (adelay at scene times) ==');
  const voiceTracks = [];
  for (let i = 0; i < segs.length; i++) {
    const out = path.join(TMP, `voice-${segs[i].character.toLowerCase()}.mp3`);
    await runFfmpeg([
      '-y', '-i', segs[i].path,
      '-af', `adelay=${segs[i].delayMs}:all=1,apad`,
      '-t', '16', '-c:a', 'libmp3lame', '-q:a', '3', out,
    ]);
    voiceTracks.push({ path: out, character: segs[i].character });
    console.log(`  track ${segs[i].character}: ${fs.statSync(out).size} bytes`);
  }

  console.log('== 3. make 2 test clips + music bed ==');
  const clip1 = path.join(TMP, 'clip1.mp4');
  const clip2 = path.join(TMP, 'clip2.mp4');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=720x1280:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip1]);
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=720x1280:rate=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', clip2]);
  const bed = await getMusicBed({ durationSec: 16, outDir: TMP });
  console.log('  clips + bed ready:', bed.source);

  console.log('== 4. assemble real MP4 (voice tracks + music + dialogue/narration captions) ==');
  const out = path.join(TMP, 'output.mp4');
  const res = await assemble({
    clips: [
      { path: clip1, durationSec: 8, transition: 'dissolve', sourceHeight: 1280 },
      { path: clip2, durationSec: 8, transition: 'fade to black', sourceHeight: 1280 },
    ],
    captions: [
      { startSec: 0, endSec: 4, text: 'Ruko! Ye kahani aap ko end tak baandh kar rakhegi.' },
      { startSec: 4, endSec: 8, text: 'Abdullah: Abbu, main aa gaya! Aap ko kuch nahi hoga!' },
      { startSec: 8, endSec: 12, text: 'Abbu: Beta, tum ne kar dikhaya, tum bahadur ho!' },
      { startSec: 12, endSec: 16, text: 'Moral: sachhi bahaduri dil mein hoti hai, taqat mein nahi.' },
    ],
    voiceTracks,
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
  if (res.voiceTracksUsed !== 3) throw new Error('VOICE TRACKS NOT MIXED');
  if (!res.captionsApplied) throw new Error('CAPTIONS NOT APPLIED');

  const info = await probe(out);
  const meanVol = await volumedetect(out);
  console.log('output probe:', info.width, 'x', info.height, '| duration:', info.duration.toFixed(2), 's | hasAudio:', info.hasAudio, '| size:', fs.statSync(out).size, 'bytes');
  console.log('output mean volume:', meanVol, 'dB');
  if (!fs.existsSync(out)) throw new Error('NO OUTPUT FILE');
  if (info.duration < 14 || info.duration > 17) throw new Error('BAD OUTPUT DURATION');
  if (!info.hasAudio) throw new Error('OUTPUT HAS NO AUDIO');
  if (meanVol === null || meanVol < -60) throw new Error('OUTPUT AUDIO TOO QUIET / MISSING');

  console.log('REAL AUDIO PIPELINE TEST PASSED');
  console.log('(translate_tts was used here only as a free test harness — it is NOT in the production voice-over path.)');
}

main()
  .catch((err) => {
    console.error('AUDIO PIPELINE TEST FAILED:', err);
    process.exit(1);
  })
  .finally(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });
