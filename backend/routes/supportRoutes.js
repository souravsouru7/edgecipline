const express = require("express");

const router = express.Router();

const support = require("../controllers/supportController");
const { protect, optionalProtect } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const { uploadSupportAttachments } = require("../middleware/upload.middleware");
const {
  supportTicketCreateRateLimiter,
  supportMessageRateLimiter,
  supportSearchRateLimiter,
  supportArticleFeedbackRateLimiter,
  supportPollRateLimiter,
  supportAttachmentRateLimiter,
} = require("../middleware/rateLimiter");
const { publicSchemas, userTicketSchemas } = require("../validation/supportSchemas");

// ─── Public ──────────────────────────────────────────────────────────────────
//
// These four routes must serve a visitor with NO session. /support is submitted
// to Google Play and App Store Connect as the app's support URL, and both open
// it cold in a browser with no cookies — a reviewer bounced to a login screen
// reads it as "the URL does not work" and fails the submission. See
// AuthSessionBootstrap PUBLIC_PATH_PREFIXES and scripts/check-public-routes.mjs.

router.get("/config", support.getConfig);
router.get("/home", supportSearchRateLimiter, support.getHome);

// The chat widget. Public and stateless — it holds no conversation server-side,
// so there is nothing to leak and nothing to clean up. Shares the search
// limiter because it does the same work: one knowledge-base lookup.
router.post(
  "/assistant",
  supportSearchRateLimiter,
  validateRequest(publicSchemas.assistant),
  support.askAssistant
);

router.get(
  "/articles",
  supportSearchRateLimiter,
  validateRequest(publicSchemas.listArticles),
  support.listArticles
);

router.get(
  "/articles/:slug",
  supportSearchRateLimiter,
  validateRequest(publicSchemas.getArticle),
  support.getArticle
);

router.post(
  "/articles/:slug/feedback",
  supportArticleFeedbackRateLimiter,
  // Optional, not required: an anonymous reader may vote (keyed on a salted
  // fingerprint), and a signed-in reader is keyed on their account instead.
  optionalProtect,
  validateRequest(publicSchemas.articleFeedback),
  support.submitArticleFeedback
);

// ─── Customer tickets ────────────────────────────────────────────────────────

// Declared BEFORE "/tickets/:id" — Express matches in order, and without this
// a request for /tickets/duplicates would be parsed as a ticket id and
// rejected by the ObjectId validator.
router.get(
  "/tickets/duplicates",
  protect,
  validateRequest(userTicketSchemas.duplicates),
  support.getDuplicateCandidates
);

router.get(
  "/tickets/suggestions",
  protect,
  supportSearchRateLimiter,
  validateRequest(userTicketSchemas.suggestArticles),
  support.getArticleSuggestions
);

router.post(
  "/tickets",
  protect,
  supportTicketCreateRateLimiter,
  // Upload runs before validation so a rejected body still cleans up whatever
  // reached Cloudinary — validateRequest destroys req.uploadedImages on failure.
  uploadSupportAttachments,
  validateRequest(userTicketSchemas.create),
  support.createTicket
);

router.get(
  "/tickets",
  protect,
  validateRequest(userTicketSchemas.list),
  support.listMyTickets
);

router.get(
  "/tickets/:id",
  protect,
  supportPollRateLimiter,
  validateRequest(userTicketSchemas.getById),
  support.getMyTicket
);

router.get(
  "/tickets/:id/messages",
  protect,
  supportPollRateLimiter,
  validateRequest(userTicketSchemas.listMessages),
  support.listMyTicketMessages
);

router.post(
  "/tickets/:id/messages",
  protect,
  supportMessageRateLimiter,
  uploadSupportAttachments,
  validateRequest(userTicketSchemas.reply),
  support.replyToMyTicket
);

router.post(
  "/tickets/:id/reopen",
  protect,
  supportMessageRateLimiter,
  validateRequest(userTicketSchemas.reopen),
  support.reopenMyTicket
);

router.post(
  "/tickets/:id/satisfaction",
  protect,
  validateRequest(userTicketSchemas.satisfaction),
  support.rateMyTicket
);

// ─── Attachments ─────────────────────────────────────────────────────────────
//
// Authorised on EVERY fetch, not once when the ticket was read. See
// supportController.getMyAttachment for the two checks it performs.
router.get(
  "/attachments/:messageId/:index",
  protect,
  supportAttachmentRateLimiter,
  validateRequest(userTicketSchemas.attachment),
  support.getMyAttachment
);

module.exports = router;
