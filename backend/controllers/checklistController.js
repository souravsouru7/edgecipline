const ChecklistTracking = require("../models/ChecklistTracking");
const User = require("../models/Users");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const streakService = require("../services/streak.service");
const { logger } = require("../utils/logger");

// @desc    Log a checklist execution result
// @route   POST /api/checklists/track
// @access  Private
const RULES_MAX = 200;

function validateChecklistNumbers({ totalRules, followedRules, score }) {
  const t = Number(totalRules);
  const f = Number(followedRules);
  const s = Number(score);
  if (!Number.isFinite(t) || !Number.isInteger(t) || t < 0 || t > RULES_MAX) {
    throw new ApiError(400, `totalRules must be an integer in 0..${RULES_MAX}`, "VALIDATION_ERROR");
  }
  if (!Number.isFinite(f) || !Number.isInteger(f) || f < 0 || f > t) {
    throw new ApiError(400, "followedRules must be an integer in 0..totalRules", "VALIDATION_ERROR");
  }
  if (!Number.isFinite(s) || s < 0 || s > 100) {
    throw new ApiError(400, "score must be a number in 0..100", "VALIDATION_ERROR");
  }
  return { totalRules: t, followedRules: f, score: s };
}

const logChecklistResult = asyncHandler(async (req, res) => {
  const { market, strategyName, totalRules, followedRules, score, isAPlus, setupSimilarity } = req.body;

  if (!strategyName || totalRules === undefined || followedRules === undefined || score === undefined || isAPlus === undefined) {
    throw new ApiError(400, "All fields are required", "VALIDATION_ERROR");
  }
  const numbers = validateChecklistNumbers({ totalRules, followedRules, score });

  const trackingRecord = await ChecklistTracking.create({
    user: req.user._id,
    market: market || "Forex",
    strategyName,
    totalRules: numbers.totalRules,
    followedRules: numbers.followedRules,
    score: numbers.score,
    isAPlus: Boolean(isAPlus),
    setupSimilarity: typeof setupSimilarity === "string" ? setupSimilarity : "",
  });

  // Flag today as a checklist day. The day's actual checklist streak only
  // counts if a trade also happens, but recording the signal here means the
  // user gets credit whether they run the checklist before or after the trade.
  streakService
    .recordChecklistEvent(req.user._id, { market: market || "Forex" })
    .catch((err) => logger.warn("STREAK_CHECKLIST_EVENT_FAILED", { error: err?.message }));

  res.status(201).json(trackingRecord);
});

// @desc    Get user's checklist tracking stats
// @route   GET /api/checklists/track
// @access  Private
const getChecklistStats = asyncHandler(async (req, res) => {
  const { market } = req.query;
  const filter = { user: req.user._id };
  if (market) {
    filter.market = market;
  }

  // Hard cap: a single user with thousands of entries would otherwise pull
  // the entire history into Node memory on every dashboard load. 500 covers
  // the realistic UI need (recent activity); older entries can be paginated
  // through a separate endpoint if/when needed.
  const CHECKLIST_HISTORY_CAP = 500;
  const tracks = await ChecklistTracking.find(filter)
    .sort({ createdAt: -1 })
    .limit(CHECKLIST_HISTORY_CAP)
    .lean();

  const totalChecklists = tracks.length;
  const aPlusCount = tracks.filter(t => t.isAPlus).length;

  res.status(200).json({
    totalChecklists,
    aPlusCount,
    tracks,
    truncated: tracks.length === CHECKLIST_HISTORY_CAP,
  });
});

module.exports = {
  logChecklistResult,
  getChecklistStats,
};
