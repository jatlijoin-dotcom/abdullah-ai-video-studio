'use strict';
/**
 * voiceover.js — per-character voice-over for the storyboard's narration
 * and dialogue lines.
 *
 * Every audio segment gets ITS OWN voice:
 *   - each dialogue line is spoken by its character's voice
 *     (character profile: voice_provider + voice_id, else the per-language default)
 *   - narration is spoken by the narrator voice
 *     (settings narrator_voice_provider / narrator_voice_id, else the default)
 * Segments are synthesised separately, then each voice's lines are placed
 * at their scene times (adelay) into one timed track per voice. The jobs
 * pipeline mixes those voice tracks with the music bed and the clip audio.
 *
 * Supported TTS providers (real, key-based):
 *   - ElevenLabs (ELEVENLABS_API_KEY, voice_id per character): multilingual
 *     model eleven_multilingual_v2, works for Urdu / Hindi / English.
 *     Free tier: 10,000 credits/month (~10 min of audio). NO commercial
 *     licence on the free tier; Starter is ~$5–6/month.
 *   - Google Cloud Text-to-Speech (GOOGLE_TTS_API_KEY, voice name per
 *     character): language codes ur-IN / hi-IN / en-US.
 *     NOTE: Google Cloud TTS offers Urdu ONLY as ur-IN (Urdu, India) —
 *     there is NO ur-PK locale. Urdu voices on Google: ur-IN-Standard-A/B,
 *     ur-IN-Wavenet-A/B. A Pakistani-accent Urdu voice is available from
 *     Microsoft Azure (ur-PK-UzmaNeural / ur-PK-AsadNeural) or ElevenLabs.
 *     Free tier: 4M Standard / 1M WaveNet/Neural2 characters per month
 *     (a billing account is required even for the free tier).
 *
 * NO key configured → NO fake audio. The function writes the full script
 * (segments + timings + voice assignments) as JSON (status 'script-only')
 * and returns voiceTracks: [] — the pipeline and the frontend say so
 * honestly. The user can then record the lines or plug in a TTS key later.
 *
 * Google Translate TTS is NOT a production provider here. It is used ONLY
 * in test-audio-pipeline.js as a free test harness to prove the
 * timing/mixing/caption mechanism end-to-end. It must never be wired into
 * this file or the production voice-over path.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { runFfmpeg } = require('./ffmpeg');
const { DEFAULT_VOICES } = require('./storyboard');

// Google Cloud TTS language codes. Urdu is ur-IN only — there is no ur-PK locale.
// Default voices live in storyboard.js (single source of truth).
const TTS_LANG = { ur: 'ur-IN', hi: 'hi-IN', en: 'en-US' };

function ttsProvidersAvailable() {
  return {
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    'google-tts': Boolean(process.env.GOOGLE_TTS_API_KEY),
  };
}

function ttsProviderAvailable() {
  if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (process.env.GOOGLE_TTS_API_KEY) return 'google-tts';
  return null;
}

async function synthesizeElevenLabs(text, voiceId, outPath) {
  const res = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    },
    {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    }
  );
  await fs.promises.writeFile(outPath, res.data);
  return outPath;
}

async function synthesizeGoogleTts(text, language, voice, outPath) {
  const res = await axios.post(
    'https://texttospeech.googleapis.com/v1/text:synthesize',
    {
      input: { text },
      voice: {
        languageCode: TTS_LANG[language] || 'en-US',
        name: voice.voiceId,
        ssmlGender: 'MALE',
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: typeof voice.pitch === 'number' ? voice.pitch : 0,
      },
    },
    { params: { key: process.env.GOOGLE_TTS_API_KEY }, timeout: 60000 }
  );
  const b64 = res.data && res.data.audioContent;
  if (!b64) throw new Error('Google TTS returned no audioContent');
  await fs.promises.writeFile(outPath, Buffer.from(b64, 'base64'));
  return outPath;
}

function voiceKey(voice) {
  return `${voice.provider}:${voice.voiceId}:${typeof voice.pitch === 'number' ? voice.pitch : 0}`;
}

/**
 * Build one timed voice track per voice for a project.
 * @param {Object} opts
 * @param {Array<{text:string,startSec:number,endSec:number,role:'narration'|'dialogue',character:string,voice:{provider:string,voiceId:string,pitch?:number}}>} opts.segments
 * @param {'ur'|'hi'|'en'} opts.language
 * @param {string} opts.outDir   where the tracks + script are written
 * @param {string} opts.tmpDir   scratch dir
 * @returns {Promise<{status:'complete'|'script-only',voiceTracks:Array<{path:string,voice:Object,character:string,role:string}>,scriptPath:string,providers:Object,segments:Array,note?:string}>}
 */
async function generateVoiceover({ segments, language, outDir, tmpDir }) {
  await fs.promises.mkdir(outDir, { recursive: true });
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const scriptPath = path.join(outDir, 'voiceover-script.json');
  const script = {
    language,
    languageCode: TTS_LANG[language] || 'en-US',
    generatedAt: new Date().toISOString(),
    segments: segments.map((s) => ({
      text: s.text,
      startSec: s.startSec,
      endSec: s.endSec,
      role: s.role || 'narration',
      character: s.character || 'Narrator',
      voice: s.voice || null,
    })),
  };
  await fs.promises.writeFile(scriptPath, JSON.stringify(script, null, 2), 'utf8');

  const available = ttsProvidersAvailable();
  const needed = [...new Set(segments.map((s) => (s.voice && s.voice.provider) || null))];
  const missing = needed.filter((p) => p && !available[p]);
  if (missing.length) {
    return {
      status: 'script-only',
      voiceTracks: [],
      scriptPath,
      providers: available,
      segments: script.segments,
      note:
        `No key for TTS provider(s): ${missing.join(', ')}. ` +
        'Full script + timings + voice assignments written to voiceover-script.json — no audio was faked. ' +
        'Set ELEVENLABS_API_KEY (ElevenLabs) or GOOGLE_TTS_API_KEY (Google Cloud TTS) in .env to get real voice-over, ' +
        'or record these lines and place one MP3 per voice in the project folder.',
    };
  }

  const totalDuration = Math.max(...segments.map((s) => s.endSec), 0);

  // Group segments by voice — one timed track per voice.
  const groups = new Map();
  for (const seg of segments) {
    const key = voiceKey(seg.voice);
    if (!groups.has(key)) {
      groups.set(key, { voice: seg.voice, character: seg.character, role: seg.role, segments: [] });
    }
    groups.get(key).segments.push(seg);
  }

  const voiceTracks = [];
  let gi = 0;
  for (const [, group] of groups) {
    const args = ['-y'];
    const delays = [];
    let si = 0;
    for (const seg of group.segments) {
      const segPath = path.join(tmpDir, `vo_g${gi}_s${si}.mp3`);
      if (group.voice.provider === 'elevenlabs') {
        await synthesizeElevenLabs(seg.text, group.voice.voiceId, segPath);
      } else {
        await synthesizeGoogleTts(seg.text, language, group.voice, segPath);
      }
      args.push('-i', segPath);
      delays.push(`[${si}:a]adelay=${Math.round(seg.startSec * 1000)}:all=1[vo${si}]`);
      si++;
    }
    const mixed =
      delays.join(';') +
      ';' +
      delays.map((_, i) => `[vo${i}]`).join('') +
      `amix=inputs=${group.segments.length}:duration=longest:dropout_transition=0[aout]`;
    const safeName = (group.character || 'voice').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const trackPath = path.join(outDir, `voice-${safeName}.mp3`);
    args.push(
      '-filter_complex', mixed,
      '-map', '[aout]',
      '-t', String(totalDuration),
      '-c:a', 'libmp3lame', '-q:a', '3',
      trackPath
    );
    await runFfmpeg(args);
    voiceTracks.push({
      path: trackPath,
      voice: group.voice,
      character: group.character,
      role: group.role,
    });
    gi++;
  }

  return {
    status: 'complete',
    voiceTracks,
    scriptPath,
    providers: available,
    segments: script.segments,
  };
}

module.exports = {
  generateVoiceover,
  ttsProviderAvailable,
  ttsProvidersAvailable,
  TTS_LANG,
  DEFAULT_VOICES,
};
