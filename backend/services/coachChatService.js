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

// A healthy coach reply lands in ~5s. Without an upper bound a hung upstream
// connection would keep the SSE pipe heartbeating forever without ever
// answering, and the browser would sit on a spinner until the user gave up.
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_STREAM_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 750;
// Google's own transient failures: rate limit, overload, gateway blips.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `thinkingConfig` is a 2.5+ parameter. Older models reject the field with a
// 400, so a rollback of GEMINI_MODEL would otherwise take the whole feature
// down rather than just losing the thinking cap.
function supportsThinkingConfig(modelName) {
  const match = /gemini-(\d+)(?:\.(\d+))?/.exec(String(modelName || ""));
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  return major > 2 || (major === 2 && minor >= 5);
}

// gemini-2.5-* charges its internal "thinking" tokens against maxOutputTokens.
// At 700 the model routinely spent ~670 of them thinking and returned a reply
// truncated mid-sentence (finishReason MAX_TOKENS), so bound the thinking and
// leave real room for the answer.
function buildGenerationConfig(modelName) {
  const config = { temperature: 0.35, maxOutputTokens: 2048 };
  if (supportsThinkingConfig(modelName)) {
    config.thinkingConfig = { thinkingBudget: 512 };
  }
  return config;
}

function getGeminiModel() {
  if (!appConfig.ai.geminiApiKey) {
    throw new ApiError(503, "Coach AI is not configured", "COACH_UNAVAILABLE");
  }
  const genAI = new GoogleGenerativeAI(appConfig.ai.geminiApiKey);
  return genAI.getGenerativeModel(
    { model: appConfig.ai.geminiModel },
    { timeout: REQUEST_TIMEOUT_MS }
  );
}

// Undici surfaces connection-level failures as a bare "fetch failed", which is
// what killed live coach replies even though the API itself was healthy.
// Google's 429/5xx are just as transient and just as worth one more attempt.
function isRetryableError(error) {
  if (RETRYABLE_STATUS.has(error?.status)) return true;
  const message = String(error?.message || "");
  if (/\[(429|500|502|503|504)\s/.test(message)) return true;
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network error/i.test(message);
}

// The SDK puts the HTTP status on the error for most failures and only in the
// "[403 Forbidden] ..." message prefix for others, so check both.
function statusOf(error) {
  const direct = Number(error?.status ?? error?.statusCode);
  if (Number.isFinite(direct) && direct >= 400) return direct;
  const match = /\[(\d{3})\s/.exec(String(error?.message || ""));
  return match ? Number(match[1]) : 0;
}

// Failures that are our fault, not the trader's. These refund the quota slot
// and are worth a retry button; everything else is not.
const REFUNDABLE_CODES = new Set([
  "COACH_UNAVAILABLE",
  "COACH_BUSY",
  "COACH_STREAM_ERROR",
  "COACH_EMPTY_RESPONSE",
]);

// Operator-actionable failures: a dead API key or a model name that no longer
// exists is a config problem that will break every request until someone fixes
// it, so it must page louder than a one-off upstream blip.
const ALERTING_CODES = new Set(["COACH_UNAVAILABLE"]);

// A credential or billing problem reads identically to the trader whether it's
// a revoked key, a disabled project, or a model that was retired — there is
// nothing they can do, so say so without leaking which it was.
const UNAVAILABLE_MESSAGE = "Coach is unavailable right now. We're on it.";

// Turn an upstream failure into something the trader can act on. Everything
// used to surface as a flat "Coach response failed", which told them nothing
// about whether to retry, rephrase, or wait.
function describeFailure(error) {
  if (error instanceof ApiError) return error;
  const message = String(error?.message || "");
  const status = statusOf(error);

  if (/SAFETY|RECITATION|blocked/i.test(message)) {
    return new ApiError(502, "Coach couldn't answer that one. Try rephrasing the question.", "COACH_BLOCKED");
  }
  // Checked before the hard-status branches: 429 and 5xx are transient.
  if (isRetryableError(error)) {
    return new ApiError(503, "Coach is busy right now. Try again in a moment.", "COACH_BUSY");
  }
  // 401/403: revoked or restricted key, or a project denied access to the API.
  if (status === 401 || status === 403 ||
      /API[_ ]?key|permission denied|denied access|PERMISSION_DENIED|UNAUTHENTICATED/i.test(message)) {
    return new ApiError(503, UNAVAILABLE_MESSAGE, "COACH_UNAVAILABLE", null, true);
  }
  // 404: the configured model name was retired or never existed.
  if (status === 404 || /no longer available|is not found for API version|NOT_FOUND/i.test(message)) {
    return new ApiError(503, UNAVAILABLE_MESSAGE, "COACH_UNAVAILABLE", null, true);
  }
  // 400: we built a request this model won't accept. The trader's wording is
  // the only part they control, so point at that.
  if (status === 400 || /invalid[_ ]argument|INVALID_ARGUMENT/i.test(message)) {
    return new ApiError(400, "Coach couldn't process that question. Try rephrasing it.", "COACH_BAD_REQUEST");
  }
  return new ApiError(502, "Coach response failed", "COACH_STREAM_ERROR");
}

function isRefundable(errorCode) {
  return REFUNDABLE_CODES.has(String(errorCode || ""));
}

// Clear the quota charge for a question that never got an answer. Mongo is the
// authority for the weekly count, so flipping `billable` is what actually
// refunds it; the Redis decrement just stops the cached number reading one too
// high until the key expires.
async function refundTurn({ user, userMessageId }) {
  if (!userMessageId) return false;
  try {
    await CoachMessage.updateOne({ _id: userMessageId, user: user._id }, { $set: { billable: false } });
    await coachQuotaService.refundUsage(user);
    return true;
  } catch (error) {
    // A failed refund must never mask the original failure the caller is
    // reporting, so log and move on.
    logger.warn("COACH_QUOTA_REFUND_FAILED", {
      userId: String(user._id),
      userMessageId: String(userMessageId),
      error: error?.message,
    });
    return false;
  }
}

// Retiring the failed pair behind a retry. They stay in the collection for
// debugging but drop out of the thread, the model's history window, and the
// quota count.
async function supersedeTurn({ user, conversationId, userMessageId }) {
  if (!userMessageId) return false;
  const original = await CoachMessage.findOne({
    _id: userMessageId,
    user: user._id,
    conversation: conversationId,
  }).lean();
  if (!original) return false;

  await CoachMessage.updateMany(
    {
      conversation: conversationId,
      user: user._id,
      createdAt: { $gte: original.createdAt },
      // Only the failed tail of the thread is retired. A successful turn that
      // happened to come later must never be swept up by a retry.
      $or: [{ _id: original._id }, { role: "assistant", status: "error" }],
    },
    { $set: { superseded: true, billable: false } }
  );
  return true;
}

// One retry, and only when the failure happened before any token reached the
// client — replaying a partially streamed reply would duplicate visible text.
async function streamWithRetry({ model, request, onChunk, onRetry }) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_STREAM_ATTEMPTS; attempt += 1) {
    let text = "";
    try {
      const result = await model.generateContentStream(request);
      for await (const chunk of result.stream) {
        const piece = typeof chunk.text === "function" ? chunk.text() : "";
        if (!piece) continue;
        text += piece;
        if (onChunk) onChunk(piece);
      }
      return text;
    } catch (error) {
      lastError = error;
      if (text || attempt === MAX_STREAM_ATTEMPTS || !isRetryableError(error)) {
        error.partialText = text;
        throw error;
      }
      if (onRetry) onRetry(error);
      await delay(RETRY_BACKOFF_MS * attempt);
    }
  }
  throw lastError;
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
  const messages = await CoachMessage.find({
    conversation: conversationId,
    superseded: { $ne: true },
  })
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
  // "any" is the default for a thread opened before we knew which book it was
  // about. Resolving it (rather than defaulting to Forex) is what keeps an
  // Indian-market trader from being coached on an empty Forex snapshot.
  const market = await coachContextService.resolveMarket({
    market: conversation.market,
    user,
  });
  if (conversation.market !== market) {
    // Pin the thread to the resolved market so later turns stay consistent.
    conversation.market = market;
    await CoachConversation.updateOne({ _id: conversation._id }, { $set: { market } });
  }

  const { context, digest, cached } = await coachContextService.getContext({
    userId: user._id,
    market,
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
      market,
    });
  }

  const model = getGeminiModel();
  let fullText = "";

  try {
    fullText = await streamWithRetry({
      model,
      request: {
        systemInstruction: input.systemInstruction,
        contents: input.contents,
        generationConfig: buildGenerationConfig(appConfig.ai.geminiModel),
      },
      onChunk,
      onRetry: (error) => {
        logger.warn("COACH_STREAM_RETRY", {
          userId: String(user._id),
          conversationId: String(conversation._id),
          error: error?.message,
        });
      },
    });

    // A blocked or empty completion used to resolve as "done", leaving the
    // trader watching an assistant bubble that never filled in. Fail loudly
    // instead so the UI shows a retry affordance.
    if (!fullText.trim()) {
      throw new ApiError(502, "Coach returned an empty response. Try asking again.", "COACH_EMPTY_RESPONSE");
    }

    const persisted = await recordAssistantMessage({
      conversationId: conversation._id,
      userId: user._id,
      content: fullText.trim(),
      status: "complete",
      error: "",
      model: appConfig.ai.geminiModel,
      latencyMs: Date.now() - started,
      streamed: true,
      contextDigest: digest,
    });

    await bumpConversation(conversation, fullText || userMessage.content);

    return { messageId: String(persisted._id), latencyMs: Date.now() - started };
  } catch (error) {
    // Only a stream failure carries partial text; a later persistence failure
    // must not discard what the client already saw.
    if (typeof error?.partialText === "string") fullText = error.partialText;

    const described = describeFailure(error);
    // The raw upstream text never reaches the client, so this log is the only
    // place the real cause ("[403] project denied", a retired model name) is
    // recorded. Config failures break every request until an operator acts, so
    // they go out at error level where alerting can see them.
    const logFailure = ALERTING_CODES.has(described.errorCode) ? logger.error : logger.warn;
    logFailure.call(logger, "COACH_STREAM_FAILED", {
      userId: String(user._id),
      conversationId: String(conversation._id),
      market,
      model: appConfig.ai.geminiModel,
      errorCode: described.errorCode,
      status: statusOf(error),
      error: error?.message,
    });

    // Always persist a failure marker so the thread shows the user something
    // went wrong instead of silently truncating.
    await recordAssistantMessage({
      conversationId: conversation._id,
      userId: user._id,
      content: fullText.trim() || described.message,
      status: "error",
      error: `${described.errorCode}: ${error?.message || "unknown"}`,
      model: appConfig.ai.geminiModel,
      latencyMs: Date.now() - started,
      streamed: true,
      contextDigest: digest,
    });

    throw described;
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
  isRefundable,
  refundTurn,
  supersedeTurn,
  ALERTING_CODES,
  // Exported for testing
  buildGenerationConfig,
  describeFailure,
  isRetryableError,
  statusOf,
  streamWithRetry,
  supportsThinkingConfig,
};
