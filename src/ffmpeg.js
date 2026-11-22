'use strict';
/**
 * ffmpeg.js — video assembly with FFmpeg (direct spawn, no wrapper lib).
 *
 * assemble():
 *   - normalises every scene clip to the target resolution/fps (centre
 *     crop, no stretching), trims (or loops) each clip to its scene length
 *   - joins clips with xfade transitions (type/duration per scene)
 *   - burns Roman Urdu / English narration captions (one drawtext per line
 *     — drawtext does NOT understand \n, a lesson learned the hard way)
 *   - mixes scene audio (low) + one timed voice track per voice (dialogue
 *     per character + narration) + music bed, loudnorm
 *   - upscales to 4K with lanczos ONLY when requested, and labels the
 *     output honestly as upscaled (never native 4K); if the provider
 *     already delivered 4K frames, upscaleNote records that instead
 *   - exports MP4 (H.264 + AAC, faststart)
 *
 * Every ffmpeg failure throws with the tail of stderr — never silent.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('node:child_process');

function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}
function ffprobeBin() {
  return process.env.FFPROBE_PATH || 'ffprobe';
}

/** Run ffmpeg/ffprobe with an argv array; rejects on non-zero exit. */
function runCmd(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => reject(new Error(`${bin} failed to start: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const tail = stderr.trim().split('\n').slice(-15).join('\n');
        reject(new Error(`${bin} exited with code ${code}:\n${tail}`));
      }
    });
  });
}

async function runFfmpeg(args) {
  return runCmd(ffmpegBin(), args);
}

/** Probe a media file: { width, height, duration, fps, hasAudio, hasVideo }. */
async function probe(file) {
  const { stdout } = await runCmd(ffprobeBin(), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,duration,codec_type',
    '-show_entries', 'format=duration',
    '-of', 'json',
    file,
  ]);
  const data = JSON.parse(stdout);
  const stream = (data.streams && data.streams[0]) || {};
  const fpsParts = (stream.r_frame_rate || '30/1').split('/').map(Number);
  const fps = fpsParts[1] ? fpsParts[0] / fpsParts[1] : 30;
  const duration = parseFloat(stream.duration || (data.format && data.format.duration) || 0);
  // Check for an audio stream.
  let hasAudio = false;
  try {
    const a = await runCmd(ffprobeBin(), [
      '-v', 'error', '-select_streams', 'a',
      '-show_entries', 'stream=index', '-of', 'csv=p=0', file,
    ]);
    hasAudio = a.stdout.trim().length > 0;
  } catch (_) {
    hasAudio = false;
  }
  return {
    width: stream.width || 0,
    height: stream.height || 0,
    duration,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
    hasAudio,
    hasVideo: Boolean(stream.width),
  };
}

function pickFont() {
  const candidates = [
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/** Word-aware split of a caption into lines of at most maxChars. */
function splitCaption(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3); // never more than 3 lines per caption
}

/** xfade transition type + duration for a storyboard transition name. */
function xfadeFor(transition) {
  switch ((transition || 'cut').toLowerCase()) {
    case 'dissolve': return { type: 'dissolve', dur: 0.5 };
    case 'fade': return { type: 'fade', dur: 0.5 };
    case 'wipe': return { type: 'wipeleft', dur: 0.5 };
    case 'fade to white': return { type: 'fadewhite', dur: 0.6 };
    case 'fade to black': return { type: 'fadeblack', dur: 0.6 };
    case 'cut':
    default: return { type: 'fade', dur: 0.08 };
  }
}

/**
 * Assemble the final video.
 * @param {Object} opts
 * @param {Array<{path:string,durationSec:number,transition:string}>} opts.clips
 * @param {Array<{startSec:number,endSec:number,text:string}>} [opts.captions]
 * @param {Array<{path:string}>} [opts.voiceTracks]  one pre-timed track per voice
 * @param {string|null} [opts.voiceoverPath]  legacy single voice-over file (kept for compat)
 * @param {string|null} [opts.musicPath]
 * @param {string} opts.outputPath
 * @param {number} [opts.width]   target width (default by aspect)
 * @param {number} [opts.height]  target height
 * @param {number} [opts.fps=30]
 * @param {boolean} [opts.upscale4K]  scale final output to 3840x2160
 * @param {string|null} [opts.upscaleNote]  extra note for the metadata comment
 *   (e.g. when the provider already delivered 4K frames)
 * @param {string} opts.tmpDir    scratch dir for caption text files
 * @returns {Promise<{outputPath,durationSec,upscaled4K,width,height,captionsApplied,voiceTracksUsed}>}
 */
async function assemble(opts) {
  const {
    clips,
    captions = [],
    voiceTracks = [],
    voiceoverPath = null,
    musicPath = null,
    outputPath,
    fps = 30,
    upscale4K = false,
    upscaleNote = null,
    tmpDir,
  } = opts;
  if (!clips || !clips.length) throw new Error('assemble: no clips provided');
  if (!tmpDir) throw new Error('assemble: tmpDir is required');

  const aspect = opts.aspect || '9:16';
  const baseW = opts.width || (aspect === '9:16' ? 720 : 1280);
  const baseH = opts.height || (aspect === '9:16' ? 1280 : 720);
  const outW = upscale4K ? (aspect === '9:16' ? 2160 : 3840) : baseW;
  const outH = upscale4K ? (aspect === '9:16' ? 3840 : 2160) : baseH;
  const nativeMaxH = Math.max(...clips.map((c) => c.sourceHeight || baseH));
  const actuallyUpscaled = Boolean(upscale4K) && nativeMaxH < outH;

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.mkdir(tmpDir, { recursive: true });

  // Probe clips (durations + audio presence).
  const infos = [];
  for (const c of clips) infos.push(await probe(c.path));

  const n = clips.length;
  const args = ['-y'];
  const inputIndex = { video: [], audio: [] };

  // Video inputs (loop short clips so every scene fills its length).
  clips.forEach((c, i) => {
    const dur = infos[i].duration || c.durationSec;
    if (dur > 0 && dur < c.durationSec) args.push('-stream_loop', '-1');
    args.push('-i', c.path);
    inputIndex.video.push(i);
  });
  let nextInput = n;
  const voiceTrackInputs = [];
  if (voiceTracks && voiceTracks.length) {
    for (const vt of voiceTracks) {
      args.push('-i', vt.path);
      voiceTrackInputs.push(nextInput++);
    }
  }
  if (voiceoverPath) { args.push('-i', voiceoverPath); inputIndex.voiceover = nextInput++; }
  if (musicPath) { args.push('-i', musicPath); inputIndex.music = nextInput++; }

  const filters = [];

  // 1) Normalise each clip: trim to scene length, scale+crop, fps, format.
  for (let i = 0; i < n; i++) {
    filters.push(
      `[${i}:v]trim=0:${clips[i].durationSec},setpts=PTS-STARTPTS,` +
      `scale=${baseW}:${baseH}:force_original_aspect_ratio=increase,` +
      `crop=${baseW}:${baseH},setsar=1,fps=${fps},format=yuv420p[v${i}]`
    );
  }

  // 2) xfade chain.
  const trans = [];
  for (let i = 0; i < n - 1; i++) trans.push(xfadeFor(clips[i].transition));
  let current = 'v0';
  let runningDur = clips[0].durationSec;
  for (let i = 1; i < n; i++) {
    const t = trans[i - 1];
    const offset = Math.max(0, runningDur - t.dur);
    const out = i === n - 1 ? 'vx' : `x${i}`;
    filters.push(
      `[${current}][v${i}]xfade=transition=${t.type}:duration=${t.dur}:offset=${offset.toFixed(3)}[${out}]`
    );
    current = out;
    runningDur = runningDur + clips[i].durationSec - t.dur;
  }
  const totalDur = runningDur;

  // 3) Gentle fade-out at the end + optional 4K upscale.
  let videoOut = current;
  filters.push(`[${videoOut}]fade=t=out:st=${Math.max(0, totalDur - 0.6).toFixed(3)}:d=0.6[vfade]`);
  videoOut = 'vfade';
  if (upscale4K) {
    filters.push(`[${videoOut}]scale=${outW}:${outH}:flags=lanczos[vup]`);
    videoOut = 'vup';
  }

  // 4) Captions — one drawtext per line (drawtext does not understand \n).
  //    Caption windows are shifted by the cumulative transition overlap.
  const font = pickFont();
  let captionsApplied = false;
  if (font && captions.length) {
    const maxChars = Math.max(18, Math.floor(baseW / 24));
    const fontSize = Math.max(28, Math.round(baseW * 0.055));
    const lineH = fontSize + 8;
    let cumTrans = 0;
    captions.forEach((cap, ci) => {
      const lines = splitCaption(cap.text, maxChars);
      const bandH = lines.length * lineH + 20;
      const bandY = baseH - bandH - 8;
      const adjStart = Math.max(0, cap.startSec - cumTrans);
      const adjEnd = Math.max(adjStart + 0.5, cap.endSec - cumTrans);
      const enable = `between(t,${adjStart.toFixed(2)},${adjEnd.toFixed(2)})`;
      filters.push(
        `[${videoOut}]drawbox=x=0:y=${bandY}:w=${baseW}:h=${bandH}:color=black@0.85:t=fill:enable='${enable}'[vbox${ci}]`
      );
      videoOut = `vbox${ci}`;
      lines.forEach((line, li) => {
        const txtFile = path.join(tmpDir, `cap_${ci}_${li}.txt`);
        fs.writeFileSync(txtFile, line, 'utf8');
        const y = bandY + 10 + li * lineH;
        filters.push(
          `[${videoOut}]drawtext=fontfile=${font}:textfile='${txtFile}':` +
          `fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${y}:` +
          `enable='${enable}'[vtxt${ci}_${li}]`
        );
        videoOut = `vtxt${ci}_${li}`;
      });
      cumTrans += ci < trans.length ? trans[ci].dur : 0;
    });
    captionsApplied = true;
  }

  // 5) Audio: clip audio (low) + one timed voice track per voice +
  //    legacy single voice-over (if any) + music bed → loudnorm.
  const clipAudioLabels = [];
  infos.forEach((info, i) => {
    if (info.hasAudio) {
      filters.push(`[${i}:a]volume=0.35,aresample=44100,apad[a${i}]`);
      clipAudioLabels.push(`[a${i}]`);
    }
  });
  const mixInputs = [];
  voiceTrackInputs.forEach((idx, i) => {
    filters.push(`[${idx}:a]aresample=44100,apad[vt${i}]`);
    mixInputs.push(`[vt${i}]`);
  });
  if (voiceoverPath) {
    filters.push(`[${inputIndex.voiceover}:a]aresample=44100,apad[vo]`);
    mixInputs.push('[vo]');
  }
  if (musicPath) {
    filters.push(`[${inputIndex.music}:a]volume=0.22,aresample=44100,apad[mu]`);
    mixInputs.push('[mu]');
  }
  clipAudioLabels.forEach((label) => mixInputs.push(label));

  let audioOut = null;
  if (mixInputs.length) {
    filters.push(
      `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0,` +
      `loudnorm=I=-16:TP=-1.5:LRA=11[aout]`
    );
    audioOut = '[aout]';
  } else {
    filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${totalDur.toFixed(2)}[aout]`);
    audioOut = '[aout]';
  }

  args.push('-filter_complex', filters.join(';'));
  args.push('-map', `[${videoOut}]`);
  args.push('-map', audioOut);
  const comment =
    'Abdullah AI Video Studio' +
    (actuallyUpscaled ? ' — upscaled to 4K from lower-resolution clips (NOT native 4K)' : '') +
    (upscaleNote ? ` — ${upscaleNote}` : '');
  args.push(
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-t', totalDur.toFixed(3),
    '-metadata', `comment=${comment}`,
    outputPath
  );

  await runFfmpeg(args);

  return {
    outputPath,
    durationSec: totalDur,
    upscaled4K: actuallyUpscaled,
    width: outW,
    height: outH,
    captionsApplied,
    voiceTracksUsed: voiceTrackInputs.length,
  };
}

module.exports = { runFfmpeg, runCmd, probe, assemble, pickFont, splitCaption };
