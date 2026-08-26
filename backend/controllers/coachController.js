const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const CoachConversation = require("../models/CoachConversation");
const CoachMessage = require("../models/CoachMessage");
const coachChatService = require("../services/coachChatService");
const coachContextService = require("../services/coachContextService");
const coachPromptService = require("../services/coachPromptService");
const coachQuotaService = require("../services/coachQuotaService");
const { logger } = require("../utils/logger");

function sseInit(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Some intermediaries buffer SSE responses unless we hint them off.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

function sseSend(res, event, data) {
  // Multi-line content must split each \n into its own data: row per SSE spec.
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`event: ${event}\n`);
  for (const line of String(payload).split("\n")) {
    res.write(`data: ${line}\n`);
  }
  res.write("\n");
}

function summariseConversation(conversation) {
  return {
    _id: conversation._id,
    title: conversation.title || "Coach session",
    anchor: conversation.anchor || { kind: "freeform" },
    market: conversation.market || "any",
    messageCount: conversation.messageCount || 0,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview || "",
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

exports.getQuota = asyncHandler(async (req, res) => {
  const quota = await coachQuotaService.getQuota(req.user);
  res.json({ quota });
});

exports.getQuickPrompts = asyncHandler(async (req, res) => {
  const anchorKind = req.validated?.query?.anchor || req.query?.anchor || "freeform";
  res.json({ prompts: coachPromptService.getQuickPrompts(anchorKind) });
});

exports.listConversations = asyncHandler(async (req, res) => {
  const limit = req.validated?.query?.limit ?? 20;
  const anchorKind = req.validated?.query?.anchorKind;
  const filter = { user: req.user._id, deletedAt: null };
  if (anchorKind) filter["anchor.kind"] = anchorKind;

  const conversations = await CoachConversation.find(filter)
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  res.json({ conversations: conversations.map(summariseConversation) });
});

exports.getConversation = asyncHandler(async (req, res) => {
  const conversation = await CoachConversation.findOne({
    _id: req.params.id,
    user: req.user._id,
    deletedAt: null,
  }).lean();
  if (!conversation) throw new ApiError(404, "Conversation not found", "COACH_NOT_FOUND");

  const messages = await CoachMessage.find({ conversation: conversation._id })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  res.json({
    conversation: summariseConversation(conversation),
    messages: messages.map((m) => ({
      _id: m._id,
      role: m.role,
      content: m.content,
      status: m.status,
      error: m.error,
      streamed: m.streamed,
      createdAt: m.createdAt,
    })),
  });
});

exports.createConversation = asyncHandler(async (req, res) => {
  const { anchor, market, initialMessage } = req.validated?.body || req.body || {};
  const conversation = await CoachConversation.create({
    user: req.user._id,
    anchor: anchor || { kind: "freeform" },
    market: market || "any",
    title: anchor?.label || "",
  });

  if (initialMessage) {
    await coachChatService.persistUserMessage({
      conversation,
      user: req.user,
      content: initialMessage,
    });
  }

  res.status(201).json({
    conversation: summariseConversation({
      ...conversation.toObject(),
      messageCount: initialMessage ? 1 : 0,
      lastMessageAt: initialMessage ? new Date() : null,
      lastMessagePreview: initialMessage || "",
    }),
  });
});

exports.deleteConversation = asyncHandler(async (req, res) => {
  const conversation = await CoachConversation.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, deletedAt: null },
    { $set: { deletedAt: new Date() } },
    { new: true, lean: true }
  );
  if (!conversation) throw new ApiError(404, "Conversation not found", "COACH_NOT_FOUND");
  res.json({ deleted: true });
});

// SSE message endpoint. The client POSTs the next user question; we stream the
// assistant reply over Server-Sent Events. Falls back to a single JSON
// response when `?stream=false` (used by clients that don't speak SSE — e.g.
// tests and lightweight admin tooling).
exports.sendMessage = asyncHandler(async (req, res) => {
  const { content, stream = true, anchor } = req.validated?.body || req.body || {};
  const conversation = await coachChatService.ensureConversation({
    user: req.user,
    conversationId: req.params.id,
    anchor,
  });

  // Quota enforcement happens BEFORE we open the SSE pipe so the response
  // shape (JSON 402 vs. event-stream 200) is unambiguous.
  let quotaSnapshot;
  try {
    const result = await coachChatService.enforceAndCountQuota(req.user);
    quotaSnapshot = result.quota;
  } catch (error) {
    if (error?.errorCode === "COACH_QUOTA_EXHAUSTED") {
      res.status(402).json({
        success: false,
        error: {
          code: "COACH_QUOTA_EXHAUSTED",
          message: error.message,
          details: error.details,
        },
      });
      return;
    }
    throw error;
  }

  const userMessage = await coachChatService.persistUserMessage({
    conversation,
    user: req.user,
    content,
  });
  await CoachConversation.updateOne(
    { _id: conversation._id },
    {
      $inc: { messageCount: 1 },
      $set: {
        lastMessageAt: new Date(),
        lastMessagePreview: content.slice(0, 200),
      },
    }
  );

  const history = await coachChatService.loadHistory(conversation._id);
  // History already includes the user's new message (persisted above) — strip
  // the latest user turn so it isn't duplicated when we append it to the
  // model input.
  const historyForModel = history.filter((m) => String(m._id) !== String(userMessage._id));

  if (!stream) {
    let buffer = "";
    try {
      const result = await coachChatService.streamCompletion({
        conversation,
        user: req.user,
        history: historyForModel,
        userMessage,
        onChunk: (chunk) => { buffer += chunk; },
      });
      res.json({
        conversationId: conversation._id,
        messageId: result.messageId,
        content: buffer,
        quota: quotaSnapshot,
      });
    } catch (error) {
      logger.warn("COACH_SYNC_REPLY_FAILED", { error: error?.message });
      res.status(error?.statusCode || 502).json({
        success: false,
        error: { code: error?.errorCode || "COACH_STREAM_ERROR", message: error?.message },
      });
    }
    return;
  }

  sseInit(res);
  sseSend(res, "meta", {
    conversationId: String(conversation._id),
    userMessageId: String(userMessage._id),
    quota: quotaSnapshot,
  });

  const heartbeat = setInterval(() => res.write(":\n\n"), 15_000);
  let closed = false;
  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
  });

  try {
    await coachChatService.streamCompletion({
      conversation,
      user: req.user,
      history: historyForModel,
      userMessage,
      onMeta: (meta) => { if (!closed) sseSend(res, "context", meta); },
      onChunk: (chunk) => { if (!closed) sseSend(res, "delta", { text: chunk }); },
    });
    if (!closed) sseSend(res, "done", { ok: true });
  } catch (error) {
    if (!closed) {
      sseSend(res, "error", {
        code:    error?.errorCode || "COACH_STREAM_ERROR",
        message: error?.message || "Coach response failed",
      });
    }
  } finally {
    clearInterval(heartbeat);
    if (!closed) res.end();
  }
});

exports.refreshContext = asyncHandler(async (req, res) => {
  // Context is cached per market; refresh the one the caller is looking at so
  // the "↻" in the chat header rebuilds the snapshot the coach actually reads.
  const market = await coachContextService.resolveMarket({
    market: req.body?.market || req.query?.market,
    user: req.user,
  });
  await coachContextService.invalidate(req.user._id, market);
  const { context, digest } = await coachContextService.getContext({
    userId: req.user._id,
    market,
    forceRefresh: true,
  });
  res.json({
    refreshed: true,
    market,
    digest,
    summary: {
      tradeCount:     context.recentTrades.length,
      reflectionDays: context.reflections.length,
      hasWeeklyReport: Boolean(context.latestWeeklyReport),
    },
  });
});
