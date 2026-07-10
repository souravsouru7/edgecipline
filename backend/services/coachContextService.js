const crypto = require("crypto");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const streakService = require("./streak.service");
const reflectionService = require("./reflectionService");
const analyticsSnapshotService = require("./analyticsSnapshotService");
const weeklyReportRepository = require("../repositories/weeklyReport.repository");
const { client: redis, isRedisReady } = require("../config/redis");
const { logger } = require("../utils/logger");

const CONTEXT_VERSION = "v1";
const CACHE_TTL_SECONDS = 5 * 60;
const RECENT_TRADE_LIMIT = 20;
const REFLECTION_LOOKBACK_DAYS = 7;
// Hard cap so even an unusually rich snapshot fits inside our model's prompt
// budget. The Gemini service rejects above 200 KB; we leave headroom for the
// system prompt + chat history.
const MAX_CONTEXT_BYTES = 60_000;

const TRADE_FIELDS = {
  pair: 1, type: 1, profit: 1, tradeDate: 1, createdAt: 1, effectiveTradeDate: 1,
  session: 1, strategy: 1, setupScore: 1, setupRules: 1, mood: 1, confidence: 1,
  emotionalTags: 1, mistakeTag: 1, lesson: 1, wouldRetake: 1, tradeQuality: 1,
  entryBasis: 1, marketType: 1,
};

function cacheKey(userId) {
  return `coach:ctx:${CONTEXT_VERSION}:${userId}`;
}

function shortTrade(trade) {
  return {
    pair: trade.pair || null,
    type: trade.type || null,
    profit: Number.isFinite(trade.profit) ? Number(trade.profit) : null,
    session: trade.session || null,
    strategy: trade.strategy || null,
    setupScore: trade.setupScore ?? null,
    mood: trade.mood ?? null,
    confidence: trade.confidence || null,
    tags: Array.isArray(trade.emotionalTags) ? trade.emotionalTags.slice(0, 5) : [],
    mistake: trade.mistakeTag || null,
    wouldRetake: trade.wouldRetake || null,
    quality: trade.tradeQuality || null,
    market: trade.marketType || "Forex",
    date: trade.tradeDate || trade.effectiveTradeDate || trade.createdAt || null,
  };
}

function shortReflection(reflection) {
  return {
    day:          reflection.day,
    followedPlan: reflection.followedPlan || null,
    mood:         reflection.mood ?? null,
    confidence:   reflection.confidence ?? null,
    wouldRepeat:  reflection.wouldRepeat || null,
    improvement:  reflection.improvement || null,
    skipped:      Boolean(reflection.skipped),
    tradeCount:   reflection.context?.tradeCount ?? 0,
    pnl:          reflection.context?.grossPnL ?? 0,
  };
}

function shortWeeklyReport(report) {
  if (!report) return null;
  const ai = report.aiFeedback || {};
  return {
    weekStart: report.weekStart,
    weekEnd: report.weekEnd,
    summary: ai.summary || null,
    mistakes: Array.isArray(ai.mistakes) ? ai.mistakes.slice(0, 4) : [],
    improvements: Array.isArray(ai.improvements) ? ai.improvements.slice(0, 4) : [],
    nextWeekChecklist: Array.isArray(ai.nextWeekChecklist) ? ai.nextWeekChecklist.slice(0, 5) : [],
    psychologyFeedback: ai.psychologyFeedback || null,
    dataQualityScore: ai.dataQualityScore ?? null,
  };
}

function shortAnalyticsSnapshot(snapshot) {
  if (!snapshot) return null;
  const perf = snapshot.performance || snapshot.basicStats || {};
  const psych = snapshot.psychology || {};
  const dna = snapshot.tradingDNA || {};
  return {
    period:      snapshot.period || "weekly",
    totalTrades: perf.totalTrades ?? 0,
    wins:        perf.wins ?? perf.winningTrades ?? 0,
    losses:      perf.losses ?? perf.losingTrades ?? 0,
    winRate:     perf.winRate ?? 0,
    netPnL:      perf.netPnL ?? 0,
    avgSetupScore: perf.avgSetupScore ?? null,
    psychology: {
      score: psych.psychologyScore ?? null,
      planAdherencePct: psych.scoreBreakdown?.planAdherencePct ?? null,
      calmTradingPct:   psych.scoreBreakdown?.calmTradingPct ?? null,
      noRevengePct:     psych.scoreBreakdown?.noRevengePct ?? null,
      topEmotionalTags: Array.isArray(psych.topEmotionalTags) ? psych.topEmotionalTags.slice(0, 3) : [],
    },
    tradingDNA: {
      bestSession:    dna.sessionDNA?.best?.name || null,
      bestStrategy:   dna.strategyDNA?.best?.name || null,
      mostExpensiveEmotion: dna.emotionDNA?.mostExpensive?.name || null,
      mostProfitableEmotion: dna.emotionDNA?.mostProfitable?.name || null,
      identity:       dna.dnaSummary?.tradingIdentity || null,
    },
    psychologyCost: snapshot.psychologyCost
      ? {
          score: snapshot.psychologyCost.psychologyCostScore ?? null,
          biggestLeak: snapshot.psychologyCost.topLeaks?.[0]
            ? {
                name: snapshot.psychologyCost.topLeaks[0].name,
                cost: snapshot.psychologyCost.topLeaks[0].cost,
              }
            : null,
        }
      : null,
  };
}

function summariseMistakes(trades) {
  const tally = new Map();
  for (const trade of trades) {
    if (!trade.mistakeTag) continue;
    tally.set(trade.mistakeTag, (tally.get(trade.mistakeTag) || 0) + 1);
  }
  return Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));
}

async function loadTrades(userId, limit) {
  const baseQuery = {
    user: userId,
    deletedAt: null,
  };
  const [forex, indian] = await Promise.all([
    Trade.find(
      { ...baseQuery, "parsedData.multiTradeGhost": { $ne: true } },
      TRADE_FIELDS
    ).sort({ effectiveTradeDate: -1, _id: -1 }).limit(limit).lean(),
    IndianTrade.find(baseQuery, TRADE_FIELDS)
      .sort({ effectiveTradeDate: -1, _id: -1 })
      .limit(limit)
      .lean(),
  ]);
  // Merge by trade date desc, then trim to limit.
  return [...forex, ...indian]
    .sort((a, b) => new Date(b.effectiveTradeDate || b.createdAt || 0) - new Date(a.effectiveTradeDate || a.createdAt || 0))
    .slice(0, limit);
}

async function buildContext({ userId, market = "Forex" } = {}) {
  const [trades, streakSnap, reflectionWindow, latestReports, analyticsSnap] = await Promise.all([
    loadTrades(userId, RECENT_TRADE_LIMIT),
    streakService.getStreakSnapshot(userId).catch(() => null),
    reflectionService.getRecentReflections(userId, REFLECTION_LOOKBACK_DAYS).catch(() => ({ items: [] })),
    weeklyReportRepository.findWeeklyReportsByUser(userId, market, 1).catch(() => []),
    analyticsSnapshotService
      .getSnapshot({ userId, market, period: "weekly" })
      .catch(() => null),
  ]);

  const context = {
    version: CONTEXT_VERSION,
    generatedAt: new Date().toISOString(),
    market,
    streak: streakSnap
      ? {
          journal: streakSnap.journal,
          checklist: streakSnap.checklist,
          rule: streakSnap.rule,
          today: streakSnap.todayKey,
          timezone: streakSnap.timezone,
        }
      : null,
    analytics: shortAnalyticsSnapshot(analyticsSnap),
    recentTrades: trades.map(shortTrade),
    topMistakes: summariseMistakes(trades),
    reflections: (reflectionWindow.items || []).slice(0, REFLECTION_LOOKBACK_DAYS).map(shortReflection),
    latestWeeklyReport: shortWeeklyReport(latestReports?.[0] || null),
  };

  return context;
}

function digest(context) {
  const json = JSON.stringify(context);
  return {
    sourceHash: crypto.createHash("sha1").update(json).digest("hex"),
    bytes: Buffer.byteLength(json, "utf8"),
    tradeCount: context.recentTrades?.length || 0,
    reflectionDays: context.reflections?.length || 0,
    hasWeeklyReport: Boolean(context.latestWeeklyReport),
    contextVersion: context.version,
  };
}

function trimIfTooLarge(context) {
  const json = JSON.stringify(context);
  if (Buffer.byteLength(json, "utf8") <= MAX_CONTEXT_BYTES) return context;
  // Drop the noisiest things first: tail-end trades, then older reflections.
  while (
    context.recentTrades.length > 6 &&
    Buffer.byteLength(JSON.stringify(context), "utf8") > MAX_CONTEXT_BYTES
  ) {
    context.recentTrades.pop();
  }
  while (
    context.reflections.length > 3 &&
    Buffer.byteLength(JSON.stringify(context), "utf8") > MAX_CONTEXT_BYTES
  ) {
    context.reflections.pop();
  }
  return context;
}

async function getContext({ userId, market = "Forex", forceRefresh = false } = {}) {
  if (!userId) throw new Error("getContext requires userId");

  if (!forceRefresh && isRedisReady()) {
    try {
      const cached = await redis.get(cacheKey(userId));
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.version === CONTEXT_VERSION && parsed.market === market) {
          return { context: parsed, digest: digest(parsed), cached: true };
        }
      }
    } catch (error) {
      logger.warn("COACH_CTX_REDIS_READ_FAILED", { userId: String(userId), error: error?.message });
    }
  }

  const fresh = trimIfTooLarge(await buildContext({ userId, market }));

  if (isRedisReady()) {
    try {
      await redis.set(cacheKey(userId), JSON.stringify(fresh), "EX", CACHE_TTL_SECONDS);
    } catch {
      // Best-effort cache write.
    }
  }

  return { context: fresh, digest: digest(fresh), cached: false };
}

async function invalidate(userId) {
  if (!isRedisReady()) return;
  try {
    await redis.del(cacheKey(userId));
  } catch {
    // Best-effort invalidate; next read will rebuild.
  }
}

module.exports = {
  CONTEXT_VERSION,
  MAX_CONTEXT_BYTES,
  buildContext,
  digest,
  getContext,
  invalidate,
  trimIfTooLarge,
};
