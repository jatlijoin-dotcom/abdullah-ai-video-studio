'use strict';
/**
 * server.js — Abdullah AI Video Studio backend.
 *
 * Express API + static frontend + background job worker.
 * Run:  npm install && cp .env.example .env && npm start
 * Env:  see .env.example (keys live ONLY in .env, never in code).
 */
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const { spawn } = require('node:child_process');

const { initDb, closeDb } = require('./src/db');
const { startWorker, isDemoMode } = require('./src/jobs');
const { detectConfiguredProvider } = require('./src/providers');
const generateRoutes = require('./src/routes/generate');
const projectRoutes = require('./src/routes/projects');
const characterRoutes = require('./src/routes/characters');
const settingsRoutes = require('./src/routes/settings');
const estimateRoutes = require('./src/routes/estimate');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = require('./package.json').version;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Static frontend — the website in ./frontend/ (index.html, app.js,
// styles.css) is served at /. Registered before the API routes, but it
// only answers for files that actually exist in ./frontend/, so no /api/*
// route is shadowed (verified by the API tests).
app.use(express.static(path.join(__dirname, 'frontend')));

let ffmpegAvailable = false;
function checkFfmpeg() {
  return new Promise((resolve) => {
    const bin = process.env.FFMPEG_PATH || 'ffmpeg';
    const child = spawn(bin, ['-version']);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'abdullah-ai-video-studio',
    version: VERSION,
    demoMode: isDemoMode(),
    configuredProvider: detectConfiguredProvider(),
    ffmpegAvailable,
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

app.use('/api', generateRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/estimate', estimateRoutes);

// SPA fallback: any non-API route serves the frontend index (if present).
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const index = path.join(__dirname, 'frontend', 'index.html');
  res.sendFile(index, (err) => {
    if (err) {
      res.status(404).json({
        error: 'Frontend not installed in ./frontend/. The API is running — see /api/health.',
      });
    }
  });
});

// 404 for unknown API routes.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown API route: ${req.method} ${req.path}` });
});

// Central error handler — always JSON, never a stack leak to the client.
app.use((err, req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: `Upload too large (max ${process.env.MAX_UPLOAD_MB || 20} MB).`,
    });
  }
  if (err && err.message && /Only PNG, JPG or WebP/.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  console.error('[error]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Internal server error. Check the server logs.' });
});

async function main() {
  initDb();
  ffmpegAvailable = await checkFfmpeg();
  if (!ffmpegAvailable) {
    console.warn(
      '[warn] ffmpeg was NOT found on PATH. Video assembly will fail until ffmpeg is installed. ' +
        'Demo Mode (storyboard plans) still works.'
    );
  }
  if (isDemoMode()) {
    console.log('[info] Demo Mode is ON (DEMO_MODE=true or no provider key). Jobs will return storyboard plans, never fake videos.');
  } else {
    console.log(`[info] Provider configured: ${detectConfiguredProvider()}`);
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[info] Abdullah AI Video Studio backend listening on http://${HOST}:${PORT}`);
    console.log(`[info] Website: http://${HOST}:${PORT}/`);
    console.log(`[info] Health: http://${HOST}:${PORT}/api/health`);
  });

  let worker = null;
  if (String(process.env.WORKER_ENABLED || 'true').toLowerCase() !== 'false') {
    worker = startWorker({ pollMs: Number(process.env.WORKER_POLL_MS || 5000) });
  }

  function shutdown(signal) {
    console.log(`[info] ${signal} received — shutting down gracefully…`);
    if (worker) worker.stop();
    server.close(() => {
      closeDb();
      console.log('[info] Shutdown complete.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[fatal] Failed to start:', err);
  process.exit(1);
});
