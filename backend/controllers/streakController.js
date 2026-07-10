const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const streakService = require("../services/streak.service");
const { handleStreakEvents } = require("../services/streakNotification.service");
const { logger } = require("../utils/logger");

// GET /api/streaks
// Returns the user's three streaks plus a 90-day calendar grid for the
// detail page. Cheap — denormalized counters + a bounded daily lookup.
const getStreaks = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 7), 366);
  const detail = await streakService.getStreakDetail(req.user._id, { days });
  if (!detail) throw new ApiError(404, "Streaks not found", "NOT_FOUND");
  res.status(200).json(detail);
});

// POST /api/streaks/no-trade-today
// Marks today as a "sat out" day. Idempotent. Triggers recompute + emits
// any milestone notification that crossing today's threshold unlocks.
const markNoTradeToday = asyncHandler(async (req, res) => {
  const { market, note } = req.body || {};
  const result = await streakService.markNoTradeAndRecompute(req.user._id, { market, note });

  // Fire-and-forget — never block the response on push delivery.
  handleStreakEvents(req.user._id, result.events).catch((err) =>
    logger.warn("STREAK_EVENTS_HANDLER_FAILED", { error: err?.message })
  );

  logger.info("STREAK_NO_TRADE_TODAY", {
    userId: String(req.user._id),
    day: result.todayKey,
    alreadyTraded: result.alreadyTraded,
    currentJournalStreak: result.streaks.journal.current,
  });

  res.status(200).json({
    day: result.todayKey,
    alreadyTraded: result.alreadyTraded,
    streaks: result.streaks,
    events: result.events,
  });
});

// POST /api/streaks/recompute
// Self-service rebuild — useful when something looks stale (e.g., after
// importing old trades). No-op if nothing has changed.
const recomputeStreaks = asyncHandler(async (req, res) => {
  const result = await streakService.recomputeStreaks(req.user._id);
  res.status(200).json(result);
});

// PUT /api/streaks/threshold
// Updates the user's rule-discipline threshold (0–100). Triggers recompute
// so the rule streak reflects the new threshold immediately.
const updateRuleThreshold = asyncHandler(async (req, res) => {
  const threshold = Number(req.body?.threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new ApiError(400, "threshold must be a number between 0 and 100", "VALIDATION_ERROR");
  }
  const User = require("../models/Users");
  await User.updateOne({ _id: req.user._id }, { $set: { "streaks.rule.threshold": threshold } });
  const result = await streakService.recomputeStreaks(req.user._id);
  res.status(200).json(result);
});

module.exports = {
  getStreaks,
  markNoTradeToday,
  recomputeStreaks,
  updateRuleThreshold,
};
