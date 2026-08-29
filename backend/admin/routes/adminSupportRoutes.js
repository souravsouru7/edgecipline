const express = require("express");

const router = express.Router();

const adminSupport = require("../../controllers/adminSupportController");
const { supportAuth, requireCapability } = require("../../middleware/supportAuth");
const { validateRequest } = require("../../middleware/validateRequest");
const { uploadSupportAttachments } = require("../../middleware/upload.middleware");
const {
  supportMessageRateLimiter,
  supportPollRateLimiter,
  supportAttachmentRateLimiter,
  adminDestructiveRateLimiter,
} = require("../../middleware/rateLimiter");
const {
  staffTicketSchemas,
  adminArticleSchemas,
  adminAgentSchemas,
  userTicketSchemas,
} = require("../../validation/supportSchemas");
const { SUPPORT_CAPABILITIES } = require("../../constants/support");

// Every route below runs supportAuth, which re-reads the acting user from the
// database and re-derives their capabilities on each request. A revoked agent
// loses access on their very next call rather than when their token expires.
router.use(supportAuth);

// ─── Console ─────────────────────────────────────────────────────────────────

router.get("/me", adminSupport.getMyCapabilities);
router.get("/agents", adminSupport.listAgents);
router.get("/metrics", supportPollRateLimiter, adminSupport.getMetrics);

// ─── Queue ───────────────────────────────────────────────────────────────────

router.get(
  "/tickets",
  supportPollRateLimiter,
  validateRequest(staffTicketSchemas.list),
  adminSupport.listTickets
);

router.get(
  "/tickets/:id",
  supportPollRateLimiter,
  validateRequest(staffTicketSchemas.getById),
  adminSupport.getTicket
);

router.get(
  "/tickets/:id/messages",
  supportPollRateLimiter,
  validateRequest(staffTicketSchemas.listMessages),
  adminSupport.listMessages
);

router.get(
  "/tickets/:id/context",
  validateRequest(staffTicketSchemas.getById),
  adminSupport.getTicketContext
);

router.get(
  "/tickets/:id/audit",
  validateRequest(staffTicketSchemas.auditTrail),
  adminSupport.getAuditTrail
);

// ─── Ticket actions ──────────────────────────────────────────────────────────
//
// The capability each route needs is declared here rather than buried in the
// controller, so the permission model is readable from the route table alone.

router.post(
  "/tickets/:id/messages",
  requireCapability(SUPPORT_CAPABILITIES.REPLY),
  supportMessageRateLimiter,
  uploadSupportAttachments,
  validateRequest(staffTicketSchemas.reply),
  adminSupport.reply
);

// Claiming an unassigned ticket needs only ASSIGN_SELF; taking one from another
// agent additionally requires REASSIGN, which the service checks because only
// it knows whether this is a self-claim.
router.patch(
  "/tickets/:id/assign",
  requireCapability(SUPPORT_CAPABILITIES.ASSIGN_SELF),
  validateRequest(staffTicketSchemas.assign),
  adminSupport.assign
);

router.patch(
  "/tickets/:id/status",
  requireCapability(SUPPORT_CAPABILITIES.CHANGE_STATUS),
  validateRequest(staffTicketSchemas.status),
  adminSupport.changeStatus
);

router.patch(
  "/tickets/:id/priority",
  requireCapability(SUPPORT_CAPABILITIES.CHANGE_PRIORITY),
  validateRequest(staffTicketSchemas.priority),
  adminSupport.changePriority
);

router.patch(
  "/tickets/:id/tags",
  requireCapability(SUPPORT_CAPABILITIES.MANAGE_TAGS),
  validateRequest(staffTicketSchemas.tags),
  adminSupport.updateTags
);

// ─── Attachments ─────────────────────────────────────────────────────────────
//
// Staff may read attachments on internal notes; customers may not. That is why
// this is a separate route from the customer one rather than a branch inside a
// shared handler.
router.get(
  "/attachments/:messageId/:index",
  supportAttachmentRateLimiter,
  validateRequest(userTicketSchemas.attachment),
  adminSupport.getAttachment
);

// ─── Knowledge base ──────────────────────────────────────────────────────────
//
// Authoring is MANAGE_KB — leads and admins. A regular agent can read and link
// articles but cannot rewrite what the whole customer base sees.

router.get(
  "/articles",
  requireCapability(SUPPORT_CAPABILITIES.MANAGE_KB),
  validateRequest(adminArticleSchemas.list),
  adminSupport.listArticles
);

router.get(
  "/articles/:id",
  requireCapability(SUPPORT_CAPABILITIES.MANAGE_KB),
  validateRequest(adminArticleSchemas.getById),
  adminSupport.getArticle
);

router.get(
  "/articles/:id/feedback",
  requireCapability(SUPPORT_CAPABILITIES.MANAGE_KB),
  validateRequest(adminArticleSchemas.feedback),
  adminSupport.getArticleFeedback
);

router.post(
  "/articles",
  requireCapability(SUPPORT_CAPABILITIES.MANAGE_KB),
  validateRequest(adminArticleSchemas.create),
  adminSupport.createArticle
);

router.patch(
  "/articles/:id",
  requireCapability(SUPPORT_CAPABILITIES.MANAGE_KB),
  validateRequest(adminArticleSchemas.update),
  adminSupport.updateArticle
);

router.patch(
  "/articles/:id/status",
  requireCapability(SUPPORT_CAPABILITIES.MANAGE_KB),
  validateRequest(adminArticleSchemas.changeStatus),
  adminSupport.changeArticleStatus
);

router.delete(
  "/articles/:id",
  requireCapability(SUPPORT_CAPABILITIES.MANAGE_KB),
  adminDestructiveRateLimiter,
  validateRequest(adminArticleSchemas.remove),
  adminSupport.deleteArticle
);

// ─── Agent administration ────────────────────────────────────────────────────

router.patch(
  "/agents/:userId",
  requireCapability(SUPPORT_CAPABILITIES.MANAGE_AGENTS),
  adminDestructiveRateLimiter,
  validateRequest(adminAgentSchemas.setRole),
  adminSupport.setAgentRole
);

module.exports = router;
