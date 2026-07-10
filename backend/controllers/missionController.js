const asyncHandler = require("../utils/asyncHandler");
const { success, paginated, buildPagination } = require("../utils/apiResponse");
const missionService = require("../services/missionService");
const { recommendMissions, getUserBehaviorProfile } = require("../services/aiMissionRecommendationService");

// ─── Templates (read-only for users) ─────────────────────────────────────────

exports.getTemplates = asyncHandler(async (req, res) => {
  const { category, difficulty } = req.query;
  const templates = await missionService.getAllTemplates({ category, difficulty, isActive: true });
  success(res, templates);
});

// ─── Active missions ──────────────────────────────────────────────────────────

exports.getActiveMissions = asyncHandler(async (req, res) => {
  const missions = await missionService.getActiveMissions(req.user._id);
  success(res, missions);
});

// ─── Mission history ──────────────────────────────────────────────────────────

exports.getMissionHistory = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const page = Math.max(Number(req.query.page) || 1, 1);

  const result = await missionService.getMissionHistory(req.user._id, { limit, page });
  paginated(res, result.items, buildPagination({ page: result.page, limit: result.limit, total: result.total }));
});

// ─── Single mission ───────────────────────────────────────────────────────────

exports.getMission = asyncHandler(async (req, res) => {
  const mission = await missionService.getMissionById(req.user._id, req.params.id);
  success(res, mission);
});

// ─── Stats ────────────────────────────────────────────────────────────────────

exports.getMissionStats = asyncHandler(async (req, res) => {
  const stats = await missionService.getMissionStats(req.user._id);
  success(res, stats);
});

// ─── Lifecycle actions ────────────────────────────────────────────────────────

exports.acceptMission = asyncHandler(async (req, res) => {
  const mission = await missionService.acceptMission(req.user._id, req.params.id);
  success(res, mission, { message: "Mission accepted" });
});

exports.archiveMission = asyncHandler(async (req, res) => {
  const mission = await missionService.archiveMission(req.user._id, req.params.id);
  success(res, mission, { message: "Mission archived" });
});

// ─── AI Recommendations ───────────────────────────────────────────────────────

exports.getRecommendations = asyncHandler(async (req, res) => {
  const lookbackDays = Math.min(Number(req.query.lookback) || 30, 90);
  const result = await recommendMissions(req.user._id, { maxRecommendations: 3, lookbackDays });
  success(res, result);
});

exports.getBehaviorProfile = asyncHandler(async (req, res) => {
  const lookbackDays = Math.min(Number(req.query.lookback) || 30, 90);
  const profile = await getUserBehaviorProfile(req.user._id, lookbackDays);
  success(res, profile);
});
