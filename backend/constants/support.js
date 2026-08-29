"use strict";

/**
 * Single source of truth for the customer-support vocabulary.
 *
 * Everything the API and the UI have to agree on lives here: the category
 * list, the ticket state machine, priorities, channels and roles. Models
 * import these for their enums, Zod schemas import them for validation, and
 * the frontend receives them from GET /api/support/config — so a category
 * added here shows up everywhere without a second edit.
 */

// ─── Categories ──────────────────────────────────────────────────────────────
// Chosen against what Edgecipline actually does: two market workspaces, a
// journal, an OCR import pipeline, analytics/AI reports, and a Razorpay
// subscription. "subscription_billing" and "payments" are deliberately
// separate — a renewal question and a failed charge are handled differently
// and carry different urgency.
const SUPPORT_CATEGORIES = [
  { value: "getting_started",      label: "Getting Started",        description: "Setup, onboarding, and first steps" },
  { value: "account_profile",      label: "Account & Profile",      description: "Login, profile, and account settings" },
  { value: "trading_journal",      label: "Trading Journal",        description: "Logging trades, setups, and checklists" },
  { value: "trade_import",         label: "Trade Import & OCR",     description: "Screenshot uploads and extraction" },
  { value: "analytics_reports",    label: "Analytics & Reports",    description: "Dashboards, insights, and weekly reports" },
  { value: "subscription_billing", label: "Subscription & Billing", description: "Plans, renewals, and invoices" },
  { value: "payments",             label: "Payments",               description: "Failed, duplicate, or missing payments" },
  { value: "technical_issue",      label: "Technical Issue",        description: "Errors, crashes, and unexpected behaviour" },
  { value: "mobile_app",           label: "Mobile App",             description: "Android and iOS app problems" },
  { value: "security_privacy",     label: "Security & Privacy",     description: "Account security and data requests" },
  { value: "feature_request",      label: "Feature Request",        description: "Ideas and improvements" },
  { value: "other",                label: "Other",                  description: "Anything else" },
];

const SUPPORT_CATEGORY_VALUES = SUPPORT_CATEGORIES.map((item) => item.value);

// Categories where a slow reply costs the customer money. New tickets in these
// categories are floored at "high" regardless of what the user selected.
const MONEY_CATEGORIES = new Set(["payments", "subscription_billing"]);

// ─── Status ──────────────────────────────────────────────────────────────────
const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_on_user",
  "pending",
  "resolved",
  "closed",
];

const TICKET_STATUS_LABELS = {
  open:            "Open",
  in_progress:     "In Progress",
  waiting_on_user: "Waiting for You",
  pending:         "Pending",
  resolved:        "Resolved",
  closed:          "Closed",
};

// Statuses where the customer is waiting on us.
const ACTIVE_STATUSES = ["open", "in_progress", "pending"];
// Statuses a ticket can hold without being finished.
const UNRESOLVED_STATUSES = ["open", "in_progress", "waiting_on_user", "pending"];
const TERMINAL_STATUSES = ["resolved", "closed"];

/**
 * Valid transitions, keyed by the status being left.
 *
 * The rules that matter:
 *   - `closed` is terminal for customers. Only staff may reopen it, so an
 *     accidental or forged API call cannot silently revive a closed ticket.
 *   - `resolved` -> `open` is the reopen path, available to the customer for
 *     REOPEN_WINDOW_DAYS after resolution.
 *   - Every transition is ALSO enforced inside the Mongo update predicate, so
 *     two agents racing on the same ticket cannot both win.
 */
const STATUS_TRANSITIONS = {
  open:            ["in_progress", "waiting_on_user", "pending", "resolved", "closed"],
  in_progress:     ["open", "waiting_on_user", "pending", "resolved", "closed"],
  waiting_on_user: ["open", "in_progress", "pending", "resolved", "closed"],
  pending:         ["open", "in_progress", "waiting_on_user", "resolved", "closed"],
  resolved:        ["open", "in_progress", "closed"],
  closed:          ["open", "in_progress"],
};

// Transitions only staff may perform. A customer replying to a resolved ticket
// reopens it (a system transition, not a user-chosen one), but nobody outside
// the support team may drag a closed ticket back into the queue.
const STAFF_ONLY_TRANSITIONS = new Set(["closed->open", "closed->in_progress"]);

function canTransition(from, to, { actorRole = "agent" } = {}) {
  if (from === to) return false;
  if (!TICKET_STATUSES.includes(to)) return false;
  const allowed = STATUS_TRANSITIONS[from];
  if (!Array.isArray(allowed) || !allowed.includes(to)) return false;
  if (actorRole === "user" && STAFF_ONLY_TRANSITIONS.has(`${from}->${to}`)) return false;
  return true;
}

// ─── Priority ────────────────────────────────────────────────────────────────
const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"];
// "urgent" is staff-only. Without that split every ticket is urgent and the
// field stops carrying information.
const USER_SELECTABLE_PRIORITIES = ["low", "normal", "high"];
const PRIORITY_RANK = { low: 0, normal: 1, high: 2, urgent: 3 };

/**
 * Normalize a customer-submitted priority. Anything unknown falls back to
 * normal, and "urgent" is downgraded rather than rejected — failing a whole
 * ticket creation over a cosmetic field would be worse than quietly
 * correcting it. Money categories are floored at "high" because a stuck
 * payment is genuinely time-critical.
 */
function normalizeUserPriority(requested, category) {
  const candidate = USER_SELECTABLE_PRIORITIES.includes(requested) ? requested : "normal";
  if (MONEY_CATEGORIES.has(category) && PRIORITY_RANK[candidate] < PRIORITY_RANK.high) {
    return "high";
  }
  return candidate;
}

// ─── Channel ─────────────────────────────────────────────────────────────────
// Where the conversation originated. `portal` is the only value the API
// creates today; the others exist so an inbound email/WhatsApp integration can
// attach to a ticket later without a schema migration.
const TICKET_CHANNELS = ["portal", "email", "whatsapp", "in_app"];

// ─── Messages ────────────────────────────────────────────────────────────────
const MESSAGE_TYPES = ["message", "internal_note", "system_event"];
const MESSAGE_VISIBILITY = ["public", "internal"];
const MESSAGE_AUTHOR_ROLES = ["user", "agent", "system"];

const SYSTEM_EVENT_ACTIONS = [
  "created",
  "status_changed",
  "priority_changed",
  "assigned",
  "unassigned",
  "reassigned",
  "reopened",
  "tags_changed",
];

// ─── Knowledge base ──────────────────────────────────────────────────────────
const ARTICLE_STATUSES = ["draft", "published", "archived"];

// ─── Roles ───────────────────────────────────────────────────────────────────
// Layered on top of Users.role rather than replacing it. `null` means "not
// support staff". Admins hold every capability regardless of supportRole.
const SUPPORT_ROLES = ["agent", "lead"];

const SUPPORT_CAPABILITIES = {
  VIEW_TICKETS:    "support:view_tickets",
  REPLY:           "support:reply",
  INTERNAL_NOTE:   "support:internal_note",
  ASSIGN_SELF:     "support:assign_self",
  REASSIGN:        "support:reassign",
  CHANGE_STATUS:   "support:change_status",
  CHANGE_PRIORITY: "support:change_priority",
  MANAGE_TAGS:     "support:manage_tags",
  VIEW_BILLING:    "support:view_billing",
  MANAGE_KB:       "support:manage_kb",
  MANAGE_AGENTS:   "support:manage_agents",
  DELETE_TICKET:   "support:delete_ticket",
};

const AGENT_CAPABILITIES = [
  SUPPORT_CAPABILITIES.VIEW_TICKETS,
  SUPPORT_CAPABILITIES.REPLY,
  SUPPORT_CAPABILITIES.INTERNAL_NOTE,
  SUPPORT_CAPABILITIES.ASSIGN_SELF,
  SUPPORT_CAPABILITIES.CHANGE_STATUS,
  SUPPORT_CAPABILITIES.CHANGE_PRIORITY,
  SUPPORT_CAPABILITIES.MANAGE_TAGS,
];

const LEAD_CAPABILITIES = [
  ...AGENT_CAPABILITIES,
  SUPPORT_CAPABILITIES.REASSIGN,
  SUPPORT_CAPABILITIES.VIEW_BILLING,
  SUPPORT_CAPABILITIES.MANAGE_KB,
];

const ADMIN_CAPABILITIES = [
  ...LEAD_CAPABILITIES,
  SUPPORT_CAPABILITIES.MANAGE_AGENTS,
  SUPPORT_CAPABILITIES.DELETE_TICKET,
];

/**
 * Resolve what a staff member may do. Takes the lean user object supportAuth
 * just loaded, so the answer always reflects CURRENT database state — a
 * revoked agent loses access on their very next request.
 */
function resolveCapabilities(user) {
  if (!user) return [];
  if (user.role === "admin") return [...ADMIN_CAPABILITIES];
  if (user.supportRole === "lead") return [...LEAD_CAPABILITIES];
  if (user.supportRole === "agent") return [...AGENT_CAPABILITIES];
  return [];
}

function hasCapability(user, capability) {
  return resolveCapabilities(user).includes(capability);
}

function isSupportStaff(user) {
  return Boolean(user && (user.role === "admin" || SUPPORT_ROLES.includes(user.supportRole)));
}

// ─── Tags ────────────────────────────────────────────────────────────────────
// Free-text tags become a mess and a search liability. A fixed allowlist keeps
// the filter UI honest; extending it is a one-line change here.
const TICKET_TAGS = [
  "refund",
  "duplicate_charge",
  "bug",
  "data_loss",
  "cannot_login",
  "ocr_failure",
  "feature_idea",
  "vip",
  "escalated",
  "awaiting_third_party",
  "documentation",
  "spam",
];

const MAX_TAGS_PER_TICKET = 10;

// ─── Business rules ──────────────────────────────────────────────────────────
// A customer may reopen a resolved ticket within this window; after it the
// ticket auto-closes and they start a fresh one. Long enough to cover a
// weekend plus a holiday, short enough that threads do not live forever.
const REOPEN_WINDOW_DAYS = 7;
// Resolved tickets older than this auto-close. Same number on purpose: the
// moment reopening stops being allowed is the moment the ticket is done.
const AUTO_CLOSE_AFTER_DAYS = REOPEN_WINDOW_DAYS;
// How many times one ticket may bounce back before staff should split it into
// a fresh case. Surfaced to agents rather than enforced as a hard block.
const REOPEN_SOFT_LIMIT = 3;

// Field limits, shared by the models and the Zod schemas so they cannot drift.
const LIMITS = {
  subjectMin: 5,
  subjectMax: 200,
  messageMin: 1,
  messageMax: 10000,
  resolutionMax: 4000,
  articleTitleMax: 200,
  articleExcerptMax: 400,
  articleBodyMax: 50000,
  articleSlugMax: 120,
  feedbackCommentMax: 1000,
  satisfactionCommentMax: 1000,
};

module.exports = {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_VALUES,
  MONEY_CATEGORIES,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  ACTIVE_STATUSES,
  UNRESOLVED_STATUSES,
  TERMINAL_STATUSES,
  STATUS_TRANSITIONS,
  STAFF_ONLY_TRANSITIONS,
  canTransition,
  TICKET_PRIORITIES,
  USER_SELECTABLE_PRIORITIES,
  PRIORITY_RANK,
  normalizeUserPriority,
  TICKET_CHANNELS,
  MESSAGE_TYPES,
  MESSAGE_VISIBILITY,
  MESSAGE_AUTHOR_ROLES,
  SYSTEM_EVENT_ACTIONS,
  ARTICLE_STATUSES,
  SUPPORT_ROLES,
  SUPPORT_CAPABILITIES,
  resolveCapabilities,
  hasCapability,
  isSupportStaff,
  TICKET_TAGS,
  MAX_TAGS_PER_TICKET,
  REOPEN_WINDOW_DAYS,
  AUTO_CLOSE_AFTER_DAYS,
  REOPEN_SOFT_LIMIT,
  LIMITS,
};
