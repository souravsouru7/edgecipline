"use strict";

// Pure deterministic signal-extraction functions for Trading DNA.
//
// These functions take an array of plain trade docs (already filtered for the
// user + market + date window) and return compact, JSON-serialisable summary
// objects. No I/O, no Mongoose, no AI calls — so they are trivially unit-
// testable and safe to share between the report generator and the Gemini
// prompt builder.

function round(value, decimals = 2) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(decimals));
}

function getEffectiveDate(trade) {
  return new Date(
    trade.effectiveTradeDate || trade.tradeDate || trade.createdAt || Date.now()
  );
}

function isWin(trade) {
  return (trade.profit || 0) > 0;
}

function isLoss(trade) {
  return (trade.profit || 0) < 0;
}

// IndianTrade has no `status` column — treat undefined/null as completed.
// Forex Trade rows must be explicitly "completed" to count. This filter is
// the gatekeeper for analytics: pending / processing / failed rows are
// excluded so the sample count and downstream stats reflect only settled
// trades.
function filterCompletedTrades(trades) {
  if (!Array.isArray(trades)) return [];
  return trades.filter((t) => {
    if (t?.status === undefined || t?.status === null) return true;
    return t.status === "completed";
  });
}

// Per-trade expectancy = winRate * avgWin − lossRate * |avgLoss|.
// Returns 0 for an empty group rather than NaN so it sorts cleanly.
function expectancy(trades) {
  if (!Array.isArray(trades) || trades.length === 0) return 0;
  const wins = trades.filter(isWin);
  const losses = trades.filter(isLoss);
  const winRate = wins.length / trades.length;
  const lossRate = losses.length / trades.length;
  const avgWin = wins.length
    ? wins.reduce((s, t) => s + (t.profit || 0), 0) / wins.length
    : 0;
  const avgLoss = losses.length
    ? Math.abs(losses.reduce((s, t) => s + (t.profit || 0), 0) / losses.length)
    : 0;
  return winRate * avgWin - lossRate * avgLoss;
}

function summarizeGroup(name, group) {
  const wins = group.filter(isWin).length;
  const netPnL = group.reduce((s, t) => s + (t.profit || 0), 0);
  return {
    name,
    trades: group.length,
    winRate: round((wins / group.length) * 100, 1),
    netPnL: round(netPnL),
    expectancy: round(expectancy(group)),
  };
}

function rankSetups(trades, { minTradesPerSetup = 5, top = 5 } = {}) {
  const groups = new Map();
  for (const t of trades) {
    const key = String(t.strategy || "").trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const ranked = [...groups.entries()]
    .map(([name, group]) => {
      const summary = summarizeGroup(name, group);
      const scores = group
        .map((t) => t.setupScore)
        .filter((s) => typeof s === "number");
      return {
        ...summary,
        avgSetupScore: scores.length
          ? round(scores.reduce((s, x) => s + x, 0) / scores.length, 1)
          : null,
      };
    })
    .filter((r) => r.trades >= minTradesPerSetup)
    .sort((a, b) => b.expectancy - a.expectancy);

  return {
    best: ranked[0] || null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    top: ranked.slice(0, top),
  };
}

function rankSessions(trades) {
  const groups = new Map();
  for (const t of trades) {
    const key = String(t.session || "").trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const ranked = [...groups.entries()]
    .map(([name, group]) => summarizeGroup(name, group))
    .sort((a, b) => b.expectancy - a.expectancy);
  return {
    best: ranked[0] || null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    all: ranked,
  };
}

function ruleAdherence(trades, { limit = 12 } = {}) {
  const counts = new Map();
  for (const t of trades) {
    if (!Array.isArray(t.setupRules)) continue;
    for (const r of t.setupRules) {
      const label = String(r.label || "").trim();
      if (!label) continue;
      if (!counts.has(label)) counts.set(label, { followed: 0, total: 0 });
      const c = counts.get(label);
      c.total += 1;
      if (r.followed) c.followed += 1;
    }
  }
  return [...counts.entries()]
    .map(([label, c]) => ({
      label,
      total: c.total,
      followed: c.followed,
      followedPct: c.total ? round((c.followed / c.total) * 100, 1) : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

function recoveryProfile(trades) {
  const sorted = [...trades].sort(
    (a, b) => getEffectiveDate(a) - getEffectiveDate(b)
  );
  let afterLoss = { wins: 0, total: 0 };
  let afterTwoLosses = { wins: 0, total: 0 };
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (isLoss(prev)) {
      afterLoss.total += 1;
      if (isWin(curr)) afterLoss.wins += 1;
    }
    if (i >= 2 && isLoss(sorted[i - 2]) && isLoss(prev)) {
      afterTwoLosses.total += 1;
      if (isWin(curr)) afterTwoLosses.wins += 1;
    }
  }
  return {
    afterLoss: {
      sample: afterLoss.total,
      winRate: afterLoss.total
        ? round((afterLoss.wins / afterLoss.total) * 100, 1)
        : null,
    },
    afterTwoLosses: {
      sample: afterTwoLosses.total,
      winRate: afterTwoLosses.total
        ? round((afterTwoLosses.wins / afterTwoLosses.total) * 100, 1)
        : null,
    },
  };
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function positionSizingProfile(trades) {
  const sized = trades.filter(
    (t) => Number.isFinite(t.quantity) && t.quantity > 0
  );
  if (sized.length < 5) return null;
  const sorted = [...sized].sort(
    (a, b) => getEffectiveDate(a) - getEffectiveDate(b)
  );
  const med = median(sorted.map((t) => t.quantity));
  if (!med) return null;

  let oversize = 0;
  let undersize = 0;
  let postLoss = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (!isLoss(sorted[i - 1])) continue;
    postLoss += 1;
    const ratio = sorted[i].quantity / med;
    if (ratio > 1.3) oversize += 1;
    else if (ratio < 0.7) undersize += 1;
  }
  return {
    sample: sized.length,
    medianQty: round(med),
    oversizeAfterLossPct: postLoss
      ? round((oversize / postLoss) * 100, 1)
      : 0,
    undersizeAfterLossPct: postLoss
      ? round((undersize / postLoss) * 100, 1)
      : 0,
    postLossSample: postLoss,
  };
}

function consistencyIndex(trades) {
  const byDay = new Map();
  for (const t of trades) {
    const d = getEffectiveDate(t).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + (t.profit || 0));
  }
  const dailyPnL = [...byDay.values()];
  if (dailyPnL.length < 3) return null;
  const mean = dailyPnL.reduce((s, x) => s + x, 0) / dailyPnL.length;
  const variance =
    dailyPnL.reduce((s, x) => s + (x - mean) ** 2, 0) / dailyPnL.length;
  const stddev = Math.sqrt(variance);
  const cv =
    Math.abs(mean) > 0.0001 ? round(stddev / Math.abs(mean), 2) : null;
  return {
    activeDays: dailyPnL.length,
    dailyMean: round(mean),
    dailyStddev: round(stddev),
    coefficientOfVariation: cv,
  };
}

function emotionalProfile(trades) {
  // Key by lowercased tag so "FOMO"/"fomo"/"Fomo" collapse into one entry.
  // Keep the first-seen original casing for display — avoids both
  // double-counting and an arbitrary canonical form imposed on the user.
  const tagMap = new Map();
  for (const t of trades) {
    if (!Array.isArray(t.emotionalTags)) continue;
    for (const tag of t.emotionalTags) {
      const trimmed = String(tag || "").trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      const existing = tagMap.get(key);
      if (existing) {
        existing.count += 1;
        existing.netPnL += t.profit || 0;
      } else {
        tagMap.set(key, {
          tag: trimmed,
          count: 1,
          netPnL: t.profit || 0,
        });
      }
    }
  }
  const entries = [...tagMap.values()].map((e) => ({
    tag: e.tag,
    count: e.count,
    netPnL: round(e.netPnL),
  }));
  return {
    topByFrequency: entries
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    mostProfitable: entries
      .slice()
      .sort((a, b) => b.netPnL - a.netPnL)
      .slice(0, 3),
    mostCostly: entries
      .slice()
      .sort((a, b) => a.netPnL - b.netPnL)
      .slice(0, 3),
  };
}

function monthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function parseMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return { year: y, monthIndex: m - 1 };
}

// Returns the sequence of monthKey strings from `start` to `end` inclusive,
// e.g. enumerateMonths("2026-03", "2026-08") -> ["2026-03","2026-04",...,"2026-08"].
// Caller is responsible for ordering; we expect start <= end lexicographically.
function enumerateMonths(start, end) {
  const out = [];
  const { year: sy, monthIndex: sm } = parseMonthKey(start);
  const { year: ey, monthIndex: em } = parseMonthKey(end);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(monthKey(y, m));
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

function emptyMonthEntry(key) {
  return {
    month: key,
    trades: 0,
    winRate: null,
    netPnL: 0,
    planAdherencePct: null,
    avgSetupScore: null,
    avgMood: null,
  };
}

function monthlyEvolution(trades, { months = 6 } = {}) {
  const buckets = new Map();
  for (const t of trades) {
    const d = getEffectiveDate(t);
    const key = monthKey(d.getUTCFullYear(), d.getUTCMonth());
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  if (buckets.size === 0) return [];

  // Take the full range between the earliest and latest month that have data,
  // not just the months that have data. This keeps the x-axis honest when a
  // trader sat out a month — gaps render as nulls instead of being collapsed
  // into a misleading adjacent line segment.
  const sortedKeys = [...buckets.keys()].sort();
  const earliest = sortedKeys[0];
  const latest = sortedKeys[sortedKeys.length - 1];
  const fullRange = enumerateMonths(earliest, latest).slice(-months);

  return fullRange.map((k) => {
    const group = buckets.get(k);
    if (!group || group.length === 0) return emptyMonthEntry(k);
    const wins = group.filter(isWin).length;
    const setupScores = group
      .map((t) => t.setupScore)
      .filter((s) => typeof s === "number");
    const moods = group.map((t) => t.mood).filter((m) => typeof m === "number");
    const planTrades = group.filter((t) => t.entryBasis === "Plan").length;
    return {
      month: k,
      trades: group.length,
      winRate: round((wins / group.length) * 100, 1),
      netPnL: round(group.reduce((s, t) => s + (t.profit || 0), 0)),
      planAdherencePct: round((planTrades / group.length) * 100, 1),
      avgSetupScore: setupScores.length
        ? round(setupScores.reduce((s, x) => s + x, 0) / setupScores.length, 1)
        : null,
      avgMood: moods.length
        ? round(moods.reduce((s, x) => s + x, 0) / moods.length, 2)
        : null,
    };
  });
}

function summarizeWindow(trades) {
  if (!Array.isArray(trades) || trades.length === 0) return null;
  const wins = trades.filter(isWin).length;
  const planTrades = trades.filter((t) => t.entryBasis === "Plan").length;
  const setupScores = trades
    .map((t) => t.setupScore)
    .filter((s) => typeof s === "number");
  return {
    trades: trades.length,
    winRate: round((wins / trades.length) * 100, 1),
    netPnL: round(trades.reduce((s, t) => s + (t.profit || 0), 0)),
    expectancy: round(expectancy(trades)),
    planAdherencePct: round((planTrades / trades.length) * 100, 1),
    avgSetupScore: setupScores.length
      ? round(setupScores.reduce((s, x) => s + x, 0) / setupScores.length, 1)
      : null,
  };
}

function quarterlyComparison(currentTrades, previousTrades) {
  const current = summarizeWindow(currentTrades);
  const previous = summarizeWindow(previousTrades);
  const deltas = current && previous
    ? {
        winRate: round((current.winRate || 0) - (previous.winRate || 0), 1),
        netPnL: round((current.netPnL || 0) - (previous.netPnL || 0)),
        expectancy: round((current.expectancy || 0) - (previous.expectancy || 0)),
        planAdherencePct: round(
          (current.planAdherencePct || 0) - (previous.planAdherencePct || 0),
          1
        ),
      }
    : null;
  return { current, previous, deltas };
}

// Deterministic behavioral patterns — these become the seed for the AI's
// "behaviorPatterns" output and let the model anchor on real numbers.
function behaviorPatterns(trades) {
  const patterns = [];

  const planTrades = trades.filter((t) => t.entryBasis === "Plan");
  const emotionTrades = trades.filter(
    (t) => t.entryBasis === "Emotion" || t.entryBasis === "Impulsive"
  );
  if (planTrades.length >= 5 && emotionTrades.length >= 5) {
    const planWR = (planTrades.filter(isWin).length / planTrades.length) * 100;
    const emoWR =
      (emotionTrades.filter(isWin).length / emotionTrades.length) * 100;
    patterns.push({
      pattern: "Plan vs emotion-based entries",
      trigger: `${emotionTrades.length} trades entered on emotion or impulse`,
      consequence: `Plan win rate ${round(planWR, 1)}% vs emotion win rate ${round(emoWR, 1)}%`,
    });
  }

  const withMood = trades.filter((t) => typeof t.mood === "number");
  if (withMood.length >= 10) {
    const highMood = withMood.filter((t) => t.mood >= 4);
    const lowMood = withMood.filter((t) => t.mood <= 2);
    if (highMood.length >= 3 && lowMood.length >= 3) {
      const highAvg =
        highMood.reduce((s, t) => s + (t.profit || 0), 0) / highMood.length;
      const lowAvg =
        lowMood.reduce((s, t) => s + (t.profit || 0), 0) / lowMood.length;
      patterns.push({
        pattern: "Mood and outcome correlation",
        trigger: `Mood >= 4 on ${highMood.length} trades, mood <= 2 on ${lowMood.length} trades`,
        consequence: `Avg P&L high-mood ${round(highAvg)} vs low-mood ${round(lowAvg)}`,
      });
    }
  }

  const highScore = trades.filter(
    (t) => typeof t.setupScore === "number" && t.setupScore >= 80
  );
  const lowScore = trades.filter(
    (t) => typeof t.setupScore === "number" && t.setupScore < 50
  );
  if (highScore.length >= 3 && lowScore.length >= 3) {
    const hsWR =
      (highScore.filter(isWin).length / highScore.length) * 100;
    const lsWR = (lowScore.filter(isWin).length / lowScore.length) * 100;
    patterns.push({
      pattern: "Checklist score vs win rate",
      trigger: `${highScore.length} A+ trades (score >= 80) and ${lowScore.length} low-score trades (< 50)`,
      consequence: `Win rate ${round(hsWR, 1)}% vs ${round(lsWR, 1)}%`,
    });
  }

  return patterns;
}

function buildPersonalityBundle({
  trades = [],
  previousTrades = [],
  marketLabel,
  period,
  performance,
  psychology,
}) {
  const sample = trades.length;
  const lowSample = sample < 20;

  return {
    period: period?.label || "",
    periodType: period?.periodType || "",
    marketType: marketLabel,
    sample: {
      totalTrades: sample,
      previousWindowTrades: previousTrades.length,
      lowSample,
      windowStart: period?.from?.toISOString?.() || null,
      windowEnd: period?.to?.toISOString?.() || null,
    },
    performance: {
      netPnL: round(performance?.netPnL || 0),
      grossPnL: round(performance?.grossPnL || 0),
      winRatePct: round(performance?.winRate || 0, 1),
      profitFactor:
        performance?.profitFactor === Infinity
          ? "Infinity"
          : round(performance?.profitFactor || 0, 2),
      avgWin: round(performance?.avgWin || 0),
      avgLoss: round(performance?.avgLoss || 0),
      expectancy: round(expectancy(trades)),
    },
    psychologySummary: psychology
      ? {
          score: psychology.psychologyScore,
          planAdherencePct: psychology.scoreBreakdown?.planAdherencePct ?? null,
          calmTradingPct: psychology.scoreBreakdown?.calmTradingPct ?? null,
          noRevengePct: psychology.scoreBreakdown?.noRevengePct ?? null,
          wouldRetakePct: psychology.scoreBreakdown?.wouldRetakePct ?? null,
          moodAverage: psychology.mood?.average ?? null,
        }
      : null,
    setups: rankSetups(trades),
    sessions: rankSessions(trades),
    ruleAdherence: ruleAdherence(trades),
    recovery: recoveryProfile(trades),
    positionSizing: positionSizingProfile(trades),
    consistency: consistencyIndex(trades),
    emotions: emotionalProfile(trades),
    behaviorPatterns: behaviorPatterns(trades),
    monthlyEvolution: monthlyEvolution(trades),
    quarterlyComparison: quarterlyComparison(trades, previousTrades),
  };
}

module.exports = {
  buildPersonalityBundle,
  behaviorPatterns,
  consistencyIndex,
  emotionalProfile,
  expectancy,
  filterCompletedTrades,
  monthlyEvolution,
  positionSizingProfile,
  quarterlyComparison,
  rankSessions,
  rankSetups,
  recoveryProfile,
  ruleAdherence,
  summarizeWindow,
};
