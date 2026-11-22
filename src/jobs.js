'use strict';
/**
 * jobs.js — the pipeline worker.
 *
 * One job = one project, processed step by step:
 *   storyboard (already built at creation) →
 *   scenes_generating (one AI clip per scene via the configured provider) →
 *   voiceover (real TTS when a key exists, otherwise script-only) →
 *   music (library track or generated placeholder bed) →
 *   assembling (FFmpeg: xfade joins, captions, audio mix, optional 4K upscale) →
 *   complete
 *
 * DEMO MODE (DEMO_MODE=true, the default, or no provider configured):
 * the job stops after the storyboard and writes a real, downloadable
 * demo plan (storyboard JSON + a Markdown plan with the scene prompts and
 * instructions to connect a provider). Status becomes 'demo_complete'.
 * It NEVER writes a fake MP4.
 *
 * Errors go through queue.failJob (up to 2 automatic retries).
 */
const fs = require('fs');
const path = require('path');
const { initDb } = require('./db');
const queue = require('./queue');
const {
  getProjectWithScenes,
  updateProject,
  updateSceneClip,
  projectDir,
} = require('./projects');
const { getProvider, detectConfiguredProvider } = require('./providers');
const { ProviderError } = require('./providers/base');
const { generateVoiceover } = require('./voiceover');
const { getMusicBed } = require('./music');
const { assemble, probe } = require('./ffmpeg');

const QUALITY_RESOLUTION = {
  '720p': { '9:16': [720, 1280], '16:9': [1280, 720] },
  '1080p': { '9:16': [1080, 1920], '16:9': [1920, 1080] },
  '4K': { '9:16': [1080, 1920], '16:9': [1920, 1080] }, // base 1080p, then upscale
};

function isDemoMode() {
  if (String(process.env.DEMO_MODE || '').toLowerCase() === 'true') return true;
  if (String(process.env.DEMO_MODE || '').toLowerCase() === 'false') return false;
  return true; // default: demo on
}

/** Decide whether this run can generate real clips. */
function resolveProvider() {
  if (isDemoMode()) return { demo: true, reason: 'DEMO_MODE=true in .env' };
  const db = initDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'provider'").get();
  const preferred = row ? row.value : detectConfiguredProvider();
  const configured = detectConfiguredProvider();
  if (!configured) {
    return { demo: true, reason: 'no AI provider API key is configured' };
  }
  const name = preferred && configured === preferred ? preferred : configured;
  return { demo: false, providerName: name };
}

function demoPlanMarkdown(project, providerInfo) {
  const lines = [];
  lines.push(`# ${project.title} — Demo Plan (NOT a video)`);
  lines.push('');
  lines.push('> **Demo Mode:** no AI video provider is connected, so no video was generated.');
  lines.push('> This file is the real storyboard + scene prompts for your project. Connect a');
  lines.push('> provider (see README.md) and re-run the job to generate real AI clips.');
  lines.push('');
  lines.push(`- **Story:** ${project.prompt}`);
  lines.push(`- **Mode:** ${project.mode} | **Duration:** ${project.durationSeconds}s | **Aspect:** ${project.aspect} | **Quality:** ${project.quality} | **Language:** ${project.language}`);
  lines.push(`- **Why demo:** ${providerInfo.reason}.`);
  lines.push('');
  lines.push('## Character lock');
  lines.push('');
  lines.push('```');
  lines.push(project.storyboard.characterLock);
  lines.push('```');
  lines.push('');
  lines.push('## Scenes');
  lines.push('');
  for (const s of project.storyboard.scenes) {
    lines.push(`### Scene ${s.index + 1} — ${s.startSec}s–${s.endSec}s`);
    lines.push('');
    lines.push(`- **Setting:** ${s.setting}`);
    lines.push(`- **Action:** ${s.action}`);
    lines.push(`- **Camera:** ${s.cameraMovement} | **Transition:** ${s.transition}`);
    lines.push(`- **Narration (${project.language}):** ${s.narration}`);
    if (s.narrationVoice) {
      lines.push(`  - Narration voice: ${s.narrationVoice.provider} / ${s.narrationVoice.voiceId}`);
    }
    for (const d of s.dialogue || []) {
      lines.push(`- **Dialogue — ${d.character} (${d.startSec}s–${d.endSec}s, ${d.voiceProvider} / ${d.voiceId}):** ${d.line}`);
    }
    lines.push(`- **Video prompt:** ${s.videoPrompt}`);
    lines.push(`- **Negative prompt:** ${s.negativePrompt}`);
    lines.push('');
  }
  lines.push('## How to generate the real video');
  lines.push('');
  lines.push('1. Get an API key for one provider (Google AI Studio for Gemini Omni Flash is the cheapest start — get a Gemini API key, enable billing, and check the cost estimate at GET /api/estimate first).');
  lines.push('2. Put it in `.env` (GOOGLE_GEMINI_API_KEY=...) and set DEMO_MODE=false.');
  lines.push('3. Restart the server and create the project again (or re-queue this job).');
  lines.push('4. The pipeline will generate one clip per scene, add per-character voice-over + music, and export one MP4.');
  lines.push('');
  return lines.join('\n');
}

async function runDemoJob(job, project) {
  const dir = projectDir(project.id);
  const planPath = path.join(dir, 'demo-plan.md');
  const providerInfo = resolveProvider();
  fs.writeFileSync(planPath, demoPlanMarkdown(project, providerInfo), 'utf8');
  updateProject(project.id, {
    status: 'demo',
    demo: 1,
    demo_output_path: planPath,
  });
  queue.updateJob(job.id, { status: 'demo_complete', progress: 100, current_step: 'demo plan ready' });
  return { demo: true, demoOutputPath: planPath };
}

/** Reference image handling: Omni / Veo GA / Runway accept local files; Kling/Luma need a public URL. */
function referenceImageFor(providerName, character) {
  if (!character) return null;
  const localPath = character.image_path;
  if (providerName === 'omni' || providerName === 'veo-ga' || providerName === 'runway') return localPath;
  // Kling / Luma: only a public URL works; local files are skipped honestly.
  if (/^https?:\/\//i.test(localPath)) return localPath;
  return null;
}

async function processJob(jobId) {
  const job = queue.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  const project = getProjectWithScenes(job.projectId);
  if (!project) throw new Error(`Project not found for job ${jobId}`);
  if (!project.storyboard) throw new Error(`Project ${project.id} has no storyboard`);

  const dir = projectDir(project.id);
  const clipsDir = path.join(dir, 'clips');
  const tmpDir = path.join(dir, 'tmp');
  fs.mkdirSync(clipsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // ---- Demo Mode: storyboard + plan only, never a fake video. ----
    const resolved = resolveProvider();
    if (resolved.demo) {
      queue.updateProgress(job.id, 50, 'demo mode — writing storyboard plan');
      return await runDemoJob(job, project);
    }

    const providerName = resolved.providerName;
    const provider = getProvider(providerName);
    queue.updateProgress(job.id, 5, `provider: ${providerName}`);

    // Character reference image (if any).
    let character = null;
    if (project.characterId) {
      const db = initDb();
      const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(project.characterId);
      if (row) {
        character = {
          id: row.id,
          name: row.name,
          description: row.description,
          image_path: row.image_path,
        };
      }
    }
    const referenceImagePath = referenceImageFor(providerName, character);
    const refNote = character && !referenceImagePath
      ? ' (reference image skipped: this provider needs a public image URL; character-lock text is still in every prompt)'
      : '';

    // ---- 1) Generate one clip per scene. ----
    queue.updateProgress(job.id, 10, 'scenes_generating');
    const clips = [];
    const scenes = project.scenes;
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const pct = 10 + Math.round(((i + 1) / scenes.length) * 45);
      queue.updateProgress(job.id, pct, `generating scene ${i + 1}/${scenes.length}${refNote}`);
      const result = await provider.generateClip({
        scenePrompt: scene.videoPrompt,
        negativePrompt: scene.negativePrompt,
        referenceImagePath,
        aspect: project.aspect,
        quality: project.quality,
        durationSec: scene.endSec - scene.startSec,
        outDir: clipsDir,
      });
      updateSceneClip(scene.id, { clip_path: result.clipPath, clip_status: 'done' });
      const info = await probe(result.clipPath).catch(() => ({ width: 0, height: 0 }));
      clips.push({
        path: result.clipPath,
        durationSec: scene.endSec - scene.startSec,
        transition: scene.transition,
        sourceWidth: info.width || 0,
        sourceHeight: info.height || 0,
      });
    }

    // ---- 2) Voice-over: narration (narrator voice) + dialogue (each
    // character's own voice), each placed at its scene time. Without a TTS
    // key this is script-only — no fake audio. ----
    queue.updateProgress(job.id, 60, 'voiceover');
    let voiceTracks = [];
    if (project.voiceover) {
      const sbScenes = project.storyboard.scenes;
      const segments = [];
      for (const s of sbScenes) {
        segments.push({
          text: s.narration,
          startSec: s.narrationStartSec != null ? s.narrationStartSec : s.startSec,
          endSec: s.narrationEndSec != null ? s.narrationEndSec : s.startSec + (s.endSec - s.startSec) * 0.45,
          role: 'narration',
          character: 'Narrator',
          voice: s.narrationVoice || { provider: 'google-tts', voiceId: 'ur-IN-Wavenet-B', pitch: 0 },
        });
        for (const d of s.dialogue || []) {
          segments.push({
            text: d.line,
            startSec: d.startSec,
            endSec: d.endSec,
            role: 'dialogue',
            character: d.character,
            voice: { provider: d.voiceProvider || 'google-tts', voiceId: d.voiceId, pitch: 0 },
          });
        }
      }
      const vo = await generateVoiceover({
        segments,
        language: project.language,
        outDir: dir,
        tmpDir,
      });
      voiceTracks = vo.voiceTracks || []; // [] in script-only mode — honest, no fake audio
    }

    // ---- 3) Music bed. ----
    queue.updateProgress(job.id, 70, 'music');
    let musicPath = null;
    if (project.music) {
      const bed = await getMusicBed({ durationSec: project.durationSeconds, outDir: dir });
      musicPath = bed.musicPath;
    }

    // ---- 4) Assemble. ----
    queue.updateProgress(job.id, 78, 'assembling');
    // If the provider already delivered 4K frames (e.g. Omni 4K upscaling),
    // export at 4K without a second FFmpeg upscale and label it honestly.
    const delivered4K =
      project.quality === '4K' &&
      clips.length > 0 &&
      clips.every((c) => Math.max(c.sourceWidth || 0, c.sourceHeight || 0) >= 3840);
    let width;
    let height;
    let upscale4K;
    if (delivered4K) {
      const res4k = { '9:16': [2160, 3840], '16:9': [3840, 2160] };
      [width, height] = res4k[project.aspect] || res4k['9:16'];
      upscale4K = false;
    } else {
      const res = QUALITY_RESOLUTION[project.quality] || QUALITY_RESOLUTION['1080p'];
      [width, height] = res[project.aspect] || res['9:16'];
      upscale4K = project.quality === '4K';
    }
    // Captions cover BOTH narration and dialogue (with the speaker's name).
    const captions = [];
    for (const s of project.storyboard.scenes) {
      captions.push({
        startSec: s.narrationStartSec != null ? s.narrationStartSec : s.startSec,
        endSec: s.narrationEndSec != null ? s.narrationEndSec : s.endSec,
        text: s.narration,
      });
      for (const d of s.dialogue || []) {
        captions.push({ startSec: d.startSec, endSec: d.endSec, text: `${d.character}: ${d.line}` });
      }
    }
    const outputPath = path.join(dir, 'output.mp4');
    const assembled = await assemble({
      clips,
      captions,
      voiceTracks,
      musicPath,
      outputPath,
      width,
      height,
      fps: 30,
      upscale4K,
      upscaleNote: delivered4K ? '4K output upscaled by the video provider (not native 4K)' : null,
      aspect: project.aspect,
      tmpDir,
    });

    updateProject(project.id, {
      status: 'complete',
      output_path: outputPath,
      upscaled_4k: assembled.upscaled4K || delivered4K ? 1 : 0,
    });
    queue.updateJob(job.id, { status: 'complete', progress: 100, current_step: 'complete' });
    return { demo: false, outputPath, upscaled4K: assembled.upscaled4K || delivered4K };
  } catch (err) {
    // Provider-not-configured mid-run (e.g. key removed): fall back to demo, don't fake it.
    if (err instanceof ProviderError && err.code === 'PROVIDER_NOT_CONFIGURED') {
      queue.updateProgress(job.id, 50, 'no provider configured — falling back to demo mode');
      return await runDemoJob(job, project);
    }
    const { willRetry } = queue.failJob(job.id, err);
    if (willRetry) {
      // Re-raise so the worker loop logs it; the job is already re-queued.
      throw new Error(`Job ${jobId} failed (will retry): ${err.message}`);
    }
    updateProject(project.id, { status: 'failed', error: err.message });
    throw err;
  }
}

/** Background worker loop: claim jobs and process them one at a time. */
function startWorker({ pollMs = 5000 } = {}) {
  let running = false;
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped || running) return;
    const job = queue.claimNext();
    if (!job) return;
    running = true;
    try {
      await processJob(job.id);
    } catch (err) {
      console.error(`[worker] job ${job.id} error:`, err.message);
    } finally {
      running = false;
    }
  }

  timer = setInterval(tick, pollMs);
  tick(); // first check immediately
  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}

module.exports = { processJob, startWorker, isDemoMode, resolveProvider };
