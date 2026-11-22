'use strict';
/**
 * providers/runway.js — Runway Gen-4 API adapter.
 *
 * Docs: https://docs.dev.runwayml.com/
 * Pricing (verify before use): https://docs.dev.runwayml.com/guides/pricing
 *
 * Verified 2026-11-22 from docs.dev.runwayml.com (models page):
 * - gen4.5 is the flagship: text-to-video AND image-to-video, 2–10s,
 *   12 credits/sec ≈ $0.12/s, ratios 1280:720 / 720:1280.
 * - gen4_turbo is the fast model: 5 credits/sec ≈ $0.05/s, 5s or 10s,
 *   image-to-video ONLY — it does NOT support text-to-video.
 *   (The old code posted text_to_video with gen4_turbo — that was a bug.)
 * - 1 credit = $0.01. Runway credits are the same across Gen-4 models.
 * Audio: Gen-4 video has no generated audio track — the pipeline adds
 * voice-over + music in FFmpeg.
 *
 * Env: RUNWAY_API_KEY (required), RUNWAY_MODEL (optional override:
 * 'gen4.5' or 'gen4_turbo'; default is automatic — gen4.5 for text,
 * gen4_turbo for image).
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
const axios = require('axios');
const {
  VideoProvider,
  ProviderError,
  sleep,
  imageToDataUri,
  downloadToFile,
} = require('./base');

const API_BASE = 'https://api.dev.runwayml.com/v1';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const RATE_PER_SECOND = { gen4_turbo: 0.05, gen4_5: 0.12 };

class RunwayProvider extends VideoProvider {
  get name() {
    return 'runway';
  }

  get capabilities() {
    return {
      supportsReferenceImage: true,
      maxClipSeconds: 10,
      supportsAudio: false,
      native4K: false,
    };
  }

  estimateCostSeconds(seconds, model = 'gen4.5') {
    const rate = RATE_PER_SECOND[model] || RATE_PER_SECOND.gen4_5;
    return {
      amount: seconds * rate,
      currency: 'USD',
      note: `Runway ${model} at $${rate}/s (1 credit = $0.01). Verify the current rate at https://docs.dev.runwayml.com/guides/pricing before generating.`,
    };
  }

  _client(apiKey) {
    return axios.create({
      baseURL: API_BASE,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Runway-Version': '2024-11-06',
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
  }

  async generateClip({
    scenePrompt,
    referenceImagePath,
    aspect = '9:16',
    durationSec = 8,
    outDir,
  }) {
    const apiKey = this.requireKey('RUNWAY_API_KEY');
    const client = this._client(apiKey);
    const ratio = aspect === '9:16' ? '720:1280' : '1280:720';

    // gen4_turbo is image-to-video only; gen4.5 handles text-to-video.
    const override = process.env.RUNWAY_MODEL;
    let model;
    let duration;
    if (referenceImagePath) {
      model = override === 'gen4.5' ? 'gen4.5' : 'gen4_turbo';
      duration = model === 'gen4.5'
        ? Math.max(2, Math.min(10, Math.round(durationSec || 8)))
        : durationSec >= 8 ? 10 : 5;
    } else {
      model = 'gen4.5'; // gen4_turbo does NOT support text-to-video
      duration = Math.max(2, Math.min(10, Math.round(durationSec || 8)));
    }

    let task;
    try {
      if (referenceImagePath) {
        const res = await client.post('/image_to_video', {
          model,
          promptImage: imageToDataUri(referenceImagePath),
          promptText: scenePrompt,
          ratio,
          duration,
        });
        task = res.data;
      } else {
        const res = await client.post('/text_to_video', {
          model,
          promptText: scenePrompt,
          ratio,
          duration,
        });
        task = res.data;
      }
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Runway request failed: ${providerErrorMessage(err)}`
      );
    }

    if (!task || !task.id) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Runway did not return a task id: ${JSON.stringify(task).slice(0, 300)}`
      );
    }

    const clipPath = await this._pollAndDownload(task.id, client, outDir);
    return {
      clipPath,
      providerJobId: task.id,
      durationSec: duration,
      status: 'complete',
    };
  }

  async checkStatus(taskId) {
    const apiKey = this.requireKey('RUNWAY_API_KEY');
    const task = await this._getTask(taskId, this._client(apiKey));
    if (task.status === 'SUCCEEDED') return { status: 'complete', output: task.output };
    if (task.status === 'FAILED') {
      return { status: 'failed', error: task.failure || task.failureCode || 'unknown' };
    }
    return { status: 'processing' };
  }

  async _getTask(taskId, client) {
    try {
      const res = await client.get(`/tasks/${taskId}`);
      return res.data;
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Runway status check failed: ${providerErrorMessage(err)}`
      );
    }
  }

  async _pollAndDownload(taskId, client, outDir) {
    const started = Date.now();
    for (;;) {
      const task = await this._getTask(taskId, client);
      if (task.status === 'SUCCEEDED') {
        const url = task.output && task.output[0];
        if (!url) {
          throw new ProviderError('PROVIDER_ERROR', 'Runway task succeeded but returned no video URL.');
        }
        await fs.promises.mkdir(outDir, { recursive: true });
        const dest = path.join(outDir, `runway-${randomUUID()}.mp4`);
        await downloadToFile(url, dest);
        return dest;
      }
      if (task.status === 'FAILED') {
        throw new ProviderError(
          'PROVIDER_ERROR',
          `Runway generation failed: ${task.failure || task.failureCode || 'unknown reason'}`
        );
      }
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        throw new ProviderError(
          'PROVIDER_TIMEOUT',
          `Runway generation timed out after ${POLL_TIMEOUT_MS / 60000} minutes (task ${taskId}).`
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function providerErrorMessage(err) {
  if (err.response && err.response.data) {
    return `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 300)}`;
  }
  return err.message || String(err);
}

module.exports = { RunwayProvider, RATE_PER_SECOND };
