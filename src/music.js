'use strict';
/**
 * music.js — background music bed.
 *
 * Two sources, in priority order:
 *   1. The user's own royalty-free tracks in storage/music/ (mp3/wav/ogg/
 *      m4a). The first file alphabetically is picked deterministically,
 *      looped/trimmed to the video length and faded out. Drop your own
 *      tracks here — that is the recommended setup.
 *   2. A generated ambient pad (sine-wave chord, quiet, with fade in/out)
 *      made with FFmpeg. This is REAL synthesised audio, clearly labelled
 *      as a placeholder bed — it is not a recording and not a song.
 *      Use it only until you add real royalty-free music.
 *
 * Never use commercial music: baking a singer's song into a video risks
 * a YouTube Content ID claim.
 */
const fs = require('fs');
const path = require('path');
const { runFfmpeg } = require('./ffmpeg');

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);

function musicDir() {
  return path.join(process.env.STORAGE_PATH || path.join(__dirname, '..', 'storage'), 'music');
}

/** List royalty-free tracks the user placed in storage/music/. */
function listLibraryTracks() {
  const dir = musicDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => AUDIO_EXTS.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Produce a music bed of exactly `durationSec` seconds.
 * @returns {Promise<{musicPath:string,source:'library'|'generated-placeholder',track:string|null,note:string}>}
 */
async function getMusicBed({ durationSec, outDir }) {
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'music-bed.mp3');
  const tracks = listLibraryTracks();

  if (tracks.length) {
    const track = tracks[0];
    // Loop the track to the video length, fade out the last 2 seconds.
    await runFfmpeg([
      '-y',
      '-stream_loop', '-1',
      '-i', track,
      '-t', String(durationSec),
      '-af', `afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, durationSec - 2)}:d=2`,
      '-c:a', 'libmp3lame', '-q:a', '4',
      outPath,
    ]);
    return {
      musicPath: outPath,
      source: 'library',
      track: path.basename(track),
      note: `Using your royalty-free track "${path.basename(track)}" from storage/music/.`,
    };
  }

  // Placeholder: a soft A-major pad (220 + 277.18 + 329.63 Hz), quiet.
  await runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', `sine=frequency=220:duration=${durationSec}`,
    '-f', 'lavfi', '-i', `sine=frequency=277.18:duration=${durationSec}`,
    '-f', 'lavfi', '-i', `sine=frequency=329.63:duration=${durationSec}`,
    '-filter_complex',
    '[0:a][1:a][2:a]amix=inputs=3:normalize=0,volume=0.18,' +
      `afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, durationSec - 2)}:d=2[aout]`,
    '-map', '[aout]',
    '-t', String(durationSec),
    '-c:a', 'libmp3lame', '-q:a', '4',
    outPath,
  ]);
  return {
    musicPath: outPath,
    source: 'generated-placeholder',
    track: null,
    note: 'No royalty-free track found in storage/music/ — a soft generated ambient pad was used instead. ' +
      'Add your own royalty-free MP3/WAV files to storage/music/ for real background music.',
  };
}

module.exports = { getMusicBed, listLibraryTracks, musicDir };
