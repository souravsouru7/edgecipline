const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const notificationService = require("./notificationService");
const { appConfig } = require("../config");

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getOffsetMs() {
  const offsetHours = appConfig.morningMentor?.timezoneOffsetHours ?? appConfig.timezoneOffsetHours ?? 5.5;
  return offsetHours * 60 * 60 * 1000;
}

// Local day-of-week (0=Sun … 6=Sat) adjusted for server timezone offset
function getLocalDayOfWeek() {
  return new Date(Date.now() + getOffsetMs()).getUTCDay();
}

// YYYY-MM-DD in local timezone — used as deduplication key
function getLocalDateKey() {
  return new Date(Date.now() + getOffsetMs()).toISOString().slice(0, 10);
}

// UTC start/end of yesterday in local timezone
function getYesterdayRange() {
  const offsetMs = getOffsetMs();
  const localNow = new Date(Date.now() + offsetMs);
  // Midnight of today in local time (stored as UTC offset)
  const localTodayMidnight = new Date(localNow);
  localTodayMidnight.setUTCHours(0, 0, 0, 0);
  // Shift back to real UTC for DB query
  return {
    start: new Date(localTodayMidnight.getTime() - 24 * 60 * 60 * 1000 - offsetMs),
    end:   new Date(localTodayMidnight.getTime() - 1 - offsetMs),
  };
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

  const avgSetupScore =
    total > 0
      ? Math.round(trades.reduce((s, t) => s + (t.setupScore || 0), 0) / total)
      : 0;

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
    isRevengeTrading: maxStreak >= 3,
    noStopLossCount,
    noStopLossRate: total > 0 ? noStopLossCount / total : 0,
    avgSetupScore,
    emotionCount,
    impulsiveEntries,
    isOvertrading: total > 5,
    isProfitable: totalPnl > 0,
  };
}

// ─── Message generators ───────────────────────────────────────────────────────

function generateTradedMessage(a) {
  const { total, wins, losses, winRate, isRevengeTrading, noStopLossCount,
    noStopLossRate, avgSetupScore, emotionCount, impulsiveEntries,
    isOvertrading, isProfitable } = a;

  // Priority order: highest-risk violation first, then discipline, then reinforcement

  if (isRevengeTrading) {
    return {
      title: "🛑 Stop. Breathe. Think.",
      body: `Yesterday shows emotional re-entry after losses: ${losses} consecutive losses and ${total} total trades. Protect discipline first today. Profits follow calm execution. 🧠`,
      scenario: "revenge",
    };
  }

  if (noStopLossRate >= 0.5) {
    return {
      title: "🛡️ Protect Your Capital First.",
      body: `${noStopLossCount} of your ${total} trades yesterday had no stop loss. Every unprotected trade puts the account at risk. Stop loss before entry today. No exceptions. ⚠️`,
      scenario: "no_stop_loss",
    };
  }

  if (isOvertrading) {
    return {
      title: "🎯 Quality Over Quantity.",
      body: `You took ${total} trades yesterday, beyond your optimal session size. Today, filter hard. One clean A+ setup beats five forced entries. 📌`,
      scenario: "overtrading",
    };
  }

  if (emotionCount >= 2 || impulsiveEntries >= 2) {
    return {
      title: "🧘 Rules, Not Emotions.",
      body: "Yesterday's entries showed emotional decision-making. Today, let rules decide, not feelings. If the checklist is incomplete, no entry. ✅",
      scenario: "emotional",
    };
  }

  if (avgSetupScore < 60 && total > 0) {
    return {
      title: "📉 Your Edge Is Slipping.",
      body: `Average setup quality yesterday was ${avgSetupScore}%. Your edge works only when the full process is followed. Checklist before every entry today. 🔍`,
      scenario: "low_setup",
    };
  }

  if (!isProfitable && total > 0) {
    return {
      title: "🔄 Losses Are Part of the Process.",
      body: `Yesterday ended negative: ${wins}W / ${losses}L. Losing days happen. The pro move today is simple: back to process, not revenge. 💪`,
      scenario: "loss_day",
    };
  }

  if (isProfitable && avgSetupScore >= 70) {
    return {
      title: "🔥 Discipline Is Delivering.",
      body: `Yesterday: ${wins}W / ${losses}L, ${winRate}% win rate with solid setup quality. That is how accounts compound. Same process today. Protect it. 📈`,
      scenario: "disciplined_win",
    };
  }

  if (isProfitable) {
    return {
      title: "✅ Stay Consistent.",
      body: `Yesterday was profitable: ${wins} wins from ${total} trades. Do not change what is working. Execute the same plan with the same focus. 🚀`,
      scenario: "profitable",
    };
  }

  return {
    title: "🌅 Reset. Refocus. Execute.",
    body: "New session, clean slate. Yesterday is data. Use it to trade better today: follow rules, manage risk, trust the process. 🎯",
    scenario: "reset",
  };
}

// 5 rotating weekend messages (index driven by calendar day so they vary)
const WEEKEND_MESSAGES = [
  {
    title: "🧠 Build Your Edge This Weekend.",
    body: "Charts are closed, but growth is open. Review your journal, study mistakes, and prepare the plan. Profitable weeks start here. 📚",
  },
  {
    title: "🔍 Weekend Reflection Builds Discipline.",
    body: "Audit last week's trades. What worked, what did not, and why? Traders who review consistently improve. ✅",
  },
  {
    title: "🚀 Your Next Profitable Week Starts Now.",
    body: "The market is closed, but your edge is built here. Review patterns, prepare setups, and let weekend work compound next week. 📈",
  },
  {
    title: "⏳ Patience and Preparation Win.",
    body: "Professional traders use weekends wisely. Study setups, review mistakes, and build the mental edge for next week. 🎯",
  },
  {
    title: "🌤️ Reset and Refocus.",
    body: "Take a disciplined break, review your journal, and prepare the watchlist. Weekend preparation builds consistency. 📝",
  },
];

// 5 rotating no-trade messages
const NO_TRADE_MESSAGES = [
  {
    title: "🧘 No Trade Is a Trade.",
    body: "You took no trades yesterday. Waiting for the right setup is professional trading. Patience protects capital. Stay selective today. 🎯",
  },
  {
    title: "✅ Discipline Is Choosing Not to Trade.",
    body: "No setup, no trade yesterday. That is how consistency is built. Today, enter only when every rule is fully met. 📌",
  },
  {
    title: "🎯 Quality Over Activity.",
    body: "Sitting out yesterday showed discipline. Professionals do not chase trades. Let the market come to your setup. 🧠",
  },
  {
    title: "🛡️ Patience Protects Capital.",
    body: "No trades can be the best trade. Yesterday you stayed disciplined. Keep the same standard today: only execute when conditions are right. ⚡",
  },
  {
    title: "⏳ Waiting Is a Skill.",
    body: "Most traders lose by forcing action. Yesterday you did not force anything. That is a professional habit. Build on it today. 💪",
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

async function sendMorningMentor(userId) {
  const dayOfWeek = getLocalDayOfWeek(); // 0=Sun, 6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const dateKey   = getLocalDateKey();
  const dedupeKey = `morning-mentor:${userId}:${dateKey}`;

  // ── Weekend ────────────────────────────────────────────────────────────────
  if (isWeekend) {
    const idx = Math.floor(Date.now() / 86400000) % WEEKEND_MESSAGES.length;
    const msg = WEEKEND_MESSAGES[idx];
    return notificationService.notifyUser(userId, {
      type:       "morning_mentor",
      title:      msg.title,
      body:       msg.body,
      sourceType: "cron",
      dedupeKey,
      deepLink:   "/notifications",
      data:       { screen: "notifications", scenario: "weekend" },
    });
  }

  // ── Fetch yesterday's trades ───────────────────────────────────────────────
  const { start, end } = getYesterdayRange();
  const FIELDS = { profit: 1, stopLoss: 1, setupScore: 1, mood: 1, emotionalTags: 1, entryBasis: 1, tradeDate: 1, createdAt: 1 };

  const [forexTrades, indianTrades] = await Promise.all([
    Trade.find(
      { user: userId, createdAt: { $gte: start, $lte: end }, "parsedData.multiTradeGhost": { $ne: true } },
      FIELDS
    ).lean(),
    IndianTrade.find(
      { user: userId, createdAt: { $gte: start, $lte: end } },
      FIELDS
    ).lean(),
  ]);

  const allTrades = [...forexTrades, ...indianTrades];

  // ── No trades yesterday ───────────────────────────────────────────────────
  if (allTrades.length === 0) {
    const idx = Math.floor(Date.now() / 86400000) % NO_TRADE_MESSAGES.length;
    const msg = NO_TRADE_MESSAGES[idx];
    return notificationService.notifyUser(userId, {
      type:       "morning_mentor",
      title:      msg.title,
      body:       msg.body,
      sourceType: "cron",
      dedupeKey,
      deepLink:   "/trades",
      data:       { screen: "trades", scenario: "no_trade" },
    });
  }

  // ── Traded yesterday — personalised mentor message ────────────────────────
  const analysis = analyzeTrades(allTrades);
  const message  = generateTradedMessage(analysis);

  return notificationService.notifyUser(userId, {
    type:       "morning_mentor",
    title:      message.title,
    body:       message.body,
    sourceType: "cron",
    dedupeKey,
    deepLink:   "/trades",
    data: {
      screen:      "trades",
      scenario:    message.scenario,
      totalTrades: allTrades.length,
    },
  });
}

module.exports = { sendMorningMentor };
