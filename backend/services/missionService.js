"use strict";

const MissionTemplate = require("../models/MissionTemplate");
const MissionAssignment = require("../models/MissionAssignment");
const User = require("../models/Users");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");

// Maximum number of simultaneous active missions per user
const MAX_ACTIVE_MISSIONS = 3;

// ─── Plan check helper ────────────────────────────────────────────────────────

// A user is considered premium if they have an active paid subscription OR
// are within an active trial window — mirroring how the rest of the app gates
// premium features (SmartPaywall, trial banner, etc.).
function userIsPremium(user) {
  if (!user) return false;
  if (user.subscriptionStatus === "active") return true;
  if (user.trial?.endsAt && new Date(user.trial.endsAt) > new Date()) return true;
  return false;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSnapshot(template) {
  return {
    name:              template.name,
    description:       template.description,
    category:          template.category,
    difficulty:        template.difficulty,
    validationType:    template.validationType,
    progressMode:      template.progressMode,
    target:            template.target,
    unit:              template.unit,
    validationConfig:  template.validationConfig || {},
    coachMessage:      template.coachMessage || null,
    completionMessage: template.completionMessage || null,
    reward:            template.reward || {},
    requiredPlan:      template.requiredPlan || null,
  };
}

function progressPercent(assignment) {
  const { missionSnapshot, currentProgress, percentNumerator, percentDenominator } = assignment;
  const mode = missionSnapshot?.progressMode;
  if (mode === "percentage") {
    if (!percentDenominator) return 0;
    const pct = Math.round((percentNumerator / percentDenominator) * 100);
    return Math.min(pct, 100);
  }
  const target = missionSnapshot?.target || 1;
  return Math.min(Math.round((currentProgress / target) * 100), 100);
}

function formatAssignment(a) {
  const snap = a.missionSnapshot || {};
  return {
    id: a._id,
    templateId: a.template,
    status: a.status,
    name: snap.name,
    description: snap.description,
    category: snap.category,
    difficulty: snap.difficulty,
    progressMode: snap.progressMode,
    unit: snap.unit,
    currentProgress: a.currentProgress,
    target: snap.target,
    progressPercent: progressPercent(a),
    consecutiveCount: a.consecutiveCount,
    percentNumerator: a.percentNumerator,
    percentDenominator: a.percentDenominator,
    coachMessage: snap.coachMessage,
    completionMessage: snap.completionMessage,
    reward: snap.reward,
    recommendedBy: a.recommendedBy,
    recommendationReason: a.recommendationReason,
    acceptedAt: a.acceptedAt,
    startedAt: a.startedAt,
    completedAt: a.completedAt,
    archivedAt: a.archivedAt,
    expiresAt: a.expiresAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    requiredPlan: snap.requiredPlan || null,
  };
}

// ─── Mission Template CRUD ───────────────────────────────────────────────────

async function getAllTemplates({ category, difficulty, isActive = true } = {}) {
  const filter = {};
  if (isActive !== null) filter.isActive = isActive;
  if (category) filter.category = category;
  if (difficulty) filter.difficulty = difficulty;

  return MissionTemplate.find(filter).sort({ sortOrder: 1, createdAt: 1 }).lean();
}

async function getTemplateById(templateId) {
  const t = await MissionTemplate.findById(templateId).lean();
  if (!t) throw new ApiError(404, "Mission template not found", "MISSION_TEMPLATE_NOT_FOUND");
  return t;
}

async function createTemplate(data) {
  const template = new MissionTemplate(data);
  await template.save();
  return template.toObject();
}

async function updateTemplate(templateId, updates) {
  const template = await MissionTemplate.findByIdAndUpdate(
    templateId,
    { $set: updates },
    { new: true, runValidators: true }
  ).lean();
  if (!template) throw new ApiError(404, "Mission template not found", "MISSION_TEMPLATE_NOT_FOUND");
  return template;
}

async function deactivateTemplate(templateId) {
  return updateTemplate(templateId, { isActive: false });
}

// ─── Mission Assignment Lifecycle ────────────────────────────────────────────

/**
 * Assign a mission to a user (status = 'available').
 * Called by the AI recommendation engine or by admin push.
 * Idempotent — if an active/available assignment already exists, returns it.
 */
async function assignMission(userId, templateId, { recommendedBy = "system", recommendationReason = null } = {}) {
  const template = await getTemplateById(templateId);
  if (!template.isActive) {
    throw new ApiError(400, "Mission template is not active", "MISSION_INACTIVE");
  }

  // Idempotency check
  const existing = await MissionAssignment.findOne({
    user: userId,
    template: templateId,
    status: { $in: ["available", "accepted", "active"] },
  }).lean();
  if (existing) return formatAssignment(existing);

  const expiresAt = template.expiryDays
    ? new Date(Date.now() + template.expiryDays * 24 * 60 * 60 * 1000)
    : null;

  const assignment = new MissionAssignment({
    user: userId,
    template: templateId,
    status: "available",
    missionSnapshot: buildSnapshot(template),
    recommendedBy,
    recommendationReason,
    expiresAt,
  });

  await assignment.save();
  logger.info("[Mission] Assigned mission", { userId, templateId, recommendedBy });
  return formatAssignment(assignment.toObject());
}

/**
 * User accepts a mission → status: 'available' → 'active'.
 * Enforces the 3-mission cap.
 */
async function acceptMission(userId, assignmentId) {
  const assignment = await MissionAssignment.findOne({ _id: assignmentId, user: userId });
  if (!assignment) throw new ApiError(404, "Mission not found", "MISSION_NOT_FOUND");
  if (assignment.status === "active") return formatAssignment(assignment.toObject()); // idempotent
  if (!["available", "accepted"].includes(assignment.status)) {
    throw new ApiError(400, `Cannot accept a mission with status '${assignment.status}'`, "INVALID_MISSION_STATUS");
  }

  // Plan gate: if the template requires premium, check the user's subscription
  if (assignment.missionSnapshot?.requiredPlan === "premium") {
    const user = await User.findById(userId)
      .select("subscriptionStatus trial")
      .lean();
    if (!userIsPremium(user)) {
      throw new ApiError(
        403,
        "This mission requires a premium subscription",
        "PREMIUM_REQUIRED"
      );
    }
  }

  // Cap at 3 active missions
  const activeCount = await MissionAssignment.countDocuments({
    user: userId,
    status: { $in: ["accepted", "active"] },
    _id: { $ne: assignmentId },
  });
  if (activeCount >= MAX_ACTIVE_MISSIONS) {
    throw new ApiError(
      422,
      `You can have at most ${MAX_ACTIVE_MISSIONS} active missions at a time`,
      "MAX_ACTIVE_MISSIONS_REACHED"
    );
  }

  const now = new Date();
  assignment.status = "active";
  assignment.acceptedAt = assignment.acceptedAt || now;
  assignment.startedAt = now;
  await assignment.save();

  logger.info("[Mission] Mission accepted", { userId, assignmentId });
  return formatAssignment(assignment.toObject());
}

/**
 * User archives a mission (gives up) → status: 'active' → 'archived'.
 */
async function archiveMission(userId, assignmentId) {
  const assignment = await MissionAssignment.findOne({ _id: assignmentId, user: userId });
  if (!assignment) throw new ApiError(404, "Mission not found", "MISSION_NOT_FOUND");
  if (assignment.status === "archived") return formatAssignment(assignment.toObject());
  if (!["active", "accepted", "available"].includes(assignment.status)) {
    throw new ApiError(400, `Cannot archive a mission with status '${assignment.status}'`, "INVALID_MISSION_STATUS");
  }

  assignment.status = "archived";
  assignment.archivedAt = new Date();
  await assignment.save();

  logger.info("[Mission] Mission archived", { userId, assignmentId });
  return formatAssignment(assignment.toObject());
}

/**
 * Mark a mission as completed. Called by missionProgressService.
 */
async function completeMission(userId, assignmentId) {
  const assignment = await MissionAssignment.findOne({ _id: assignmentId, user: userId });
  if (!assignment) throw new ApiError(404, "Mission not found", "MISSION_NOT_FOUND");
  if (assignment.status === "completed") return formatAssignment(assignment.toObject());
  if (assignment.status !== "active") {
    throw new ApiError(400, "Only active missions can be completed", "INVALID_MISSION_STATUS");
  }

  const snap = assignment.missionSnapshot || {};
  const reward = snap.reward || {};

  assignment.status = "completed";
  assignment.completedAt = new Date();
  assignment.reward = {
    badge: reward.badge || "discipline_badge",
    badgeLabel: reward.badgeLabel || "Discipline Badge",
    badgeColor: reward.badgeColor || "#0D9E6E",
    completionMessage: reward.completionMessage || "Mission complete. Well done.",
    grantedAt: new Date(),
  };
  assignment.rewardGrantedAt = new Date();
  await assignment.save();

  logger.info("[Mission] Mission completed", { userId, assignmentId, mission: snap.name });
  return formatAssignment(assignment.toObject());
}

// ─── Queries ─────────────────────────────────────────────────────────────────

async function getActiveMissions(userId) {
  const assignments = await MissionAssignment.find({
    user: userId,
    status: { $in: ["active", "available"] },
  })
    .sort({ startedAt: -1, createdAt: -1 })
    .lean();

  return assignments.map(formatAssignment);
}

async function getMissionHistory(userId, { limit = 20, page = 1 } = {}) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    MissionAssignment.find({ user: userId, status: { $in: ["completed", "archived", "expired"] } })
      .sort({ completedAt: -1, archivedAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    MissionAssignment.countDocuments({
      user: userId,
      status: { $in: ["completed", "archived", "expired"] },
    }),
  ]);

  return { items: items.map(formatAssignment), total, page, limit };
}

async function getMissionById(userId, assignmentId) {
  const assignment = await MissionAssignment.findOne({ _id: assignmentId, user: userId }).lean();
  if (!assignment) throw new ApiError(404, "Mission not found", "MISSION_NOT_FOUND");
  return formatAssignment(assignment);
}

async function getMissionStats(userId) {
  const [completed, active, archived] = await Promise.all([
    MissionAssignment.countDocuments({ user: userId, status: "completed" }),
    MissionAssignment.countDocuments({ user: userId, status: { $in: ["active", "available"] } }),
    MissionAssignment.countDocuments({ user: userId, status: "archived" }),
  ]);

  const recentCompleted = await MissionAssignment.find({ user: userId, status: "completed" })
    .sort({ completedAt: -1 })
    .limit(5)
    .lean();

  const categoryBreakdown = await MissionAssignment.aggregate([
    { $match: { user: userId, status: "completed" } },
    { $group: { _id: "$missionSnapshot.category", count: { $sum: 1 } } },
  ]);

  return {
    completed,
    active,
    archived,
    recentCompleted: recentCompleted.map(formatAssignment),
    categoryBreakdown: categoryBreakdown.reduce((acc, c) => {
      acc[c._id] = c.count;
      return acc;
    }, {}),
  };
}

// ─── Expiry sweep (called by cron) ───────────────────────────────────────────

async function expireOldMissions() {
  const now = new Date();
  const result = await MissionAssignment.updateMany(
    {
      status: { $in: ["available", "accepted", "active"] },
      expiresAt: { $lt: now },
    },
    { $set: { status: "expired" } }
  );
  if (result.modifiedCount > 0) {
    logger.info("[Mission] Expired missions", { count: result.modifiedCount });
  }
  return result.modifiedCount;
}

// ─── Admin analytics ─────────────────────────────────────────────────────────

async function getAdminAnalytics() {
  const [statusBreakdown, categoryBreakdown, completionRate] = await Promise.all([
    MissionAssignment.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    MissionAssignment.aggregate([
      { $group: { _id: "$missionSnapshot.category", count: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } } } },
    ]),
    MissionAssignment.aggregate([
      { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } }, archived: { $sum: { $cond: [{ $eq: ["$status", "archived"] }, 1, 0] } } } },
    ]),
  ]);

  const totals = completionRate[0] || { total: 0, completed: 0, archived: 0 };
  return {
    statusBreakdown: statusBreakdown.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
    categoryBreakdown,
    totalAssigned: totals.total,
    completionRate: totals.total ? Math.round((totals.completed / totals.total) * 100) : 0,
    dropOffRate: totals.total ? Math.round((totals.archived / totals.total) * 100) : 0,
  };
}

// ─── Seed ────────────────────────────────────────────────────────────────────

async function seedMissionTemplates() {
  const { MISSION_TEMPLATES } = require("../data/missionTemplates");
  let seeded = 0;
  for (const tpl of MISSION_TEMPLATES) {
    const exists = await MissionTemplate.findOne({ name: tpl.name }).lean();
    if (!exists) {
      await MissionTemplate.create(tpl);
      seeded++;
    }
  }
  if (seeded > 0) logger.info("[Mission] Seeded mission templates", { count: seeded });
  return seeded;
}

module.exports = {
  // Helpers
  progressPercent,
  formatAssignment,
  // Templates
  getAllTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deactivateTemplate,
  // Assignment lifecycle
  assignMission,
  acceptMission,
  archiveMission,
  completeMission,
  // Queries
  getActiveMissions,
  getMissionHistory,
  getMissionById,
  getMissionStats,
  // Maintenance
  expireOldMissions,
  // Admin
  getAdminAnalytics,
  // Seed
  seedMissionTemplates,
  // Constants
  MAX_ACTIVE_MISSIONS,
};
