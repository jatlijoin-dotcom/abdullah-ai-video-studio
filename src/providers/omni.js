'use strict';
/**
 * providers/omni.js — Gemini Omni Flash (gemini-omni-1.2-flash) via the Gemini API.
 *
 * Docs (verified 2026-11-22): https://ai.google.dev/gemini-api/docs/omni
 * Pricing (verify before use): https://ai.google.dev/gemini-api/docs/pricing
 *
 * REST: POST https://generativelanguage.googleapis.com/v1beta/interactions?key=$API_KEY
 * Body: { model, input, response_format: { type: 'video', aspect_ratio, duration, resolution } }
 * - duration: whole seconds "3s".."15s" (default "10s"); over 15s = invalid argument error.
 * - aspect_ratio: "9:16" | "16:9".
 * - resolution: "360p" | "720p" (default) | "1080p" (upscaled by Google) | "4k" (upscaled by Google).
 * - input: a plain string prompt, or an array of
 *   {type:'image', data: <base64>, mime_type: 'image/jpeg'} + {type:'text', text: <prompt>}
 *   for reference images (up to 6).
 * - Response: synchronous; the video is base64 in steps[] -> an entry with
 *   type "model_output" -> content[] -> {type:'video', mime_type:'video/mp4', data:'...'}.
 * - Native audio is included in every clip.
 * - PAID TIER ONLY — no free tier. Output video $12.00 per 1M tokens:
 *   720p ≈ 5,792 tokens/s ≈ $0.07/s; 1080p (upsampled) $0.104/s;
 *   4K (upsampled) $0.209/s; 360p $0.023/s. Input $1.50 per 1M tokens.
 *
 * Env: GOOGLE_GEMINI_API_KEY (required), OMNI_MODEL (default gemini-omni-1.2-flash).
 * If no key is configured this adapter throws PROVIDER_NOT_CONFIGURED — never a fake clip.
 *
 * Model note (verified 2026-11-22 from the official Gemini API pricing page):
 * gemini-omni-1.2-flash is the CURRENT model. gemini-omni-1.1-flash is the
 * PREVIOUS generation, in a 4-week transition window — effective Dec 3, 2026
 * all requests to 1.1 automatically route to 1.2 and are billed at the lower
 * 1.2 rates. The pricing page lists both models (1.2: output video $12.00/1M
 * tokens ≈ $0.07/s at 720p; 1.1: $17.50/1M tokens ≈ $0.10/s at 720p). Never
 * use 1.1 as the default.
 *
 * NOT LIVE-TESTED: no API key exists, so no real Omni call has ever been made from
 * this code. The endpoint, model, request and response shapes are taken from the
 * official docs above; the first live call may still fail on quota, billing or
 * content policy — the error is surfaced, never hidden.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
const axios = require('axios');
const {
  VideoProvider,
  ProviderError,
} = require('./base');

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — the call is synchronous

// Verified rates from the official Gemini API pricing page (2026-11-22).
// 720p: 5,792 tokens/s x $12.00/1M tokens = $0.0695/s ≈ $0.07/s.
// 1080p (upsampled): 8,688 tokens/s ≈ $0.104/s. 4K (upsampled): 17,376 tokens/s ≈ $0.209/s.
const RATE_PER_SECOND = { '360p': 0.023, '720p': 0.07, '1080p': 0.104, '4K': 0.209 };
const RESOLUTION_FOR_QUALITY = { '720p': '720p', '1080p': '1080p', '4K': '4k' };

class OmniProvider extends VideoProvider {
  get name() {
    return 'omni';
  }

  get model() {
    return process.env.OMNI_MODEL || 'gemini-omni-1.2-flash';
  }

  get capabilities() {
    return {
      supportsReferenceImage: true, // up to 6 reference images
      maxClipSeconds: 15,
      supportsAudio: true, // native audio in every clip
      native4K: false, // 1080p and 4K are upscaled by Google, not native
      resolutionNote:
        '1080p and 4K outputs are upscaled by Google (see the Omni docs). 720p is the native default.',
    };
  }

  estimateCostSeconds(seconds, quality = '720p') {
    const rate = RATE_PER_SECOND[quality] || RATE_PER_SECOND['720p'];
    return {
      amount: seconds * rate,
      currency: 'USD',
      note: `Gemini Omni Flash at ${quality}: $${rate}/s of video (output tokens). Verify the current rate at https://ai.google.dev/gemini-api/docs/pricing before generating.`,
    };
  }

  resolutionForQuality(quality) {
    return RESOLUTION_FOR_QUALITY[quality] || '720p';
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
    const apiKey = this.requireKey('GOOGLE_GEMINI_API_KEY');
    // Omni supports 3s..15s; our scenes are 4s..8s, so clamp defensively.
    const duration = Math.max(3, Math.min(15, Math.round(durationSec || 8)));

    const input = [];
    if (referenceImagePath) {
      const ext = path.extname(referenceImagePath).toLowerCase();
      const mime =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      input.push({
        type: 'image',
        data: fs.readFileSync(referenceImagePath).toString('base64'),
        mime_type: mime,
      });
    }
    let prompt = scenePrompt;
    if (negativePrompt) prompt += `\nAvoid: ${negativePrompt}`;
    input.push({ type: 'text', text: prompt });

    const body = {
      model: this.model,
      // Text-only requests send a plain string; image requests send the array.
      input: input.length === 1 ? input[0].text : input,
      response_format: {
        type: 'video',
        aspect_ratio: aspect === '9:16' ? '9:16' : '16:9',
        duration: `${duration}s`,
        resolution: this.resolutionForQuality(quality),
      },
    };

    let res;
    try {
      res = await axios.post(API_URL, body, {
        params: { key: apiKey },
        timeout: TIMEOUT_MS,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Omni request failed: ${providerErrorMessage(err)}`
      );
    }

    const videoB64 = extractVideoData(res.data);
    if (!videoB64) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Omni returned no video data: ${JSON.stringify(res.data).slice(0, 500)}`
      );
    }

    await fs.promises.mkdir(outDir, { recursive: true });
    const dest = path.join(outDir, `omni-${randomUUID()}.mp4`);
    await fs.promises.writeFile(dest, Buffer.from(videoB64, 'base64'));
    return {
      clipPath: dest,
      providerJobId: (res.data && res.data.id) || null,
      durationSec: duration,
      status: 'complete',
    };
  }

  async checkStatus() {
    return {
      status: 'complete',
      note: 'Omni generation is synchronous — generateClip returns the finished clip.',
    };
  }
}

/** REST shape: steps[] -> model_output -> content[] -> {type:'video', data: base64}. */
function extractVideoData(data) {
  if (!data || typeof data !== 'object') return null;
  const steps = Array.isArray(data.steps) ? data.steps : [];
  for (const step of steps) {
    if (step.type !== 'model_output') continue;
    const content = Array.isArray(step.content) ? step.content : [];
    for (const item of content) {
      if (item.type === 'video' && item.data) return item.data;
    }
  }
  // SDK convenience shape (not expected over REST, tolerated just in case).
  if (data.output_video && data.output_video.data) return data.output_video.data;
  if (data.outputVideo && data.outputVideo.data) return data.outputVideo.data;
  return null;
}

function providerErrorMessage(err) {
  if (err.response && err.response.data) {
    const d = err.response.data;
    if (d.error && d.error.message) return `HTTP ${err.response.status}: ${d.error.message}`;
    return `HTTP ${err.response.status}: ${JSON.stringify(d).slice(0, 300)}`;
  }
  return err.message || String(err);
}

module.exports = { OmniProvider, RATE_PER_SECOND };
