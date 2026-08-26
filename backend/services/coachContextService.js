const crypto = require("crypto");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const streakService = require("./streak.service");
const reflectionService = require("./reflectionService");
const analyticsSnapshotService = require("./analyticsSnapshotService");
const weeklyReportRepository = require("../repositories/weeklyReport.repository");
const { client: redis, isRedisReady } = require("../config/redis");
const { logger } = require("../utils/logger");

const CONTEXT_VERSION = "v2";
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

const MARKETS = ["Forex", "Indian_Market"];

function cacheKey(userId, market) {
  return `coach:ctx:${CONTEXT_VERSION}:${market || "Forex"}:${userId}`;
}

// A conversation can be opened before we know which book it is about (market
// "any"). Resolve that to a concrete market so the snapshot, the weekly
// report, and the trade list all describe the same thing: the conversation's
// own market first, then the trader's stored preference, then whichever
// collection actually holds their trades.
async function resolveMarket({ market, user, userId } = {}) {
  const raw = String(market || "").trim();
  if (raw === "Indian_Market" || raw.toLowerCase() === "indian") return "Indian_Market";
  if (raw === "Forex") return "Forex";

  if (user?.preferredMarket && MARKETS.includes(user.preferredMarket)) return user.preferredMarket;

  const owner = userId || user?._id || user;
  if (!owner) return "Forex";

  const [forexCount, indianCount] = await Promise.all([
    Trade.countDocuments({
      user: owner,
      deletedAt: null,
      "parsedData.multiTradeGhost": { $ne: true },
    }).catch(() => 0),
    IndianTrade.countDocuments({ user: owner, deletedAt: null }).catch(() => 0),
  ]);
  return indianCount > forexCount ? "Indian_Market" : "Forex";
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
    // Rules the trader broke on this trade. The AI Coach Feed anchors whole
    // insights on a single broken rule, so without these the coach can only
    // answer "I don't see that in your last 20 trades".
    brokeRules: Array.isArray(trade.setupRules)
      ? trade.setupRules.filter((rule) => rule && rule.followed === false)
          .map((rule) => rule.label)
          .filter(Boolean)
          .slice(0, 8)
      : [],
    wouldRetake: trade.wouldRetake || null,
    quality: trade.tradeQuality || null,
    market: trade.sourceMarket || trade.marketType || "Forex",
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
  const tally = new Map();   // normalizedKey -> count
  const labels = new Map();  // normalizedKey -> display label (first-seen casing)
  for (const trade of trades) {
    if (!trade.mistakeTag) continue;
    const trimmed = String(trade.mistakeTag).trim();
    if (!trimmed) continue;
    // Case-fold so "FOMO" and "fomo" tally as the same mistake.
    const key = trimmed.toLowerCase();
    if (!labels.has(key)) labels.set(key, trimmed);
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  return Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({ tag: labels.get(key), count }));
}

function tradeTime(trade) {
  const value = trade.effectiveTradeDate || trade.tradeDate || trade.createdAt;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

// Only the requested market's trades belong in the context: handing an Indian
// options trader a list of Forex fills makes the coach answer "I don't see
// that in your last 20 trades". The source collection is also the only
// reliable market label — IndianTrade documents carry no `marketType` field —
// so tag each row as it is loaded.
function summariseBrokenRules(trades) {
  const tally = new Map();  // normalizedKey -> count
  const labels = new Map(); // normalizedKey -> display label (first-seen casing)
  for (const trade of trades) {
    if (!Array.isArray(trade.setupRules)) continue;
    for (const rule of trade.setupRules) {
      if (!rule || rule.followed !== false) continue;
      const trimmed = String(rule.label || "").trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!labels.has(key)) labels.set(key, trimmed);
      tally.set(key, (tally.get(key) || 0) + 1);
    }
  }
  return Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({ rule: labels.get(key), violations: count }));
}

async function loadTrades(userId, limit, market = "Forex") {
  const baseQuery = {
    user: userId,
    deletedAt: null,
  };
  const [forex, indian] = await Promise.all([
    market === "Indian_Market"
      ? []
      : Trade.find(
          { ...baseQuery, "parsedData.multiTradeGhost": { $ne: true } },
          TRADE_FIELDS
        ).sort({ effectiveTradeDate: -1, _id: -1 }).limit(limit).lean(),
    market === "Forex"
      ? []
      : IndianTrade.find(baseQuery, TRADE_FIELDS)
          .sort({ effectiveTradeDate: -1, _id: -1 })
          .limit(limit)
          .lean(),
  ]);
  // Merge by trade date desc, then trim to limit.
  return [
    ...forex.map((trade) => ({ ...trade, sourceMarket: "Forex" })),
    ...indian.map((trade) => ({ ...trade, sourceMarket: "Indian_Market" })),
  ]
    .sort((a, b) => tradeTime(b) - tradeTime(a))
    .slice(0, limit);
}

async function buildContext({ userId, market = "Forex" } = {}) {
  const [trades, streakSnap, reflectionWindow, latestReports, analyticsSnap] = await Promise.all([
    loadTrades(userId, RECENT_TRADE_LIMIT, market),
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
    // Every figure in this context is denominated here. Without it the model
    // quotes Indian rupee P&L with a dollar sign.
    currency: market === "Indian_Market" ? "INR" : "USD",
    currencySymbol: market === "Indian_Market" ? "₹" : "$",
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
    topBrokenRules: summariseBrokenRules(trades),
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
    // Recorded per message: "which book was the coach reading?" is the exact
    // question that was unanswerable when Indian threads were served Forex.
    market: context.market || "",
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
      const cached = await redis.get(cacheKey(userId, market));
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
      await redis.set(cacheKey(userId, market), JSON.stringify(fresh), "EX", CACHE_TTL_SECONDS);
    } catch {
      // Best-effort cache write.
    }
  }

  return { context: fresh, digest: digest(fresh), cached: false };
}

// Context is cached per market, so an unqualified invalidate has to clear
// every market's entry — otherwise switching books serves a stale snapshot.
async function invalidate(userId, market) {
  if (!isRedisReady()) return;
  const markets = market ? [market] : MARKETS;
  try {
    await Promise.all(markets.map((m) => redis.del(cacheKey(userId, m))));
  } catch {
    // Best-effort invalidate; next read will rebuild.
  }
}

module.exports = {
  CONTEXT_VERSION,
  MARKETS,
  MAX_CONTEXT_BYTES,
  buildContext,
  digest,
  getContext,
  invalidate,
  resolveMarket,
  trimIfTooLarge,
  // Exported for testing
  summariseBrokenRules,
  summariseMistakes,
};
