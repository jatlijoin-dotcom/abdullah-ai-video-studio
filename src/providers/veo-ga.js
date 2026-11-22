'use strict';
/**
 * providers/veo-ga.js — Google Veo 3.1 GA on Google Cloud (Gemini Enterprise
 * Agent Platform / Vertex AI).
 *
 * Verified 2026-11-22 from Google Cloud docs:
 * - Endpoint: POST https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT}
 *   /locations/us-central1/publishers/google/models/{MODEL}:predictLongRunning
 * - Models: veo-3.1-generate-001, veo-3.1-fast-generate-001 (stable GA IDs).
 * - Auth: OAuth2 Bearer token from a service account (JWT -> token exchange).
 * - Poll: POST .../publishers/google/models/{MODEL}:fetchPredictOperation {operationName}.
 * - Output is written to a Cloud Storage bucket you specify (storageUri) and is
 *   then downloaded from there.
 * - Durations: 4, 6 or 8 seconds. Resolution: 720p / 1080p.
 * Docs: https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-an-image
 * Pricing (verify before use): https://cloud.google.com/vertex-ai/generative-ai/pricing
 *
 * Env: GOOGLE_CLOUD_PROJECT (required), GOOGLE_CLOUD_LOCATION (default us-central1),
 * GOOGLE_APPLICATION_CREDENTIALS (path to a service-account JSON key file, required),
 * VEO_GA_MODEL (default veo-3.1-generate-001), VEO_GA_GCS_BUCKET (required).
 *
 * NOT LIVE-TESTED: no Google Cloud project or service-account credentials exist,
 * so no real Veo GA call has ever been made from this code. Endpoint, auth flow
 * and model IDs are verified from the official docs; the response parsing is
 * defensive (several possible field shapes are checked) because the exact result
 * payload could not be observed without credentials. The first live call may need
 * small field adjustments — errors are surfaced, never hidden or faked.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { randomUUID } = require('node:crypto');
const axios = require('axios');
const {
  VideoProvider,
  ProviderError,
  sleep,
  downloadToFile,
} = require('./base');

const POLL_INTERVAL_MS = 10000;
const POLL_TIMEOUT_MS = 12 * 60 * 1000;

let tokenCache = { token: null, expiresAt: 0 };

function b64url(obj) {
  return Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
}

/** Service-account JWT -> OAuth2 access token (cached until shortly before expiry). */
async function getAccessToken() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new ProviderError(
      'PROVIDER_NOT_CONFIGURED',
      'veo-ga: GOOGLE_APPLICATION_CREDENTIALS is not set. Point it at a Google Cloud service-account JSON key file (see README).'
    );
  }
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.token;
  }
  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  } catch (err) {
    throw new ProviderError(
      'PROVIDER_NOT_CONFIGURED',
      `veo-ga: could not read service-account file ${credPath}: ${err.message}`
    );
  }
  if (!creds.client_email || !creds.private_key) {
    throw new ProviderError(
      'PROVIDER_NOT_CONFIGURED',
      'veo-ga: service-account JSON is missing client_email or private_key.'
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${b64url(header)}.${b64url(claims)}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(unsigned), creds.private_key)
    .toString('base64url');
  const jwt = `${unsigned}.${signature}`;

  let res;
  try {
    res = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
      }
    );
  } catch (err) {
    throw new ProviderError(
      'PROVIDER_ERROR',
      `veo-ga: OAuth token exchange failed: ${providerErrorMessage(err)}`
    );
  }
  const token = res.data && res.data.access_token;
  if (!token) {
    throw new ProviderError(
      'PROVIDER_ERROR',
      'veo-ga: OAuth token exchange returned no access_token.'
    );
  }
  tokenCache = {
    token,
    expiresAt: Date.now() + (res.data.expires_in || 3600) * 1000,
  };
  return token;
}

class VeoGaProvider extends VideoProvider {
  get name() {
    return 'veo-ga';
  }

  get model() {
    return process.env.VEO_GA_MODEL || 'veo-3.1-generate-001';
  }

  get location() {
    return process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  }

  get capabilities() {
    return {
      supportsReferenceImage: true,
      maxClipSeconds: 8,
      supportsAudio: true, // Veo 3.1 generates native audio
      native4K: false,
      note: 'Veo 3.1 GA on Google Cloud. Output is written to a Cloud Storage bucket and downloaded from there.',
    };
  }

  estimateCostSeconds(seconds) {
    return {
      amount: null,
      currency: null,
      note: `Veo 3.1 GA is billed by Google Cloud (Vertex AI). Verify the current rate at https://cloud.google.com/vertex-ai/generative-ai/pricing before generating (${seconds}s requested).`,
    };
  }

  _baseUrl() {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'veo-ga: GOOGLE_CLOUD_PROJECT is not set.'
      );
    }
    return `https://${this.location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${this.location}/publishers/google/models/${this.model}`;
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
    const bucket = process.env.VEO_GA_GCS_BUCKET;
    if (!bucket) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'veo-ga: VEO_GA_GCS_BUCKET is not set. Veo on Vertex AI writes its output to a Cloud Storage bucket — create one and set its name here (see README).'
      );
    }
    const token = await getAccessToken();
    // Vertex Veo 3.1 durations are 4, 6 or 8 seconds.
    const duration = durationSec <= 4 ? 4 : durationSec <= 6 ? 6 : 8;

    const instance = { prompt: scenePrompt };
    if (referenceImagePath) {
      const ext = path.extname(referenceImagePath).toLowerCase();
      const mime =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      instance.image = {
        bytesBase64Encoded: fs.readFileSync(referenceImagePath).toString('base64'),
        mimeType: mime,
      };
    }
    const body = {
      instances: [instance],
      parameters: {
        aspectRatio: aspect === '9:16' ? '9:16' : '16:9',
        durationSeconds: duration,
        generateAudio: true,
        resolution: quality === '1080p' || quality === '4K' ? '1080p' : '720p',
        sampleCount: 1,
        storageUri: `gs://${bucket}/veo-ga/${randomUUID()}/`,
      },
    };
    if (negativePrompt) body.parameters.negativePrompt = negativePrompt;

    let operation;
    try {
      const res = await axios.post(
        `${this._baseUrl()}:predictLongRunning`,
        body,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );
      operation = res.data;
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `veo-ga request failed: ${providerErrorMessage(err)}`
      );
    }

    const operationName = operation && operation.name;
    if (!operationName) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `veo-ga did not return an operation name: ${JSON.stringify(operation).slice(0, 300)}`
      );
    }

    const clipPath = await this._pollAndDownload(operationName, token, outDir);
    return {
      clipPath,
      providerJobId: operationName,
      durationSec: duration,
      status: 'complete',
    };
  }

  async checkStatus(operationName) {
    const token = await getAccessToken();
    const op = await this._fetchOperation(operationName, token);
    if (op.error) {
      return { status: 'failed', error: JSON.stringify(op.error).slice(0, 500) };
    }
    if (!op.done) return { status: 'processing' };
    return { status: 'complete' };
  }

  async _fetchOperation(operationName, token) {
    try {
      const res = await axios.post(
        `${this._baseUrl()}:fetchPredictOperation`,
        { operationName },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );
      return res.data;
    } catch (err) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `veo-ga status check failed: ${providerErrorMessage(err)}`
      );
    }
  }

  async _pollAndDownload(operationName, token, outDir) {
    const started = Date.now();
    for (;;) {
      const op = await this._fetchOperation(operationName, token);
      if (op.error) {
        throw new ProviderError(
          'PROVIDER_ERROR',
          `veo-ga operation failed: ${JSON.stringify(op.error).slice(0, 500)}`
        );
      }
      if (op.done) {
        const uri = extractVideoUri(op);
        if (!uri) {
          throw new ProviderError(
            'PROVIDER_ERROR',
            'veo-ga operation finished but returned no video URI.'
          );
        }
        await fs.promises.mkdir(outDir, { recursive: true });
        const dest = path.join(outDir, `veo-ga-${randomUUID()}.mp4`);
        if (uri.startsWith('gs://')) {
          const m = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
          if (!m) {
            throw new ProviderError(
              'PROVIDER_ERROR',
              `veo-ga returned an unreadable GCS URI: ${uri}`
            );
          }
          const dl = `https://storage.googleapis.com/storage/v1/b/${m[1]}/o/${encodeURIComponent(m[2])}?alt=media`;
          await downloadToFile(dl, dest, { Authorization: `Bearer ${token}` });
        } else {
          await downloadToFile(uri, dest, { Authorization: `Bearer ${token}` });
        }
        return dest;
      }
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        throw new ProviderError(
          'PROVIDER_TIMEOUT',
          `veo-ga generation timed out after ${POLL_TIMEOUT_MS / 60000} minutes (operation ${operationName}).`
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

/** The video URI lives in different fields across Vertex responses — check them all. */
function extractVideoUri(op) {
  const resp = op.response || {};
  const videos = resp.videos || [];
  if (videos.length) {
    const v = videos[0];
    if (typeof v === 'string') return v;
    if (v.gcsUri) return v.gcsUri;
    if (v.uri) return v.uri;
  }
  const samples =
    (resp.generateVideoResponse && resp.generateVideoResponse.generatedSamples) ||
    resp.generatedSamples ||
    [];
  if (samples.length) {
    const s = samples[0];
    if (s.video && s.video.uri) return s.video.uri;
    if (s.uri) return s.uri;
  }
  if (resp.videoUri) return resp.videoUri;
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

module.exports = { VeoGaProvider };
