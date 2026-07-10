const { notifyUser } = require("./notificationService");
const { logger } = require("../utils/logger");

// All copy here is anti-shame by design. We celebrate consistency, frame a
// break as a fresh start, and never compare the user to anyone else.

function pluralizeDays(n) {
  return n === 1 ? "1 day" : `${n} days`;
}

// Fires once when the user crosses 3/7/14/30/60/100/180/365.
async function sendMilestone(userId, milestoneDays) {
  if (!userId || !milestoneDays) return null;
  const copy = milestoneCopy(milestoneDays);
  return notifyUser(userId, {
    type:       "streak_milestone",
    title:      copy.title,
    body:       copy.body,
    sourceType: "streak",
    dedupeKey:  `streak_milestone:${userId}:${milestoneDays}`,
    deepLink:   "/streaks",
    data:       { milestoneDays, deepLink: "/streaks" },
  }).catch((err) => {
    logger.warn("STREAK_MILESTONE_NOTIFY_FAILED", { userId: String(userId), milestoneDays, error: err?.message });
    return null;
  });
}

function milestoneCopy(days) {
  switch (days) {
    case 3:   return { title: "🔥 3-day streak",     body: "Three days of showing up. Most traders never make it past day one." };
    case 7:   return { title: "🔥 One full week",    body: "You've protected your discipline for 7 days. This is how habits form." };
    case 14:  return { title: "🔥 Two weeks strong", body: "14 days. Discipline is becoming who you are, not just what you do." };
    case 30:  return { title: "🔥 30-day milestone", body: "A full month of consistency. You're operating at a different level now." };
    case 60:  return { title: "🔥 60 days",          body: "Two months. You're not journaling — you're building an edge." };
    case 100: return { title: "🔥 100 days",         body: "Triple digits. Less than 1% of traders ever protect their discipline this long." };
    case 180: return { title: "🔥 6 months",         body: "Half a year of disciplined execution. The market rewards this." };
    case 365: return { title: "🔥 One full year",    body: "365 days. You've outlasted entire trading careers. Keep going." };
    default:  return { title: `🔥 ${pluralizeDays(days)}`, body: "You've protected your streak. Keep showing up." };
  }
}

// Fires when a strong streak (≥7) breaks. Soft, restorative — never punitive.
async function sendBroken(userId, brokenLength) {
  if (!userId || !brokenLength) return null;
  return notifyUser(userId, {
    type:       "streak_broken",
    title:      `Your ${brokenLength}-day streak ended`,
    body:       "Most disciplined traders rebuild within 2 days. The streak is just a counter — your habit is still yours.",
    sourceType: "streak",
    dedupeKey:  `streak_broken:${userId}:${new Date().toISOString().slice(0, 10)}`,
    deepLink:   "/streaks",
    data:       { brokenLength, deepLink: "/streaks" },
  }).catch((err) => {
    logger.warn("STREAK_BROKEN_NOTIFY_FAILED", { userId: String(userId), brokenLength, error: err?.message });
    return null;
  });
}

// Fires from the evening cron when the user has a streak ≥3 and hasn't
// logged today. Dedupe key is per-day so we only nudge once per user per day.
async function sendAtRisk(userId, { currentStreak, dayKey }) {
  if (!userId || !currentStreak || !dayKey) return null;
  return notifyUser(userId, {
    type:       "streak_at_risk",
    title:      "Don't lose your streak",
    body:       `Your ${currentStreak}-day discipline streak is alive — log today or mark "Sat Out" in 30 seconds.`,
    sourceType: "streak",
    dedupeKey:  `streak_at_risk:${userId}:${dayKey}`,
    deepLink:   "/streaks",
    data:       { currentStreak, deepLink: "/streaks" },
  }).catch((err) => {
    logger.warn("STREAK_AT_RISK_NOTIFY_FAILED", { userId: String(userId), error: err?.message });
    return null;
  });
}

// Convenience used by trade/checklist flows — given the `events` object from
// recomputeStreaks, fire whichever notification matches. Never throws.
async function handleStreakEvents(userId, events = {}) {
  if (!userId || !events) return;
  if (events.newMilestone) await sendMilestone(userId, events.newMilestone);
  if (events.broken && events.brokenLength >= 7) {
    await sendBroken(userId, events.brokenLength);
  }
}

module.exports = {
  sendMilestone,
  sendBroken,
  sendAtRisk,
  handleStreakEvents,
};
