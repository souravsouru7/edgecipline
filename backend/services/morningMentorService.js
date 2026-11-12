const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const notificationService = require("./notificationService");
const {
  getDayRange,
  getLocalCalendarDateAfter,
  getLocalDateKey,
  getTimeZoneParts,
  getUserNotificationTimezone,
  zonedTimeToUtc,
} = require("../utils/timezone");

// ─── Date helpers ─────────────────────────────────────────────────────────────
//
// Everything is in the USER's timezone (User.streaks.timezone, reported by the
// device on push registration). This used to be a fixed +5:30 for everyone,
// so a London user's "yesterday" ended at 18:30 their time.

function localDayOfWeek(now, timezone) {
  const p = getTimeZoneParts(now, timezone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

// The previous weekday's local day. Monday looks back at Friday — markets are
// shut at the weekend, so "you took no trades yesterday" on a Monday morning
// was praising people for Sunday.
function previousTradingDay(now, timezone) {
  const today = getTimeZoneParts(now, timezone);
  const dow = localDayOfWeek(now, timezone);
  const back = dow === 1 ? 3 : dow === 0 ? 2 : 1;
  const day = getLocalCalendarDateAfter(today, -back);
  const middayUtc = zonedTimeToUtc({ ...day, hour: 12, minute: 0, second: 0 }, timezone);
  return { ...getDayRange(middayUtc, timezone), label: back === 1 ? "yesterday" : "on Friday" };
}

// ─── Trade analyser ───────────────────────────────────────────────────────────

const EMOTION_TAGS = new Set([
  "fomo", "revenge", "fear", "frustrated", "stressed",
  "greedy", "impatient", "hesitant", "overconfident", "anxiety",
]);

function analyzeTrades(trades) {
  const total = trades.length;
  const wins   = trades.filter((t) => (t.profit || 0) > 0).length;
  const losses = trades.filter((t) => (t.profit || 0) < 0).length;
  const totalPnl = Math.round(trades.reduce((s, t) => s + (t.profit || 0), 0) * 100) / 100;

  // Max consecutive losses (sorted by tradeDate ascending)
  const sorted = [...trades].sort(
    (a, b) => new Date(a.tradeDate || a.createdAt) - new Date(b.tradeDate || b.createdAt)
  );
  let streak = 0;
  let maxStreak = 0;
  for (const t of sorted) {
    if ((t.profit || 0) < 0) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }

  const noStopLossCount = trades.filter((t) => !t.stopLoss || t.stopLoss <= 0).length;

  // Only trades that actually have a checklist score. setupScore defaults to
  // null, so averaging `|| 0` over everything told checklist non-users (even
  // profitable ones) "Your edge is slipping … 0%".
  const scored = trades.filter((t) => typeof t.setupScore === "number" && Number.isFinite(t.setupScore));
  const avgSetupScore = scored.length
    ? Math.round(scored.reduce((s, t) => s + t.setupScore, 0) / scored.length)
    : null;
  const setupScoreCoverage = total > 0 ? scored.length / total : 0;

  let emotionCount = 0;
  for (const t of trades) {
    const tags = Array.isArray(t.emotionalTags) ? t.emotionalTags : [];
    if (tags.some((tag) => EMOTION_TAGS.has(String(tag).toLowerCase()))) emotionCount++;
    if ((t.mood || 3) <= 2) emotionCount++;
  }

  const impulsiveEntries = trades.filter(
    (t) => t.entryBasis === "Emotion" || t.entryBasis === "Impulsive"
  ).length;

  return {
    total, wins, losses,
    totalPnl,
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
    maxLossStreak: maxStreak,
    isRevengeTrading: maxStreak >= 3,
    noStopLossCount,
    noStopLossRate: total > 0 ? noStopLossCount / total : 0,
    avgSetupScore,
    setupScoreCoverage,
    emotionCount,
    impulsiveEntries,
    isOvertrading: total > 5,
    isProfitable: totalPnl > 0,
  };
}

// ─── Message generators ───────────────────────────────────────────────────────

// `when` is "yesterday" or "on Friday" (Monday mornings look back to Friday).
// Copy rules: process and risk, never outcome promises ("profits follow",
// "accounts compound"), and every number shown must be the real one.
function generateTradedMessage(a, when = "yesterday") {
  const { total, wins, losses, winRate, isRevengeTrading, maxLossStreak, noStopLossCount,
    noStopLossRate, avgSetupScore, setupScoreCoverage, emotionCount, impulsiveEntries,
    isOvertrading, isProfitable } = a;
  const When = when.charAt(0).toUpperCase() + when.slice(1);

  // Priority order: highest-risk violation first, then discipline, then reinforcement

  if (isRevengeTrading) {
    return {
      title: "Stop. Breathe. Think.",
      body: `${When} you took ${maxLossStreak} losses in a row across ${total} trades. Protect your discipline first today: one planned setup at a time.`,
      scenario: "revenge",
    };
  }

  if (noStopLossRate >= 0.5) {
    return {
      title: "Protect your capital first",
      body: `${noStopLossCount} of your ${total} trades ${when} had no stop loss. Set the stop before every entry today.`,
      scenario: "no_stop_loss",
    };
  }

  if (isOvertrading) {
    return {
      title: "Quality over quantity",
      body: `You took ${total} trades ${when}. Today, filter hard: one clean A+ setup beats five forced entries.`,
      scenario: "overtrading",
    };
  }

  if (emotionCount >= 2 || impulsiveEntries >= 2) {
    return {
      title: "Rules, not emotions",
      body: `Your entries ${when} showed emotional decisions. Today, let the rules decide: if the checklist is incomplete, no entry.`,
      scenario: "emotional",
    };
  }

  // Only when most trades were actually scored — otherwise the average says
  // nothing about the process.
  if (avgSetupScore !== null && setupScoreCoverage >= 0.5 && avgSetupScore < 60) {
    return {
      title: "Your setup quality dipped",
      body: `Average setup score ${when} was ${avgSetupScore}%. Run the full checklist before every entry today.`,
      scenario: "low_setup",
    };
  }

  if (!isProfitable && total > 0) {
    return {
      title: "Losses are part of the process",
      body: `${When}: ${wins}W / ${losses}L. Losing days happen. Today's job is the same plan, not revenge.`,
      scenario: "loss_day",
    };
  }

  if (isProfitable && avgSetupScore !== null && avgSetupScore >= 70) {
    return {
      title: "Your process held up",
      body: `${When}: ${wins}W / ${losses}L, ${winRate}% win rate with solid setup quality. Same process today.`,
      scenario: "disciplined_win",
    };
  }

  if (isProfitable) {
    return {
      title: "Stay consistent",
      body: `${When}: ${wins} wins from ${total} trades. Don't change what's working: same plan, same focus.`,
      scenario: "profitable",
    };
  }

  return {
    title: "Reset. Refocus. Execute.",
    body: "New session, clean slate. Follow your rules, manage risk, trust the process.",
    scenario: "reset",
  };
}

// Rotating weekend messages (index driven by calendar day so they vary)
const WEEKEND_MESSAGES = [
  {
    title: "Build your edge this weekend",
    body: "Markets are closed. Review your journal, study your mistakes and prepare next week's plan.",
  },
  {
    title: "Weekend review builds discipline",
    body: "Look back at last week's trades: what worked, what didn't, and why.",
  },
  {
    title: "Prepare for the week ahead",
    body: "Review your patterns, refine your setups and write down the rules you'll follow next week.",
  },
  {
    title: "Patience and preparation",
    body: "Use the weekend to study setups and review mistakes, so next week starts with a clear plan.",
  },
  {
    title: "Reset and refocus",
    body: "Take a break, review your journal and prepare your watchlist for the week.",
  },
];

// Rotating messages for a trading day with no trades logged. WHEN is replaced
// with "yesterday" or "on Friday".
const NO_TRADE_MESSAGES = [
  {
    title: "No trade is a trade",
    body: "You logged no trades WHEN. Waiting for the right setup is part of the job. Stay selective today.",
  },
  {
    title: "Discipline is choosing not to trade",
    body: "No trades WHEN. Today, enter only when every rule is fully met.",
  },
  {
    title: "Quality over activity",
    body: "You sat out WHEN. Let the market come to your setup today.",
  },
  {
    title: "Patience protects capital",
    body: "No trades WHEN. Keep the same standard today: only execute when conditions are right.",
  },
  {
    title: "Waiting is a skill",
    body: "You didn't force a trade WHEN. Build on that today.",
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

function tradesRoute(user) {
  return user?.preferredMarket === "Indian_Market"
    ? { deepLink: "/indian-market/trades", screen: "indian-trades" }
    : { deepLink: "/trades", screen: "trades" };
}

function dayNumber(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * @param {object|string} user  { _id, preferredMarket, streaks.timezone } (or an id)
 * @param {{ now?: Date }} options
 */
async function sendMorningMentor(user, options = {}) {
  const userId = user?._id ?? user;
  const now = options.now || new Date();
  const timezone = getUserNotificationTimezone(typeof user === "object" ? user : null);
  const dayOfWeek = localDayOfWeek(now, timezone);
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const dateKey = getLocalDateKey(now, timezone);
  const dedupeKey = `morning-mentor:${userId}:${dateKey}`;
  const route = tradesRoute(typeof user === "object" ? user : null);
  const rotation = dayNumber(dateKey);

  // ── Weekend ────────────────────────────────────────────────────────────────
  if (isWeekend) {
    const msg = WEEKEND_MESSAGES[rotation % WEEKEND_MESSAGES.length];
    return notificationService.notifyUser(userId, {
      type:       "morning_mentor",
      title:      msg.title,
      body:       msg.body,
      sourceType: "cron",
      dedupeKey,
      deepLink:   route.deepLink,
      data:       { screen: route.screen, scenario: "weekend" },
    });
  }

  // ── Fetch the previous trading day's trades (by trade date) ──────────────
  const { start, end, label } = previousTradingDay(now, timezone);
  const FIELDS = { profit: 1, stopLoss: 1, setupScore: 1, mood: 1, emotionalTags: 1, entryBasis: 1, tradeDate: 1, createdAt: 1 };
  // When the trade happened, not when it was saved: importing a backlog of
  // old trades yesterday must not read as "you took 40 trades yesterday".
  const inRange = { $gte: start, $lt: end };
  const dateFilter = { $or: [{ tradeDate: inRange }, { tradeDate: null, createdAt: inRange }] };

  const [forexTrades, indianTrades] = await Promise.all([
    Trade.find(
      { user: userId, deletedAt: null, "parsedData.multiTradeGhost": { $ne: true }, ...dateFilter },
      FIELDS
    ).lean(),
    IndianTrade.find({ user: userId, deletedAt: null, ...dateFilter }, FIELDS).lean(),
  ]);

  const allTrades = [...forexTrades, ...indianTrades];

  // ── No trades on the previous trading day ─────────────────────────────────
  if (allTrades.length === 0) {
    const msg = NO_TRADE_MESSAGES[rotation % NO_TRADE_MESSAGES.length];
    return notificationService.notifyUser(userId, {
      type:       "morning_mentor",
      title:      msg.title,
      body:       msg.body.replace("WHEN", label),
      sourceType: "cron",
      dedupeKey,
      deepLink:   route.deepLink,
      data:       { screen: route.screen, scenario: "no_trade" },
    });
  }

  // ── Traded — personalised mentor message ──────────────────────────────────
  const analysis = analyzeTrades(allTrades);
  const message  = generateTradedMessage(analysis, label);

  return notificationService.notifyUser(userId, {
    type:       "morning_mentor",
    title:      message.title,
    body:       message.body,
    sourceType: "cron",
    dedupeKey,
    deepLink:   route.deepLink,
    data: {
      screen:      route.screen,
      scenario:    message.scenario,
      totalTrades: allTrades.length,
    },
  });
}

module.exports = { sendMorningMentor, analyzeTrades, generateTradedMessage, previousTradingDay };
