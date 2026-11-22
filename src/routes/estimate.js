'use strict';
/**
 * routes/estimate.js — cost estimate for one video, before any money is spent.
 *
 * GET /api/estimate?provider=omni&quality=720p&durationSeconds=60&referenceImage=true
 * Returns the estimated video-model cost (USD + approximate PKR) computed ONLY
 * from the verified rate card in src/providers/index.js, plus a TTS note and
 * the pricing-page URL. Providers without a verified per-second USD rate return
 * amount null with an explanation — a price is never invented.
 *
 * The response also carries:
 * - model / modelNote / verifiedFrom / verifiedAt — which model the estimate
 *   is for, and where the rates were verified (Gemini Omni 1.2 vs 1.1).
 * - breakdown — separate prices for 8s and 60s × 720p / 1080p (+ 4K / 360p),
 *   so the 8s test clip and the full 60s video are priced separately.
 * - previousGeneration — Gemini Omni 1.1 Flash (previous generation) for
 *   comparison; it is more expensive and auto-routes to 1.2 from Dec 3, 2026.
 */
const express = require('express');
const {
  estimateCost,
  estimateCostForSeconds,
  CAPABILITIES,
} = require('../providers');

const router = express.Router();

const PROVIDERS = ['omni', 'veo-ga', 'runway', 'kling', 'luma'];
const QUALITIES = ['720p', '1080p', '4K'];

/** Verified 2026-11-22 from the official Gemini API pricing page. */
const VERIFIED_AT = '2026-11-22';
const OMNI_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing';
const OMNI_MODEL = 'gemini-omni-1.2-flash';
const OMNI_MODEL_NOTE =
  'Gemini Omni Flash 1.2 (gemini-omni-1.2-flash) is the current GA model on ' +
  'the Gemini API. Gemini Omni 1.1 Flash (gemini-omni-1.1-flash) is the ' +
  'previous generation, in a 4-week transition window: effective December 3, ' +
  '2026 all API requests to 1.1 automatically route to 1.2 with no code ' +
  'changes and are billed at the lower 1.2 rates. The official pricing page ' +
  'lists both models — always use 1.2.';
const PREVIOUS_GENERATION = {
  model: 'gemini-omni-1.1-flash',
  rate720pUsdPerSec: 0.1,
  cost8s720pUsd: 0.8,
  cost60s720pUsd: 6.0,
  note: 'Previous generation — more expensive, auto-routes to 1.2 from Dec 3, 2026. Do not use.',
};

/** Breakdown rows in a fixed order: 8s/60s × 720p/1080p first, then 4K/360p. */
const BREAKDOWN_COMBOS = [
  [8, '720p'],
  [8, '1080p'],
  [60, '720p'],
  [60, '1080p'],
  [8, '4K'],
  [60, '4K'],
  [8, '360p'],
  [60, '360p'],
];

router.get('/', (req, res) => {
  const provider = String(req.query.provider || 'omni').toLowerCase();
  const quality = String(req.query.quality || '720p');
  const durationSeconds = Number(req.query.durationSeconds || 60);
  const hasReferenceImage =
    req.query.referenceImage === 'true' || req.query.hasReferenceImage === 'true';

  if (!PROVIDERS.includes(provider)) {
    return res.status(400).json({
      error: `provider must be one of: ${PROVIDERS.join(', ')}`,
    });
  }
  if (!QUALITIES.includes(quality)) {
    return res.status(400).json({ error: 'quality must be one of: 720p, 1080p, 4K' });
  }
  if (![30, 60].includes(durationSeconds)) {
    return res.status(400).json({ error: 'durationSeconds must be 30 or 60' });
  }

  const base = estimateCost({ provider, quality, durationSeconds, hasReferenceImage });
  const cap = CAPABILITIES[provider];

  const breakdown = BREAKDOWN_COMBOS.map(([seconds, q]) =>
    estimateCostForSeconds({ provider, quality: q, seconds, hasReferenceImage })
  );

  res.json({
    ...base,
    // Which model this estimate is for (Omni: the verified current model).
    model: provider === 'omni' ? OMNI_MODEL : cap ? cap.model : provider,
    modelNote:
      provider === 'omni'
        ? OMNI_MODEL_NOTE
        : `${cap ? cap.label : provider} — model per the provider capability table. Verify the current rate on the provider pricing page before generating.`,
    verifiedFrom: provider === 'omni' ? OMNI_PRICING_URL : cap ? cap.pricingUrl : null,
    verifiedAt: VERIFIED_AT,
    // Separate prices: 8s test clip and 60s video × 720p/1080p (+ 4K/360p).
    breakdown,
    // Previous generation, for comparison only (Omni only).
    previousGeneration: provider === 'omni' ? PREVIOUS_GENERATION : null,
  });
});

module.exports = router;
