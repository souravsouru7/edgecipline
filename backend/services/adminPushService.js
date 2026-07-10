const User = require("../models/Users");
const { enqueueNotificationDelivery } = require("../queues/smartNotificationQueue");
const { logger } = require("../utils/logger");

function buildIssueBody(issue, reporter) {
  const head = issue.issueCategory === "OCR_EXTRACTION"
    ? "OCR issue"
    : `${String(issue.issueCategory || "").replace(/_/g, " ").toLowerCase()} issue`;
  return `${reporter?.name || "A user"} reported ${head}: ${String(issue.description || "").slice(0, 110)}`;
}

async function sendNewIssueAlert(issue, reporter) {
  const admins = await User.find({ role: "admin" }).select("_id").lean();
  if (!admins.length) return { queued: 0, reason: "no_admins" };

  const results = await Promise.allSettled(admins.map((admin) =>
    enqueueNotificationDelivery({
      userId: admin._id,
      notification: {
        type: "admin_issue_report",
        title: `New issue: ${issue.issueCode}`,
        body: buildIssueBody(issue, reporter),
        deepLink: `/admin/issues/${issue._id}`,
        data: {
          issueId: String(issue._id),
          issueCode: issue.issueCode || "",
          screen: "admin-issues",
        },
        sourceType: "issue_report",
        sourceId: String(issue._id),
        dedupeKey: `admin-issue:${issue._id}:${admin._id}`,
      },
    })
  ));
  const queued = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - queued;
  logger.info("ADMIN_ISSUE_NOTIFICATIONS_QUEUED", { issueCode: issue.issueCode, queued, failed });
  if (failed) throw new Error(`Failed to queue ${failed} admin issue notification(s)`);
  return { queued };
}

module.exports = { sendNewIssueAlert };
