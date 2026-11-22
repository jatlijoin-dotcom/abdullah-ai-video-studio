'use strict';
/**
 * routes/generate.js — start a video generation + check job status.
 *
 * POST /api/generate
 *   Body: { prompt, mode, durationSeconds, aspect, quality, language,
 *           voiceover?, music?, characterId? }
 *   Creates the project (with a real storyboard), queues the job and
 *   returns { projectId, jobId, status, demo }.
 *   demo=true means: no provider is configured (or DEMO_MODE is on), so
 *   the job will return a storyboard plan — NOT a video. The response
 *   says so plainly.
 *
 * GET /api/jobs/:id — job status + progress + project summary.
 * GET /api/jobs     — recent jobs.
 */
const express = require('express');
const { initDb } = require('../db');
const { createProject, getProject } = require('../projects');
const queue = require('../queue');
const { isDemoMode, resolveProvider } = require('../jobs');
const { estimateCost } = require('../providers');
const { MODES, LANGUAGES, ASPECTS, DURATIONS } = require('../storyboard');

const router = express.Router();

const QUALITIES = ['720p', '1080p', '4K'];

function validateGenerateBody(body) {
  const errors = [];
  const b = body || {};
  if (typeof b.prompt !== 'string' || b.prompt.trim().length < 3) {
    errors.push('prompt must be at least 3 characters long');
  }
  if (!MODES.includes(b.mode)) errors.push(`mode must be one of: ${MODES.join(', ')}`);
  if (!DURATIONS.includes(b.durationSeconds)) {
    errors.push(`durationSeconds must be one of: ${DURATIONS.join(', ')}`);
  }
  if (!ASPECTS.includes(b.aspect)) errors.push(`aspect must be one of: ${ASPECTS.join(', ')}`);
  if (!QUALITIES.includes(b.quality)) errors.push(`quality must be one of: ${QUALITIES.join(', ')}`);
  if (!LANGUAGES.includes(b.language)) errors.push(`language must be one of: ${LANGUAGES.join(', ')}`);
  if (b.voiceover !== undefined && typeof b.voiceover !== 'boolean') errors.push('voiceover must be true or false');
  if (b.music !== undefined && typeof b.music !== 'boolean') errors.push('music must be true or false');
  if (b.characterId !== undefined && b.characterId !== null && typeof b.characterId !== 'string') {
    errors.push('characterId must be a string');
  }
  return { errors, b };
}

router.post('/generate', (req, res) => {
  const { errors, b } = validateGenerateBody(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  // Character must exist if one was chosen.
  let character = null;
  if (b.characterId) {
    const db = initDb();
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(b.characterId);
    if (!row) return res.status(400).json({ error: `Character not found: ${b.characterId}` });
    character = {
      name: row.name,
      description: row.description,
      voice_provider: row.voice_provider || null,
      voice_id: row.voice_id || null,
      voice_name: row.voice_name || null,
    };
  }

  let project;
  try {
    project = createProject({
      prompt: b.prompt,
      mode: b.mode,
      durationSeconds: b.durationSeconds,
      aspect: b.aspect,
      quality: b.quality,
      language: b.language,
      voiceover: b.voiceover !== false,
      music: b.music !== false,
      characterId: b.characterId || null,
      character,
    });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  const job = queue.createJob(project.id);
  const resolved = resolveProvider();
  const demo = resolved.demo;

  // Cost estimate for this video (verified rate card only — never invented).
  // In demo mode the estimate uses the configured provider preference (or omni).
  let estimate = null;
  try {
    const db = initDb();
    const provRow = db.prepare("SELECT value FROM settings WHERE key = 'provider'").get();
    const estProvider = demo ? (provRow && provRow.value) || 'omni' : resolved.providerName;
    estimate = estimateCost({
      provider: estProvider,
      quality: b.quality,
      durationSeconds: b.durationSeconds,
      hasReferenceImage: Boolean(b.characterId),
    });
  } catch (_) {
    estimate = null;
  }

  res.status(202).json({
    projectId: project.id,
    jobId: job.id,
    title: project.title,
    status: job.status,
    demo,
    demoReason: demo ? resolved.reason : null,
    estimatedCostUsd: estimate ? estimate.videoCostUsd : null,
    estimatedCostPkr: estimate ? estimate.videoCostPkr : null,
    estimate,
    message: demo
      ? 'Demo Mode: no AI video provider is connected. This job will return a real storyboard + scene-prompt plan — not a video. Connect a provider key in .env to generate real AI clips.'
      : `Job queued with provider "${resolved.providerName}". Poll GET /api/jobs/${job.id} for progress.`,
  });
});

router.get('/jobs/:id', (req, res) => {
  const job = queue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const project = getProject(job.projectId);
  res.json({
    job,
    project: project
      ? {
          id: project.id,
          title: project.title,
          status: project.status,
          demo: project.demo,
          upscaled4K: project.upscaled4K,
          error: project.error,
        }
      : null,
    demoMode: isDemoMode(),
  });
});

router.get('/jobs', (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  res.json({ jobs: queue.listJobs(limit) });
});

module.exports = router;
