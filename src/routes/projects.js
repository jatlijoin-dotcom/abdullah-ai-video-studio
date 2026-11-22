'use strict';
/**
 * routes/projects.js — project read/download/delete endpoints.
 * Creation lives in POST /api/generate (routes/generate.js).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { getProject, getProjectWithScenes, listProjects, deleteProject } = require('../projects');
const { getJobByProject } = require('../queue');

const router = express.Router();

function publicProject(p) {
  return {
    id: p.id,
    title: p.title,
    prompt: p.prompt,
    mode: p.mode,
    durationSeconds: p.durationSeconds,
    aspect: p.aspect,
    quality: p.quality,
    language: p.language,
    voiceover: p.voiceover,
    music: p.music,
    characterId: p.characterId,
    status: p.status,
    demo: p.demo,
    upscaled4K: p.upscaled4K,
    error: p.error,
    hasOutput: Boolean(p.outputPath && fs.existsSync(p.outputPath)),
    hasDemoOutput: Boolean(p.demoOutputPath && fs.existsSync(p.demoOutputPath)),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** GET /api/projects — newest first. */
router.get('/', (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  res.json({ projects: listProjects(limit).map(publicProject) });
});

/** GET /api/projects/:id — project + scenes + latest job. */
router.get('/:id', (req, res) => {
  const project = getProjectWithScenes(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const job = getJobByProject(project.id);
  res.json({ project: publicProject(project), scenes: project.scenes, job });
});

/** GET /api/projects/:id/storyboard — the full storyboard JSON. */
router.get('/:id/storyboard', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.storyboard) return res.status(409).json({ error: 'No storyboard for this project yet' });
  res.json({ projectId: project.id, storyboard: project.storyboard });
});

function safeFilename(title, suffix) {
  return `${title.replace(/[^\w\-]+/g, '_')}${suffix}`;
}

/**
 * Stream a file to the client (never load it fully into memory).
 * Content-Disposition: attachment forces Android Chrome to download the file
 * instead of playing it inline.
 */
function streamFile(res, filePath, contentType, filename) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_e) {
    return res.status(404).json({
      error: 'File no longer available',
      message: LOST_FILE_MESSAGE,
      hint: 'Generate the video again and download the MP4 right after it finishes.',
    });
  }
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', stat.size);
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Could not read the file. Please try again.' });
    }
    res.destroy();
  });
  stream.pipe(res);
}

/**
 * Plain-language explanation for a file that was recorded in the database
 * but is no longer on disk — on the free hosting tier this happens whenever
 * the server restarts (spin-down / redeploy wipes the ephemeral filesystem).
 */
const LOST_FILE_MESSAGE =
  'This file is no longer on this server. On the free hosting tier the server ' +
  'forgets everything when it restarts (spin-down or redeploy), so a finished ' +
  'MP4 must be downloaded promptly. Please generate the video again, keep the ' +
  'app open while it renders, and download the MP4 as soon as the job completes.';

/**
 * GET /api/projects/:id/download
 * Real video: the final MP4 (Content-Type video/mp4, attachment download).
 * Demo project: the demo plan (Markdown, attachment download).
 * 404 when the recorded file is gone (free server restarted) — plain language.
 * 409 when nothing is ready yet — never a fake file.
 */
router.get('/:id/download', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (project.outputPath) {
    if (fs.existsSync(project.outputPath)) {
      return streamFile(
        res,
        project.outputPath,
        'video/mp4',
        safeFilename(project.title, '.mp4')
      );
    }
    return res.status(404).json({
      error: 'File no longer available',
      message: LOST_FILE_MESSAGE,
      status: project.status,
      hint: 'Generate the video again and download the MP4 right after it finishes.',
    });
  }
  if (project.demoOutputPath) {
    if (fs.existsSync(project.demoOutputPath)) {
      return streamFile(
        res,
        project.demoOutputPath,
        'text/markdown; charset=utf-8',
        safeFilename(project.title, '-demo-plan.md')
      );
    }
    return res.status(404).json({
      error: 'File no longer available',
      message: LOST_FILE_MESSAGE,
      status: project.status,
      hint: 'Generate the project again to get a fresh demo plan.',
    });
  }
  return res.status(409).json({
    error: 'Nothing to download yet',
    status: project.status,
    hint: project.status === 'demo'
      ? 'This project ran in Demo Mode. Connect a provider and generate again for a real video.'
      : 'The job is still running or has failed. Check GET /api/jobs for the status.',
  });
});

/** DELETE /api/projects/:id — removes the project, scenes, job and files. */
router.delete('/:id', (req, res) => {
  const ok = deleteProject(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Project not found' });
  res.json({ deleted: true, id: req.params.id });
});

module.exports = router;
