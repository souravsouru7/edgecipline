const crypto = require("crypto");
const IssueReport = require("../models/IssueReport");
const SupportTicket = require("../models/SupportTicket");
const ApiError = require("../utils/ApiError");
const { enqueueNotificationDelivery } = require("../queues/smartNotificationQueue");
const { logger } = require("../utils/logger");
const { buildPagination } = require("../utils/apiResponse");
const { destroySupportAttachments } = require("../utils/supportAttachments");
const { UNRESOLVED_STATUSES, LIMITS } = require("../constants/support");
const supportTicketService = require("./supportTicket.service");

const ALLOWED_CATEGORIES = new Set(IssueReport.ISSUE_CATEGORIES);
const ALLOWED_MARKETS = new Set(IssueReport.MARKET_TYPES);
const ALLOWED_PLATFORMS = new Set(IssueReport.PLATFORMS);
const ALLOWED_STATUSES = new Set(IssueReport.ISSUE_STATUSES);

// An issue report is a support ticket with structured telemetry attached. The
// ticket is what the customer sees and what the support queue works; the
// IssueReport row keeps the OCR snapshot, device info and fix version that a
// conversation thread has no place for. Every report therefore maps onto one
// of the support categories the queue already routes on.
const SUPPORT_CATEGORY_FOR_ISSUE = {
  OCR_EXTRACTION: "trade_import",
  IMAGE_UPLOAD: "trade_import",
  TRADE_SAVE: "trading_journal",
  JOURNAL: "trading_journal",
  SETUP: "trading_journal",
  NOTIFICATION: "technical_issue",
  LOGIN: "account_profile",
  PERFORMANCE: "technical_issue",
  CRASH: "technical_issue",
  OTHER: "other",
};

const ISSUE_LABELS = {
  OCR_EXTRACTION: "OCR extraction",
  IMAGE_UPLOAD: "Image upload",
  TRADE_SAVE: "Trade save",
  JOURNAL: "Journal",
  SETUP: "Setup",
  NOTIFICATION: "Notification",
  LOGIN: "Login",
  PERFORMANCE: "Performance",
  CRASH: "Crash",
  OTHER: "Other",
};

// A crash or a lockout is costing the customer the product right now; a
// cosmetic journal bug is not.
const HIGH_PRIORITY_ISSUES = new Set(["CRASH", "LOGIN"]);

function ticketTagsForIssue(issueCategory) {
  const tags = ["bug"];
  if (issueCategory === "OCR_EXTRACTION") tags.push("ocr_failure");
  if (issueCategory === "LOGIN") tags.push("cannot_login");
  return tags;
}

function generateIssueCode() {
  // 6-char base36 random suffix → ISS-XXXXXX
  const buf = crypto.randomBytes(4).readUInt32BE(0);
  return `ISS-${buf.toString(36).toUpperCase().padStart(6, "0").slice(0, 6)}`;
}

function sanitizeOcrSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const allowed = [
    "symbol", "pair", "stockSymbol", "entry", "entryPrice", "exit", "exitPrice",
    "stopLoss", "takeProfit", "quantity", "sharesQty", "lotSize", "profit", "pnl",
    "tradeType", "type", "optionType", "strikePrice", "date", "tradeDate",
  ];
  const sanitizeValues = (values) => {
    if (!values || typeof values !== "object") return null;
    if (Array.isArray(values)) return values.slice(0, 20).map(sanitizeValues).filter(Boolean);
    const result = {};
    for (const key of allowed) {
      const value = values[key];
      if (typeof value === "string") result[key] = value.slice(0, 200);
      else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
      else if (typeof value === "boolean") result[key] = value;
    }
    return Object.keys(result).length ? result : null;
  };
  const clean = {};
  const flat = sanitizeValues(snapshot);
  if (flat) Object.assign(clean, flat);
  const extractedValues = sanitizeValues(snapshot.extractedValues);
  const correctedValues = sanitizeValues(snapshot.correctedValues);
  if (extractedValues) clean.extractedValues = extractedValues;
  if (correctedValues) clean.correctedValues = correctedValues;
  if (typeof snapshot.broker === "string") clean.broker = snapshot.broker.slice(0, 50);
  if (Number.isFinite(Number(snapshot.extractionConfidence))) {
    clean.extractionConfidence = Math.max(0, Math.min(100, Number(snapshot.extractionConfidence)));
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

function parseJsonField(raw) {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Ticket shaping ──────────────────────────────────────────────────────────

/** The values an agent needs at a glance, as "Label value" pairs. */
function describeOcrValues(snapshot) {
  if (!snapshot) return "";
  // The user's corrected values are the truth; the raw extraction is what
  // went wrong. Prefer the former for the summary line, fall back to the flat
  // shape older clients send.
  const values =
    (snapshot.correctedValues && !Array.isArray(snapshot.correctedValues) && snapshot.correctedValues) ||
    (snapshot.extractedValues && !Array.isArray(snapshot.extractedValues) && snapshot.extractedValues) ||
    snapshot;

  const pairs = [
    ["Symbol", values.symbol || values.pair || values.stockSymbol],
    ["Entry", values.entry ?? values.entryPrice],
    ["Exit", values.exit ?? values.exitPrice],
    ["Stop loss", values.stopLoss],
    ["Take profit", values.takeProfit],
    ["Qty", values.quantity ?? values.sharesQty ?? values.lotSize],
    ["P/L", values.profit ?? values.pnl],
    ["Date", values.date || values.tradeDate],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");

  const parts = pairs.map(([label, v]) => `${label} ${String(v).slice(0, 40)}`);
  if (snapshot.broker) parts.push(`Broker ${snapshot.broker}`);
  if (Number.isFinite(snapshot.extractionConfidence)) {
    parts.push(`Confidence ${snapshot.extractionConfidence}/100`);
  }
  return parts.join(" · ");
}

function primarySymbol(snapshot) {
  if (!snapshot) return "";
  const source = [snapshot.correctedValues, snapshot.extractedValues, snapshot].find(
    (v) => v && typeof v === "object" && !Array.isArray(v)
  );
  const symbol = source && (source.symbol || source.pair || source.stockSymbol);
  return typeof symbol === "string" ? symbol.trim().slice(0, 30) : "";
}

function buildTicketSubject({ issueCategory, description, ocrSnapshot }) {
  const label = ISSUE_LABELS[issueCategory] || "App";
  const symbol = primarySymbol(ocrSnapshot);
  let subject;
  if (symbol) {
    subject = `${label} problem — ${symbol}`;
  } else {
    const firstLine = description.split(/\r?\n/).find((line) => line.trim()) || "";
    const snippet = firstLine.trim().slice(0, 70);
    subject = snippet ? `${label} problem: ${snippet}` : `${label} problem`;
  }
  return subject.slice(0, LIMITS.subjectMax);
}

function buildTicketBody({ description, issueCategory, marketType, platform, appVersion, module, ocrSnapshot }) {
  const meta = [
    `Reported from the app · ${ISSUE_LABELS[issueCategory] || issueCategory}`,
    marketType && marketType !== "Unknown" ? marketType.replace(/_/g, " ") : null,
    platform && platform !== "unknown" ? `${platform}${appVersion ? ` v${appVersion}` : ""}` : null,
    module ? `screen: ${module}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const lines = [description, "", "—", meta];
  const ocrLine = describeOcrValues(ocrSnapshot);
  if (ocrLine) lines.push(`Extracted values: ${ocrLine}`);

  // Description is capped at 4000 and the footer is a few hundred characters,
  // so this never approaches the 10 000 message limit — the slice is a guard,
  // not a path that runs.
  return lines.join("\n").slice(0, LIMITS.messageMax);
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Open a support ticket for the report and record the telemetry against it.
 *
 * Ordering matters. The ticket goes first because supportTicket.service owns
 * every guard around the uploads — the tickets-disabled switch, the per-user
 * open-ticket cap, idempotent retries — and destroys the attachments itself on
 * each of those paths. Creating the IssueReport first would leave an orphaned
 * telemetry row pointing at nothing whenever one of those guards fires.
 *
 * If the ticket succeeds and the telemetry row then fails, the ticket is kept:
 * the customer has a conversation with their screenshots in it, which is the
 * part that must not be lost. The gap is logged for reconciliation.
 */
async function createIssue({ user, body, uploadedImages = [], requestId = "" }) {
  const issueCategory = String(body.issueCategory || "").trim().toUpperCase();
  if (!ALLOWED_CATEGORIES.has(issueCategory)) {
    await destroySupportAttachments(uploadedImages);
    throw new ApiError(400, "Invalid issueCategory", "VALIDATION_ERROR");
  }

  const description = String(body.description || "").trim();
  if (description.length < 5) {
    await destroySupportAttachments(uploadedImages);
    throw new ApiError(400, "Description must be at least 5 characters", "VALIDATION_ERROR");
  }
  if (description.length > 4000) {
    await destroySupportAttachments(uploadedImages);
    throw new ApiError(400, "Description exceeds 4000 character limit", "VALIDATION_ERROR");
  }

  const marketType = ALLOWED_MARKETS.has(body.marketType) ? body.marketType : "Unknown";
  const platform = ALLOWED_PLATFORMS.has(body.platform) ? body.platform : "unknown";
  const module = typeof body.module === "string" ? body.module.slice(0, 100) : "";
  const appVersion = typeof body.appVersion === "string" ? body.appVersion.slice(0, 30) : "";
  const submissionId =
    body.submissionId && typeof body.submissionId === "string" ? body.submissionId.slice(0, 100) : null;

  const ocrSnapshot =
    issueCategory === "OCR_EXTRACTION" ? sanitizeOcrSnapshot(parseJsonField(body.ocrDataSnapshot)) : null;
  const deviceInfo = sanitizeDeviceInfo(parseJsonField(body.deviceInfo));

  // Throws on: tickets disabled (503), open-ticket cap (429), storage errors.
  // Attachments are destroyed inside on every failure path. A retried submit
  // with the same submissionId returns the original ticket (deduped: true).
  const { ticket, deduped } = await supportTicketService.createTicket({
    user,
    body: {
      subject: buildTicketSubject({ issueCategory, description, ocrSnapshot }),
      description: buildTicketBody({
        description,
        issueCategory,
        marketType,
        platform,
        appVersion,
        module,
        ocrSnapshot,
      }),
      category: SUPPORT_CATEGORY_FOR_ISSUE[issueCategory] || "other",
      subcategory: ISSUE_LABELS[issueCategory] || "",
      priority: HIGH_PRIORITY_ISSUES.has(issueCategory) ? "high" : "normal",
      platform,
      appVersion,
      marketType,
      clientRequestId: submissionId,
    },
    uploadedImages,
    requestId,
    channel: "in_app",
    tags: ticketTagsForIssue(issueCategory),
  });

  // A deduped ticket normally already has its telemetry row. It may not, if
  // the first attempt died between the two writes — in which case this
  // request completes the pair rather than reporting a phantom success.
  if (deduped) {
    const existing = await IssueReport.findOne({ linkedTicket: ticket._id }).lean();
    if (existing) return { issue: existing, ticket, deduped: true };
  }

  let issue = null;
  const MAX_CODE_ATTEMPTS = 5;
  try {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        issue = await IssueReport.create({
          issueCode: generateIssueCode(),
          user: user._id,
          email: user.email || "",
          marketType,
          module,
          issueCategory,
          description,
          // Screenshots are private support attachments on the ticket's first
          // message, served only through the authorised attachment endpoint.
          screenshots: [],
          tradeId: body.tradeId || null,
          linkedTicket: ticket._id,
          ocrDataSnapshot: ocrSnapshot,
          appVersion,
          platform,
          deviceInfo,
          status: "OPEN",
          timeline: [
            {
              status: "OPEN",
              at: new Date(),
              note: submissionId ? `submissionId:${submissionId}` : "",
            },
          ],
        });
        break;
      } catch (error) {
        const isDup = error?.code === 11000 && /issueCode/.test(error?.message || "");
        if (!isDup) throw error;
      }
    }
  } catch (error) {
    logger.error("[IssueReport] ticket created but telemetry row failed", {
      ticketCode: ticket.ticketCode,
      userId: String(user._id),
      error: error.message,
    });
  }

  if (!issue) {
    return { issue: null, ticket, deduped };
  }

  await SupportTicket.updateOne({ _id: ticket._id }, { $set: { linkedIssue: issue._id } }).catch((error) =>
    logger.warn("[IssueReport] failed to back-link ticket to issue", {
      ticketCode: ticket.ticketCode,
      issueCode: issue.issueCode,
      error: error.message,
    })
  );

  return { issue: issue.toObject(), ticket, deduped };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

const LINKED_TICKET_FIELDS = "ticketCode status";

async function listUserIssues(userId, query = {}) {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 50;
  const filter = { user: userId };
  if (query.status && ALLOWED_STATUSES.has(query.status)) filter.status = query.status;
  if (query.category && ALLOWED_CATEGORIES.has(query.category)) filter.issueCategory = query.category;

  const [items, total] = await Promise.all([
    IssueReport.find(filter)
      .select("issueCode marketType module issueCategory description status createdAt updatedAt fixedAt fixedVersion screenshots linkedTicket")
      .populate("linkedTicket", LINKED_TICKET_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    IssueReport.countDocuments(filter),
  ]);
  return {
    items,
    pagination: buildPagination({ page, limit, total }),
  };
}

async function getUserIssue(userId, issueId) {
  const issue = await IssueReport.findOne({ _id: issueId, user: userId })
    .populate("linkedTicket", LINKED_TICKET_FIELDS)
    .lean();
  if (!issue) throw new ApiError(404, "Issue not found", "NOT_FOUND");
  return issue;
}

async function listAllIssues(query = {}) {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 50;
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
  const [items, total] = await Promise.all([
    IssueReport.find(filter)
      .populate("user", "name email role")
      .populate("linkedTicket", LINKED_TICKET_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    IssueReport.countDocuments(filter),
  ]);
  return {
    items,
    pagination: buildPagination({ page, limit, total }),
  };
}

async function getIssueForAdmin(issueId) {
  const issue = await IssueReport.findById(issueId)
    .populate("user", "name email role")
    .populate("linkedTicket", LINKED_TICKET_FIELDS)
    .lean();
  if (!issue) throw new ApiError(404, "Issue not found", "NOT_FOUND");
  return issue;
}

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Mirror an engineering status change onto the customer's ticket.
 *
 * The customer is reading the ticket, not the issue tracker, so a fix marked
 * here has to reach them there. Only two transitions are mirrored:
 *   INVESTIGATING → ticket moves open → in_progress (a signal, nothing more)
 *   FIXED         → a public reply with the fix summary, then resolved
 * CLOSED is deliberately NOT mirrored. An engineer closing a report as
 * "duplicate" or "cannot reproduce" must not yank an open conversation away
 * from a customer mid-thread; the agent working the ticket closes it.
 *
 * Best-effort throughout: the issue update has already been saved, and a
 * ticket-side failure must not turn it into an error.
 */
async function syncLinkedTicket({ issue, prevStatus, staffUser }) {
  if (!issue.linkedTicket || !staffUser?._id) return;

  const ticket = await SupportTicket.findById(issue.linkedTicket).select("status ticketCode").lean();
  if (!ticket) return;

  const ticketId = String(ticket._id);
  const actorRole = staffUser.role === "admin" ? "admin" : "agent";

  if (issue.status === "INVESTIGATING" && prevStatus !== "INVESTIGATING" && ticket.status === "open") {
    await supportTicketService.changeStatus({
      staffUser,
      actorRole,
      ticketId,
      status: "in_progress",
      requestId: `issue:${issue.issueCode}`,
    });
    return;
  }

  if (issue.status === "FIXED" && prevStatus !== "FIXED") {
    const fixLine = `The bug behind this ticket has been fixed${
      issue.fixedVersion ? ` in v${issue.fixedVersion}` : ""
    }.`;
    const body = [
      fixLine,
      issue.fixSummary ? `\n${issue.fixSummary}` : null,
      "\nIf you're still seeing the problem, reply here and we'll take another look.",
    ]
      .filter(Boolean)
      .join("\n");

    await supportTicketService.replyAsAgent({
      staffUser,
      actorRole,
      ticketId,
      body,
      requestId: `issue:${issue.issueCode}`,
    });

    // Re-read: the reply may have moved open → in_progress.
    const fresh = await SupportTicket.findById(ticketId).select("status").lean();
    if (fresh && UNRESOLVED_STATUSES.includes(fresh.status)) {
      await supportTicketService.changeStatus({
        staffUser,
        actorRole,
        ticketId,
        status: "resolved",
        resolutionSummary: issue.fixSummary || fixLine,
        requestId: `issue:${issue.issueCode}`,
      });
    }
  }
}

async function updateIssueStatus(issueId, { status, fixSummary, fixedVersion, note, staffUser = null }) {
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

  if (issue.linkedTicket) {
    try {
      await syncLinkedTicket({ issue, prevStatus, staffUser });
    } catch (error) {
      logger.warn("[IssueReport] failed to mirror status onto linked ticket", {
        issueCode: issue.issueCode,
        ticketId: String(issue.linkedTicket),
        status,
        error: error.message,
      });
    }
  }

  // Legacy path for reports that predate the ticket link. A linked report's
  // customer is told through the ticket (reply + resolution notifications);
  // a second "issue fixed" push on top of those would be noise.
  if (!issue.linkedTicket && status === "FIXED" && prevStatus !== "FIXED" && !issue.fixNotificationSent) {
    try {
      await enqueueNotificationDelivery({ userId: issue.user, notification: {
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
        deepLink: `/issues/detail?id=${issue._id.toString()}`,
        sourceType: "issue_report",
        sourceId: issue._id,
        dedupeKey: `issue_fixed:${issue._id.toString()}`,
      } });
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
  SUPPORT_CATEGORY_FOR_ISSUE,
};
