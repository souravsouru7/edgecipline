const crypto = require("crypto");
const IssueReport = require("../models/IssueReport");
const User = require("../models/Users");
const ApiError = require("../utils/ApiError");
const adminPushService = require("./adminPushService");
const { notifyUser } = require("./notificationService");
const { logger } = require("../utils/logger");
const cloudinary = require("../config/cloudinary");

const ALLOWED_CATEGORIES = new Set(IssueReport.ISSUE_CATEGORIES);
const ALLOWED_MARKETS = new Set(IssueReport.MARKET_TYPES);
const ALLOWED_PLATFORMS = new Set(IssueReport.PLATFORMS);
const ALLOWED_STATUSES = new Set(IssueReport.ISSUE_STATUSES);

function generateIssueCode() {
  // 6-char base36 random suffix → ISS-XXXXXX
  const buf = crypto.randomBytes(4).readUInt32BE(0);
  return `ISS-${buf.toString(36).toUpperCase().padStart(6, "0").slice(0, 6)}`;
}

function sanitizeOcrSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const allowed = ["symbol", "entry", "exit", "stopLoss", "quantity", "profit", "tradeType", "date"];
  const clean = {};
  for (const key of allowed) {
    if (snapshot[key] !== undefined && snapshot[key] !== null) {
      const v = snapshot[key];
      if (typeof v === "string") clean[key] = v.slice(0, 200);
      else if (typeof v === "number" && Number.isFinite(v)) clean[key] = v;
      else if (typeof v === "boolean") clean[key] = v;
    }
  }
  return Object.keys(clean).length ? clean : null;
}

function sanitizeDeviceInfo(info) {
  if (!info || typeof info !== "object") return null;
  const allowed = ["model", "os", "osVersion", "manufacturer", "screen", "language", "timezone"];
  const clean = {};
  for (const key of allowed) {
    const v = info[key];
    if (typeof v === "string") clean[key] = v.slice(0, 120);
    else if (typeof v === "number" && Number.isFinite(v)) clean[key] = v;
  }
  return Object.keys(clean).length ? clean : null;
}

async function destroyUploadedScreenshots(images) {
  if (!Array.isArray(images) || !images.length) return;
  await Promise.all(
    images.map(async (img) => {
      if (!img?.publicId) return;
      try {
        await cloudinary.uploader.destroy(img.publicId, { resource_type: "image" });
      } catch (error) {
        logger.warn("[IssueReport] failed to destroy screenshot", {
          publicId: img.publicId,
          error: error.message,
        });
      }
    })
  );
}

async function createIssue({ user, body, uploadedImages = [] }) {
  const issueCategory = String(body.issueCategory || "").trim().toUpperCase();
  if (!ALLOWED_CATEGORIES.has(issueCategory)) {
    await destroyUploadedScreenshots(uploadedImages);
    throw new ApiError(400, "Invalid issueCategory", "VALIDATION_ERROR");
  }

  const description = String(body.description || "").trim();
  if (description.length < 5) {
    await destroyUploadedScreenshots(uploadedImages);
    throw new ApiError(400, "Description must be at least 5 characters", "VALIDATION_ERROR");
  }
  if (description.length > 4000) {
    await destroyUploadedScreenshots(uploadedImages);
    throw new ApiError(400, "Description exceeds 4000 character limit", "VALIDATION_ERROR");
  }

  const marketType = ALLOWED_MARKETS.has(body.marketType) ? body.marketType : "Unknown";
  const platform = ALLOWED_PLATFORMS.has(body.platform) ? body.platform : "unknown";
  const module = typeof body.module === "string" ? body.module.slice(0, 100) : "";
  const appVersion = typeof body.appVersion === "string" ? body.appVersion.slice(0, 30) : "";

  let ocrSnapshot = null;
  if (issueCategory === "OCR_EXTRACTION") {
    let raw = body.ocrDataSnapshot;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    }
    ocrSnapshot = sanitizeOcrSnapshot(raw);
  }

  let deviceInfo = body.deviceInfo;
  if (typeof deviceInfo === "string") {
    try {
      deviceInfo = JSON.parse(deviceInfo);
    } catch {
      deviceInfo = null;
    }
  }
  deviceInfo = sanitizeDeviceInfo(deviceInfo);

  const screenshots = uploadedImages.map((img) => ({
    url: img.imageUrl,
    publicId: img.publicId || "",
    bytes: img.bytes || 0,
  }));

  // Idempotency: if client supplies a unique submissionId, retry-safe
  if (body.submissionId && typeof body.submissionId === "string") {
    const existing = await IssueReport.findOne({
      user: user._id,
      "timeline.note": `submissionId:${body.submissionId}`,
    })
      .select("_id issueCode status createdAt")
      .lean();
    if (existing) {
      await destroyUploadedScreenshots(uploadedImages);
      return existing;
    }
  }

  // Generate a unique issueCode; retry on collision (extremely rare with 6-char random).
  let issueCode;
  let attempts = 0;
  while (attempts < 5) {
    const candidate = generateIssueCode();
    // eslint-disable-next-line no-await-in-loop
    const exists = await IssueReport.exists({ issueCode: candidate });
    if (!exists) {
      issueCode = candidate;
      break;
    }
    attempts += 1;
  }
  if (!issueCode) {
    await destroyUploadedScreenshots(uploadedImages);
    throw new ApiError(500, "Could not allocate issue code", "INTERNAL_ERROR");
  }

  let issue;
  try {
    issue = await IssueReport.create({
      issueCode,
      user: user._id,
      email: user.email || "",
      marketType,
      module,
      issueCategory,
      description,
      screenshots,
      tradeId: body.tradeId || null,
      ocrDataSnapshot: ocrSnapshot,
      appVersion,
      platform,
      deviceInfo,
      status: "OPEN",
      timeline: [
        {
          status: "OPEN",
          at: new Date(),
          note: body.submissionId ? `submissionId:${body.submissionId}` : "",
        },
      ],
    });
  } catch (error) {
    await destroyUploadedScreenshots(uploadedImages);
    throw error;
  }

  // Fire-and-forget admin push — never block the user's response on it.
  adminPushService
    .sendNewIssueAlert(issue.toObject(), { name: user.name, email: user.email })
    .catch((err) =>
      logger.warn("[IssueReport] admin push alert failed", { issueCode, error: err.message })
    );

  return issue;
}

async function listUserIssues(userId, query = {}) {
  const limit = Math.min(Number(query.limit) || 25, 100);
  const filter = { user: userId };
  if (query.status && ALLOWED_STATUSES.has(query.status)) filter.status = query.status;
  if (query.category && ALLOWED_CATEGORIES.has(query.category)) filter.issueCategory = query.category;

  return IssueReport.find(filter)
    .select("issueCode marketType module issueCategory description status createdAt updatedAt fixedAt fixedVersion screenshots")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function getUserIssue(userId, issueId) {
  const issue = await IssueReport.findOne({ _id: issueId, user: userId }).lean();
  if (!issue) throw new ApiError(404, "Issue not found", "NOT_FOUND");
  return issue;
}

async function listAllIssues(query = {}) {
  const limit = Math.min(Number(query.limit) || 50, 200);
  const filter = {};
  if (query.status && ALLOWED_STATUSES.has(query.status)) filter.status = query.status;
  if (query.category && ALLOWED_CATEGORIES.has(query.category)) filter.issueCategory = query.category;
  if (query.market && ALLOWED_MARKETS.has(query.market)) filter.marketType = query.market;
  if (query.platform && ALLOWED_PLATFORMS.has(query.platform)) filter.platform = query.platform;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }
  return IssueReport.find(filter)
    .populate("user", "name email role")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function getIssueForAdmin(issueId) {
  const issue = await IssueReport.findById(issueId).populate("user", "name email role").lean();
  if (!issue) throw new ApiError(404, "Issue not found", "NOT_FOUND");
  return issue;
}

async function updateIssueStatus(issueId, { status, fixSummary, fixedVersion, note }) {
  if (!ALLOWED_STATUSES.has(status)) {
    throw new ApiError(400, "Invalid status", "VALIDATION_ERROR");
  }
  const issue = await IssueReport.findById(issueId);
  if (!issue) throw new ApiError(404, "Issue not found", "NOT_FOUND");

  const prevStatus = issue.status;
  issue.status = status;
  if (fixSummary !== undefined) issue.fixSummary = String(fixSummary).slice(0, 2000);
  if (fixedVersion !== undefined) issue.fixedVersion = String(fixedVersion).slice(0, 30);
  if (status === "FIXED" && !issue.fixedAt) issue.fixedAt = new Date();

  issue.timeline.push({
    status,
    at: new Date(),
    note: typeof note === "string" ? note.slice(0, 500) : "",
  });

  await issue.save();

  // Notify reporter when transitioning to FIXED — once.
  if (status === "FIXED" && prevStatus !== "FIXED" && !issue.fixNotificationSent) {
    try {
      await notifyUser(issue.user, {
        type: "issue_fixed",
        title: "✅ Issue Fixed",
        body:
          (issue.fixSummary && issue.fixSummary.length
            ? issue.fixSummary.slice(0, 140)
            : "The issue you reported has been resolved.") +
          (issue.fixedVersion ? ` (v${issue.fixedVersion})` : ""),
        data: {
          issueId: issue._id.toString(),
          issueCode: issue.issueCode,
          fixedVersion: issue.fixedVersion || "",
        },
        deepLink: `/issues/${issue._id.toString()}`,
        sourceType: "issue_report",
        sourceId: issue._id,
        dedupeKey: `issue_fixed:${issue._id.toString()}`,
      });
      issue.fixNotificationSent = true;
      await issue.save();
    } catch (error) {
      logger.warn("[IssueReport] failed to send fix notification", {
        issueCode: issue.issueCode,
        error: error.message,
      });
    }
  }

  return issue.toObject();
}

async function getAnalyticsSummary() {
  const [byStatus, byCategory, recent, avgResolution] = await Promise.all([
    IssueReport.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    IssueReport.aggregate([{ $group: { _id: "$issueCategory", count: { $sum: 1 } } }]),
    IssueReport.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }),
    IssueReport.aggregate([
      { $match: { status: "FIXED", fixedAt: { $ne: null } } },
      {
        $project: {
          resolutionMs: { $subtract: ["$fixedAt", "$createdAt"] },
        },
      },
      { $group: { _id: null, avgMs: { $avg: "$resolutionMs" } } },
    ]),
  ]);

  return {
    byStatus: byStatus.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {}),
    byCategory: byCategory.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {}),
    last7Days: recent,
    avgResolutionHours:
      avgResolution.length && avgResolution[0].avgMs
        ? Number((avgResolution[0].avgMs / (60 * 60 * 1000)).toFixed(1))
        : null,
  };
}

module.exports = {
  createIssue,
  listUserIssues,
  getUserIssue,
  listAllIssues,
  getIssueForAdmin,
  updateIssueStatus,
  getAnalyticsSummary,
};
