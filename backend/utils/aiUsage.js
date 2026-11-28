const AiUsage = require("../models/AiUsage");
const { client: redis, isRedisReady } = require("../config/redis");
const { appConfig } = require("../config");
const { estimateCost, visionCost } = require("../config/aiPricing");
const { logger } = require("./logger");

// Token and cost metering for every AI call. Fire-and-forget: a metering
// failure must never fail or slow the user-facing request it is measuring.
// Never record prompt or reply text here.

const DAILY_KEY_TTL_SECONDS = 3 * 24 * 60 * 60;
const MICRO = 1e6;

function dayKey(date = new Date()) {
  return `ai:tokens:${date.toISOString().slice(0, 10)}`;
}

function costKey(date = new Date()) {
  return `ai:cost:${date.toISOString().slice(0, 10)}`;
}

function userCostKey(userId, date = new Date()) {
  return `ai:ucost:${date.toISOString().slice(0, 10)}:${userId}`;
}

function readUsageMetadata(response) {
  const meta = response?.usageMetadata || {};
  const inputTokens = Number(meta.promptTokenCount) || 0;
  const outputTokens = Number(meta.candidatesTokenCount) || 0;
  const thinkingTokens = Number(meta.thoughtsTokenCount) || 0;
  const totalTokens = Number(meta.totalTokenCount) || inputTokens + outputTokens + thinkingTokens;
  return { inputTokens, outputTokens, thinkingTokens, totalTokens };
}

function readCachedTokens(response) {
  return Number(response?.usageMetadata?.cachedContentTokenCount) || 0;
}

// OpenAI chat-completions usage → the same shape.
function readOpenAiUsage(json) {
  const u = json?.usage || {};
  const inputTokens = Number(u.prompt_tokens) || 0;
  const outputTokens = Number(u.completion_tokens) || 0;
  return {
    inputTokens,
    outputTokens,
    thinkingTokens: Number(u.completion_tokens_details?.reasoning_tokens) || 0,
    totalTokens: Number(u.total_tokens) || inputTokens + outputTokens,
    cachedTokens: Number(u.prompt_tokens_details?.cached_tokens) || 0,
  };
}

// Builds the row. Exported for tests.
function buildRow(entry) {
  const {
    userId, feature, model, response, ok, errorCode, latencyMs,
    attempt, hedged, aborted, operationId, units, usage, estimatedTokens,
  } = entry;
  const at = new Date();

  let tokens;
  let cachedTokens = 0;
  let costSource;
  let cost;

  if (units != null) {
    tokens = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 };
    costSource = "unit";
    cost = visionCost(units);
  } else {
    const hasProviderUsage = Boolean(response?.usageMetadata) || Boolean(usage);
    if (usage) {
      const { cachedTokens: c = 0, ...rest } = usage;
      tokens = rest;
      cachedTokens = c;
    } else if (hasProviderUsage) {
      tokens = readUsageMetadata(response);
      cachedTokens = readCachedTokens(response);
    } else {
      // No provider numbers (aborted / failed call). Use the caller's
      // estimate if any, and label it so it is never read as measured.
      const est = estimatedTokens || {};
      const inputTokens = Number(est.inputTokens) || 0;
      const outputTokens = Number(est.outputTokens) || 0;
      tokens = { inputTokens, outputTokens, thinkingTokens: 0, totalTokens: inputTokens + outputTokens };
    }
    costSource = hasProviderUsage ? "metered" : "estimated";
    cost = estimateCost({ model: response?.modelVersion || model, ...tokens, cachedTokens, at });
  }

  return {
    user: userId || null,
    feature,
    model: model || "",
    servedModel: String(response?.modelVersion || ""),
    ...tokens,
    cachedTokens,
    attempt: Number(attempt) || 1,
    hedged: Boolean(hedged),
    aborted: Boolean(aborted),
    costUsd: cost.usd,
    costInr: cost.inr,
    pricingVersion: cost.priced ? cost.pricingVersion : "",
    costSource,
    operationId: operationId ? String(operationId) : "",
    ok: ok !== false,
    errorCode: errorCode || "",
    latencyMs: Number(latencyMs) || 0,
    createdAt: at,
  };
}

async function bumpCounter(key, by) {
  const total = await redis.incrby(key, by);
  if (total === by) await redis.expire(key, DAILY_KEY_TTL_SECONDS);
  return total;
}

// Alerts only. Never blocks a request, and never blocks a paying trader.
async function checkSpendAlerts({ dayMicros, userMicros, userId }) {
  const limits = appConfig.ai.spendAlerts || {};
  const daily = Number(limits.dailyUsd) || 0;
  const perUser = Number(limits.userDailyUsd) || 0;
  if ((daily <= 0 || dayMicros == null) && (perUser <= 0 || userMicros == null)) return;
  const { alertOnce } = require("./geminiCircuit");
  if (daily > 0 && dayMicros != null && dayMicros / MICRO > daily) {
    await alertOnce("ai_daily_spend", "AI_DAILY_SPEND_ALERT", { spentUsd: dayMicros / MICRO, thresholdUsd: daily });
  }
  if (perUser > 0 && userMicros != null && userMicros / MICRO > perUser) {
    await alertOnce(`ai_user_spend:${userId}`, "AI_USER_DAILY_SPEND_ALERT", {
      userId: String(userId), spentUsd: userMicros / MICRO, thresholdUsd: perUser,
    });
  }
}

async function persist(entry) {
  const row = buildRow(entry);
  await AiUsage.create(row);
  if (!isRedisReady()) return;
  if (row.totalTokens > 0) await bumpCounter(dayKey(), row.totalTokens);
  const micros = Math.round(row.costUsd * MICRO);
  if (micros > 0) {
    const dayMicros = await bumpCounter(costKey(), micros);
    const userMicros = row.user ? await bumpCounter(userCostKey(row.user), micros) : null;
    await checkSpendAlerts({ dayMicros, userMicros, userId: row.user });
  }
}

// `response` is the SDK's `result.response` (already awaited for streams).
function recordAiUsage(entry) {
  return persist(entry || {}).catch((error) => {
    logger.warn("AI_USAGE_RECORD_FAILED", { feature: entry?.feature, error: error?.message });
  });
}

async function getTodayTokens() {
  if (!isRedisReady()) return null;
  try {
    const value = await redis.get(dayKey());
    return Number(value) || 0;
  } catch {
    return null;
  }
}

async function getTodayCostUsd() {
  if (!isRedisReady()) return null;
  try {
    const value = await redis.get(costKey());
    return (Number(value) || 0) / MICRO;
  } catch {
    return null;
  }
}

// True only when a budget is configured AND today's spend is over it. Unknown
// (Redis down) counts as under budget: the guard is a cost brake, not a gate
// that should take features down on its own.
async function isOverDailyBudget() {
  const budget = Number(appConfig.ai.dailyTokenBudget) || 0;
  if (budget <= 0) return false;
  const used = await getTodayTokens();
  if (used == null || used <= budget) return false;
  // Lazy: geminiCircuit lazily requires this module too.
  require("./geminiCircuit")
    .alertOnce("daily_budget_exceeded", "GEMINI_DAILY_BUDGET_EXCEEDED", { used, budget })
    .catch(() => {});
  return true;
}

module.exports = {
  buildRow,
  costKey,
  dayKey,
  getTodayCostUsd,
  getTodayTokens,
  isOverDailyBudget,
  readOpenAiUsage,
  readUsageMetadata,
  recordAiUsage,
  userCostKey,
};
