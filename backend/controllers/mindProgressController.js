const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { appConfig } = require("../config");
const mindProgressService = require("../services/mindProgress.service");

function ensureEnabled() {
  if (!appConfig.mindProgress?.enabled) {
    throw new ApiError(404, "Mind Score is not available", "MIND_PROGRESS_DISABLED");
  }
}

// GET /api/mind-progress — full progress page (series, wins, target, levels).
exports.getProgress = asyncHandler(async (req, res) => {
  ensureEnabled();
  res.json(await mindProgressService.getProgress(req.user._id));
});

// GET /api/mind-progress/card — compact card (same shape as dashboard.mindProgress).
exports.getCard = asyncHandler(async (req, res) => {
  ensureEnabled();
  res.json(await mindProgressService.getCard(req.user._id));
});

// GET /api/mind-progress/micro — instant reward right after a journal save.
// 200 with `null` when it couldn't be computed in budget: the app then shows
// its plain "saved" toast.
exports.getMicro = asyncHandler(async (req, res) => {
  ensureEnabled();
  res.json({ micro: await mindProgressService.getMicro(req.user._id) });
});

// POST /api/mind-progress/wins/seen { ids: [...] }
exports.markSeen = asyncHandler(async (req, res) => {
  ensureEnabled();
  res.json(await mindProgressService.markSeen(req.user._id, req.body.ids));
});

// GET /api/mind-progress/targets/suggestions
exports.getSuggestions = asyncHandler(async (req, res) => {
  ensureEnabled();
  const { suggestions } = await mindProgressService.getSuggestions(req.user._id);
  res.json({ suggestions });
});

// PUT /api/mind-progress/target { preset, params }
exports.setTarget = asyncHandler(async (req, res) => {
  ensureEnabled();
  const target = await mindProgressService.setTarget(req.user._id, req.body);
  res.status(200).json({ target });
});

// DELETE /api/mind-progress/target
exports.cancelTarget = asyncHandler(async (req, res) => {
  ensureEnabled();
  res.json(await mindProgressService.cancelTarget(req.user._id));
});
