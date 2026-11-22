'use strict';
/**
 * providers/kling.js — Kling 4.0 via the NEW official Kling API.
 *
 * Verified 2026-11-22 (Kling's new official API):
 * - Base URL: https://api-singapore.klingai.com
 * - Auth: Bearer API key (KLING_API_KEY), obtained from the Kling developer console.
 * - Text-to-video: POST /text-to-video/kling-4.0
 * - Image-to-video: POST /image-to-video/kling-4.0
 * - Poll: GET /tasks?task_ids=<task_id>
 * - Model: kling-4.0 (fully available on the API since Oct 28, 2026; 3–30s,
 *   720p/1080p/4K, native audio). kling-4.0-flash (720p, 3–20s) also exists.
 * - The LEGACY design (api.klingai.com + JWT AK/SK + model_name) is for older
 *   models (2.6/2.1) and is NOT used here. Legacy env vars (KLING_ACCESS_KEY /
 *   KLING_SECRET_KEY) are obsolete — use KLING_API_KEY.
 * Docs: https://kling.ai/dev
 * Pricing (verify before use): https://www.klingai.com/pricing
 *
 * Env: KLING_API_KEY (required), KLING_MODEL (default kling-4.0).
 * If no key is configured this adapter throws PROVIDER_NOT_CONFIGURED — never a fake clip.
 *
 * NOT LIVE-TESTED: no API key exists, so no real Kling call has ever been made
 * from this code. Endpoint base, auth and model paths are verified from Kling's
 * official docs and changelog; the request body (prompt + settings) and the
 * task-polling response shape are the documented fields, but the exact JSON
 * shape of the task response could not be observed without a key — the poller
 * therefore checks several possible field shapes and surfaces an error if none
 * match, instead of guessing.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
const axios = require('axios');
const {
  VideoProvider,
  ProviderError,
  sleep,
  downloadToFile,
} = require('./base');

const API_BASE = 'https://api-singapore.klingai.com';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 12 * 60 * 1000;

class KlingProvider extends VideoProvider {
  get name() {
    return 'kling';
  }

  get model() {
    return process.env.KLING_MODEL || 'kling-4.0';
  }

  get capabilities() {
    return {
      supportsReferenceImage: true, // public image URL only — see below
      maxClipSeconds: 30,
      supportsAudio: true, // native audio
      native4K: false,
      note: 'Kling 4.0 (new official API). Reference image must be a public URL.',
    };
  }

  estimateCostSeconds(seconds) {
    return {
      amount: null,
      currency: null,
      note: `Kling 4.0 is billed in credits (Kling API resource packs). No verified per-second USD rate — verify at https://www.klingai.com/pricing before generating (${seconds}s requested).`,
    };
  }

  _client() {
    const apiKey = this.requireKey('KLING_API_KEY');
    return axios.create({
      baseURL: API_BASE,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
  }

  async generateClip({
    scenePrompt,
    negativePrompt,
    referenceImagePath,
    aspect = '9:16',
    quality = '720p',
    durationSec = 8,
    outDir,
  }) {
    const client = this._client();
    // Kling 4.0 supports 3–30s clips.
    const duration = Math.max(3, Math.min(30, Math.round(durationSec || 8)));
    // 4K is requested as 1080p here and upscaled with FFmpeg afterwards (labelled).
    const resolution = quality === '1080p' ? '1080p' : '720p';
    const settings = {
      duration,
      aspect_ratio: aspect === '9:16' ? '9:16' : '16:9',
      resolution,
    };
    if (negativePrompt) settings.negative_prompt = negativePrompt;

    let res;
    try {
      if (referenceImagePath) {
        if (!/^https?:\/\//i.test(referenceImagePath)) {
          throw new ProviderError(
            'REFERENCE_IMAGE_URL_REQUIRED',
            'Kling requires a public image URL for a reference image. A local file cannot be used. Use Omni, Veo GA or Runway (they accept a local image), or upload the character image to a public URL and set the project imageUrl.'
          );
        }
        res = await client.post(`/image-to-video/${this.model}`, {
          image: referenceImagePath,
          prompt: scenePrompt,
          settings,
        });
      } else {
        res = await client.post(`/text-to-video/${this.model}`, {
          prompt: scenePrompt,
          settings,
        });
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Kling request failed: ${providerErrorMessage(err)}`
      );
    }

    const taskId = extractTaskId(res.data);
    if (!taskId) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Kling did not return a task id: ${JSON.stringify(res.data).slice(0, 300)}`
      );
    }
    const clipPath = await this._pollAndDownload(client, taskId, outDir);
    return {
      clipPath,
      providerJobId: taskId,
      durationSec: duration,
      status: 'complete',
    };
  }

  async checkStatus(taskId) {
    const client = this._client();
    const task = await this._fetchTask(client, taskId);
    if (!task) return { status: 'processing' };
    const status = String(task.status || task.task_status || task.state || '').toLowerCase();
    if (['succeed', 'succeeded', 'success', 'completed', 'complete'].includes(status)) {
      return { status: 'complete' };
    }
    if (['failed', 'fail', 'error'].includes(status)) {
      return { status: 'failed', error: JSON.stringify(task).slice(0, 500) };
    }
    return { status: 'processing' };
  }

  async _fetchTask(client, taskId) {
    try {
      const res = await client.get('/tasks', { params: { task_ids: taskId } });
      const data = res.data;
      const tasks = data.tasks || data.data || data.results || [];
      if (Array.isArray(tasks) && tasks.length) return tasks[0];
      if (data && typeof data === 'object' && (data.status || data.task_id || data.id)) return data;
      return null;
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Kling status check failed: ${providerErrorMessage(err)}`
      );
    }
  }

  async _pollAndDownload(client, taskId, outDir) {
    const started = Date.now();
    for (;;) {
      const task = await this._fetchTask(client, taskId);
      const status = task
        ? String(task.status || task.task_status || task.state || '').toLowerCase()
        : '';
      if (['failed', 'fail', 'error'].includes(status)) {
        throw new ProviderError(
          'PROVIDER_ERROR',
          `Kling task failed: ${JSON.stringify(task).slice(0, 500)}`
        );
      }
      if (['succeed', 'succeeded', 'success', 'completed', 'complete'].includes(status)) {
        const url = extractVideoUrl(task);
        if (!url) {
          throw new ProviderError(
            'PROVIDER_ERROR',
            'Kling task succeeded but returned no video URL.'
          );
        }
        await fs.promises.mkdir(outDir, { recursive: true });
        const dest = path.join(outDir, `kling-${randomUUID()}.mp4`);
        await downloadToFile(url, dest);
        return dest;
      }
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        throw new ProviderError(
          'PROVIDER_TIMEOUT',
          `Kling generation timed out after ${POLL_TIMEOUT_MS / 60000} minutes (task ${taskId}).`
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function extractTaskId(data) {
  if (!data) return null;
  if (typeof data === 'string') return data;
  return (
    data.task_id ||
    data.taskId ||
    data.id ||
    (data.data && (data.data.task_id || data.data.taskId || data.data.id)) ||
    null
  );
}

/** The video URL lives in different fields across Kling responses — check them all. */
function extractVideoUrl(task) {
  if (!task) return null;
  const result = task.task_result || task.result || {};
  const videos = result.videos || result.video || [];
  if (Array.isArray(videos) && videos.length) {
    const v = videos[0];
    if (typeof v === 'string') return v;
    if (v.url) return v.url;
  }
  return (
    result.video_url ||
    result.url ||
    result.videoUrl ||
    task.video_url ||
    task.url ||
    null
  );
}

function providerErrorMessage(err) {
  if (err.response && err.response.data) {
    const d = err.response.data;
    if (d.error && d.error.message) return `HTTP ${err.response.status}: ${d.error.message}`;
    if (d.message) return `HTTP ${err.response.status}: ${d.message}`;
    return `HTTP ${err.response.status}: ${JSON.stringify(d).slice(0, 300)}`;
  }
  return err.message || String(err);
}

module.exports = { KlingProvider };
