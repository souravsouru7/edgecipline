"use strict";

// Coach history "summary" mode (COACH_HISTORY_MODE=summary, off by default).
//
// Instead of resending the last 10 turns, the model gets the last 4 turns
// verbatim plus a running summary of the older ones. Nothing is dropped
// without being summarized first: any older message the summary does not yet
// cover is still sent verbatim. The summary is refreshed after a reply, in
// the background, only once at least 4 older messages are waiting to be folded in.

const { GoogleGenerativeAI } = require("@google/generative-ai");
const CoachConversation = require("../models/CoachConversation");
const CoachMessage = require("../models/CoachMessage");
const { appConfig } = require("../config");
const { client: redis, isRedisReady } = require("../config/redis");
const { guardedCall } = require("../utils/geminiCircuit");
const { modelFor, withThinkingBudget } = require("../utils/geminiConfig");
const { logger } = require("../utils/logger");

const RECENT_TURNS = 4;
const RECENT_MESSAGES = RECENT_TURNS * 2;
const MIN_MESSAGES_TO_FOLD = 4;
const MAX_SUMMARY_CHARS = 3000;
const MAX_FOLD_MESSAGES = 40;

function isEnabled() {
  return appConfig.ai.coachHistoryMode === "summary";
}

const time = (m) => new Date(m.createdAt || 0).getTime();

// Picks what goes to the model. `history` is chronological (oldest first).
function selectWindow(history, conversation) {
  const list = Array.isArray(history) ? history : [];
  const summary = String(conversation?.summary || "").trim();
  const coveredUntil = conversation?.summarizedThroughAt ? new Date(conversation.summarizedThroughAt).getTime() : 0;
  const cut = Math.max(0, list.length - RECENT_MESSAGES);
  const recent = list.filter((m, i) => i >= cut || (summary ? time(m) > coveredUntil : true));
  return { recent, summary };
}

function buildSummaryPrompt({ previousSummary, messages }) {
  const transcript = messages
    .map((m) => `${m.role === "assistant" ? "Coach" : "Trader"}: ${String(m.content || "").slice(0, 2000)}`)
    .join("\n\n");
  return `You maintain the running memory of a coaching conversation between a trader and their trading coach.
Update the summary so a coach who never saw the earlier messages can continue seamlessly.

KEEP, in specific terms (quote exact numbers, rule names, symbols and dates):
- Trading rules the trader stated or agreed to, and any rule they admitted breaking.
- Mistakes and behavioural patterns discussed (e.g. revenge trading, FOMO, moving stops).
- Decisions, commitments and action items the coach suggested or the trader accepted.
- Emotional context the trader shared (stress, confidence, frustration) and what triggered it.
- Questions that are still open.
DROP pleasantries and anything repeated. Do not invent anything. Do not give advice.
Write plain sentences or short "- " bullet lines, at most 250 words.

Previous summary:
${previousSummary || "(none yet)"}

New messages to fold in:
${transcript}

Updated summary:`;
}

async function acquireLock(conversationId) {
  if (!isRedisReady()) return true;
  try {
    return (await redis.set(`coach:summary:lock:${conversationId}`, "1", "NX", "EX", 120)) === "OK";
  } catch {
    return true;
  }
}

// Fire-and-forget after a successful reply. Never throws.
async function refreshIfNeeded({ conversation, userId }) {
  if (!isEnabled() || !appConfig.ai.geminiApiKey || !conversation?._id) return null;
  try {
    const coveredUntil = conversation.summarizedThroughAt || new Date(0);
    const pending = await CoachMessage.find({
      conversation: conversation._id,
      superseded: { $ne: true },
      status: "complete",
      createdAt: { $gt: coveredUntil },
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(MAX_FOLD_MESSAGES + RECENT_MESSAGES)
      .lean();

    const foldable = pending.slice(0, Math.max(0, pending.length - RECENT_MESSAGES));
    if (foldable.length < MIN_MESSAGES_TO_FOLD) return null;
    if (!(await acquireLock(conversation._id))) return null;

    const modelName = modelFor("coach_summary");
    const model = new GoogleGenerativeAI(appConfig.ai.geminiApiKey).getGenerativeModel({ model: modelName });
    const result = await guardedCall({
      feature: "coach_summary",
      userId,
      model: modelName,
      operationId: String(conversation._id),
      call: () => model.generateContent({
        contents: [{ role: "user", parts: [{ text: buildSummaryPrompt({ previousSummary: conversation.summary, messages: foldable }) }] }],
        generationConfig: withThinkingBudget(modelName, { temperature: 0.1, maxOutputTokens: 700 }, 0),
      }),
    });
    const text = String(result?.response?.text?.() || "").trim().slice(0, MAX_SUMMARY_CHARS);
    if (!text) return null;

    const through = foldable[foldable.length - 1].createdAt;
    await CoachConversation.updateOne(
      { _id: conversation._id },
      { $set: { summary: text, summarizedThroughAt: through, summaryModel: modelName } }
    );
    return { summary: text, summarizedThroughAt: through };
  } catch (error) {
    logger.warn("COACH_SUMMARY_REFRESH_FAILED", { conversationId: String(conversation?._id), error: error?.message });
    return null;
  }
}

module.exports = {
  MIN_MESSAGES_TO_FOLD,
  RECENT_MESSAGES,
  RECENT_TURNS,
  buildSummaryPrompt,
  isEnabled,
  refreshIfNeeded,
  selectWindow,
};
