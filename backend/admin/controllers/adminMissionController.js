const asyncHandler = require("../../utils/asyncHandler");
const { success, paginated, buildPagination } = require("../../utils/apiResponse");
const missionService = require("../../services/missionService");
const MissionAssignment = require("../../models/MissionAssignment");
const ApiError = require("../../utils/ApiError");

// ─── Templates ────────────────────────────────────────────────────────────────

exports.getAllTemplates = asyncHandler(async (req, res) => {
  const { category, difficulty, isActive } = req.query;
  const activeFilter = isActive === "false" ? false : isActive === "true" ? true : null;
  const templates = await missionService.getAllTemplates({ category, difficulty, isActive: activeFilter });
  success(res, templates);
});

exports.createTemplate = asyncHandler(async (req, res) => {
  const template = await missionService.createTemplate(req.body);
  success(res, template, { statusCode: 201, message: "Template created" });
});

exports.updateTemplate = asyncHandler(async (req, res) => {
  const template = await missionService.updateTemplate(req.params.id, req.body);
  success(res, template, { message: "Template updated" });
});

exports.deactivateTemplate = asyncHandler(async (req, res) => {
  const template = await missionService.deactivateTemplate(req.params.id);
  success(res, template, { message: "Template deactivated" });
});

// ─── User assignments (admin view) ───────────────────────────────────────────

exports.getUserMissions = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const status = req.query.status;

  const filter = { user: userId };
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    MissionAssignment.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    MissionAssignment.countDocuments(filter),
  ]);

  paginated(
    res,
    items.map(a => missionService.formatAssignment(a)),
    buildPagination({ page, limit, total })
  );
});

// ─── Push mission to user ─────────────────────────────────────────────────────

exports.pushMissionToUser = asyncHandler(async (req, res) => {
  const { userId, templateId, reason } = req.body;
  if (!userId || !templateId) {
    throw new ApiError(400, "userId and templateId are required", "VALIDATION_ERROR");
  }
  const assignment = await missionService.assignMission(userId, templateId, {
    recommendedBy: "admin",
    recommendationReason: reason || "Assigned by admin",
  });
  success(res, assignment, { statusCode: 201, message: "Mission assigned to user" });
});

// ─── Analytics ────────────────────────────────────────────────────────────────

exports.getAnalytics = asyncHandler(async (req, res) => {
  const analytics = await missionService.getAdminAnalytics();
  success(res, analytics);
});

// ─── Seed templates ───────────────────────────────────────────────────────────

exports.seedTemplates = asyncHandler(async (req, res) => {
  const count = await missionService.seedMissionTemplates();
  success(res, { seeded: count }, { message: `${count} templates seeded` });
});
