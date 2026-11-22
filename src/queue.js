'use strict';
/**
 * queue.js — persistent job queue backed by SQLite.
 *
 * Statuses: queued → processing → scenes_generating → voiceover →
 * assembling → complete | failed | demo_complete
 * (demo_complete = Demo Mode finished: storyboard + plan delivered, no video)
 *
 * Failed jobs retry automatically up to MAX_RETRIES times, then stay
 * 'failed' with the error message stored for the frontend to show.
 */
const { randomUUID } = require('node:crypto');
const { initDb, nowIso } = require('./db');

const MAX_RETRIES = 2;

const VALID_STATUSES = [
  'queued',
  'processing',
  'scenes_generating',
  'voiceover',
  'assembling',
  'complete',
  'demo_complete',
  'failed',
];

function createJob(projectId) {
  const db = initDb();
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO jobs (id, project_id, status, progress, current_step, error, retries, created_at, updated_at)
     VALUES (?, ?, 'queued', 0, 'queued', NULL, 0, ?, ?)`
  ).run(id, projectId, now, now);
  return getJob(id);
}

function getJob(id) {
  const db = initDb();
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? normalize(row) : null;
}

function getJobByProject(projectId) {
  const db = initDb();
  const row = db
    .prepare('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(projectId);
  return row ? normalize(row) : null;
}

function listJobs(limit = 50) {
  const db = initDb();
  return db
    .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map(normalize);
}

/** Claim the oldest queued job and mark it processing. Returns null if none. */
function claimNext() {
  const db = initDb();
  const row = db
    .prepare(
      `SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`
    )
    .get();
  if (!row) return null;
  updateJob(row.id, { status: 'processing', progress: 1, current_step: 'starting' });
  return getJob(row.id);
}

function updateJob(id, patch) {
  const db = initDb();
  const allowed = ['status', 'progress', 'current_step', 'error', 'retries'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      if (key === 'status' && !VALID_STATUSES.includes(patch[key])) {
        throw new Error(`Invalid job status: ${patch[key]}`);
      }
      sets.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (!sets.length) return getJob(id);
  sets.push('updated_at = ?');
  values.push(nowIso());
  values.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getJob(id);
}

function updateProgress(id, progress, step) {
  return updateJob(id, {
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    current_step: step,
  });
}

/**
 * Mark a job failed. If retries remain, re-queue it (status 'queued',
 * retries + 1) so the worker picks it up again; otherwise leave 'failed'.
 * Returns { job, willRetry }.
 */
function failJob(id, error) {
  const job = getJob(id);
  if (!job) return { job: null, willRetry: false };
  const message = error instanceof Error ? error.message : String(error);
  if (job.retries < MAX_RETRIES) {
    const next = updateJob(id, {
      status: 'queued',
      error: message,
      retries: job.retries + 1,
      current_step: `retry ${job.retries + 1}/${MAX_RETRIES} after error`,
    });
    return { job: next, willRetry: true };
  }
  const next = updateJob(id, {
    status: 'failed',
    error: message,
    current_step: 'failed',
  });
  return { job: next, willRetry: false };
}

function normalize(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    progress: row.progress,
    currentStep: row.current_step,
    error: row.error,
    retries: row.retries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  createJob,
  getJob,
  getJobByProject,
  listJobs,
  claimNext,
  updateJob,
  updateProgress,
  failJob,
  MAX_RETRIES,
  VALID_STATUSES,
};
