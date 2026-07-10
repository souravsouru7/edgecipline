const express = require("express");

const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const { coachChatRateLimiter } = require("../middleware/rateLimiter");
const { coachSchemas } = require("../validation/coachSchemas");
const {
  createConversation,
  deleteConversation,
  getConversation,
  getQuickPrompts,
  getQuota,
  listConversations,
  refreshContext,
  sendMessage,
} = require("../controllers/coachController");

router.get("/quota",         protect, getQuota);
router.get("/quick-prompts", protect, validateRequest(coachSchemas.quickPrompts), getQuickPrompts);
router.post("/refresh-context", protect, refreshContext);

router.get(
  "/conversations",
  protect,
  validateRequest(coachSchemas.listConversations),
  listConversations
);
router.post(
  "/conversations",
  protect,
  validateRequest(coachSchemas.createConversation),
  createConversation
);
router.get(
  "/conversations/:id",
  protect,
  validateRequest(coachSchemas.conversationId),
  getConversation
);
router.delete(
  "/conversations/:id",
  protect,
  validateRequest(coachSchemas.conversationId),
  deleteConversation
);

// The message endpoint streams SSE. The per-user rate limiter sits here so a
// runaway client can't open dozens of long-lived streams in a few seconds.
router.post(
  "/conversations/:id/messages",
  protect,
  coachChatRateLimiter,
  validateRequest(coachSchemas.sendMessage),
  sendMessage
);

module.exports = router;
