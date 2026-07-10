const { GoogleGenerativeAI } = require("@google/generative-ai");
const CoachConversation = require("../models/CoachConversation");
const CoachMessage = require("../models/CoachMessage");
const coachContextService = require("./coachContextService");
const coachPromptService = require("./coachPromptService");
const coachQuotaService = require("./coachQuotaService");
const { isPremium } = require("../utils/premium");
const { appConfig } = require("../config");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");

const HISTORY_TURNS = 10;
const MAX_USER_QUESTION_CHARS = 1200;

function getGeminiModel() {
  if (!appConfig.ai.geminiApiKey) {
    throw new ApiError(503, "Coach AI is not configured", "COACH_UNAVAILABLE");
  }
  const genAI = new GoogleGenerativeAI(appConfig.ai.geminiApiKey);
  return genAI.getGenerativeModel({ model: appConfig.ai.geminiModel });
}

function previewOf(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

async function recordAssistantMessage({ conversationId, userId, content, status, error, model, latencyMs, contextDigest, streamed }) {
  return CoachMessage.create({
    conversation: conversationId,
    user: userId,
    role: "assistant",
    content,
    status,
    error: error || "",
    model: model || "",
    latencyMs: latencyMs || 0,
    streamed: Boolean(streamed),
    contextDigest: contextDigest || {},
  });
}

async function loadHistory(conversationId, { limit = HISTORY_TURNS } = {}) {
  // Last N turns of either role, chronological.
  const messages = await CoachMessage.find({ conversation: conversationId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit * 2)
    .lean();
  return messages.reverse();
}

async function ensureConversation({ user, conversationId, anchor, market }) {
  if (conversationId) {
    const convo = await CoachConversation.findOne({
      _id: conversationId,
      user: user._id,
      deletedAt: null,
    });
    if (!convo) throw new ApiError(404, "Conversation not found", "COACH_NOT_FOUND");
    return convo;
  }
  return CoachConversation.create({
    user: user._id,
    anchor: anchor || { kind: "freeform" },
    market: market || "any",
  });
}

function deriveTitle({ existingTitle, anchor, firstUserMessage }) {
  if (existingTitle) return existingTitle;
  if (anchor?.label) return anchor.label.slice(0, 80);
  const seed = String(firstUserMessage || "").trim();
  if (!seed) return "Coach session";
  return seed.length > 60 ? `${seed.slice(0, 57)}…` : seed;
}

async function persistUserMessage({ conversation, user, content }) {
  const trimmed = String(content || "").trim().slice(0, MAX_USER_QUESTION_CHARS);
  if (!trimmed) throw new ApiError(400, "Message is empty", "VALIDATION_ERROR");
  return CoachMessage.create({
    conversation: conversation._id,
    user: user._id,
    role: "user",
    content: trimmed,
    status: "complete",
  });
}

async function bumpConversation(conversation, lastMessagePreview) {
  await CoachConversation.updateOne(
    { _id: conversation._id },
    {
      $inc: { messageCount: 1 },
      $set: {
        lastMessageAt: new Date(),
        lastMessagePreview: previewOf(lastMessagePreview),
        ...(conversation.title ? {} : {
          title: deriveTitle({ existingTitle: "", anchor: conversation.anchor, firstUserMessage: lastMessagePreview }),
        }),
      },
    }
  );
}

// Quota check + atomic increment. Premium users skip the cap but still
// increment so the dashboard can show "questions this week".
async function enforceAndCountQuota(user) {
  const quota = await coachQuotaService.getQuota(user);
  if (!quota.premium && quota.remaining <= 0) {
    throw new ApiError(
      402,
      "You've used your 5 free coach questions for this week. Upgrade for unlimited coaching.",
      "COACH_QUOTA_EXHAUSTED",
      { quota }
    );
  }
  const newCount = await coachQuotaService.incrementUsage(user);
  // Defensive second check: if the increment took us past the limit because
  // a parallel request also passed the initial getQuota, deny this one.
  if (!quota.premium && newCount > coachQuotaService.FREE_WEEKLY_LIMIT) {
    throw new ApiError(
      402,
      "Weekly coach question quota reached.",
      "COACH_QUOTA_EXHAUSTED",
      { quota: { ...quota, used: newCount, remaining: 0 } }
    );
  }
  return { quota, newCount };
}

// Streaming entry point. The controller wraps this with an SSE response; on
// each chunk we both forward the token AND accumulate into `fullText` so the
// final assistant message persists exactly what the user saw.
async function streamCompletion({ conversation, user, history, userMessage, onChunk, onMeta }) {
  const started = Date.now();
  const { context, digest, cached } = await coachContextService.getContext({
    userId: user._id,
    market: conversation.market === "any" ? "Forex" : conversation.market,
  });

  const input = coachPromptService.buildModelInput({
    context,
    anchor: conversation.anchor,
    history,
    nextUserMessage: userMessage.content,
  });

  if (onMeta) {
    onMeta({
      cached,
      sourceHash: digest.sourceHash,
      contextBytes: digest.bytes,
      tradeCount: digest.tradeCount,
      reflectionDays: digest.reflectionDays,
      hasWeeklyReport: digest.hasWeeklyReport,
    });
  }

  const model = getGeminiModel();
  let fullText = "";

  try {
    const result = await model.generateContentStream({
      systemInstruction: input.systemInstruction,
      contents: input.contents,
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 700,
      },
    });

    for await (const chunk of result.stream) {
      const piece = typeof chunk.text === "function" ? chunk.text() : "";
      if (piece) {
        fullText += piece;
        if (onChunk) onChunk(piece);
      }
    }

    const persisted = await recordAssistantMessage({
      conversationId: conversation._id,
      userId: user._id,
      content: fullText.trim(),
      status: fullText ? "complete" : "error",
      error: fullText ? "" : "empty_response",
      model: appConfig.ai.geminiModel,
      latencyMs: Date.now() - started,
      streamed: true,
      contextDigest: digest,
    });

    await bumpConversation(conversation, fullText || userMessage.content);

    return { messageId: String(persisted._id), latencyMs: Date.now() - started };
  } catch (error) {
    logger.warn("COACH_STREAM_FAILED", {
      userId: String(user._id),
      conversationId: String(conversation._id),
      error: error?.message,
    });

    // Always persist a failure marker so the thread shows the user something
    // went wrong instead of silently truncating.
    await recordAssistantMessage({
      conversationId: conversation._id,
      userId: user._id,
      content: fullText.trim() || "I hit an error while reading your data. Try again in a moment.",
      status: "error",
      error: error?.message || "unknown",
      model: appConfig.ai.geminiModel,
      latencyMs: Date.now() - started,
      streamed: true,
      contextDigest: digest,
    });

    throw new ApiError(502, "Coach response failed", "COACH_STREAM_ERROR");
  }
}

module.exports = {
  HISTORY_TURNS,
  MAX_USER_QUESTION_CHARS,
  ensureConversation,
  enforceAndCountQuota,
  loadHistory,
  persistUserMessage,
  streamCompletion,
};
