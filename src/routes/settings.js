'use strict';
/**
 * routes/settings.js — app settings.
 *
 * SECURITY RULE: this API stores provider NAMES and defaults only.
 * It NEVER accepts or stores raw API keys — keys come from the .env file
 * on the server only. Any request field that looks like a key/secret is
 * rejected with 400 and an explanation.
 */
const express = require('express');
const { initDb, nowIso } = require('../db');
const { listProviders } = require('../providers');
const { isDemoMode } = require('../jobs');

const router = express.Router();

const ALLOWED_KEYS = new Set([
  'provider',
  'default_mode',
  'default_duration_seconds',
  'default_aspect',
  'default_quality',
  'default_language',
  'narrator_voice_provider',
  'narrator_voice_id',
]);

const FORBIDDEN_PATTERN = /(key|secret|token|password|credential)/i;

/** GET /api/settings — current settings + provider table (no keys). */
router.get('/', (req, res) => {
  const db = initDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({
    settings,
    demoMode: isDemoMode(),
    providers: listProviders(),
    note: 'API keys are set in the server .env file only and are never returned by this API.',
  });
});

/** POST /api/settings — update allowed keys only. */
router.post('/', express.json(), (req, res) => {
  const body = req.body || {};
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_PATTERN.test(key)) {
      return res.status(400).json({
        error: `Refused to store "${key}". API keys are never accepted through this API — set them in the server .env file (see .env.example).`,
      });
    }
    if (!ALLOWED_KEYS.has(key)) {
      return res.status(400).json({
        error: `Unknown setting "${key}". Allowed: ${[...ALLOWED_KEYS].join(', ')}.`,
      });
    }
  }
  if (body.provider && !['omni', 'veo-ga', 'runway', 'kling', 'luma'].includes(body.provider)) {
    return res.status(400).json({ error: 'provider must be one of: omni, veo-ga, runway, kling, luma.' });
  }
  if (body.default_duration_seconds && !['30', '60'].includes(String(body.default_duration_seconds))) {
    return res.status(400).json({ error: 'default_duration_seconds must be 30 or 60.' });
  }
  if (body.default_mode && !['realistic', 'cartoon'].includes(body.default_mode)) {
    return res.status(400).json({ error: 'default_mode must be realistic or cartoon.' });
  }
  if (body.default_aspect && !['9:16', '16:9'].includes(body.default_aspect)) {
    return res.status(400).json({ error: 'default_aspect must be 9:16 or 16:9.' });
  }
  if (body.default_quality && !['720p', '1080p', '4K'].includes(body.default_quality)) {
    return res.status(400).json({ error: 'default_quality must be 720p, 1080p or 4K.' });
  }
  if (body.default_language && !['ur', 'hi', 'en'].includes(body.default_language)) {
    return res.status(400).json({ error: 'default_language must be ur, hi or en.' });
  }
  if (body.narrator_voice_provider && !['elevenlabs', 'google-tts'].includes(body.narrator_voice_provider)) {
    return res.status(400).json({ error: "narrator_voice_provider must be 'elevenlabs' or 'google-tts'." });
  }
  if (body.narrator_voice_id !== undefined && String(body.narrator_voice_id).length > 200) {
    return res.status(400).json({ error: 'narrator_voice_id is too long (max 200 characters).' });
  }

  const db = initDb();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  const now = nowIso();
  for (const [key, value] of Object.entries(body)) {
    upsert.run(key, String(value), now);
  }
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({ settings, demoMode: isDemoMode() });
});

module.exports = router;
