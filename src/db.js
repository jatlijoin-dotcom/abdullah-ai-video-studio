'use strict';
/**
 * db.js — SQLite storage (Node's built-in `node:sqlite`, no native build).
 *
 * Why node:sqlite instead of better-sqlite3: better-sqlite3 needs a native
 * compile step (node-gyp) that fails in restricted sandboxes and on some
 * free hosting tiers. `node:sqlite` (Node >= 22) is the same SQLite engine,
 * zero native dependencies, and the on-disk file is a standard SQLite
 * database — you can open it with any SQLite tool. Swapping to
 * better-sqlite3 later is a one-file change (same SQL, same tables).
 *
 * Tables: projects, scenes, characters, jobs, settings.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'storage', 'studio.db');

let db = null;

function getDbPath() {
  return process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : DEFAULT_DB_PATH;
}

/** Open (and create) the database, run migrations, return the handle. */
function initDb() {
  if (db) return db;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('realistic', 'cartoon')),
      duration_seconds INTEGER NOT NULL CHECK (duration_seconds IN (30, 60)),
      aspect TEXT NOT NULL CHECK (aspect IN ('9:16', '16:9')),
      quality TEXT NOT NULL CHECK (quality IN ('720p', '1080p', '4K')),
      language TEXT NOT NULL CHECK (language IN ('ur', 'hi', 'en')),
      voiceover INTEGER NOT NULL DEFAULT 1,
      music INTEGER NOT NULL DEFAULT 1,
      character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      demo INTEGER NOT NULL DEFAULT 0,
      output_path TEXT,
      demo_output_path TEXT,
      upscaled_4k INTEGER NOT NULL DEFAULT 0,
      storyboard_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      setting TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      camera_movement TEXT NOT NULL DEFAULT '',
      transition TEXT NOT NULL DEFAULT 'cut',
      narration TEXT NOT NULL DEFAULT '',
      video_prompt TEXT NOT NULL DEFAULT '',
      negative_prompt TEXT NOT NULL DEFAULT '',
      clip_path TEXT,
      clip_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      UNIQUE (project_id, idx)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      current_step TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      retries INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Seed default settings (only if the table is empty).
  const count = d.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
  if (count === 0) {
    const now = new Date().toISOString();
    const seed = d.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)'
    );
    seed.run('provider', process.env.DEFAULT_PROVIDER || 'omni', now);
    seed.run('default_mode', 'cartoon', now);
    seed.run('default_duration_seconds', '60', now);
    seed.run('default_aspect', '9:16', now);
    seed.run('default_quality', '1080p', now);
    seed.run('default_language', 'ur', now);
    seed.run('narrator_voice_provider', 'google-tts', now);
    seed.run('narrator_voice_id', '', now);
  }

  // Migrations for databases created by older versions:
  // - characters: per-character voice fields (voice_provider / voice_id / voice_name).
  const charCols = d.prepare('PRAGMA table_info(characters)').all().map((c) => c.name);
  if (!charCols.includes('voice_provider')) d.exec("ALTER TABLE characters ADD COLUMN voice_provider TEXT");
  if (!charCols.includes('voice_id')) d.exec("ALTER TABLE characters ADD COLUMN voice_id TEXT");
  if (!charCols.includes('voice_name')) d.exec("ALTER TABLE characters ADD COLUMN voice_name TEXT");
  // - settings: narrator voice keys (seeded above for new DBs).
  const setRows = d.prepare('SELECT key FROM settings').all().map((r) => r.key);
  const now2 = new Date().toISOString();
  const seed2 = d.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
  if (!setRows.includes('narrator_voice_provider')) seed2.run('narrator_voice_provider', 'google-tts', now2);
  if (!setRows.includes('narrator_voice_id')) seed2.run('narrator_voice_id', '', now2);
  // - the old default provider was 'veo' (Veo 3.1 Preview, dead since Oct 22, 2026):
  //   migrate any existing 'veo' setting to the new default 'omni'.
  d.prepare("UPDATE settings SET value = 'omni' WHERE key = 'provider' AND value = 'veo'").run();
}

/** Close the database (used on graceful shutdown). */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { initDb, getDbPath, closeDb, nowIso };
