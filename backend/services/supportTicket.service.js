"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");

const SupportTicket = require("../models/SupportTicket");
const SupportMessage = require("../models/SupportMessage");
const SupportAuditLog = require("../models/SupportAuditLog");
const User = require("../models/Users");
const Payment = require("../models/Payment");
const IssueReport = require("../models/IssueReport");

const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { buildPagination } = require("../utils/apiResponse");
const { destroySupportAttachments } = require("../utils/supportAttachments");
const { appConfig } = require("../config");
const { describePlan } = require("../utils/premium");
const {
  serializeTicketForUser,
  serializeTicketForStaff,
  categoryLabel,
  canUserReopen,
} = require("../utils/supportSerializers");
const {
  SUPPORT_CATEGORY_VALUES,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_TAGS,
  UNRESOLVED_STATUSES,
  ACTIVE_STATUSES,
  canTransition,
  normalizeUserPriority,
  REOPEN_WINDOW_DAYS,
  AUTO_CLOSE_AFTER_DAYS,
  SUPPORT_CAPABILITIES,
  hasCapability,
  LIMITS,
} = require("../constants/support");

const messageService = require("./supportMessage.service");
const notify = require("./supportNotification.service");

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
// Ceiling on how many tickets a message-body search may pull in. Message search
// is a secondary convenience, and an unbounded $in list is a query that gets
// slower every month. Agents narrow with filters when they need more.
const MESSAGE_SEARCH_TICKET_CAP = 200;

// ─── Small helpers ───────────────────────────────────────────────────────────

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

/**
 * Human-quotable ticket id: EC-4K2P9M.
 *
 * Random rather than sequential — a sequential code tells any customer how
 * many tickets the business receives, and lets them walk the id space.
 */
function generateTicketCode() {
  const raw = crypto.randomBytes(5).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `EC-${raw.padEnd(6, "0").slice(0, 6)}`;
}

/** The customer, shaped for the notification layer, without an extra query. */
function ticketOwner(ticket) {
  return { _id: ticket.user, email: ticket.userEmail, name: ticket.userName };
}

/**
 * Audit rows are best-effort. A failed audit write must not roll back the
 * action it describes — losing the action is strictly worse than losing the
 * note about it, and the action is already reflected in the ticket itself.
 */
async function audit({ ticket, actor, actorRole, action, from = "", to = "", requestId = "" }) {
  try {
    await SupportAuditLog.create({
      ticket: toObjectId(ticket._id),
      ticketUser: toObjectId(ticket.user),
      actor: actor?._id ? toObjectId(actor._id) : null,
      actorName: actor?.name || "",
      actorRole: actorRole || "system",
      action,
      from: String(from ?? "").slice(0, 200),
      to: String(to ?? "").slice(0, 200),
      requestId: String(requestId || "").slice(0, 100),
    });
  } catch (error) {
    logger.warn("SUPPORT_AUDIT_WRITE_FAILED", {
      ticketCode: ticket?.ticketCode,
      action,
      error: error.message,
    });
  }
}

/** Ownership-scoped load. Never findById-then-compare. */
async function loadOwnedTicket(userId, ticketId) {
  const ticket = await SupportTicket.findOne({
    _id: ticketId,
    user: toObjectId(userId),
  }).lean();

  // Same 404 whether the ticket belongs to someone else or does not exist.
  // A distinct 403 would confirm the id is real, which is exactly the signal
  // an enumeration attempt is looking for.
  if (!ticket) throw new ApiError(404, "Ticket not found", "NOT_FOUND");
  return ticket;
}

async function loadStaffTicket(ticketId) {
  const ticket = await SupportTicket.findById(ticketId).lean();
  if (!ticket) throw new ApiError(404, "Ticket not found", "NOT_FOUND");
  return ticket;
}

// ─── Creation ────────────────────────────────────────────────────────────────

/**
 * Open tickets the customer already holds in this category.
 *
 * Surfaced BEFORE creating, so the UI can offer "add to your existing ticket"
 * instead of silently opening a second thread about the same problem. Nothing
 * is merged automatically — merging without a clear rule loses context and
 * confuses the customer about where their conversation went.
 */
async function findDuplicateCandidates(userId, category) {
  return SupportTicket.find({
    user: toObjectId(userId),
    status: { $in: UNRESOLVED_STATUSES },
    ...(category ? { category } : {}),
  })
    .select("ticketCode subject status category createdAt lastActivityAt")
    .sort({ lastActivityAt: -1 })
    .limit(3)
    .lean();
}

async function createTicket({ user, body, uploadedImages = [], requestId = "" }) {
  if (!appConfig.support.ticketsEnabled) {
    await destroySupportAttachments(messageService.mapUploadsToAttachments(uploadedImages));
    throw new ApiError(
      503,
      "Ticket creation is temporarily unavailable. Please reach us on WhatsApp or by email.",
      "SUPPORT_TICKETS_DISABLED",
      null,
      true
    );
  }

  const clientRequestId = body.clientRequestId ? String(body.clientRequestId).slice(0, 100) : null;

  // Idempotency, checked before anything is written. A retried submit after a
  // mobile timeout returns the ticket the first attempt created.
  if (clientRequestId) {
    const existing = await SupportTicket.findOne({
      user: toObjectId(user._id),
      clientRequestId,
    }).lean();

    if (existing) {
      await destroySupportAttachments(messageService.mapUploadsToAttachments(uploadedImages));
      logger.info("SUPPORT_TICKET_CREATE_DEDUPED", {
        ticketCode: existing.ticketCode,
        userId: String(user._id),
      });
      return { ticket: existing, deduped: true };
    }
  }

  const category = SUPPORT_CATEGORY_VALUES.includes(body.category) ? body.category : "other";

  // Volume cap. Deliberately counts only UNRESOLVED tickets: a customer with
  // twenty resolved tickets is a loyal customer, not an abuser.
  const openCount = await SupportTicket.countDocuments({
    user: toObjectId(user._id),
    status: { $in: UNRESOLVED_STATUSES },
  });

  if (openCount >= appConfig.support.maxOpenTicketsPerUser) {
    await destroySupportAttachments(messageService.mapUploadsToAttachments(uploadedImages));
    throw new ApiError(
      429,
      `You already have ${openCount} open tickets. Please continue on one of those, or wait for a reply before opening another.`,
      "SUPPORT_TOO_MANY_OPEN_TICKETS"
    );
  }

  const subject = String(body.subject || "").trim();
  const description = messageService.normalizeBody(body.description, { max: LIMITS.messageMax });
  const priority = normalizeUserPriority(body.priority, category);

  // Insert-and-retry rather than check-then-insert: two concurrent creates can
  // both see a code as free. The unique index is the real guard; a duplicate
  // just means picking another code.
  let ticket;
  const MAX_CODE_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      ticket = await SupportTicket.create({
        ticketCode: generateTicketCode(),
        user: toObjectId(user._id),
        userEmail: user.email || "",
        userName: user.name || "",
        subject,
        category,
        subcategory: String(body.subcategory || "").slice(0, 100),
        priority,
        status: "open",
        channel: "portal",
        source: {
          platform: String(body.platform || "unknown").slice(0, 20),
          appVersion: String(body.appVersion || "").slice(0, 30),
          marketType: String(body.marketType || "Unknown").slice(0, 30),
        },
        linkedIssue: body.linkedIssue ? toObjectId(body.linkedIssue) : null,
        lastActivityAt: new Date(),
        clientRequestId,
      });
      break;
    } catch (error) {
      const duplicateCode = error?.code === 11000 && /ticketCode/.test(error?.message || "");
      const duplicateRequest = error?.code === 11000 && /clientRequestId/.test(error?.message || "");

      // Lost the idempotency race against a concurrent identical submit — the
      // other request won, so return its ticket rather than erroring.
      if (duplicateRequest && clientRequestId) {
        // eslint-disable-next-line no-await-in-loop
        const winner = await SupportTicket.findOne({
          user: toObjectId(user._id),
          clientRequestId,
        }).lean();
        if (winner) {
          await destroySupportAttachments(messageService.mapUploadsToAttachments(uploadedImages));
          return { ticket: winner, deduped: true };
        }
      }

      if (!duplicateCode) {
        await destroySupportAttachments(messageService.mapUploadsToAttachments(uploadedImages));
        throw error;
      }
      // else: code collision, pick another and retry.
    }
  }

  if (!ticket) {
    await destroySupportAttachments(messageService.mapUploadsToAttachments(uploadedImages));
    throw new ApiError(500, "Could not allocate a ticket code", "INTERNAL_ERROR");
  }

  // The description becomes the first message, so the thread reads as one
  // continuous conversation rather than a form followed by a chat.
  try {
    await messageService.appendMessage({
      ticket,
      author: user,
      authorRole: "user",
      type: "message",
      body: description,
      uploadedImages,
    });
  } catch (error) {
    // The ticket exists but has no opening message — unusable. Roll it back so
    // the customer can retry cleanly rather than staring at an empty thread.
    await SupportTicket.deleteOne({ _id: ticket._id });
    await destroySupportAttachments(messageService.mapUploadsToAttachments(uploadedImages));
    throw error;
  }

  await audit({
    ticket,
    actor: user,
    actorRole: "user",
    action: "ticket_created",
    to: ticket.status,
    requestId,
  });

  // Never awaited into the response path. The ticket is committed; whether the
  // push queue or Resend is healthy is not the customer's problem.
  notify.notifyTicketCreated({ ticket: ticket.toObject(), user }).catch(() => {});

  logger.info("SUPPORT_TICKET_CREATED", {
    ticketCode: ticket.ticketCode,
    category,
    priority,
    userId: String(user._id),
  });

  return { ticket: ticket.toObject(), deduped: false };
}

// ─── Customer reads ──────────────────────────────────────────────────────────

async function listUserTickets(userId, query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  const filter = { user: toObjectId(userId) };

  if (query.status === "open") {
    filter.status = { $in: UNRESOLVED_STATUSES };
  } else if (TICKET_STATUSES.includes(query.status)) {
    filter.status = query.status;
  }

  if (SUPPORT_CATEGORY_VALUES.includes(query.category)) {
    filter.category = query.category;
  }

  // Customers search their own small set, so a case-insensitive contains match
  // on the subject is both adequate and predictable. The `user` equality above
  // means the index does the selection first — this never scans the collection.
  if (query.q) {
    const term = String(query.q).trim().slice(0, 100);
    if (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { subject: { $regex: escaped, $options: "i" } },
        { ticketCode: { $regex: `^${escaped}`, $options: "i" } },
      ];
    }
  }

  const [items, total] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ lastActivityAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeTicketForUser),
    pagination: buildPagination({ page, limit, total }),
  };
}

async function getUserTicket(userId, ticketId) {
  const ticket = await loadOwnedTicket(userId, ticketId);
  return serializeTicketForUser(ticket);
}

// ─── Customer writes ─────────────────────────────────────────────────────────

async function replyAsUser({ user, ticketId, body, uploadedImages = [], clientMessageId, requestId }) {
  const ticket = await loadOwnedTicket(user._id, ticketId);

  if (ticket.status === "closed") {
    await destroySupportAttachments(messageService.mapUploadsToAttachments(uploadedImages));
    throw new ApiError(
      409,
      "This ticket is closed. Please open a new ticket and we'll pick it up from there.",
      "SUPPORT_TICKET_CLOSED"
    );
  }

  const wasResolved = ticket.status === "resolved";

  // A reply to a resolved ticket reopens it — but only inside the window.
  // After that it is closed and the customer starts fresh, which keeps a
  // months-old thread from being resurrected with unrelated questions.
  if (wasResolved && !canUserReopen(ticket)) {
    await destroySupportAttachments(messageService.mapUploadsToAttachments(uploadedImages));
    throw new ApiError(
      409,
      `This ticket was resolved more than ${REOPEN_WINDOW_DAYS} days ago. Please open a new ticket.`,
      "SUPPORT_REOPEN_WINDOW_EXPIRED"
    );
  }

  const { message, deduped } = await messageService.appendMessage({
    ticket,
    author: user,
    authorRole: "user",
    type: "message",
    body,
    uploadedImages,
    clientMessageId,
  });

  // A retried request must not reopen the ticket a second time or fire a
  // second notification.
  if (deduped) {
    return { message, ticket, deduped: true };
  }

  let updatedTicket = ticket;

  if (wasResolved) {
    // Guarded on the status we read: if an agent closed it in the meantime,
    // this no-ops rather than dragging a closed ticket back open.
    const reopened = await SupportTicket.findOneAndUpdate(
      { _id: ticket._id, status: "resolved" },
      {
        $set: { status: "open", resolvedAt: null },
        // Cleared so the auto-close sweep does not immediately re-close a
        // ticket the customer has just brought back to life.
        $inc: { reopenCount: 1, version: 1 },
      },
      { returnDocument: "after" }
    ).lean();

    if (reopened) {
      updatedTicket = reopened;
      await messageService.recordSystemEvent({
        ticket: reopened,
        action: "reopened",
        from: "resolved",
        to: "open",
        actorName: user.name,
      });
      await audit({
        ticket: reopened,
        actor: user,
        actorRole: "user",
        action: "ticket_reopened",
        from: "resolved",
        to: "open",
        requestId,
      });
      notify.notifyReopened({ ticket: reopened, recipient: ticketOwner(reopened) }).catch(() => {});
    }
  } else if (ticket.status === "waiting_on_user") {
    // The customer answering is exactly what "waiting on user" was waiting for.
    const moved = await SupportTicket.findOneAndUpdate(
      { _id: ticket._id, status: "waiting_on_user" },
      { $set: { status: "in_progress" }, $inc: { version: 1 } },
      { returnDocument: "after" }
    ).lean();

    if (moved) {
      updatedTicket = moved;
      await messageService.recordSystemEvent({
        ticket: moved,
        action: "status_changed",
        from: "waiting_on_user",
        to: "in_progress",
        actorName: user.name,
      });
    }
  }

  notify.notifyUserReply({ ticket: updatedTicket, message }).catch(() => {});

  return { message, ticket: updatedTicket, deduped: false };
}

async function reopenTicket({ user, ticketId, requestId }) {
  const ticket = await loadOwnedTicket(user._id, ticketId);

  if (ticket.status !== "resolved") {
    throw new ApiError(
      409,
      ticket.status === "closed"
        ? "This ticket is closed. Please open a new ticket instead."
        : "This ticket is already open.",
      "SUPPORT_INVALID_TRANSITION"
    );
  }

  if (!canTransition("resolved", "open", { actorRole: "user" }) || !canUserReopen(ticket)) {
    throw new ApiError(
      409,
      `This ticket was resolved more than ${REOPEN_WINDOW_DAYS} days ago. Please open a new ticket.`,
      "SUPPORT_REOPEN_WINDOW_EXPIRED"
    );
  }

  const reopened = await SupportTicket.findOneAndUpdate(
    { _id: ticket._id, status: "resolved" },
    {
      $set: { status: "open", resolvedAt: null, lastActivityAt: new Date() },
      $inc: { reopenCount: 1, version: 1 },
    },
    { returnDocument: "after" }
  ).lean();

  if (!reopened) {
    throw new ApiError(409, "This ticket has already changed. Please refresh.", "SUPPORT_CONFLICT");
  }

  await messageService.recordSystemEvent({
    ticket: reopened,
    action: "reopened",
    from: "resolved",
    to: "open",
    actorName: user.name,
  });
  await audit({
    ticket: reopened,
    actor: user,
    actorRole: "user",
    action: "ticket_reopened",
    from: "resolved",
    to: "open",
    requestId,
  });

  notify.notifyReopened({ ticket: reopened, recipient: ticketOwner(reopened) }).catch(() => {});

  return serializeTicketForUser(reopened);
}

async function submitSatisfaction({ user, ticketId, rating, comment }) {
  const ticket = await loadOwnedTicket(user._id, ticketId);

  if (!["resolved", "closed"].includes(ticket.status)) {
    throw new ApiError(409, "You can rate a ticket once it has been resolved.", "SUPPORT_INVALID_STATE");
  }

  // `satisfaction.rating: null` in the predicate makes this one-shot: a second
  // submit finds no match and is rejected rather than overwriting.
  const updated = await SupportTicket.findOneAndUpdate(
    { _id: ticket._id, user: toObjectId(user._id), "satisfaction.rating": null },
    {
      $set: {
        "satisfaction.rating": Number(rating),
        "satisfaction.comment": String(comment || "").trim().slice(0, LIMITS.satisfactionCommentMax),
        "satisfaction.submittedAt": new Date(),
      },
    },
    { returnDocument: "after" }
  ).lean();

  if (!updated) {
    throw new ApiError(409, "You have already rated this ticket.", "SUPPORT_ALREADY_RATED");
  }

  return serializeTicketForUser(updated);
}

// ─── Staff reads ─────────────────────────────────────────────────────────────

/**
 * Server-side queue: filter, search, sort, paginate. Nothing about this loads
 * the collection into the client — the response is one page, always.
 */
async function listStaffTickets(query = {}, staffUser) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const filter = {};

  // Named queue tabs, resolved server-side so the client cannot invent one.
  switch (query.queue) {
    case "mine":
      filter.assignedTo = toObjectId(staffUser._id);
      filter.status = { $in: UNRESOLVED_STATUSES };
      break;
    case "unassigned":
      filter.assignedTo = null;
      filter.status = { $in: UNRESOLVED_STATUSES };
      break;
    case "waiting_on_user":
      filter.status = "waiting_on_user";
      break;
    case "resolved":
      filter.status = { $in: ["resolved", "closed"] };
      break;
    case "all":
    default:
      break;
  }

  if (TICKET_STATUSES.includes(query.status)) filter.status = query.status;
  if (TICKET_PRIORITIES.includes(query.priority)) filter.priority = query.priority;
  if (SUPPORT_CATEGORY_VALUES.includes(query.category)) filter.category = query.category;
  if (TICKET_TAGS.includes(query.tag)) filter.tags = query.tag;

  if (query.assignedTo === "none") {
    filter.assignedTo = null;
  } else if (query.assignedTo && mongoose.Types.ObjectId.isValid(query.assignedTo)) {
    filter.assignedTo = toObjectId(query.assignedTo);
  }

  if (query.email) {
    filter.userEmail = String(query.email).trim().toLowerCase().slice(0, 200);
  }

  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }

  // Two search modes, kept separate so each stays index-backed.
  //
  //   q             — ticket code or subject, via the compound text index.
  //   messageQuery  — message bodies. Resolves matching ticket ids first, then
  //                   filters on them. Bounded, because an unbounded $in list
  //                   is a query that degrades every month.
  let useTextScore = false;

  if (query.messageQuery) {
    const term = String(query.messageQuery).trim().slice(0, 200);
    if (term) {
      const matches = await SupportMessage.find(
        { $text: { $search: term } },
        { ticket: 1 }
      )
        .limit(MESSAGE_SEARCH_TICKET_CAP)
        .lean();

      const ticketIds = [...new Set(matches.map((m) => String(m.ticket)))].map(toObjectId);
      // An empty result must match nothing, not everything.
      filter._id = { $in: ticketIds };
    }
  } else if (query.q) {
    const term = String(query.q).trim().slice(0, 200);
    if (/^EC-[A-Z0-9]{4,10}$/i.test(term)) {
      // An exact code is the single most common agent search — go straight at
      // the unique index instead of paying for a text search.
      filter.ticketCode = term.toUpperCase();
    } else if (term) {
      filter.$text = { $search: term };
      useTextScore = true;
    }
  }

  const sortField = {
    activity: { lastActivityAt: -1, _id: -1 },
    created: { createdAt: -1, _id: -1 },
    priority: { priority: -1, lastActivityAt: -1 },
    oldest: { createdAt: 1, _id: 1 },
  }[query.sort] || { lastActivityAt: -1, _id: -1 };

  const sort = useTextScore ? { score: { $meta: "textScore" }, ...sortField } : sortField;
  const projection = useTextScore ? { score: { $meta: "textScore" } } : {};

  const [items, total] = await Promise.all([
    SupportTicket.find(filter, projection)
      .populate("assignedTo", "name supportRole accountStatus")
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeTicketForStaff),
    pagination: buildPagination({ page, limit, total }),
  };
}

async function getStaffTicket(ticketId) {
  const ticket = await SupportTicket.findById(ticketId)
    .populate("assignedTo", "name supportRole accountStatus")
    .populate("user", "name email")
    .lean();

  if (!ticket) throw new ApiError(404, "Ticket not found", "NOT_FOUND");
  return serializeTicketForStaff(ticket);
}

/**
 * Customer context panel.
 *
 * Answers the questions an agent actually has open in front of them — is this
 * person paying, have they been here before, is this a known bug — and nothing
 * else. Payment amounts are gated behind VIEW_BILLING: an agent triaging an
 * OCR bug has no business reading a customer's transaction history.
 */
async function getUserContext(ticketId, staffUser) {
  const ticket = await loadStaffTicket(ticketId);
  const userId = toObjectId(ticket.user);
  const canSeeBilling = hasCapability(staffUser, SUPPORT_CAPABILITIES.VIEW_BILLING);

  const [account, ticketCounts, recentTickets, issueReports, lastPayment] = await Promise.all([
    User.findById(userId)
      .select("name email role accountStatus createdAt subscriptionStatus subscriptionPlan subscriptionExpiry preferredMarket tradingStyle lastLogin trial")
      .lean(),
    SupportTicket.aggregate([
      { $match: { user: userId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    SupportTicket.find({ user: userId, _id: { $ne: toObjectId(ticketId) } })
      .select("ticketCode subject status category createdAt resolvedAt satisfaction.rating")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    IssueReport.find({ user: userId })
      .select("issueCode issueCategory status createdAt")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    canSeeBilling
      ? Payment.findOne({ user: userId, status: "completed" })
          .select("amount currency plan status createdAt")
          .sort({ createdAt: -1 })
          .lean()
      : Promise.resolve(null),
  ]);

  // The account may have been deleted mid-investigation. The ticket still
  // exists (it is purged with the account, but a request can race that), so
  // degrade to the denormalised snapshot rather than throwing.
  if (!account) {
    return {
      account: { name: ticket.userName, email: ticket.userEmail, deleted: true },
      plan: null,
      ticketCounts: {},
      recentTickets: [],
      issueReports: [],
      billing: null,
    };
  }

  return {
    account: {
      id: String(account._id),
      name: account.name,
      email: account.email,
      accountStatus: account.accountStatus || "active",
      memberSince: account.createdAt,
      lastLogin: account.lastLogin || null,
      preferredMarket: account.preferredMarket || null,
      tradingStyle: account.tradingStyle || null,
      deleted: false,
    },
    // Resolved through the same helper the rest of the app uses, so the agent
    // sees exactly the entitlement the customer's app is enforcing.
    plan: describePlan(account),
    ticketCounts: ticketCounts.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {}),
    recentTickets: recentTickets.map((t) => ({
      id: String(t._id),
      ticketCode: t.ticketCode,
      subject: t.subject,
      status: t.status,
      category: t.category,
      categoryLabel: categoryLabel(t.category),
      createdAt: t.createdAt,
      rating: t.satisfaction?.rating || null,
    })),
    issueReports: issueReports.map((i) => ({
      id: String(i._id),
      issueCode: i.issueCode,
      category: i.issueCategory,
      status: i.status,
      createdAt: i.createdAt,
    })),
    billing: canSeeBilling
      ? {
          visible: true,
          lastPayment: lastPayment
            ? {
                amount: lastPayment.amount,
                currency: lastPayment.currency,
                plan: lastPayment.plan,
                at: lastPayment.createdAt,
              }
            : null,
        }
      : { visible: false, lastPayment: null },
  };
}

// ─── Staff writes ────────────────────────────────────────────────────────────

async function replyAsAgent({
  staffUser,
  actorRole,
  ticketId,
  body,
  uploadedImages = [],
  clientMessageId,
  internal = false,
  nextStatus,
  requestId,
}) {
  const ticket = await loadStaffTicket(ticketId);

  const { message, deduped } = await messageService.appendMessage({
    ticket,
    author: staffUser,
    authorRole: "agent",
    type: internal ? "internal_note" : "message",
    body,
    uploadedImages,
    clientMessageId,
  });

  if (deduped) {
    return { message, ticket, deduped: true };
  }

  await audit({
    ticket,
    actor: staffUser,
    actorRole,
    action: internal ? "internal_note_added" : "agent_replied",
    requestId,
  });

  // An internal note is invisible to the customer, so it must not change the
  // ticket's public state and must not notify them. It is a note to colleagues.
  if (internal) {
    return { message, ticket, deduped: false };
  }

  // A public reply moves an untouched ticket into progress, and optionally to
  // whatever the agent picked (usually "waiting on user").
  const target = TICKET_STATUSES.includes(nextStatus)
    ? nextStatus
    : ticket.status === "open"
      ? "in_progress"
      : null;

  let updatedTicket = ticket;

  if (target && target !== ticket.status && canTransition(ticket.status, target, { actorRole: "agent" })) {
    const moved = await SupportTicket.findOneAndUpdate(
      { _id: ticket._id, status: ticket.status },
      { $set: { status: target }, $inc: { version: 1 } },
      { returnDocument: "after" }
    ).lean();

    if (moved) {
      updatedTicket = moved;
      await messageService.recordSystemEvent({
        ticket: moved,
        action: "status_changed",
        from: ticket.status,
        to: target,
        actorName: staffUser.name,
      });
    }
  }

  notify
    .notifyAgentReply({
      ticket: updatedTicket,
      message,
      recipient: ticketOwner(updatedTicket),
    })
    .catch(() => {});

  return { message, ticket: updatedTicket, deduped: false };
}

/**
 * Assign, reassign, or unassign.
 *
 * The concurrency case this is built around: two agents open the unassigned
 * queue and both click "Assign to me" on the same ticket. The claim predicate
 * requires `assignedTo: null`, so exactly one update matches. The loser gets a
 * 409 naming the winner — not a silent overwrite, and not a ticket that
 * appears in two people's queues.
 */
async function assignTicket({ staffUser, actorRole, ticketId, assigneeId, expectedVersion, requestId }) {
  const ticket = await loadStaffTicket(ticketId);
  const currentAssignee = ticket.assignedTo ? String(ticket.assignedTo) : null;
  const targetId = assigneeId ? String(assigneeId) : null;

  if (currentAssignee === targetId) {
    return { ticket: serializeTicketForStaff(ticket), changed: false };
  }

  // Claiming an unassigned ticket needs only ASSIGN_SELF. Taking one off
  // somebody else, or handing it to a third party, needs REASSIGN.
  const isSelfClaim = !currentAssignee && targetId === String(staffUser._id);
  if (!isSelfClaim && !hasCapability(staffUser, SUPPORT_CAPABILITIES.REASSIGN)) {
    throw new ApiError(
      403,
      "You can claim unassigned tickets, but reassigning requires a support lead.",
      "FORBIDDEN"
    );
  }

  let assignee = null;
  if (targetId) {
    assignee = await User.findById(targetId).select("name role supportRole accountStatus").lean();
    if (!assignee) {
      throw new ApiError(404, "That agent no longer exists", "NOT_FOUND");
    }
    if (assignee.role !== "admin" && !assignee.supportRole) {
      throw new ApiError(400, "That user is not a support agent", "VALIDATION_ERROR");
    }
    // Assigning work to a suspended account means the ticket silently rots.
    if (assignee.accountStatus && assignee.accountStatus !== "active") {
      throw new ApiError(400, "That agent's account is disabled", "VALIDATION_ERROR");
    }
  }

  const guard = { _id: ticket._id };
  if (isSelfClaim) {
    guard.assignedTo = null;
  } else if (Number.isInteger(expectedVersion)) {
    guard.version = expectedVersion;
  } else {
    guard.assignedTo = ticket.assignedTo;
  }

  const updated = await SupportTicket.findOneAndUpdate(
    guard,
    {
      $set: {
        assignedTo: targetId ? toObjectId(targetId) : null,
        assignedAt: targetId ? new Date() : null,
      },
      $inc: { version: 1 },
      $max: { lastActivityAt: new Date() },
    },
    { returnDocument: "after" }
  )
    .populate("assignedTo", "name supportRole accountStatus")
    .lean();

  if (!updated) {
    const fresh = await SupportTicket.findById(ticketId)
      .populate("assignedTo", "name")
      .lean();
    throw new ApiError(
      409,
      fresh?.assignedTo?.name
        ? `${fresh.assignedTo.name} claimed this ticket first.`
        : "This ticket changed while you were viewing it. Please refresh.",
      "SUPPORT_CONFLICT"
    );
  }

  const action = !currentAssignee ? "assigned" : targetId ? "reassigned" : "unassigned";

  await messageService.recordSystemEvent({
    ticket: updated,
    action,
    from: currentAssignee ? "previous agent" : "",
    to: assignee?.name || "",
    actorName: staffUser.name,
    // Internal handoffs are team bookkeeping. The customer sees that someone
    // is on their ticket, not that it has been passed around three times.
    visibility: "internal",
  });

  await audit({
    ticket: updated,
    actor: staffUser,
    actorRole,
    action,
    from: currentAssignee || "unassigned",
    to: targetId || "unassigned",
    requestId,
  });

  if (targetId && targetId !== String(staffUser._id)) {
    notify
      .notifyAssigned({ ticket: updated, assigneeId: targetId, assignedByName: staffUser.name })
      .catch(() => {});
  }

  return { ticket: serializeTicketForStaff(updated), changed: true };
}

/**
 * Move a ticket through the state machine.
 *
 * The transition is validated twice on purpose: once in JavaScript for a clear
 * error message, and once inside the Mongo predicate (`status: from`) so that
 * two agents acting at the same moment cannot both succeed. The second check is
 * the one that actually enforces it.
 */
async function changeStatus({ staffUser, actorRole, ticketId, status, resolutionSummary, expectedVersion, requestId }) {
  const ticket = await loadStaffTicket(ticketId);
  const from = ticket.status;

  if (from === status) {
    return { ticket: serializeTicketForStaff(ticket), changed: false };
  }

  if (!canTransition(from, status, { actorRole: "agent" })) {
    throw new ApiError(
      409,
      `A ticket cannot move from ${from} to ${status}.`,
      "SUPPORT_INVALID_TRANSITION"
    );
  }

  const now = new Date();
  const set = { status };
  const unset = {};

  if (status === "resolved") {
    set.resolvedAt = now;
    set["resolution.summary"] = String(resolutionSummary || "").trim().slice(0, LIMITS.resolutionMax);
    set["resolution.resolvedBy"] = toObjectId(staffUser._id);
  }

  if (status === "closed") {
    set.closedAt = now;
  }

  // Reopening must clear resolvedAt, or the nightly auto-close sweep finds the
  // ticket still "resolved 8 days ago" and closes it again the same night.
  if (["open", "in_progress", "waiting_on_user", "pending"].includes(status)) {
    set.resolvedAt = null;
    set.closedAt = null;
  }

  const guard = { _id: ticket._id, status: from };
  if (Number.isInteger(expectedVersion)) guard.version = expectedVersion;

  const updated = await SupportTicket.findOneAndUpdate(
    guard,
    {
      $set: set,
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
      $inc: { version: 1, ...(from === "resolved" || from === "closed" ? { reopenCount: 1 } : {}) },
      $max: { lastActivityAt: now },
    },
    { returnDocument: "after" }
  ).lean();

  if (!updated) {
    const fresh = await SupportTicket.findById(ticketId).select("status").lean();
    throw new ApiError(
      409,
      `This ticket is now ${fresh?.status || "changed"} — someone updated it while you were viewing. Please refresh.`,
      "SUPPORT_CONFLICT"
    );
  }

  await messageService.recordSystemEvent({
    ticket: updated,
    action: "status_changed",
    from,
    to: status,
    actorName: staffUser.name,
  });

  await audit({
    ticket: updated,
    actor: staffUser,
    actorRole,
    action: "status_changed",
    from,
    to: status,
    requestId,
  });

  notify
    .notifyStatusChanged({ ticket: updated, from, to: status, recipient: ticketOwner(updated) })
    .catch(() => {});

  return { ticket: serializeTicketForStaff(updated), changed: true };
}

async function changePriority({ staffUser, actorRole, ticketId, priority, expectedVersion, requestId }) {
  const ticket = await loadStaffTicket(ticketId);

  if (ticket.priority === priority) {
    return { ticket: serializeTicketForStaff(ticket), changed: false };
  }

  const guard = { _id: ticket._id, priority: ticket.priority };
  if (Number.isInteger(expectedVersion)) guard.version = expectedVersion;

  const updated = await SupportTicket.findOneAndUpdate(
    guard,
    { $set: { priority }, $inc: { version: 1 }, $max: { lastActivityAt: new Date() } },
    { returnDocument: "after" }
  ).lean();

  if (!updated) {
    throw new ApiError(409, "This ticket changed while you were viewing it. Please refresh.", "SUPPORT_CONFLICT");
  }

  await messageService.recordSystemEvent({
    ticket: updated,
    action: "priority_changed",
    from: ticket.priority,
    to: priority,
    actorName: staffUser.name,
    visibility: "internal",
  });

  await audit({
    ticket: updated,
    actor: staffUser,
    actorRole,
    action: "priority_changed",
    from: ticket.priority,
    to: priority,
    requestId,
  });

  return { ticket: serializeTicketForStaff(updated), changed: true };
}

async function updateTags({ staffUser, actorRole, ticketId, tags, requestId }) {
  const ticket = await loadStaffTicket(ticketId);

  // Allowlisted and de-duplicated. Free-text tags turn the filter UI into a
  // guessing game within a month.
  const clean = [...new Set((tags || []).filter((tag) => TICKET_TAGS.includes(tag)))].slice(0, 10);

  const updated = await SupportTicket.findOneAndUpdate(
    { _id: ticket._id },
    { $set: { tags: clean }, $inc: { version: 1 } },
    { returnDocument: "after" }
  ).lean();

  await messageService.recordSystemEvent({
    ticket: updated,
    action: "tags_changed",
    from: (ticket.tags || []).join(", "),
    to: clean.join(", "),
    actorName: staffUser.name,
    visibility: "internal",
  });

  await audit({
    ticket: updated,
    actor: staffUser,
    actorRole,
    action: "tags_changed",
    from: (ticket.tags || []).join(","),
    to: clean.join(","),
    requestId,
  });

  return serializeTicketForStaff(updated);
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Support dashboard numbers.
 *
 * Every figure below is computed from real timestamps. Nothing is estimated,
 * and averages deliberately exclude tickets that never reached the relevant
 * state rather than counting them as zero — a ticket with no first response
 * yet is not a zero-second first response.
 */
async function getMetrics(staffUser) {
  const dayAgo = new Date(Date.now() - 86400000);
  const staffId = toObjectId(staffUser._id);

  const [
    byStatus,
    byPriority,
    byCategory,
    unassigned,
    mine,
    resolvedToday,
    reopened,
    responseTimes,
    byAgent,
    satisfaction,
  ] = await Promise.all([
    SupportTicket.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    SupportTicket.aggregate([
      { $match: { status: { $in: UNRESOLVED_STATUSES } } },
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]),
    SupportTicket.aggregate([
      { $match: { status: { $in: UNRESOLVED_STATUSES } } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]),
    SupportTicket.countDocuments({ assignedTo: null, status: { $in: UNRESOLVED_STATUSES } }),
    SupportTicket.countDocuments({ assignedTo: staffId, status: { $in: UNRESOLVED_STATUSES } }),
    SupportTicket.countDocuments({ status: "resolved", resolvedAt: { $gte: dayAgo } }),
    SupportTicket.countDocuments({ reopenCount: { $gt: 0 } }),
    SupportTicket.aggregate([
      {
        // Only tickets that actually reached each milestone contribute. A
        // still-open ticket has no resolution time, and averaging it in as
        // zero would make the dashboard flatter the team.
        $match: { $or: [{ firstResponseAt: { $ne: null } }, { resolvedAt: { $ne: null } }] },
      },
      {
        $project: {
          firstResponseMs: {
            $cond: [
              { $ne: ["$firstResponseAt", null] },
              { $subtract: ["$firstResponseAt", "$createdAt"] },
              null,
            ],
          },
          resolutionMs: {
            $cond: [
              { $ne: ["$resolvedAt", null] },
              { $subtract: ["$resolvedAt", "$createdAt"] },
              null,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgFirstResponseMs: { $avg: "$firstResponseMs" },
          avgResolutionMs: { $avg: "$resolutionMs" },
          firstResponseCount: { $sum: { $cond: [{ $ne: ["$firstResponseMs", null] }, 1, 0] } },
          resolutionCount: { $sum: { $cond: [{ $ne: ["$resolutionMs", null] }, 1, 0] } },
        },
      },
    ]),
    SupportTicket.aggregate([
      { $match: { assignedTo: { $ne: null }, status: { $in: UNRESOLVED_STATUSES } } },
      { $group: { _id: "$assignedTo", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
      {
        $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "agent" },
      },
      {
        $project: {
          count: 1,
          name: { $ifNull: [{ $arrayElemAt: ["$agent.name", 0] }, "Unknown"] },
        },
      },
    ]),
    SupportTicket.aggregate([
      { $match: { "satisfaction.rating": { $ne: null } } },
      { $group: { _id: null, avg: { $avg: "$satisfaction.rating" }, count: { $sum: 1 } } },
    ]),
  ]);

  const toMap = (rows) => rows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
  const timing = responseTimes[0] || {};
  const hours = (ms) => (ms ? Number((ms / 3600000).toFixed(1)) : null);

  const statusCounts = toMap(byStatus);
  const priorityCounts = toMap(byPriority);

  return {
    open: ACTIVE_STATUSES.reduce((sum, s) => sum + (statusCounts[s] || 0), 0),
    unassigned,
    mine,
    waitingOnUser: statusCounts.waiting_on_user || 0,
    highPriority: (priorityCounts.high || 0) + (priorityCounts.urgent || 0),
    resolvedToday,
    reopened,
    byStatus: statusCounts,
    byPriority: priorityCounts,
    byCategory: toMap(byCategory),
    byAgent: byAgent.map((row) => ({ agentId: String(row._id), name: row.name, count: row.count })),
    avgFirstResponseHours: hours(timing.avgFirstResponseMs),
    avgResolutionHours: hours(timing.avgResolutionMs),
    // Sample sizes shipped alongside the averages: "4.2h across 3 tickets" is
    // a very different claim from "4.2h across 900", and a dashboard that
    // hides which one it is invites the wrong decision.
    firstResponseSample: timing.firstResponseCount || 0,
    resolutionSample: timing.resolutionCount || 0,
    satisfaction: satisfaction[0]
      ? { average: Number(satisfaction[0].avg.toFixed(2)), responses: satisfaction[0].count }
      : { average: null, responses: 0 },
  };
}

// ─── Maintenance ─────────────────────────────────────────────────────────────

/**
 * Close resolved tickets past the reopen window.
 *
 * Runs from a nightly cron. Bounded per run so one sweep cannot monopolise the
 * connection pool, and idempotent — the predicate excludes anything already
 * closed, so a double firing is harmless.
 */
async function autoCloseResolvedTickets({ batchSize = 500 } = {}) {
  const cutoff = new Date(Date.now() - AUTO_CLOSE_AFTER_DAYS * 86400000);

  const stale = await SupportTicket.find({
    status: "resolved",
    resolvedAt: { $lte: cutoff },
  })
    .select("_id ticketCode user")
    .limit(batchSize)
    .lean();

  if (!stale.length) return { closed: 0 };

  const result = await SupportTicket.updateMany(
    { _id: { $in: stale.map((t) => t._id) }, status: "resolved" },
    { $set: { status: "closed", closedAt: new Date() }, $inc: { version: 1 } }
  );

  logger.info("SUPPORT_AUTO_CLOSE_SWEEP", {
    candidates: stale.length,
    closed: result.modifiedCount,
    olderThanDays: AUTO_CLOSE_AFTER_DAYS,
  });

  return { closed: result.modifiedCount };
}

async function listTicketAuditTrail(ticketId, { limit = 50 } = {}) {
  const rows = await SupportAuditLog.find({ ticket: toObjectId(ticketId) })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .lean();

  return rows.map((row) => ({
    id: String(row._id),
    action: row.action,
    actorName: row.actorName || "System",
    actorRole: row.actorRole,
    from: row.from,
    to: row.to,
    at: row.createdAt,
  }));
}

/** Agents available in the assignment picker. */
async function listAgents() {
  const agents = await User.find({
    $or: [{ role: "admin" }, { supportRole: { $in: ["agent", "lead"] } }],
    $and: [{ $or: [{ accountStatus: "active" }, { accountStatus: { $exists: false } }] }],
  })
    .select("name email role supportRole")
    .sort({ name: 1 })
    .lean();

  return agents.map((agent) => ({
    id: String(agent._id),
    name: agent.name,
    email: agent.email,
    supportRole: agent.supportRole || (agent.role === "admin" ? "admin" : null),
  }));
}

module.exports = {
  generateTicketCode,
  findDuplicateCandidates,
  createTicket,
  listUserTickets,
  getUserTicket,
  loadOwnedTicket,
  loadStaffTicket,
  replyAsUser,
  reopenTicket,
  submitSatisfaction,
  listStaffTickets,
  getStaffTicket,
  getUserContext,
  replyAsAgent,
  assignTicket,
  changeStatus,
  changePriority,
  updateTags,
  getMetrics,
  autoCloseResolvedTickets,
  listTicketAuditTrail,
  listAgents,
};
