const IndianTrade = require("../models/IndianTrade");

const MIN_SIGNAL_TRADES = 5;
const TRADE_LIMIT = 10000;
const VALID_INSTRUMENT_TYPES = new Set(["ALL", "OPTION", "EQUITY"]);
const PROJECTION = [
  "pair", "underlying", "instrumentType", "stockSymbol", "sector", "optionType",
  "profit", "brokerage", "sttTaxes", "entryBasis", "strategy", "setup", "session",
  "mistakeTag", "lesson", "mood", "confidence", "emotionalTags", "wouldRetake",
  "tradeQuality", "setupScore", "setupRules", "stopLoss", "takeProfit", "tradeDate",
  "createdAt",
].join(" ");

const CONFIDENCE_LEVELS = [
  { min: 40, key: "strong", label: "Strong evidence", score: 1 },
  { min: 20, key: "moderate", label: "Moderate evidence", score: 0.75 },
  { min: 10, key: "developing", label: "Developing evidence", score: 0.55 },
  { min: 5, key: "early", label: "Early signal", score: 0.35 },
  { min: 0, key: "insufficient", label: "Insufficient evidence", score: 0 },
];

const COVERAGE_FIELDS = {
  profit: (trade) => isRecordedNumber(trade.profit),
  costs: (trade) => isRecordedNumber(trade.brokerage) || isRecordedNumber(trade.sttTaxes),
  entryBasis: (trade) => Boolean(cleanText(trade.entryBasis)),
  strategy: (trade) => Boolean(cleanText(trade.strategy || trade.setup)),
  session: (trade) => Boolean(cleanText(trade.session)),
  mistakeTag: (trade) => Boolean(cleanText(trade.mistakeTag)),
  mood: (trade) => isRecordedNumber(trade.mood),
  confidence: (trade) => Boolean(cleanText(trade.confidence)),
  emotionalTags: (trade) => Array.isArray(trade.emotionalTags) && trade.emotionalTags.length > 0,
  review: (trade) => Boolean(cleanText(trade.wouldRetake)) && Boolean(cleanText(trade.tradeQuality)),
  setupRules: (trade) => Array.isArray(trade.setupRules) && trade.setupRules.length > 0,
  riskPlan: (trade) => isRecordedNumber(trade.stopLoss) && isRecordedNumber(trade.takeProfit),
};

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecordedNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function normalizeInstrumentType(value = "ALL") {
  const normalized = cleanText(value).toUpperCase() || "ALL";
  if (!VALID_INSTRUMENT_TYPES.has(normalized)) {
    throw new Error("Invalid Indian instrumentType");
  }
  return normalized;
}

function confidenceForSample(sampleSize) {
  const count = Math.max(0, Number(sampleSize) || 0);
  const level = CONFIDENCE_LEVELS.find((item) => count >= item.min);
  return { key: level.key, label: level.label, score: level.score, sampleSize: count };
}

function tradeDate(trade) {
  const value = trade?.tradeDate || trade?.createdAt;
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function netPnl(trade) {
  if (!isRecordedNumber(trade?.profit)) return null;
  return round(Number(trade.profit) - (Number(trade.brokerage) || 0) - (Number(trade.sttTaxes) || 0));
}

function calculateCoverage(trades) {
  const total = trades.length;
  const coverage = {};
  for (const [field, predicate] of Object.entries(COVERAGE_FIELDS)) {
    const count = trades.filter(predicate).length;
    coverage[field] = {
      count,
      percentage: total ? round((count / total) * 100, 1) : 0,
    };
  }
  const values = Object.values(coverage);
  const overallPercentage = values.length
    ? round(values.reduce((sum, item) => sum + item.percentage, 0) / values.length, 1)
    : 0;
  return { coverage, overallPercentage };
}

function calculateStability(rows) {
  if (rows.length < 10) return { key: "unconfirmed", label: "Needs more history", score: 0.75 };
  const ordered = [...rows].sort((a, b) => (tradeDate(a)?.getTime() || 0) - (tradeDate(b)?.getTime() || 0));
  const midpoint = Math.floor(ordered.length / 2);
  const pnl = (items) => items.reduce((sum, item) => sum + (netPnl(item) || 0), 0);
  const earlier = pnl(ordered.slice(0, midpoint));
  const recent = pnl(ordered.slice(midpoint));
  const sameDirection = (earlier > 0 && recent > 0) || (earlier < 0 && recent < 0);
  if (sameDirection) return { key: "stable", label: "Directionally stable", score: 1 };
  return { key: "unstable", label: "Recent result differs", score: 0.55 };
}

function recencyScore(rows, now) {
  const latest = rows.reduce((max, row) => Math.max(max, tradeDate(row)?.getTime() || 0), 0);
  if (!latest) return 0.25;
  const ageDays = Math.max(0, (now.getTime() - latest) / 86400000);
  return round(Math.max(0.2, 1 - ageDays / 90), 3);
}

function summarizeRows(rows) {
  const pnlRows = rows.filter((row) => netPnl(row) != null);
  const net = round(pnlRows.reduce((sum, row) => sum + netPnl(row), 0));
  const wins = pnlRows.filter((row) => netPnl(row) > 0).length;
  return {
    sampleSize: rows.length,
    pnlReadyTrades: pnlRows.length,
    netPnl: net,
    avgNetPnl: pnlRows.length ? round(net / pnlRows.length) : 0,
    winRate: pnlRows.length ? round((wins / pnlRows.length) * 100, 1) : 0,
  };
}

function actionFor(candidate) {
  if (candidate.dimension === "entryBasis") {
    return candidate.category === "leak"
      ? "Use the pre-trade checklist and take only planned entries for the next five trades."
      : "Keep the checklist mandatory so planned entries remain your default behavior.";
  }
  if (candidate.dimension === "mistakeTag") return `Add a checklist guardrail specifically for “${candidate.key}”.`;
  if (["mood", "confidence", "emotionalTags"].includes(candidate.dimension)) {
    return candidate.category === "leak"
      ? "Pause entries when this mindset appears; reset before placing another trade."
      : "Record this state before entry and trade only when the setup also passes its rules.";
  }
  if (candidate.dimension === "strategy") {
    return candidate.category === "leak"
      ? `Reduce or pause “${candidate.key}” until its entry rules are reviewed.`
      : `Prioritize only fully qualified “${candidate.key}” setups; do not increase size from this signal alone.`;
  }
  if (candidate.dimension === "session") {
    return candidate.category === "leak"
      ? `Reduce activity during the ${candidate.key} session until more evidence improves.`
      : `Prefer qualified setups during the ${candidate.key} session while continuing to log outcomes.`;
  }
  return "Review this condition before the next trade and record whether the guardrail was followed.";
}

function titleFor(candidate) {
  const direction = candidate.category === "leak" ? "Review" : "Repeat carefully";
  if (candidate.dimension === "entryBasis") return candidate.category === "leak" ? "Unplanned entries are the clearest current leak" : "Planned entries are showing better discipline";
  return `${direction}: ${candidate.key}`;
}

function createCandidate({ dimension, theme, key, rows, fieldCoverage, controllability, now, suppressedSignals }) {
  if (!rows.length) return null;
  const stats = summarizeRows(rows);
  if (!stats.pnlReadyTrades || stats.netPnl === 0) return null;
  if (stats.sampleSize < MIN_SIGNAL_TRADES) {
    suppressedSignals.push({ dimension, key, sampleSize: stats.sampleSize, reason: "minimum_sample" });
    return null;
  }

  const category = stats.netPnl < 0 ? "leak" : "strength";
  const confidence = confidenceForSample(stats.sampleSize);
  const stability = calculateStability(rows);
  const recency = recencyScore(rows, now);
  const evidenceScore = round(confidence.score * fieldCoverage * stability.score, 3);
  const candidate = {
    id: `${category}:${dimension}:${String(key).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    category,
    theme,
    dimension,
    key,
    title: "",
    evidence: `${key} is associated with ${stats.netPnl < 0 ? "-" : "+"}₹${Math.abs(stats.netPnl).toFixed(2)} net P&L across ${stats.sampleSize} trades in the tracked sample.`,
    action: "",
    financialImpact: Math.abs(stats.netPnl),
    sampleSize: stats.sampleSize,
    stats,
    confidence,
    stability,
    coverage: round(fieldCoverage * 100, 1),
    evidenceScore,
    recencyScore: recency,
    controllability,
    priority: 0,
  };
  candidate.title = titleFor(candidate);
  candidate.action = actionFor(candidate);
  return candidate;
}

function groupBy(trades, valueFor) {
  const groups = new Map();
  for (const row of trades) {
    const values = valueFor(row);
    for (const raw of Array.isArray(values) ? values : [values]) {
      const key = typeof raw === "number" ? String(raw) : cleanText(raw);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
  }
  return groups;
}

function buildCandidates(trades, dataQuality, now) {
  const suppressedSignals = [];
  const candidates = [];
  const coverageRatio = (field) => (dataQuality.coverage[field]?.percentage || 0) / 100;
  const add = (options) => {
    const candidate = createCandidate({ ...options, now, suppressedSignals });
    if (candidate) candidates.push(candidate);
  };

  const planned = trades.filter((row) => cleanText(row.entryBasis) === "Plan");
  const nonPlanned = trades.filter((row) => ["Emotion", "Impulsive"].includes(cleanText(row.entryBasis)));
  add({ dimension: "entryBasis", theme: "discipline", key: "Planned entries", rows: planned, fieldCoverage: coverageRatio("entryBasis"), controllability: 1 });
  add({ dimension: "entryBasis", theme: "discipline", key: "Emotional or impulsive entries", rows: nonPlanned, fieldCoverage: coverageRatio("entryBasis"), controllability: 1 });

  const dimensionGroups = [
    { dimension: "strategy", theme: "setup", groups: groupBy(trades, (row) => row.strategy || row.setup), coverage: "strategy", controllability: 0.8 },
    { dimension: "session", theme: "timing", groups: groupBy(trades, (row) => row.session), coverage: "session", controllability: 0.75 },
    { dimension: "mistakeTag", theme: "discipline", groups: groupBy(trades, (row) => row.mistakeTag), coverage: "mistakeTag", controllability: 1 },
    { dimension: "confidence", theme: "mindset", groups: groupBy(trades, (row) => row.confidence), coverage: "confidence", controllability: 0.9 },
    { dimension: "emotionalTags", theme: "mindset", groups: groupBy(trades, (row) => row.emotionalTags || []), coverage: "emotionalTags", controllability: 0.9 },
  ];
  for (const config of dimensionGroups) {
    for (const [key, rows] of config.groups) {
      add({
        dimension: config.dimension,
        theme: config.theme,
        key,
        rows,
        fieldCoverage: coverageRatio(config.coverage),
        controllability: config.controllability,
      });
    }
  }

  const highMood = trades.filter((row) => Number(row.mood) >= 4);
  const lowMood = trades.filter((row) => Number(row.mood) <= 2);
  add({ dimension: "mood", theme: "mindset", key: "Ready mindset (mood 4–5)", rows: highMood, fieldCoverage: coverageRatio("mood"), controllability: 0.9 });
  add({ dimension: "mood", theme: "mindset", key: "Low-readiness mindset (mood 1–2)", rows: lowMood, fieldCoverage: coverageRatio("mood"), controllability: 0.9 });

  const maxImpact = Math.max(1, ...candidates.map((item) => item.financialImpact));
  for (const item of candidates) {
    const impactScore = item.financialImpact / maxImpact;
    item.priority = round((item.evidenceScore * 0.3 + impactScore * 0.3 + item.controllability * 0.25 + item.recencyScore * 0.15) * 100, 1);
  }

  candidates.sort((a, b) => b.priority - a.priority || b.sampleSize - a.sampleSize || a.id.localeCompare(b.id));
  const deduped = [];
  const seen = new Set();
  for (const item of candidates) {
    const dedupeKey = `${item.category}:${item.theme}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(item);
  }
  return { candidates: deduped, suppressedSignals };
}

function calculateProgress(trades) {
  const ordered = [...trades].sort((a, b) => (tradeDate(a)?.getTime() || 0) - (tradeDate(b)?.getTime() || 0));
  const recent = ordered.slice(-10);
  const previous = ordered.slice(-20, -10);
  const planPct = (rows) => rows.length ? round((rows.filter((row) => cleanText(row.entryBasis) === "Plan").length / rows.length) * 100, 1) : null;
  const net = (rows) => round(rows.reduce((sum, row) => sum + (netPnl(row) || 0), 0));
  const currentPlan = planPct(recent);
  const previousPlan = planPct(previous);
  return {
    comparedTrades: { recent: recent.length, previous: previous.length },
    planAdherence: {
      currentPct: currentPlan,
      previousPct: previousPlan,
      changePct: currentPlan != null && previousPlan != null ? round(currentPlan - previousPlan, 1) : null,
    },
    netPnl: {
      current: net(recent),
      previous: previous.length ? net(previous) : null,
      change: previous.length ? round(net(recent) - net(previous)) : null,
    },
  };
}

function buildUnlockRequirements(trades, dataQuality) {
  const requirements = [];
  if (trades.length < MIN_SIGNAL_TRADES) {
    requirements.push({ field: "trades", current: trades.length, target: MIN_SIGNAL_TRADES, remaining: MIN_SIGNAL_TRADES - trades.length });
  }
  for (const field of ["entryBasis", "strategy", "mood", "confidence", "emotionalTags", "setupRules"]) {
    const percentage = dataQuality.coverage[field]?.percentage || 0;
    if (percentage < 70) requirements.push({ field, currentPercentage: percentage, targetPercentage: 70 });
  }
  return requirements;
}

function buildIndianIntelligenceSummary(inputTrades, options = {}) {
  const instrumentType = normalizeInstrumentType(options.instrumentType);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const trades = Array.isArray(inputTrades)
    ? inputTrades.filter((row) => instrumentType === "ALL" || cleanText(row.instrumentType).toUpperCase() === instrumentType)
    : [];
  const pnlReady = trades.filter((row) => netPnl(row) != null);
  const qualityBase = calculateCoverage(trades);
  const { candidates, suppressedSignals } = buildCandidates(trades, qualityBase, now);
  const strengths = candidates.filter((item) => item.category === "strength").slice(0, 4);
  const leaks = candidates.filter((item) => item.category === "leak").slice(0, 4);
  const doNow = leaks[0] || strengths[0] || null;
  const dates = trades.map(tradeDate).filter(Boolean).sort((a, b) => a - b);
  const dataQuality = { ...qualityBase, suppressedSignals };

  return {
    marketType: "Indian_Market",
    instrumentType,
    generatedAt: now.toISOString(),
    sample: {
      totalTrades: trades.length,
      pnlReadyTrades: pnlReady.length,
      netPnl: round(pnlReady.reduce((sum, row) => sum + netPnl(row), 0)),
      from: dates[0]?.toISOString?.() || null,
      to: dates[dates.length - 1]?.toISOString?.() || null,
    },
    confidence: confidenceForSample(trades.length),
    doNow,
    strengths,
    leaks,
    guardrails: leaks.slice(0, 3).map((item) => ({
      id: `guardrail:${item.id}`,
      sourceInsightId: item.id,
      title: item.title,
      action: item.action,
      priority: item.priority,
      confidence: item.confidence,
    })),
    progress: calculateProgress(trades),
    dataQuality,
    unlockRequirements: buildUnlockRequirements(trades, dataQuality),
  };
}

async function getIndianIntelligenceSummary({ userId, instrumentType = "ALL", now } = {}) {
  if (!userId) throw new Error("userId is required");
  const normalizedType = normalizeInstrumentType(instrumentType);
  const query = { user: userId, deletedAt: null };
  if (normalizedType !== "ALL") query.instrumentType = normalizedType;

  const trades = await IndianTrade.find(query)
    .select(PROJECTION)
    .sort({ tradeDate: 1, createdAt: 1, _id: 1 })
    .lean()
    .limit(TRADE_LIMIT);

  return buildIndianIntelligenceSummary(trades, { instrumentType: normalizedType, now });
}

module.exports = {
  MIN_SIGNAL_TRADES,
  PROJECTION,
  TRADE_LIMIT,
  buildIndianIntelligenceSummary,
  confidenceForSample,
  getIndianIntelligenceSummary,
  normalizeInstrumentType,
};
