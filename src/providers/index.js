'use strict';
/**
 * providers/index.js — provider registry, capability table and cost estimation.
 *
 * Current providers (verified 2026-11-22):
 * - omni:   Gemini Omni Flash (gemini-omni-1.2-flash) via the Gemini API — DEFAULT.
 *            Veo 3.1 Preview models are DEAD (shut down Oct 22, 2026) and are not
 *            referenced anywhere in this codebase.
 * - veo-ga: Google Veo 3.1 GA (veo-3.1-generate-001) on Google Cloud / Vertex AI —
 *            needs a Cloud project, billing, a service account and a GCS bucket.
 * - runway: Runway Gen-4.5 (text + image) / Gen-4 Turbo (image only).
 * - kling:  Kling 4.0 (new official API, api-singapore.klingai.com).
 * - luma:   Luma Dream Machine Ray 2 (ray-3.2 is a separate Agents API, not used).
 *
 * Costs: every rate in CAPABILITIES.ratePerSecond is taken from the provider's
 * official pricing page linked in the same entry. A provider with ratePerSecond
 * null has no verified per-second USD rate — estimates return amount null and
 * say so, never an invented number.
 */
const { OmniProvider, RATE_PER_SECOND: OMNI_RATES } = require('./omni');
const { VeoGaProvider } = require('./veo-ga');
const { RunwayProvider } = require('./runway');
const { KlingProvider } = require('./kling');
const { LumaProvider } = require('./luma');
const { ProviderError } = require('./base');

const CLASSES = {
  omni: OmniProvider,
  'veo-ga': VeoGaProvider,
  runway: RunwayProvider,
  kling: KlingProvider,
  luma: LumaProvider,
};

/** Approximate PKR/USD rate used in estimates — labelled approximate everywhere. */
const PKR_PER_USD = 280;

const CAPABILITIES = {
  omni: {
    name: 'omni',
    label: 'Gemini Omni Flash (Gemini API)',
    model: 'gemini-omni-1.2-flash',
    maxClipSeconds: 15,
    supportsReferenceImage: true,
    referenceImageNote: 'Up to 6 reference images are sent with the prompt (base64).',
    supportsAudio: true,
    native4K: false,
    qualityNote:
      'Resolution is settable: 720p native; 1080p and 4K are upscaled by Google (see the Omni docs).',
    envKey: 'GOOGLE_GEMINI_API_KEY',
    signupUrl: 'https://aistudio.google.com/',
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/omni',
    costNote:
      'Paid tier only, no free tier. Output video $12.00/1M tokens: 720p $0.07/s, 1080p (upsampled) $0.104/s, 4K (upsampled) $0.209/s, 360p $0.023/s. Verify the current rate on the pricing page.',
    ratePerSecond: OMNI_RATES,
  },
  'veo-ga': {
    name: 'veo-ga',
    label: 'Google Veo 3.1 GA (Google Cloud / Vertex AI)',
    model: 'veo-3.1-generate-001 (or veo-3.1-fast-generate-001)',
    maxClipSeconds: 8,
    supportsReferenceImage: true,
    referenceImageNote: 'Local image file is uploaded with the request.',
    supportsAudio: true,
    native4K: false,
    qualityNote:
      'Generates 720p / 1080p clips; 4K is an FFmpeg upscale afterwards (labelled as upscaled).',
    envKey: 'GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS + VEO_GA_GCS_BUCKET',
    signupUrl: 'https://console.cloud.google.com/',
    pricingUrl: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
    docsUrl:
      'https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-an-image',
    costNote:
      'Billed by Google Cloud (Vertex AI). NOT live-tested from this code — needs a Cloud project, billing, Vertex AI API enabled, a service account and a GCS bucket. Verify the current rate on the pricing page.',
    ratePerSecond: null,
  },
  runway: {
    name: 'runway',
    label: 'Runway Gen-4.5 / Gen-4 Turbo',
    model: 'gen4.5 (text + image) / gen4_turbo (image only)',
    maxClipSeconds: 10,
    supportsReferenceImage: true,
    referenceImageNote: 'Local image file is sent as a data URI.',
    supportsAudio: false,
    native4K: false,
    qualityNote:
      'Generates up to 720p; 1080p/4K are FFmpeg upscales (labelled as upscaled).',
    envKey: 'RUNWAY_API_KEY',
    signupUrl: 'https://dev.runwayml.com/',
    pricingUrl: 'https://docs.dev.runwayml.com/guides/pricing',
    docsUrl: 'https://docs.dev.runwayml.com/',
    costNote:
      'Credit-based, 1 credit = $0.01: gen4_turbo 5 credits/s ($0.05/s), gen4.5 12 credits/s ($0.12/s). With a character reference image the pipeline uses gen4_turbo; without one it uses gen4.5. Verify the current rate on the pricing page.',
    ratePerSecond: { gen4_turbo: 0.05, gen4_5: 0.12 },
  },
  kling: {
    name: 'kling',
    label: 'Kling 4.0',
    model: 'kling-4.0 (kling-4.0-flash also available)',
    maxClipSeconds: 30,
    supportsReferenceImage: true,
    referenceImageNote:
      'Reference image must be a PUBLIC image URL — a local file is not accepted by Kling.',
    supportsAudio: true,
    native4K: false,
    qualityNote:
      'Generates 720p / 1080p; this adapter requests 1080p for the 4K choice and upscales with FFmpeg (labelled as upscaled).',
    envKey: 'KLING_API_KEY',
    signupUrl: 'https://kling.ai/dev',
    pricingUrl: 'https://www.klingai.com/pricing',
    docsUrl: 'https://kling.ai/dev',
    costNote:
      'Credit-based (Kling API resource packs). No verified per-second USD rate in this repo — verify on the pricing page. NOT live-tested from this code.',
    ratePerSecond: null,
  },
  luma: {
    name: 'luma',
    label: 'Luma Dream Machine (Ray 2)',
    model: 'ray-2',
    maxClipSeconds: 9,
    supportsReferenceImage: true,
    referenceImageNote:
      'Reference image must be a PUBLIC image URL — a local file is not accepted by Luma.',
    supportsAudio: false,
    native4K: false,
    qualityNote:
      'Generates 720p / 1080p (resolution is settable); 4K is an FFmpeg upscale (labelled as upscaled). Ray 3.2 is a separate Luma Agents API and is not implemented here.',
    envKey: 'LUMA_API_KEY',
    signupUrl: 'https://lumalabs.ai/',
    pricingUrl: 'https://lumalabs.ai/pricing',
    docsUrl: 'https://developers.lumalabs.ai/',
    costNote:
      'Credit-based, pay-as-you-go. No verified per-second USD rate in this repo — verify on the pricing page.',
    ratePerSecond: null,
  },
};

function listProviders() {
  return Object.entries(CAPABILITIES).map(([name, info]) => ({
    name,
    ...info,
    configured: isConfigured(name),
  }));
}

function getProvider(name) {
  const C = CLASSES[name];
  if (!C) throw new ProviderError('PROVIDER_NOT_CONFIGURED', `Unknown provider: ${name}`);
  return new C();
}

function isConfigured(name) {
  switch (name) {
    case 'omni':
      return Boolean(process.env.GOOGLE_GEMINI_API_KEY);
    case 'veo-ga':
      return Boolean(
        process.env.GOOGLE_CLOUD_PROJECT &&
          process.env.GOOGLE_APPLICATION_CREDENTIALS &&
          process.env.VEO_GA_GCS_BUCKET
      );
    case 'runway':
      return Boolean(process.env.RUNWAY_API_KEY);
    case 'kling':
      return Boolean(process.env.KLING_API_KEY);
    case 'luma':
      return Boolean(process.env.LUMA_API_KEY);
    default:
      return false;
  }
}

function detectConfiguredProvider() {
  const order = ['omni', 'veo-ga', 'runway', 'kling', 'luma'];
  for (const name of order) {
    if (isConfigured(name)) return name;
  }
  return null;
}

/** Scene durations for a project: 60s -> [8,8,8,8,8,8,8,4]; 30s -> [8,8,8,6]. */
function sceneDurations(durationSeconds) {
  return durationSeconds === 60 ? [8, 8, 8, 8, 8, 8, 8, 4] : [8, 8, 8, 6];
}

/**
 * How many seconds the provider actually bills for, given the scene durations.
 * Each provider rounds differently: Omni charges exact seconds (3–15s clips),
 * Veo GA bills 4/6/8s steps, Runway bills 5s/10s (gen4_turbo) or exact 2–10s
 * (gen4.5), Kling bills exact seconds (3–30s), Luma bills 5s/9s clips.
 */
function billedSeconds(provider, durations, hasReferenceImage = false) {
  switch (provider) {
    case 'omni':
      return durations.reduce((a, b) => a + b, 0);
    case 'veo-ga':
      return durations.reduce((a, d) => a + (d <= 4 ? 4 : d <= 6 ? 6 : 8), 0);
    case 'runway':
      if (hasReferenceImage) {
        // gen4_turbo (image-to-video): 5s or 10s clips.
        return durations.reduce((a, d) => a + (d <= 5 ? 5 : 10), 0);
      }
      // gen4.5 (text-to-video): exact seconds, 2–10s.
      return durations.reduce((a, b) => a + b, 0);
    case 'kling':
      return durations.reduce((a, b) => a + b, 0);
    case 'luma':
      return durations.reduce((a, d) => a + (d <= 5 ? 5 : 9), 0);
    default:
      return durations.reduce((a, b) => a + b, 0);
  }
}

/**
 * Estimate the cost of ONE video. Computed ONLY from the verified rate card
 * above — a provider without a verified per-second USD rate returns
 * videoCostUsd null with an explanation. PKR is approximate (280 PKR/USD).
 */
function estimateCost({
  provider,
  quality = '720p',
  durationSeconds = 60,
  hasReferenceImage = false,
}) {
  const cap = CAPABILITIES[provider];
  const durations = sceneDurations(durationSeconds);
  const billed = billedSeconds(provider, durations, hasReferenceImage);

  let videoCostUsd = null;
  let rateNote = null;
  if (cap && cap.ratePerSecond) {
    let rate;
    if (provider === 'runway') {
      rate = hasReferenceImage
        ? cap.ratePerSecond.gen4_turbo
        : cap.ratePerSecond.gen4_5;
      rateNote = hasReferenceImage
        ? 'Runway gen4_turbo (image-to-video): $0.05/s.'
        : 'Runway gen4.5 (text-to-video): $0.12/s.';
    } else {
      rate = cap.ratePerSecond[quality] ?? cap.ratePerSecond['720p'];
      rateNote = `${cap.label} at ${quality}: $${rate}/s of video.`;
    }
    videoCostUsd = +(billed * rate).toFixed(2);
  }

  const videoCostPkr =
    videoCostUsd === null ? null : Math.round(videoCostUsd * PKR_PER_USD);

  return {
    provider,
    quality,
    durationSeconds,
    billedSeconds: billed,
    videoCostUsd,
    videoCostPkr,
    ttsCostUsd: 0,
    ttsNote:
      'Voice-over is ~$0 within the free tiers: ElevenLabs 10,000 credits/month (~10 min of audio) and Google Cloud TTS 1M Neural2/WaveNet characters/month (billing account required). Beyond that, check the TTS pricing pages.',
    totalUsd: videoCostUsd,
    totalPkr: videoCostPkr,
    currency: 'USD',
    pkrRate: PKR_PER_USD,
    pkrNote: 'PKR is approximate at 280 PKR/USD.',
    pricingUrl: cap ? cap.pricingUrl : null,
    note: videoCostUsd === null
      ? `${cap ? cap.label : provider} has no verified per-second USD rate in this repo — ${cap ? cap.costNote : 'verify the current rate on the provider pricing page before generating.'}`
      : `${rateNote} Estimate only — verify the current rate on the pricing page before generating.`,
  };
}

/**
 * Estimate the cost of ONE clip of `seconds` seconds at a quality.
 * Used for the /api/estimate breakdown (an 8s test clip and a 60s video).
 * Billed seconds use the same per-provider rounding as estimateCost.
 * PKR is computed from the UNROUNDED USD amount (Math.round(amount * 280)),
 * so e.g. 8s at 1080p ($0.832) gives PKR 233, matching the rounded USD $0.83.
 * A quality with no verified rate returns null amounts, never an invented price.
 */
function estimateCostForSeconds({
  provider,
  quality = '720p',
  seconds = 8,
  hasReferenceImage = false,
}) {
  const cap = CAPABILITIES[provider];
  const billed = billedSeconds(provider, [seconds], hasReferenceImage);
  const pricingUrl = cap ? cap.pricingUrl : null;
  const verifyNote =
    'Estimate only — verify the current rate on the pricing page before generating.';

  if (!cap || !cap.ratePerSecond) {
    return {
      durationSeconds: seconds,
      quality,
      billedSeconds: billed,
      videoCostUsd: null,
      videoCostPkr: null,
      pricingUrl,
      note: cap
        ? `${cap.label} has no verified per-second USD rate in this repo — ${cap.costNote} ${verifyNote}`
        : `Unknown provider ${provider}. ${verifyNote}`,
    };
  }

  let rate;
  let rateNote;
  if (provider === 'runway') {
    rate = hasReferenceImage
      ? cap.ratePerSecond.gen4_turbo
      : cap.ratePerSecond.gen4_5;
    rateNote = hasReferenceImage
      ? 'Runway gen4_turbo (image-to-video): $0.05/s.'
      : 'Runway gen4.5 (text-to-video): $0.12/s.';
  } else {
    rate = cap.ratePerSecond[quality];
    if (rate === undefined) {
      return {
        durationSeconds: seconds,
        quality,
        billedSeconds: billed,
        videoCostUsd: null,
        videoCostPkr: null,
        pricingUrl,
        note: `${cap.label} has no verified per-second USD rate for ${quality} in this repo — verify on the pricing page. ${verifyNote}`,
      };
    }
    rateNote = `${cap.label} at ${quality}: $${rate}/s of video.`;
  }

  const amount = billed * rate;
  const videoCostUsd = +amount.toFixed(2);
  const videoCostPkr = Math.round(amount * PKR_PER_USD);
  return {
    durationSeconds: seconds,
    quality,
    billedSeconds: billed,
    videoCostUsd,
    videoCostPkr,
    pricingUrl,
    note: `${rateNote} ${verifyNote}`,
  };
}

module.exports = {
  CLASSES,
  CAPABILITIES,
  PKR_PER_USD,
  listProviders,
  getProvider,
  isConfigured,
  detectConfiguredProvider,
  sceneDurations,
  billedSeconds,
  estimateCost,
  estimateCostForSeconds,
};
