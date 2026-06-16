const User = require("../models/Users");
const DeviceToken = require("../models/DeviceToken");
const { getFirebaseAdmin } = require("../config/firebaseAdmin");
const { logger } = require("../utils/logger");

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

async function getAdminDeviceTokens() {
  const admins = await User.find({ role: "admin" }).select("_id").lean();
  if (!admins.length) return [];
  const adminIds = admins.map((a) => a._id);
  const tokens = await DeviceToken.find({
    user: { $in: adminIds },
    enabled: true,
    revokedAt: null,
  })
    .select("token user")
    .lean();
  return tokens;
}

async function disableInvalidTokens(tokens) {
  if (!tokens.length) return;
  try {
    await DeviceToken.updateMany(
      { token: { $in: tokens } },
      { $set: { enabled: false, revokedAt: new Date() } }
    );
  } catch (error) {
    logger.warn("[AdminPush] failed to disable invalid tokens", { error: error.message });
  }
}

function buildIssueBody(issue, reporter) {
  const head =
    issue.issueCategory === "OCR_EXTRACTION"
      ? "OCR issue"
      : `${String(issue.issueCategory || "").replace(/_/g, " ").toLowerCase()} issue`;
  const name = reporter?.name || "A user";
  const desc = String(issue.description || "").slice(0, 110);
  return `${name} reported ${head}: ${desc}`;
}

async function sendNewIssueAlert(issue, reporter) {
  try {
    const tokens = await getAdminDeviceTokens();
    if (!tokens.length) {
      logger.info("[AdminPush] no admin device tokens available", {
        issueCode: issue?.issueCode,
      });
      return { sent: false, reason: "no_tokens" };
    }

    const admin = getFirebaseAdmin();
    const message = {
      tokens: tokens.map((t) => t.token),
      notification: {
        title: `🚨 ${issue.issueCode} • ${issue.marketType}`,
        body: buildIssueBody(issue, reporter),
      },
      data: {
        type: "admin_issue_report",
        issueId: issue._id?.toString?.() || "",
        issueCode: issue.issueCode || "",
        category: issue.issueCategory || "",
        marketType: issue.marketType || "",
        platform: issue.platform || "",
        deepLink: `/admin/issues/${issue._id?.toString?.() || ""}`,
      },
      android: {
        priority: "high",
        notification: {
          channelId: "edgecipline_risk",
          color: "#E53935",
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    const invalidTokens = [];
    response.responses.forEach((result, index) => {
      if (result.error && INVALID_TOKEN_CODES.has(result.error.code)) {
        invalidTokens.push(tokens[index].token);
      }
    });
    await disableInvalidTokens(invalidTokens);

    logger.info("[AdminPush] new issue alert sent", {
      issueCode: issue.issueCode,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });
    return {
      sent: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (error) {
    logger.error("[AdminPush] failed to send new issue alert", {
      issueCode: issue?.issueCode,
      error: error.message,
    });
    return { sent: false, error: error.message };
  }
}

module.exports = {
  sendNewIssueAlert,
};
