"use strict";

const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { appConfig } = require("../config");
const analyticsSnapshotService = require("./analyticsSnapshotService");
const tradingDnaReportRepository = require("../repositories/tradingDnaReport.repository");
const {
  buildPersonalityBundle,
  filterCompletedTrades,
} = require("../utils/tradingDnaSignals");
const {
  generateTradingDna,
  buildFallbackDna,
  normalizeDna,
  PROMPT_VERSION,
} = require("./tradingDnaPromptService");
const { calculatePsychologyScore } = require("../utils/metricEngine");
const { getTradeCacheVersion } = require("../utils/cacheUtils");
const {
  signShareToken,
  verifyShareToken,
  DEFAULT_TTL_DAYS: SHARE_DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS: SHARE_MAX_TTL_DAYS,
} = require("../utils/tradingDnaShareToken");
const {
  enqueueTradingDnaJob,
  getTradingDnaJobSnapshot,
} = require("../queues/tradingDnaQueue");

const PERIOD_DAYS = {
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

const DEFAULT_PERIOD = "90d";

// Throttle generation: a successful AI generation within this window blocks a
// new one unless `force` is passed. Keeps Gemini costs sane and prevents
// users from spamming the button.
const GENERATE_LOCKOUT_HOURS = Number(
  process.env.TRADING_DNA_GENERATE_LOCKOUT_HOURS || 24
);

function resolvePeriod(periodType = DEFAULT_PERIOD) {
  const days = PERIOD_DAYS[periodType];
  if (!days) {
    throw new ApiError(
      400,
      `Unsupported period: ${periodType}. Use 30d, 90d, or 365d.`,
      "VALIDATION_ERROR"
    );
  }
  const to = new Date();
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    periodType,
    days,
    from,
    to,
    label: `Last ${days} days`,
  };
}

function resolvePreviousPeriod(period) {
  const to = new Date(period.from.getTime() - 1);
  const from = new Date(to.getTime() - period.days * 24 * 60 * 60 * 1000);
  return { from, to };
}

function normalizeMarket(marketType) {
  if (marketType === "Indian_Market") return "Indian_Market";
  return "Forex";
}

// Mirrors the psychology block produced inside weeklyReport.service so the AI
// sees the same shape it has already been tuned on.
function buildPsychologyBlock(trades) {
  if (!Array.isArray(trades) || trades.length === 0) return null;

  const tracked = trades.filter(
    (t) =>
      typeof t.mood === "number" ||
      (t.confidence && String(t.confidence).trim()) ||
      (Array.isArray(t.emotionalTags) && t.emotionalTags.length > 0) ||
      (t.wouldRetake && String(t.wouldRetake).trim())
  );
  if (tracked.length === 0) return null;

  const planTrades = trades.filter((t) => t.entryBasis === "Plan").length;
  const calmFocused = trades.filter(
    (t) =>
      Array.isArray(t.emotionalTags) &&
      (t.emotionalTags.includes("Calm") || t.emotionalTags.includes("Focused"))
  ).length;
  const withMood = trades.filter((t) => typeof t.mood === "number");
  const moodAvg = withMood.length
    ? withMood.reduce((s, t) => s + Number(t.mood || 0), 0) / withMood.length
    : null;
  const retakeYes = trades.filter((t) => t.wouldRetake === "Yes").length;
  const retakeTracked = trades.filter(
    (t) => t.wouldRetake === "Yes" || t.wouldRetake === "No"
  ).length;

  // Revenge-trade heuristic — same definition as weeklyReport.service.
  let revenge = 0;
  for (let i = 1; i < trades.length; i += 1) {
    const prev = trades[i - 1];
    const curr = trades[i];
    const prevLoss = (prev.profit || 0) < 0;
    const prevRisk =
      prev.entryPrice && prev.stopLoss
        ? Math.abs(prev.entryPrice - prev.stopLoss)
        : 0;
    const currRisk =
      curr.entryPrice && curr.stopLoss
        ? Math.abs(curr.entryPrice - curr.stopLoss)
        : 0;
    const sameDay =
      new Date(prev.createdAt).toDateString() ===
      new Date(curr.createdAt).toDateString();
    if (prevLoss && sameDay && prevRisk > 0 && currRisk > prevRisk * 1.5) {
      revenge += 1;
    }
  }

  return {
    psychologyScore: calculatePsychologyScore(trades),
    scoreBreakdown: {
      planAdherencePct: trades.length
        ? Number(((planTrades / trades.length) * 100).toFixed(1))
        : 0,
      calmTradingPct: trades.length
        ? Number(((calmFocused / trades.length) * 100).toFixed(1))
        : 0,
      noRevengePct: trades.length
        ? Number((((trades.length - revenge) / trades.length) * 100).toFixed(1))
        : 100,
      wouldRetakePct: retakeTracked
        ? Number(((retakeYes / retakeTracked) * 100).toFixed(1))
        : 50,
    },
    mood: {
      tracked: withMood.length,
      average: moodAvg === null ? null : Number(moodAvg.toFixed(2)),
    },
  };
}

function buildNoDataDna() {
  return {
    identity: { archetype: null, oneLiner: "", tagline: "" },
    strengths: [],
    weaknesses: [],
    blindSpots: [],
    behaviorPatterns: [],
    improvementPriorities: [
      {
        priority: "Log trades",
        action: "Record every trade you take for the next 2 weeks.",
        expectedImpact:
          "Your Trading DNA can only emerge from logged data — start the baseline.",
      },
    ],
    coachSummary:
      "There are no trades in this window. Once you log around 20 trades, your Trading DNA will start to take shape.",
    confidenceNote: "No trades logged in this window.",
  };
}

async function generateReport({
  userId,
  marketType = "Forex",
  periodType = DEFAULT_PERIOD,
} = {}) {
  const market = normalizeMarket(marketType);
  const period = resolvePeriod(periodType);
  const previous = resolvePreviousPeriod(period);

  const [snapshot, previousSnapshot] = await Promise.all([
    analyticsSnapshotService.getSnapshot({
      userId,
      market,
      dateRange: { from: period.from, to: period.to },
      period: "monthly",
      includeTrades: true,
    }),
    analyticsSnapshotService.getSnapshot({
      userId,
      market,
      dateRange: { from: previous.from, to: previous.to },
      period: "monthly",
      includeTrades: true,
    }),
  ]);

  // Filter out trades that are not in a settled state. The Forex Trade model
  // has an enum status (pending / processing / completed / failed) and new
  // rows default to "pending" — including them in DNA analytics would inflate
  // sample counts with rows that have no profit/exit data yet. IndianTrade
  // has no status field, so undefined is treated as completed.
  const trades = filterCompletedTrades(snapshot.trades);
  const previousTrades = filterCompletedTrades(previousSnapshot.trades);

  // Snapshot the trade-cache version at generation time so the read-side
  // can flag a stored report as stale once the user changes their trades.
  const dataVersion = String(await getTradeCacheVersion(userId) || "");

  const psychology = buildPsychologyBlock(trades);
  const bundle = buildPersonalityBundle({
    trades,
    previousTrades,
    marketLabel: market,
    period,
    performance: snapshot.performance,
    psychology,
  });

  let aiPayload;
  if (trades.length === 0) {
    aiPayload = {
      model: "no-data",
      promptVersion: PROMPT_VERSION,
      dna: buildNoDataDna(),
    };
  } else {
    try {
      aiPayload = await generateTradingDna(bundle);
    } catch (err) {
      logger.warn(
        "[TradingDNA] generation failed, persisting deterministic fallback",
        { error: err.message, userId: userId?.toString?.(), market, periodType }
      );
      aiPayload = {
        model: "fallback",
        promptVersion: PROMPT_VERSION,
        dna: normalizeDna(buildFallbackDna(bundle), bundle),
      };
    }
  }

  return tradingDnaReportRepository.upsertReport({
    userId,
    marketType: market,
    periodType: period.periodType,
    windowStart: period.from,
    windowEnd: period.to,
    bundle,
    ai: aiPayload.dna,
    aiModel: aiPayload.model,
    promptVersion: aiPayload.promptVersion || PROMPT_VERSION,
    dataVersion,
  });
}

// Compares the stored cache version to the current version and tags the
// report with a `meta.stale` boolean. Pure read-side annotation — never
// mutates the stored doc.
async function attachStaleness(report) {
  if (!report) return report;
  const currentVersion = String((await getTradeCacheVersion(report.user)) || "");
  const reportVersion = String(report.dataVersion || "");
  // Only flag stale when BOTH versions are non-empty and differ. An empty
  // stored version means the report predates the staleness field; we
  // can't make a confident claim, so we treat it as "fresh enough".
  const stale = Boolean(
    reportVersion && currentVersion && reportVersion !== currentVersion
  );
  return {
    ...report,
    meta: {
      stale,
      dataVersion: reportVersion || null,
      currentDataVersion: currentVersion || null,
    },
  };
}

async function generateNowOnce({
  userId,
  marketType = "Forex",
  periodType = DEFAULT_PERIOD,
  force = false,
} = {}) {
  if (!force) {
    const since = new Date(
      Date.now() - GENERATE_LOCKOUT_HOURS * 60 * 60 * 1000
    );
    const recent = await tradingDnaReportRepository.findRecentlyGenerated(
      userId,
      normalizeMarket(marketType),
      periodType,
      since
    );
    if (recent) {
      throw new ApiError(
        409,
        `Trading DNA was generated within the last ${GENERATE_LOCKOUT_HOURS} hours. Pass force=true to regenerate.`,
        "CONFLICT",
        { reportId: recent._id }
      );
    }
  }
  return generateReport({ userId, marketType, periodType });
}

async function listReports(userId, marketType = "Forex", rawLimit = 12) {
  const limit = Math.min(50, Math.max(1, parseInt(rawLimit, 10) || 12));
  return tradingDnaReportRepository.listReports(
    userId,
    normalizeMarket(marketType),
    limit
  );
}

async function getLatest(userId, marketType = "Forex", periodType = DEFAULT_PERIOD) {
  if (!PERIOD_DAYS[periodType]) {
    throw new ApiError(
      400,
      `Unsupported period: ${periodType}`,
      "VALIDATION_ERROR"
    );
  }
  const report = await tradingDnaReportRepository.findLatest(
    userId,
    normalizeMarket(marketType),
    periodType
  );
  return attachStaleness(report);
}

async function getReportById(userId, reportId) {
  const report = await tradingDnaReportRepository.findByIdAndUser(
    reportId,
    userId
  );
  if (!report) {
    throw new ApiError(404, "Trading DNA report not found", "NOT_FOUND");
  }
  return attachStaleness(report);
}

// ─── Share-link surface ──────────────────────────────────────────────────────
//
// Share tokens are stateless JWTs scoped by `aud: tdna-share`. We do NOT store
// them in MongoDB — issuance is idempotent (the same report can be shared by
// minting a fresh token at any time) and revocation is governed by the TTL.
// If a user wants to invalidate an old link, they generate a fresh DNA report
// and the old report's link still works for its TTL — there is currently no
// blacklist. Keep TTL short by default and document this trade-off.

function resolveFrontendOrigin() {
  return (
    process.env.FRONTEND_URL ||
    appConfig.cors.allowedOrigins?.[0] ||
    "http://localhost:3000"
  );
}

function buildShareUrl(token) {
  // Query-string token rather than a dynamic path segment — required so the
  // Next.js static export (output: "export") can serve this from a single
  // pre-rendered HTML file without `generateStaticParams`.
  const origin = resolveFrontendOrigin().replace(/\/+$/, "");
  return `${origin}/trading-dna/share?t=${encodeURIComponent(token)}`;
}

// Strips out anything we don't want a stranger with the link to see:
//   - raw P&L numbers (gross/net/expectancy dollars)
//   - position sizing and recovery details (too revealing about account size)
//   - the full trade-level bundle
// Keeps the identity narrative (archetype, coach summary), the highest-value
// strengths/improvements, and percentage-based plan adherence — the parts
// that make a share card look good without leaking the user's book.
function sanitizeReportForShare(report) {
  if (!report) return null;
  const ai = report.ai || {};
  const sample = report.bundle?.sample || {};
  const psy = report.bundle?.psychologySummary || null;

  return {
    marketType: report.marketType,
    periodType: report.periodType,
    generatedAt: report.updatedAt || report.createdAt || null,
    identity: {
      archetype: ai.identity?.archetype || null,
      oneLiner: ai.identity?.oneLiner || "",
      tagline: ai.identity?.tagline || "",
    },
    coachSummary: ai.coachSummary || "",
    confidenceNote: ai.confidenceNote || "",
    topStrengths: Array.isArray(ai.strengths)
      ? ai.strengths.slice(0, 2).map((s) => ({
          title: s.title || "",
          // Drop the `evidence` field — it commonly contains $ amounts.
        }))
      : [],
    topImprovement: Array.isArray(ai.improvementPriorities) && ai.improvementPriorities[0]
      ? {
          priority: ai.improvementPriorities[0].priority || "",
          action: ai.improvementPriorities[0].action || "",
        }
      : null,
    psychologyScore: psy?.score ?? null,
    planAdherencePct: psy?.planAdherencePct ?? null,
    sample: {
      totalTrades: sample.totalTrades ?? 0,
      lowSample: Boolean(sample.lowSample),
    },
  };
}

async function createShareToken({ userId, reportId, ttlDays } = {}) {
  if (!reportId) {
    throw new ApiError(400, "reportId is required", "VALIDATION_ERROR");
  }
  // Ownership check — must happen before minting a token so a user cannot
  // forge a share link for someone else's report by guessing an id.
  const report = await tradingDnaReportRepository.findByIdAndUser(
    reportId,
    userId
  );
  if (!report) {
    throw new ApiError(404, "Trading DNA report not found", "NOT_FOUND");
  }

  const { token, expiresAt, ttlDays: appliedTtl } = signShareToken({
    reportId: report._id,
    userId,
    ttlDays,
  });

  return {
    token,
    url: buildShareUrl(token),
    expiresAt,
    ttlDays: appliedTtl,
  };
}

// ─── Async generation surface (BullMQ) ──────────────────────────────────────
//
// The synchronous generate path keeps the request thread held for the full
// 30–90s Gemini call. enqueueGeneration moves that work to the worker so the
// HTTP request returns instantly with a job id. The frontend polls
// getJobStatus until state is "completed" or "failed".
//
// Lockout enforcement still happens HERE (not in the worker) so a user cannot
// trigger an unbounded queue of repeat generations by spamming the API.

async function enqueueGeneration({
  userId,
  marketType = "Forex",
  periodType = DEFAULT_PERIOD,
  force = false,
} = {}) {
  if (!userId) {
    throw new ApiError(400, "userId is required", "VALIDATION_ERROR");
  }
  if (!PERIOD_DAYS[periodType]) {
    throw new ApiError(
      400,
      `Unsupported period: ${periodType}. Use 30d, 90d, or 365d.`,
      "VALIDATION_ERROR"
    );
  }
  const market = normalizeMarket(marketType);

  if (!force) {
    const since = new Date(Date.now() - GENERATE_LOCKOUT_HOURS * 60 * 60 * 1000);
    const recent = await tradingDnaReportRepository.findRecentlyGenerated(
      userId,
      market,
      periodType,
      since
    );
    if (recent) {
      throw new ApiError(
        409,
        `Trading DNA was generated within the last ${GENERATE_LOCKOUT_HOURS} hours. Pass force=true to regenerate.`,
        "CONFLICT",
        { reportId: recent._id }
      );
    }
  }

  const enqueued = await enqueueTradingDnaJob({
    userId,
    marketType: market,
    periodType,
    force,
  });

  return {
    jobId: enqueued.jobId,
    state: enqueued.state,
    deduplicated: Boolean(enqueued.deduplicated),
    marketType: market,
    periodType,
  };
}

async function getJobStatus({ userId, jobId } = {}) {
  if (!userId) {
    throw new ApiError(400, "userId is required", "VALIDATION_ERROR");
  }
  if (!jobId) {
    throw new ApiError(400, "jobId is required", "VALIDATION_ERROR");
  }

  const snapshot = await getTradingDnaJobSnapshot(jobId);
  if (!snapshot) {
    throw new ApiError(404, "Trading DNA job not found", "NOT_FOUND");
  }

  // Ownership check — a user must never be able to peek at someone else's job
  // by guessing or scraping a jobId.
  if (String(snapshot.data?.userId || "") !== String(userId)) {
    throw new ApiError(404, "Trading DNA job not found", "NOT_FOUND");
  }

  let report = null;
  if (snapshot.state === "completed" && snapshot.result?.reportId) {
    report = await tradingDnaReportRepository.findByIdAndUser(
      snapshot.result.reportId,
      userId
    );
  }

  return {
    jobId: snapshot.jobId,
    state: snapshot.state,
    attemptsMade: snapshot.attemptsMade,
    progress: snapshot.progress,
    failedReason: snapshot.failedReason,
    enqueuedAt: snapshot.timestamp ? new Date(snapshot.timestamp) : null,
    startedAt: snapshot.processedOn ? new Date(snapshot.processedOn) : null,
    finishedAt: snapshot.finishedOn ? new Date(snapshot.finishedOn) : null,
    marketType: snapshot.data?.marketType || null,
    periodType: snapshot.data?.periodType || null,
    report,
  };
}

async function getSharedReport(token) {
  const { reportId, userId } = verifyShareToken(token);
  const report = await tradingDnaReportRepository.findByIdAndUser(
    reportId,
    userId
  );
  if (!report) {
    // Treat "report was deleted after a link was minted" as link-invalid
    // rather than 404, so the public share page can show a consistent
    // "this link is no longer valid" message.
    throw new ApiError(
      404,
      "This shared Trading DNA report is no longer available",
      "NOT_FOUND"
    );
  }
  return sanitizeReportForShare(report);
}

module.exports = {
  DEFAULT_PERIOD,
  GENERATE_LOCKOUT_HOURS,
  PERIOD_DAYS,
  SHARE_DEFAULT_TTL_DAYS,
  SHARE_MAX_TTL_DAYS,
  attachStaleness,
  buildNoDataDna,
  buildPsychologyBlock,
  createShareToken,
  enqueueGeneration,
  generateNowOnce,
  generateReport,
  getJobStatus,
  getLatest,
  getReportById,
  getSharedReport,
  listReports,
  resolvePeriod,
  resolvePreviousPeriod,
  sanitizeReportForShare,
};
