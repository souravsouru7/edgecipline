"use strict";

// AI price table. The one place prices live: change a rate here (or add a
// dated row) and every cost figure follows, without touching a service.
//
// Source: aistudio.google.com/docs/pricing (paid tier, standard), read
// 2026-11-28. USD per 1M tokens. Thinking tokens bill at the output rate.
// Bump PRICING_VERSION on any edit; each AiUsage row stores the version its
// cost was computed with.

const PRICING_VERSION = "2026-11-28.1";

// Rows per model, oldest first. The row in force at the call time wins.
const MODEL_RATES = {
  "gemini-3.6-flash": [
    { effectiveFrom: "2000-01-01", inputPer1M: 0.75, outputPer1M: 3.75, cachedInputPer1M: 0.075 },
    { effectiveFrom: "2027-01-01", inputPer1M: 1.50, outputPer1M: 7.50, cachedInputPer1M: 0.15 },
  ],
  "gemini-3.8-flash": [
    { effectiveFrom: "2000-01-01", inputPer1M: 0.75, outputPer1M: 3.75, cachedInputPer1M: 0.075 },
    { effectiveFrom: "2027-01-01", inputPer1M: 1.50, outputPer1M: 7.50, cachedInputPer1M: 0.15 },
  ],
  "gemini-3.5-flash-lite": [
    { effectiveFrom: "2000-01-01", inputPer1M: 0.30, outputPer1M: 2.50, cachedInputPer1M: 0.03 },
  ],
  // 404 "no longer available" for this project (live test 2026-11-28); kept for old rows.
  "gemini-2.5-flash-lite": [
    { effectiveFrom: "2000-01-01", inputPer1M: 0.10, outputPer1M: 0.40, cachedInputPer1M: 0.01 },
  ],
  "gpt-4o-mini": [
    { effectiveFrom: "2000-01-01", inputPer1M: 0.15, outputPer1M: 0.60, cachedInputPer1M: 0.075 },
  ],
};

// Deprecated names Google serves (and bills) as another model.
const MODEL_ALIASES = {
  // "automatically routes API requests to gemini-3.6-flash" (deprecations page)
  "gemini-3.5-flash": "gemini-3.6-flash",
  // From 2026-12-01 billed as 3.5 Flash-Lite.
  "gemini-2.5-flash": "gemini-3.5-flash-lite",
};

// Cloud Vision: $ per 1,000 units (each documentTextDetection / textDetection
// call is one unit). The first 1,000 units a month are free; that is not
// applied per call, so this is the marginal price.
const VISION_PER_1000_UNITS = 1.5;

function usdToInr() {
  const rate = Number(process.env.AI_USD_INR);
  return Number.isFinite(rate) && rate > 0 ? rate : 90;
}

// "models/gemini-3.6-flash-001" → "gemini-3.6-flash"
function normalizeModel(model) {
  let name = String(model || "").trim().toLowerCase().replace(/^models\//, "");
  if (!MODEL_RATES[name]) name = name.replace(/-(\d{3}|latest|preview(-[\w-]+)?)$/, "");
  return MODEL_ALIASES[name] || name;
}

function rateFor(model, at = new Date()) {
  const rows = MODEL_RATES[normalizeModel(model)];
  if (!rows) return null;
  const day = new Date(at).toISOString().slice(0, 10);
  let picked = null;
  for (const row of rows) if (row.effectiveFrom <= day) picked = row;
  return picked;
}

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Cost of one call from provider token counts.
 * `inputTokens` is the provider's promptTokenCount, which INCLUDES cached
 * tokens; those bill at the cached rate instead.
 */
function estimateCost({ model, inputTokens = 0, outputTokens = 0, thinkingTokens = 0, cachedTokens = 0, at = new Date() } = {}) {
  const rate = rateFor(model, at);
  if (!rate) return { usd: 0, inr: 0, pricingVersion: PRICING_VERSION, priced: false };
  const cached = Math.min(Math.max(0, cachedTokens), Math.max(0, inputTokens));
  const usd =
    ((inputTokens - cached) * rate.inputPer1M +
      cached * rate.cachedInputPer1M +
      (outputTokens + thinkingTokens) * rate.outputPer1M) / 1e6;
  return { usd: round(usd, 8), inr: round(usd * usdToInr(), 6), pricingVersion: PRICING_VERSION, priced: true };
}

function visionCost(units = 1) {
  const usd = (Math.max(0, units) * VISION_PER_1000_UNITS) / 1000;
  return { usd: round(usd, 8), inr: round(usd * usdToInr(), 6), pricingVersion: PRICING_VERSION, priced: true };
}

module.exports = {
  MODEL_ALIASES,
  MODEL_RATES,
  PRICING_VERSION,
  VISION_PER_1000_UNITS,
  estimateCost,
  normalizeModel,
  rateFor,
  usdToInr,
  visionCost,
};
