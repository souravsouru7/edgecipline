const AiUsage = require("../models/AiUsage");
const { client: redis, isRedisReady } = require("../config/redis");
const { appConfig } = require("../config");
const { logger } = require("./logger");

// Token metering for every Gemini call. Fire-and-forget: a metering failure
// must never fail or slow the user-facing request it is measuring.

const DAILY_KEY_TTL_SECONDS = 3 * 24 * 60 * 60;

function dayKey(date = new Date()) {
  return `ai:tokens:${date.toISOString().slice(0, 10)}`;
}

function readUsageMetadata(response) {
  const meta = response?.usageMetadata || {};
  const inputTokens = Number(meta.promptTokenCount) || 0;
  const outputTokens = Number(meta.candidatesTokenCount) || 0;
  const thinkingTokens = Number(meta.thoughtsTokenCount) || 0;
  const totalTokens = Number(meta.totalTokenCount) || inputTokens + outputTokens + thinkingTokens;
  return { inputTokens, outputTokens, thinkingTokens, totalTokens };
}

async function persist({ userId, feature, model, response, ok, errorCode, latencyMs }) {
  const tokens = readUsageMetadata(response);
  await AiUsage.create({
    user: userId || null,
    feature,
    model: model || "",
    ...tokens,
    ok: ok !== false,
    errorCode: errorCode || "",
    latencyMs: Number(latencyMs) || 0,
  });
  if (tokens.totalTokens > 0 && isRedisReady()) {
    const key = dayKey();
    const total = await redis.incrby(key, tokens.totalTokens);
    if (total === tokens.totalTokens) await redis.expire(key, DAILY_KEY_TTL_SECONDS);
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
  dayKey,
  getTodayTokens,
  isOverDailyBudget,
  readUsageMetadata,
  recordAiUsage,
};
