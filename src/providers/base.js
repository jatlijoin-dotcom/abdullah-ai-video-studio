'use strict';
/**
 * providers/base.js — the provider interface every adapter implements.
 *
 * A provider turns ONE scene prompt (+ optional reference image) into ONE
 * video clip file. All adapters share this contract so the pipeline in
 * src/jobs.js never cares which provider is configured.
 *
 * Contract:
 *   generateClip({ scenePrompt, negativePrompt, referenceImagePath,
 *                  aspect, quality, durationSec, outDir })
 *     → Promise<{ clipPath, providerJobId, durationSec, status }>
 *   checkStatus(providerJobId)
 *     → Promise<{ status: 'processing'|'complete'|'failed', clipPath? }>
 *   capabilities → { supportsReferenceImage, maxClipSeconds,
 *                    supportsAudio, native4K }
 *   estimateCostSeconds(seconds) → { amount: null, note } — we never
 *     invent prices; every adapter points at the provider's pricing page.
 *
 * Errors: every adapter throws ProviderError with a machine-readable code.
 *   PROVIDER_NOT_CONFIGURED — no API key in the environment. The pipeline
 *   treats this as "run in Demo Mode", never as a reason to fake a video.
 *   REFERENCE_IMAGE_URL_REQUIRED — provider needs a public image URL.
 *   PROVIDER_ERROR — the provider API rejected the request (message kept).
 *   PROVIDER_TIMEOUT — polling ran out of time.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Read a local image file and return a data: URI (for image-to-video). */
function imageToDataUri(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'image/png';
  const b64 = fs.readFileSync(imagePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

/** Download a URL to a local file (streaming). Throws on HTTP errors. */
async function downloadToFile(url, destPath, headers = {}) {
  const res = await axios.get(url, {
    responseType: 'stream',
    headers,
    maxRedirects: 5,
    timeout: 120000,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new ProviderError(
      'PROVIDER_ERROR',
      `Download failed with HTTP ${res.status} from ${url}`
    );
  }
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const writer = fs.createWriteStream(destPath);
  await new Promise((resolve, reject) => {
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    res.data.on('error', reject);
  });
  return destPath;
}

class VideoProvider {
  constructor(opts = {}) {
    this.opts = opts;
  }

  get name() {
    return 'base';
  }

  get capabilities() {
    return {
      supportsReferenceImage: false,
      maxClipSeconds: 8,
      supportsAudio: false,
      native4K: false,
    };
  }

  /** Human-readable cost note. Never invents a price. */
  estimateCostSeconds(_seconds) {
    return {
      amount: null,
      currency: null,
      note: 'Pricing changes often — verify the current price on the provider pricing page before generating.',
    };
  }

  requireKey(envName) {
    const key = process.env[envName];
    if (!key) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        `${this.name}: no API key configured. Set ${envName} in .env (see .env.example). ` +
          'Without a provider key the backend runs in Demo Mode and cannot generate real AI video.'
      );
    }
    return key;
  }

  async generateClip(_args) {
    throw new ProviderError('PROVIDER_ERROR', `${this.name}: generateClip not implemented`);
  }

  async checkStatus(_jobId) {
    throw new ProviderError('PROVIDER_ERROR', `${this.name}: checkStatus not implemented`);
  }
}

module.exports = {
  VideoProvider,
  ProviderError,
  sleep,
  imageToDataUri,
  downloadToFile,
};
