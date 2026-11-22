'use strict';
/**
 * routes/characters.js — Character Lock profiles.
 * Upload a reference image (phone gallery works — standard file input),
 * and the character's description is repeated verbatim in every scene
 * prompt (see src/storyboard.js) while the image is passed to providers
 * that support image conditioning (Omni, Veo GA, Runway).
 *
 * Optional voice fields (form fields, same multipart request):
 *   voice_provider: 'elevenlabs' | 'google-tts' (default 'google-tts' when
 *     a voice_id is given without a provider)
 *   voice_id:       ElevenLabs voice_id, or a Google Cloud TTS voice name
 *                   (e.g. 'ur-IN-Wavenet-B')
 *   voice_name:     display label (e.g. 'Abdullah — young male')
 * The voice is used for that character's dialogue lines; the narrator
 * voice is separate (settings narrator_voice_provider / narrator_voice_id).
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { initDb, nowIso } = require('../db');

const router = express.Router();

function charactersDir() {
  return path.join(
    process.env.STORAGE_PATH || path.join(__dirname, '..', '..', 'storage'),
    'characters'
  );
}

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 20);

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      const dir = charactersDir();
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPG or WebP images are accepted as a character reference.'));
  },
});

/** POST /api/characters — multipart: image (file), name, description, optional voice fields. */
router.post('/', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'A reference image file (field "image") is required.' });
  }
  const name = (req.body.name || '').trim();
  const description = (req.body.description || '').trim();
  if (name.length < 2) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Character name must be at least 2 characters.' });
  }
  if (description.length < 10) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      error: 'Character description must be at least 10 characters — describe face, hair, clothes and body so every scene can repeat it.',
    });
  }
  // Optional voice fields.
  const voiceId = (req.body.voice_id || '').trim().slice(0, 200) || null;
  let voiceProvider = (req.body.voice_provider || '').trim().toLowerCase() || null;
  const voiceName = (req.body.voice_name || '').trim().slice(0, 120) || null;
  if (voiceProvider && !['elevenlabs', 'google-tts'].includes(voiceProvider)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "voice_provider must be 'elevenlabs' or 'google-tts'." });
  }
  if (voiceId && !voiceProvider) voiceProvider = 'google-tts';
  if (voiceName && !voiceId) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'voice_name needs a voice_id too.' });
  }
  const db = initDb();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO characters (id, name, description, image_path, voice_provider, voice_id, voice_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, description, req.file.path, voiceProvider, voiceId, voiceName, nowIso());
  res.status(201).json({
    character: {
      id,
      name,
      description,
      imagePath: req.file.path,
      voiceProvider,
      voiceId,
      voiceName,
      createdAt: nowIso(),
    },
  });
});

/** GET /api/characters — list all character profiles. */
router.get('/', (req, res) => {
  const db = initDb();
  const rows = db
    .prepare('SELECT * FROM characters ORDER BY created_at DESC')
    .all();
  res.json({
    characters: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      imagePath: r.image_path,
      voiceProvider: r.voice_provider || null,
      voiceId: r.voice_id || null,
      voiceName: r.voice_name || null,
      createdAt: r.created_at,
    })),
  });
});

/** DELETE /api/characters/:id — removes the profile and its image file. */
router.delete('/:id', (req, res) => {
  const db = initDb();
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  db.prepare('DELETE FROM characters WHERE id = ?').run(req.params.id);
  try { fs.unlinkSync(row.image_path); } catch (_) { /* already gone */ }
  res.json({ deleted: true, id: req.params.id });
});

module.exports = router;
