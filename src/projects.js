'use strict';
/**
 * projects.js — project CRUD service (used by the routes and the worker).
 * A project owns one storyboard, its scenes, one job and (eventually) one
 * output MP4. Files live under storage/projects/<projectId>/.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
const { initDb, nowIso } = require('./db');
const { buildStoryboard } = require('./storyboard');

function storageRoot() {
  return path.resolve(process.env.STORAGE_PATH || path.join(__dirname, '..', 'storage'));
}

function projectDir(projectId) {
  return path.join(storageRoot(), 'projects', projectId);
}

/** Create a project + its scenes from a validated generate request. */
function createProject(input) {
  const db = initDb();
  // Narrator voice override from settings (empty id = use the per-language default).
  let narratorVoice = null;
  const nvp = db.prepare("SELECT value FROM settings WHERE key = 'narrator_voice_provider'").get();
  const nvi = db.prepare("SELECT value FROM settings WHERE key = 'narrator_voice_id'").get();
  if (nvi && nvi.value) {
    narratorVoice = {
      provider: (nvp && nvp.value) || 'google-tts',
      voiceId: nvi.value,
      pitch: 0,
    };
  }
  const storyboard = buildStoryboard({
    prompt: input.prompt,
    mode: input.mode,
    durationSeconds: input.durationSeconds,
    language: input.language,
    aspect: input.aspect,
    quality: input.quality,
    character: input.character || null,
    narratorVoice,
  });

  const id = randomUUID();
  const now = nowIso();
  const dir = projectDir(id);
  fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });

  db.prepare(
    `INSERT INTO projects
       (id, title, prompt, mode, duration_seconds, aspect, quality, language,
        voiceover, music, character_id, status, demo, output_path, demo_output_path,
        upscaled_4k, storyboard_json, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, NULL, NULL, 0, ?, NULL, ?, ?)`
  ).run(
    id,
    storyboard.title,
    input.prompt.trim(),
    input.mode,
    input.durationSeconds,
    input.aspect,
    input.quality,
    input.language,
    input.voiceover ? 1 : 0,
    input.music ? 1 : 0,
    input.characterId || null,
    JSON.stringify(storyboard),
    now,
    now
  );

  const insertScene = db.prepare(
    `INSERT INTO scenes
       (id, project_id, idx, start_sec, end_sec, setting, action,
        camera_movement, transition, narration, video_prompt, negative_prompt,
        clip_path, clip_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?)`
  );
  for (const s of storyboard.scenes) {
    insertScene.run(
      randomUUID(), id, s.index, s.startSec, s.endSec, s.setting, s.action,
      s.cameraMovement, s.transition, s.narration, s.videoPrompt,
      s.negativePrompt, now
    );
  }

  // Persist the storyboard next to the project files too.
  fs.writeFileSync(
    path.join(dir, 'storyboard.json'),
    JSON.stringify(storyboard, null, 2),
    'utf8'
  );

  return getProject(id);
}

function getProject(id) {
  const db = initDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return row ? normalizeProject(row) : null;
}

function getProjectWithScenes(id) {
  const project = getProject(id);
  if (!project) return null;
  const db = initDb();
  const scenes = db
    .prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY idx ASC')
    .all(id)
    .map(normalizeScene);
  // Merge dialogue + narration windows from the storyboard (the scenes table
  // does not store them; they live in the storyboard JSON).
  if (project.storyboard && Array.isArray(project.storyboard.scenes)) {
    scenes.forEach((s, i) => {
      const ss = project.storyboard.scenes[i];
      if (ss) {
        s.dialogue = ss.dialogue || [];
        s.narrationStartSec = ss.narrationStartSec;
        s.narrationEndSec = ss.narrationEndSec;
        s.narrationVoice = ss.narrationVoice;
      }
    });
  }
  return { ...project, scenes };
}

function listProjects(limit = 50) {
  const db = initDb();
  return db
    .prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map(normalizeProject);
}

function updateProject(id, patch) {
  const db = initDb();
  const allowed = [
    'status', 'demo', 'output_path', 'demo_output_path',
    'upscaled_4k', 'error', 'storyboard_json',
  ];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (!sets.length) return getProject(id);
  sets.push('updated_at = ?');
  values.push(nowIso());
  values.push(id);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getProject(id);
}

function updateSceneClip(sceneId, patch) {
  const db = initDb();
  const allowed = ['clip_path', 'clip_status'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (!sets.length) return;
  values.push(sceneId);
  db.prepare(`UPDATE scenes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

/** Delete a project, its scenes/jobs and its files on disk. */
function deleteProject(id) {
  const project = getProject(id);
  if (!project) return false;
  const db = initDb();
  db.prepare('DELETE FROM jobs WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM scenes WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  fs.rmSync(projectDir(id), { recursive: true, force: true });
  return true;
}

function normalizeProject(row) {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    mode: row.mode,
    durationSeconds: row.duration_seconds,
    aspect: row.aspect,
    quality: row.quality,
    language: row.language,
    voiceover: Boolean(row.voiceover),
    music: Boolean(row.music),
    characterId: row.character_id,
    status: row.status,
    demo: Boolean(row.demo),
    outputPath: row.output_path,
    demoOutputPath: row.demo_output_path,
    upscaled4K: Boolean(row.upscaled_4k),
    storyboard: row.storyboard_json ? JSON.parse(row.storyboard_json) : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeScene(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    index: row.idx,
    startSec: row.start_sec,
    endSec: row.end_sec,
    setting: row.setting,
    action: row.action,
    cameraMovement: row.camera_movement,
    transition: row.transition,
    narration: row.narration,
    videoPrompt: row.video_prompt,
    negativePrompt: row.negative_prompt,
    clipPath: row.clip_path,
    clipStatus: row.clip_status,
    createdAt: row.created_at,
  };
}

module.exports = {
  createProject,
  getProject,
  getProjectWithScenes,
  listProjects,
  updateProject,
  updateSceneClip,
  deleteProject,
  projectDir,
  storageRoot,
};
