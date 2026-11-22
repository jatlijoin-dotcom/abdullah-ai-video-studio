'use strict';
/**
 * providers/luma.js — Luma Dream Machine (Ray 2) API adapter.
 *
 * Docs: https://developers.lumalabs.ai/
 * Pricing (verify before use): https://lumalabs.ai/pricing
 *
 * Ray 2: 5s or 9s clips, resolution 540p / 720p / 1080p / 4k. Text-to-video
 * via prompt; image-to-video via keyframes.frame0 (image URL). Like Kling,
 * Luma needs a PUBLIC image URL for reference images — a local file path
 * throws REFERENCE_IMAGE_URL_REQUIRED.
 *
 * NOTE: Ray 3.2 exists, but ONLY via the separate Luma Agents API (a different
 * product with its own keys and billing) — it is NOT part of the Dream
 * Machine API and is not implemented here.
 *
 * Env: LUMA_API_KEY (required).
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

const API_BASE = 'https://api.lumalabs.ai/dream-machine/v1';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

class LumaProvider extends VideoProvider {
  get name() {
    return 'luma';
  }

  get capabilities() {
    return {
      supportsReferenceImage: true, // public image URL only (see below)
      maxClipSeconds: 9,
      supportsAudio: false,
      native4K: false,
    };
  }

  estimateCostSeconds(seconds) {
    return {
      amount: null,
      currency: null,
      note: `Luma Dream Machine is credit-based. Verify the current rate at https://lumalabs.ai/pricing before generating (${seconds}s requested).`,
    };
  }

  _client() {
    const apiKey = this.requireKey('LUMA_API_KEY');
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
    referenceImagePath,
    aspect = '9:16',
    durationSec = 8,
    outDir,
  }) {
    const client = this._client();
    // Ray 2 supports 5s and 9s. Resolution is settable (540p/720p/1080p/4k);
    // 4K is requested as 1080p here and upscaled with FFmpeg afterwards (labelled).
    const duration = durationSec >= 8 ? '9s' : '5s';
    const resolution = quality === '1080p' ? '1080p' : '720p';
    const body = {
      prompt: scenePrompt,
      aspect_ratio: aspect === '9:16' ? '9:16' : '16:9',
      model: 'ray-2',
      duration,
      resolution,
    };
    if (referenceImagePath) {
      if (!/^https?:\/\//i.test(referenceImagePath)) {
        throw new ProviderError(
          'REFERENCE_IMAGE_URL_REQUIRED',
          'luma: image-to-video needs a publicly reachable image URL. ' +
            'The reference image is a local file, which Luma cannot fetch. ' +
            'Upload the character image to public storage (or use Omni, Veo GA or Runway, which accept local images) and pass its URL.'
        );
      }
      body.keyframes = { frame0: { type: 'image', url: referenceImagePath } };
    }

    let generation;
    try {
      const res = await client.post('/generations', body);
      generation = res.data;
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Luma request failed: ${providerErrorMessage(err)}`
      );
    }
    if (!generation || !generation.id) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Luma did not return a generation id: ${JSON.stringify(generation).slice(0, 300)}`
      );
    }
    const clipPath = await this._pollAndDownload(generation.id, client, outDir);
    return {
      clipPath,
      providerJobId: generation.id,
      durationSec: duration === '9s' ? 9 : 5,
      status: 'complete',
    };
  }

  async checkStatus(generationId) {
    const client = this._client();
    const gen = await this._getGeneration(generationId, client);
    if (gen.state === 'completed') return { status: 'complete', generation: gen };
    if (gen.state === 'failed') {
      return { status: 'failed', error: gen.failure_reason || 'unknown' };
    }
    return { status: 'processing' };
  }

  async _getGeneration(id, client) {
    try {
      const res = await client.get(`/generations/${id}`);
      return res.data;
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Luma status check failed: ${providerErrorMessage(err)}`
      );
    }
  }

  async _pollAndDownload(id, client, outDir) {
    const started = Date.now();
    for (;;) {
      const gen = await this._getGeneration(id, client);
      if (gen.state === 'completed') {
        const url = gen.assets && gen.assets.video;
        if (!url) {
          throw new ProviderError('PROVIDER_ERROR', 'Luma generation completed but returned no video URL.');
        }
        await fs.promises.mkdir(outDir, { recursive: true });
        const dest = path.join(outDir, `luma-${randomUUID()}.mp4`);
        await downloadToFile(url, dest);
        return dest;
      }
      if (gen.state === 'failed') {
        throw new ProviderError(
          'PROVIDER_ERROR',
          `Luma generation failed: ${gen.failure_reason || 'unknown reason'}`
        );
      }
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        throw new ProviderError(
          'PROVIDER_TIMEOUT',
          `Luma generation timed out after ${POLL_TIMEOUT_MS / 60000} minutes (generation ${id}).`
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

module.exports = { LumaProvider };
