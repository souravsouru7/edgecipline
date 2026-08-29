"use strict";

const User = require("../models/Users");
const { enqueueNotificationDelivery } = require("../queues/smartNotificationQueue");
const { logger } = require("../utils/logger");
const { categoryLabel } = require("../utils/supportSerializers");
const { TICKET_STATUS_LABELS, SUPPORT_ROLES } = require("../constants/support");
const mailService = require("./mailService");

/**
 * Every notification the support system sends.
 *
 * The contract this file exists to enforce: **nothing in here may ever throw
 * into a caller.** A ticket that has been committed to the database must stay
 * committed even if Redis is down, FCM is rejecting, and the Resend domain is
 * unverified. Every export resolves; failures are logged and swallowed.
 *
 * That is not defensive padding — it is the difference between "the customer's
 * message was saved and we failed to email them" and "the customer lost the
 * message they spent ten minutes writing because our mail provider blipped".
 */

// Push and email are independent channels with independent failure modes.
// Settled, never rejected, so one dead channel cannot take the other with it.
async function fanOut(tasks, context) {
  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === "rejected");

  if (failed.length) {
    logger.warn("SUPPORT_NOTIFICATION_PARTIAL_FAILURE", {
      ...context,
      attempted: results.length,
      failed: failed.length,
      // First reason only — the rest are almost always the same outage.
      reason: failed[0]?.reason?.message,
    });
  }

  return { attempted: results.length, failed: failed.length };
}

function ticketDeepLink(ticketId) {
  return `/support/tickets/detail?id=${ticketId}`;
}

// Truncated for a push body and an email preview. Whitespace is collapsed so a
// message that opens with six blank lines does not render as an empty preview.
function preview(text, max = 140) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Staff who should hear about queue activity.
 *
 * Reads the database every time rather than caching: an agent added this
 * morning must receive tonight's alerts, and one removed must stop.
 * Deliberately excludes disabled accounts — a suspended agent should not keep
 * getting customer data pushed to their phone.
 */
async function listNotifiableStaff({ excludeUserId } = {}) {
  const staff = await User.find({
    $or: [{ role: "admin" }, { supportRole: { $in: SUPPORT_ROLES } }],
    $and: [{ $or: [{ accountStatus: "active" }, { accountStatus: { $exists: false } }] }],
  })
    .select("_id")
    .lean();

  const excluded = excludeUserId ? String(excludeUserId) : null;
  return staff.filter((s) => String(s._id) !== excluded);
}

function pushToUser(userId, notification) {
  return enqueueNotificationDelivery({ userId, notification });
}

// ─── Customer-facing ─────────────────────────────────────────────────────────

async function notifyTicketCreated({ ticket, user }) {
  try {
    const ticketId = String(ticket._id);

    await fanOut(
      [
        pushToUser(user._id, {
          type: "support_ticket_created",
          title: `Ticket ${ticket.ticketCode} created`,
          body: `We've received "${preview(ticket.subject, 70)}" and will reply soon.`,
          data: { ticketId, ticketCode: ticket.ticketCode, screen: "support-ticket" },
          deepLink: ticketDeepLink(ticketId),
          sourceType: "support_ticket",
          sourceId: ticketId,
          dedupeKey: `support:created:${ticketId}`,
        }),
        mailService.sendSupportTicketCreated({
          to: user.email,
          userName: user.name,
          ticketId,
          ticketCode: ticket.ticketCode,
          subject: ticket.subject,
          categoryLabel: categoryLabel(ticket.category),
        }),
      ],
      { event: "ticket_created", ticketCode: ticket.ticketCode }
    );

    // Staff alert is a separate fan-out: a failure to reach the customer must
    // not stop the queue being told, and vice versa.
    const staff = await listNotifiableStaff({ excludeUserId: user._id });
    if (staff.length) {
      await fanOut(
        staff.map((member) =>
          pushToUser(member._id, {
            type: "support_new_ticket_staff",
            title: `New ticket: ${ticket.ticketCode}`,
            body: `${ticket.priority.toUpperCase()} · ${categoryLabel(ticket.category)} — ${preview(ticket.subject, 80)}`,
            data: { ticketId, ticketCode: ticket.ticketCode, screen: "admin-support" },
            deepLink: `/admin/support/detail?id=${ticketId}`,
            sourceType: "support_ticket",
            sourceId: ticketId,
            dedupeKey: `support:staff-new:${ticketId}:${member._id}`,
          })
        ),
        { event: "ticket_created_staff", ticketCode: ticket.ticketCode }
      );
    }
  } catch (error) {
    logger.error("SUPPORT_NOTIFY_CREATED_FAILED", {
      ticketCode: ticket?.ticketCode,
      error: error.message,
    });
  }
}

/**
 * @param {object} message MUST be a public agent reply. Callers read it back
 *   from the public-only query rather than passing whatever they just wrote,
 *   so an internal note can never reach this function — and therefore can
 *   never reach a push body or an email preview.
 */
async function notifyAgentReply({ ticket, message, recipient }) {
  try {
    if (message.visibility !== "public") {
      // Refusing loudly rather than silently returning: if this ever fires, a
      // caller has a bug that would otherwise leak staff commentary.
      logger.error("SUPPORT_NOTIFY_BLOCKED_INTERNAL_NOTE", {
        ticketCode: ticket?.ticketCode,
        messageId: String(message?._id),
      });
      return;
    }

    const ticketId = String(ticket._id);

    await fanOut(
      [
        pushToUser(recipient._id, {
          type: "support_agent_reply",
          title: `Support replied · ${ticket.ticketCode}`,
          body: preview(message.body),
          data: { ticketId, ticketCode: ticket.ticketCode, screen: "support-ticket" },
          deepLink: ticketDeepLink(ticketId),
          sourceType: "support_ticket",
          sourceId: ticketId,
          // Keyed on the message, not the ticket — every reply is its own
          // notification, but a retried delivery of the same reply is not.
          dedupeKey: `support:agent-reply:${message._id}`,
        }),
        mailService.sendSupportAgentReply({
          to: recipient.email,
          userName: recipient.name,
          ticketId,
          ticketCode: ticket.ticketCode,
          subject: ticket.subject,
          replyPreview: preview(message.body, 600),
          agentName: message.authorName,
        }),
      ],
      { event: "agent_reply", ticketCode: ticket.ticketCode }
    );
  } catch (error) {
    logger.error("SUPPORT_NOTIFY_AGENT_REPLY_FAILED", {
      ticketCode: ticket?.ticketCode,
      error: error.message,
    });
  }
}

async function notifyStatusChanged({ ticket, from, to, recipient }) {
  try {
    const ticketId = String(ticket._id);
    await fanOut(
      [
        pushToUser(recipient._id, {
          type: to === "resolved" ? "support_resolved" : "support_status_changed",
          title: `Ticket ${ticket.ticketCode} · ${TICKET_STATUS_LABELS[to] || to}`,
          body:
            to === "resolved"
              ? preview(ticket.resolution?.summary || "Your ticket has been resolved.")
              : `Status changed from ${TICKET_STATUS_LABELS[from] || from} to ${TICKET_STATUS_LABELS[to] || to}.`,
          data: { ticketId, ticketCode: ticket.ticketCode, status: to, screen: "support-ticket" },
          deepLink: ticketDeepLink(ticketId),
          sourceType: "support_ticket",
          sourceId: ticketId,
          // Includes the target status so moving open→resolved→open→resolved
          // is not deduped into a single silent notification.
          dedupeKey: `support:status:${ticketId}:${to}:${ticket.version}`,
        }),
        to === "resolved"
          ? mailService.sendSupportResolved({
              to: recipient.email,
              userName: recipient.name,
              ticketId,
              ticketCode: ticket.ticketCode,
              subject: ticket.subject,
              resolutionSummary: ticket.resolution?.summary || "",
            })
          : Promise.resolve({ sent: false, reason: "not_emailed" }),
      ],
      { event: "status_changed", ticketCode: ticket.ticketCode, from, to }
    );
  } catch (error) {
    logger.error("SUPPORT_NOTIFY_STATUS_FAILED", {
      ticketCode: ticket?.ticketCode,
      error: error.message,
    });
  }
}

async function notifyReopened({ ticket, recipient }) {
  try {
    const ticketId = String(ticket._id);
    await fanOut(
      [
        pushToUser(recipient._id, {
          type: "support_reopened",
          title: `Ticket ${ticket.ticketCode} reopened`,
          body: "We're looking at this again.",
          data: { ticketId, ticketCode: ticket.ticketCode, screen: "support-ticket" },
          deepLink: ticketDeepLink(ticketId),
          sourceType: "support_ticket",
          sourceId: ticketId,
          dedupeKey: `support:reopened:${ticketId}:${ticket.reopenCount}`,
        }),
      ],
      { event: "reopened", ticketCode: ticket.ticketCode }
    );
  } catch (error) {
    logger.error("SUPPORT_NOTIFY_REOPENED_FAILED", {
      ticketCode: ticket?.ticketCode,
      error: error.message,
    });
  }
}

// ─── Staff-facing ────────────────────────────────────────────────────────────

async function notifyUserReply({ ticket, message }) {
  try {
    const ticketId = String(ticket._id);

    // An assigned ticket goes to its owner alone — fanning every reply to the
    // whole team is how support teams learn to ignore notifications. Only an
    // unassigned ticket wakes everybody.
    const targets = ticket.assignedTo
      ? [{ _id: ticket.assignedTo }]
      : await listNotifiableStaff({ excludeUserId: ticket.user });

    if (!targets.length) return;

    await fanOut(
      targets.map((member) =>
        pushToUser(member._id, {
          type: "support_user_reply_staff",
          title: `Customer replied · ${ticket.ticketCode}`,
          body: preview(message.body),
          data: { ticketId, ticketCode: ticket.ticketCode, screen: "admin-support" },
          deepLink: `/admin/support/detail?id=${ticketId}`,
          sourceType: "support_ticket",
          sourceId: ticketId,
          dedupeKey: `support:user-reply:${message._id}:${member._id}`,
        })
      ),
      { event: "user_reply_staff", ticketCode: ticket.ticketCode }
    );
  } catch (error) {
    logger.error("SUPPORT_NOTIFY_USER_REPLY_FAILED", {
      ticketCode: ticket?.ticketCode,
      error: error.message,
    });
  }
}

async function notifyAssigned({ ticket, assigneeId, assignedByName }) {
  try {
    if (!assigneeId) return;
    const ticketId = String(ticket._id);

    await fanOut(
      [
        pushToUser(assigneeId, {
          type: "support_assigned",
          title: `Assigned to you · ${ticket.ticketCode}`,
          body: `${assignedByName || "A colleague"} assigned "${preview(ticket.subject, 70)}" to you.`,
          data: { ticketId, ticketCode: ticket.ticketCode, screen: "admin-support" },
          deepLink: `/admin/support/detail?id=${ticketId}`,
          sourceType: "support_ticket",
          sourceId: ticketId,
          // Reassigning back and forth must notify each time, so the dedupe
          // key carries the ticket version rather than just the ids.
          dedupeKey: `support:assigned:${ticketId}:${assigneeId}:${ticket.version}`,
        }),
      ],
      { event: "assigned", ticketCode: ticket.ticketCode }
    );
  } catch (error) {
    logger.error("SUPPORT_NOTIFY_ASSIGNED_FAILED", {
      ticketCode: ticket?.ticketCode,
      error: error.message,
    });
  }
}

module.exports = {
  listNotifiableStaff,
  notifyTicketCreated,
  notifyAgentReply,
  notifyStatusChanged,
  notifyReopened,
  notifyUserReply,
  notifyAssigned,
};
