"use strict";

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const ApiError = require("../utils/ApiError");

const PROMPT_VERSION = "v1";

// Bundles are typically 5–10 KB. Cap well below Gemini's input budget so a
// runaway signals output cannot blow up the prompt.
const DEFAULT_MAX_BUNDLE_BYTES = 100_000;
const configuredMaxBundleBytes = Number(process.env.TRADING_DNA_MAX_BUNDLE_BYTES);
const MAX_BUNDLE_BYTES = Number.isSafeInteger(configuredMaxBundleBytes)
  ? Math.min(500_000, Math.max(1024, configuredMaxBundleBytes))
  : DEFAULT_MAX_BUNDLE_BYTES;

// SDK-level request timeout. Without this, a stalled HTTP socket would pin a
// worker slot until the BullMQ lock duration (180s) expired, then retry the
// same dead request. 75s is comfortably above the observed upper bound of a
// healthy Gemini call (~45s) and well under the worker lock.
const DEFAULT_GEMINI_TIMEOUT_MS = 75_000;
const configuredGeminiTimeoutMs = Number(process.env.TRADING_DNA_GEMINI_TIMEOUT_MS);
const GEMINI_TIMEOUT_MS = Number.isSafeInteger(configuredGeminiTimeoutMs)
  ? Math.min(170_000, Math.max(5_000, configuredGeminiTimeoutMs))
  : DEFAULT_GEMINI_TIMEOUT_MS;

// Constrained archetype list — keeps the LLM from inventing a new label every
// run, which would break consistency across regenerations and across users.
const ARCHETYPES = [
  "Patient Sniper",
  "Momentum Rider",
  "Disciplined Grinder",
  "Volatility Surfer",
  "Reactive Improviser",
  "Range Hunter",
  "Breakout Hunter",
  "Risk Curator",
  "Mean Reversion Specialist",
  "Trend Follower",
  "Scalper",
  "Swing Builder",
];

function getGeminiClient() {
  const apiKey = appConfig.ai.geminiApiKey;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(apiKey);
}

function extractJsonObject(text) {
  if (!text) return null;
  const match = String(text).match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function parseDnaFromRaw(rawText) {
  const text = String(rawText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const candidate = extractJsonObject(text);
    if (!candidate) return null;
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}

function buildFallbackDna(bundle) {
  const sample = bundle?.sample?.totalTrades || 0;
  const lowSample = Boolean(bundle?.sample?.lowSample);
  const bestSetup = bundle?.setups?.best;
  const worstSetup = bundle?.setups?.worst;
  const bestSession = bundle?.sessions?.best;
  const worstSession = bundle?.sessions?.worst;
  const psyScore = bundle?.psychologySummary?.score ?? null;
  const planPct = bundle?.psychologySummary?.planAdherencePct ?? null;
  const sizing = bundle?.positionSizing;
  const recovery = bundle?.recovery;

  const strengths = [];
  if (bestSetup) {
    strengths.push({
      title: `Edge in ${bestSetup.name}`,
      evidence: `${bestSetup.trades} trades on ${bestSetup.name}, ${bestSetup.winRate}% win rate, expectancy ${bestSetup.expectancy}.`,
      metric: `expectancy=${bestSetup.expectancy}`,
    });
  }
  if (bestSession) {
    strengths.push({
      title: `Strongest in ${bestSession.name}`,
      evidence: `${bestSession.trades} trades, ${bestSession.winRate}% win rate, net P&L ${bestSession.netPnL}.`,
      metric: `session_net_pnl=${bestSession.netPnL}`,
    });
  }
  if (recovery?.afterLoss?.sample >= 5 && recovery?.afterLoss?.winRate >= 50) {
    strengths.push({
      title: "Bounces back after losses",
      evidence: `Win rate of ${recovery.afterLoss.winRate}% on ${recovery.afterLoss.sample} trades taken right after a loss.`,
      metric: `post_loss_win_rate=${recovery.afterLoss.winRate}%`,
    });
  }

  const weaknesses = [];
  if (worstSetup && worstSetup.name !== bestSetup?.name) {
    weaknesses.push({
      title: `Underperforming setup: ${worstSetup.name}`,
      evidence: `${worstSetup.trades} trades, ${worstSetup.winRate}% win rate, expectancy ${worstSetup.expectancy}.`,
      metric: `expectancy=${worstSetup.expectancy}`,
    });
  }
  if (worstSession && worstSession.name !== bestSession?.name) {
    weaknesses.push({
      title: `${worstSession.name} drags performance`,
      evidence: `${worstSession.trades} trades, ${worstSession.winRate}% win rate, net P&L ${worstSession.netPnL}.`,
      metric: `session_net_pnl=${worstSession.netPnL}`,
    });
  }
  if (sizing?.oversizeAfterLossPct >= 30 && sizing.postLossSample >= 5) {
    weaknesses.push({
      title: "Sizes up after losses",
      evidence: `${sizing.oversizeAfterLossPct}% of ${sizing.postLossSample} post-loss trades exceed 1.3x median size.`,
      metric: `oversize_after_loss=${sizing.oversizeAfterLossPct}%`,
    });
  }

  let coachSummary;
  if (lowSample) {
    coachSummary = `Only ${sample} trades in this window, so the report is preliminary. Keep logging — your Trading DNA will sharpen as the sample grows.`;
  } else {
    const parts = [];
    if (bestSetup) parts.push(`Your edge is concentrated in ${bestSetup.name}.`);
    if (planPct !== null) parts.push(`Plan adherence sits at ${planPct}%.`);
    if (psyScore !== null) parts.push(`Psychology score is ${psyScore}/100.`);
    parts.push("Focus next on cutting underperforming setups and protecting size after losses.");
    coachSummary = parts.join(" ");
  }

  return {
    identity: {
      archetype: lowSample ? null : "Disciplined Grinder",
      oneLiner: lowSample
        ? "Not enough trades to assign an archetype yet."
        : "A measured trader compounding consistency through repetition.",
      tagline: lowSample ? "Sample too small" : "Stay the course.",
    },
    strengths,
    weaknesses,
    blindSpots: [],
    behaviorPatterns: Array.isArray(bundle?.behaviorPatterns)
      ? bundle.behaviorPatterns
      : [],
    improvementPriorities: [
      {
        priority: "Tighten setup selection",
        action: "Skip any trade that scores below 70 on your checklist.",
        expectedImpact: "Higher per-trade expectancy by removing the worst tail.",
      },
      {
        priority: "Protect size after losses",
        action: "Cut size by 50% on the trade immediately after any loss.",
        expectedImpact: "Smaller drawdowns and faster recovery from losing streaks.",
      },
      {
        priority: "Tag every entry",
        action: "Record entryBasis, mood, and emotional tags on every trade.",
        expectedImpact: "Future Trading DNA reports become significantly more accurate.",
      },
    ],
    coachSummary,
    confidenceNote: lowSample
      ? `Confidence is limited due to a small sample (${sample} trade${sample === 1 ? "" : "s"}).`
      : `Based on ${sample} trades over the window.`,
  };
}

function buildPrompt(bundle) {
  const bundleJson = JSON.stringify(bundle);
  const lowSample = Boolean(bundle?.sample?.lowSample);
  const sample = bundle?.sample?.totalTrades || 0;
  const lowSampleWarning = lowSample
    ? `\nIMPORTANT: Only ${sample} trade(s) in this window. Every observation MUST be marked preliminary. Set "identity.archetype" to null. State explicitly in coachSummary and confidenceNote that the sample is too small for a reliable identity.`
    : "";

  return `You are a trading psychologist and performance coach analyzing a trader's behavioral signature to generate their "Trading DNA" — a personalized identity report distilled from their journal.

STRICT DATA RULES — follow every rule without exception:
1. ONLY use numbers, setups, sessions, tags, and patterns that exist in the Bundle JSON below.
2. NEVER invent statistics, trades, sessions, strategies, or patterns not present in the data.
3. NEVER give buy/sell signals, price predictions, or financial advice.
4. Every "evidence" string MUST quote at least one exact number from the bundle.
5. Pick "identity.archetype" from THIS EXACT LIST (case-sensitive): ${ARCHETYPES.map((a) => `"${a}"`).join(", ")}. NEVER invent a new archetype. If the data is ambiguous, set archetype to null.
6. If sample.lowSample is true, set archetype to null and say in coachSummary that observations are preliminary.
7. "blindSpots" must describe things the trader is NOT noticing — derive from contradictions in the data (e.g. avoiding their best session, high confidence on losing setups, costly emotion they keep repeating).
8. "behaviorPatterns" entries must each name a trigger (what causes the behavior) and a consequence (the measurable result).
9. Address the trader directly in "coachSummary" ("You tend to..."). 3–5 sentences. No motivational fluff.
${lowSampleWarning}

ANALYSIS REQUIREMENTS:
- Identity: pick the archetype that best fits the data. "oneLiner" is one sentence summarizing how they trade. "tagline" is a 3–6 word motto.
- Strengths: 2–4. Reference specific numbers — best setup expectancy, best session win rate, post-loss recovery rate, plan-adherence wins, etc.
- Weaknesses: 2–4. Cite worst setup, low rule adherence, oversize-after-loss percentages, most costly emotional tags, lowest-performing session.
- Blind Spots: 1–3. Contradictions only: e.g. the trader's most profitable tag appears on the fewest trades, OR their best session has the lowest trade count, OR their highest-scored trades have a lower win rate than mid-scored trades.
- Behavior Patterns: 2–4. Use bundle.behaviorPatterns as seeds. Add 1–2 of your own derived from the bundle (e.g. month-over-month discipline drift, session-and-emotion combinations).
- Improvement Priorities: EXACTLY 3. Each has priority (what to focus on), action (a concrete weekly step they can do this week), expectedImpact (the metric that should move).
- Coach Summary: 3–5 sentences. Personal, direct, references their archetype and the single highest-leverage change they should make.
- Confidence Note: one sentence on data sufficiency. Mention the trade count.

Return ONLY valid JSON (no markdown, no backticks, no explanation outside the JSON):
{
  "identity": { "archetype": string|null, "oneLiner": string, "tagline": string },
  "strengths": [ { "title": string, "evidence": string, "metric": string } ],
  "weaknesses": [ { "title": string, "evidence": string, "metric": string } ],
  "blindSpots": [ { "title": string, "why": string, "watchFor": string } ],
  "behaviorPatterns": [ { "pattern": string, "trigger": string, "consequence": string } ],
  "improvementPriorities": [ { "priority": string, "action": string, "expectedImpact": string } ],
  "coachSummary": string,
  "confidenceNote": string
}

Bundle JSON:
${bundleJson}
`;
}

function normalizeDna(parsed, bundle) {
  const archetypeRaw = parsed?.identity?.archetype;
  const safeArchetype = ARCHETYPES.includes(archetypeRaw) ? archetypeRaw : null;
  const lowSample = Boolean(bundle?.sample?.lowSample);
  return {
    identity: {
      archetype: lowSample ? null : safeArchetype,
      oneLiner: typeof parsed?.identity?.oneLiner === "string"
        ? parsed.identity.oneLiner
        : "",
      tagline: typeof parsed?.identity?.tagline === "string"
        ? parsed.identity.tagline
        : "",
    },
    strengths: Array.isArray(parsed?.strengths) ? parsed.strengths.slice(0, 6) : [],
    weaknesses: Array.isArray(parsed?.weaknesses) ? parsed.weaknesses.slice(0, 6) : [],
    blindSpots: Array.isArray(parsed?.blindSpots) ? parsed.blindSpots.slice(0, 6) : [],
    behaviorPatterns: Array.isArray(parsed?.behaviorPatterns)
      ? parsed.behaviorPatterns.slice(0, 6)
      : [],
    improvementPriorities: Array.isArray(parsed?.improvementPriorities)
      ? parsed.improvementPriorities.slice(0, 5)
      : [],
    coachSummary: typeof parsed?.coachSummary === "string" ? parsed.coachSummary : "",
    confidenceNote: typeof parsed?.confidenceNote === "string"
      ? parsed.confidenceNote
      : "",
  };
}

async function generateTradingDna(bundle) {
  const bundleJson = JSON.stringify(bundle);
  if (Buffer.byteLength(bundleJson, "utf8") > MAX_BUNDLE_BYTES) {
    // VALIDATION_ERROR so the worker classifies it as UnrecoverableError —
    // a bundle that is too large will be too large every retry, so the
    // default 2-attempt backoff is pure waste.
    throw new ApiError(
      400,
      `Trading DNA bundle exceeds the ${MAX_BUNDLE_BYTES}-byte prompt limit`,
      "VALIDATION_ERROR"
    );
  }

  const modelName = appConfig.ai.geminiModel;

  try {
    const genAI = getGeminiClient();
    // Pass requestOptions.timeout so the underlying fetch aborts after the
    // budget — a hung socket no longer holds the worker until lockDuration.
    const model = genAI.getGenerativeModel(
      { model: modelName },
      { timeout: GEMINI_TIMEOUT_MS }
    );
    const prompt = buildPrompt(bundle);

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        // Slightly warmer than weekly feedback (0.2) — the personality
        // language benefits from a little expressiveness, but not so much
        // that archetype assignment becomes unstable.
        temperature: 0.4,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    });

    let text = "";
    const cand = result?.response?.candidates?.[0];
    if (cand?.content?.parts) {
      text = cand.content.parts.map((p) => p.text || "").join("");
    } else {
      text = result?.response?.text?.() || "";
    }

    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = parseDnaFromRaw(cleaned) || buildFallbackDna(bundle);

    return {
      model: modelName,
      promptVersion: PROMPT_VERSION,
      dna: normalizeDna(parsed, bundle),
      raw: cleaned,
    };
  } catch (err) {
    const message = err?.message || String(err);
    logger.warn("[TradingDNA] Gemini call failed, using deterministic fallback", {
      error: message,
    });
    return {
      model: "fallback",
      promptVersion: PROMPT_VERSION,
      dna: normalizeDna(buildFallbackDna(bundle), bundle),
      raw: "",
    };
  }
}

module.exports = {
  ARCHETYPES,
  GEMINI_TIMEOUT_MS,
  MAX_BUNDLE_BYTES,
  PROMPT_VERSION,
  buildFallbackDna,
  buildPrompt,
  generateTradingDna,
  normalizeDna,
};
