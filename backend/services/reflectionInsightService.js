const { GoogleGenerativeAI } = require("@google/generative-ai");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

const MAX_INSIGHT_CHARS = 200;

function getClient() {
  const apiKey = appConfig.ai.geminiApiKey;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(apiKey);
}

function truncateInsight(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_INSIGHT_CHARS) return clean;
  // Cut on a word boundary so we don't dangle mid-word.
  const cut = clean.slice(0, MAX_INSIGHT_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

// ─── Deterministic fallback ──────────────────────────────────────────────────
// Runs when (a) GEMINI_API_KEY is missing, (b) the API call fails, or (c) the
// response is empty/unusable. The chosen line should still feel personal —
// pull from the actual reflection fields when present.
function buildFallbackInsight({ reflection, context }) {
  const plan = reflection?.followedPlan;
  const repeat = reflection?.wouldRepeat;
  const mood = Number(reflection?.mood);
  const traded = context?.hadTrades;
  const grossPnL = Number(context?.grossPnL || 0);

  if (!traded) {
    return "No trades today, no damage done — sitting out is its own skill.";
  }
  if (plan === "yes" && grossPnL < 0) {
    return "You followed your plan despite losing today. That is long-term discipline compounding quietly.";
  }
  if (plan === "yes" && grossPnL > 0) {
    return "Plan in, profit out. Same process tomorrow — protect what's working.";
  }
  if (plan === "no" && grossPnL > 0) {
    return "Profitable today, but off-plan. The win is luck if the process isn't repeatable — rebuild tomorrow.";
  }
  if (plan === "partly") {
    return "Half-followed plan is a half-edge. Pin down the one rule you skipped and reload tomorrow.";
  }
  if (repeat === "no") {
    return "You wouldn't repeat today — that honesty is the start of the fix. One concrete change tomorrow.";
  }
  if (Number.isFinite(mood) && mood <= 2) {
    return "Heavy day. Close the laptop, walk it off, and reset before the next session.";
  }
  return "Logged today. Consistent reflection is what turns a journal into an edge.";
}

// ─── Gemini path ─────────────────────────────────────────────────────────────
function buildPrompt({ reflection, context, day }) {
  const summary = {
    day,
    tradeCount: context?.tradeCount ?? 0,
    grossPnL: context?.grossPnL ?? 0,
    followedChecklist: Boolean(context?.followedChecklist),
    followedPlan: reflection?.followedPlan ?? null,
    mood: reflection?.mood ?? null,
    confidence: reflection?.confidence ?? null,
    wouldRepeat: reflection?.wouldRepeat ?? null,
    improvement: reflection?.improvement ?? "",
  };

  return `You are an end-of-day trading coach. The trader just submitted a
30-second reflection. Generate ONE coaching line that:
- Is at most ${MAX_INSIGHT_CHARS} characters.
- Reads as a single sentence (no lists, no markdown, no emojis at the start).
- References ONLY the data below — do not invent trades, P&L, or feelings.
- Highlights a specific behavioural pattern (e.g. "followed plan despite a
  losing day") and ends with one calm action for tomorrow.
- Avoids generic motivation. Be specific, warm, and direct.
- Does NOT give buy/sell signals or price predictions.

Reflection JSON:
${JSON.stringify(summary)}

Return plain text only — no JSON, no quotes around the sentence.`;
}

async function generateInsight({ reflection, context, day }) {
  if (!appConfig.ai.geminiApiKey) {
    return {
      insight: truncateInsight(buildFallbackInsight({ reflection, context })),
      model: "fallback-static",
      fallback: true,
    };
  }

  try {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({ model: appConfig.ai.geminiModel });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: buildPrompt({ reflection, context, day }) }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 200,
      },
    });

    let text = "";
    const cand = result?.response?.candidates?.[0];
    if (cand?.content?.parts) {
      text = cand.content.parts.map((p) => p.text || "").join("");
    } else {
      text = result?.response?.text?.() || "";
    }
    const cleaned = text.replace(/^["'`]+|["'`]+$/g, "").trim();

    if (!cleaned) {
      return {
        insight: truncateInsight(buildFallbackInsight({ reflection, context })),
        model: "fallback-empty-response",
        fallback: true,
      };
    }

    return {
      insight: truncateInsight(cleaned),
      model: appConfig.ai.geminiModel,
      fallback: false,
    };
  } catch (error) {
    logger.warn("REFLECTION_INSIGHT_FAILED", {
      day,
      error: error?.message,
    });
    return {
      insight: truncateInsight(buildFallbackInsight({ reflection, context })),
      model: "fallback-error",
      fallback: true,
    };
  }
}

module.exports = {
  MAX_INSIGHT_CHARS,
  buildFallbackInsight,
  generateInsight,
};
