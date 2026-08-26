
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

const DEFAULT_MAX_SNAPSHOT_BYTES = 200_000;
const configuredMaxSnapshotBytes = Number(process.env.GEMINI_MAX_SNAPSHOT_BYTES);
const MAX_SNAPSHOT_BYTES = Number.isSafeInteger(configuredMaxSnapshotBytes)
  ? Math.min(1_000_000, Math.max(1024, configuredMaxSnapshotBytes))
  : DEFAULT_MAX_SNAPSHOT_BYTES;

function getGeminiClient() {
  const apiKey = appConfig.ai.geminiApiKey;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return new GoogleGenerativeAI(apiKey);
}

// Rule 5 of the prompt below tells the model not to give buy/sell signals,
// price predictions, or financial advice, but that's a request, not an
// enforcement -- nothing stops the model from ignoring it. This is a
// post-hoc safety net that scans the model's own output for the clearest,
// lowest-false-positive-risk patterns (imperative trade instructions,
// explicit price targets, guaranteed-return language) before it's shown to
// a user.
const PROHIBITED_ADVICE_PATTERNS = [
  /\b(buy|sell|long|short)\s+[A-Z]{2,6}(?:\/[A-Z]{2,6})?\b/, // e.g. "BUY EURUSD"
  /\btarget\s*(price)?\s*[:\-]?\s*\$?\d/i,                    // e.g. "target 1.2500"
  /\bguaranteed\s+(profit|return|win)/i,
  /\b(will|going to)\s+(rise|fall|rally|crash|go\s+(up|down))\b/i,
  /\bstop\s*loss\s+at\s+\d/i,
];

function containsProhibitedFinancialAdvice(text) {
  if (!text || typeof text !== "string") return false;
  return PROHIBITED_ADVICE_PATTERNS.some((pattern) => pattern.test(text));
}

function feedbackContainsProhibitedAdvice(feedback) {
  const texts = [
    feedback.summary,
    feedback.psychologyFeedback,
    ...(Array.isArray(feedback.mistakes)
      ? feedback.mistakes.flatMap((m) => [m?.title, m?.evidence, m?.fix])
      : []),
    ...(Array.isArray(feedback.improvements)
      ? feedback.improvements.flatMap((i) => [i?.title, i?.why, i?.how])
      : []),
    ...(Array.isArray(feedback.nextWeekChecklist) ? feedback.nextWeekChecklist : []),
  ];
  return texts.some((text) => containsProhibitedFinancialAdvice(text));
}

function extractJsonObject(text) {
  if (!text) return null;
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  return match[0];
}

function parseFeedbackFromRaw(rawText) {
  const text = String(rawText || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
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

const pctOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const money = (v) => Number(v || 0).toFixed(2);

// Psychology dimensions the weekly snapshot always carries, ordered later by
// which one is actually weakest for this trader.
function psychologyDimensions(snapshot) {
  const b = snapshot?.psychology?.scoreBreakdown || {};
  return [
    {
      pct: pctOrNull(b.planAdherencePct),
      title: "Raise plan adherence",
      why: (p) => `Only ${p}% of this week's trades came from a pre-defined plan.`,
      how: "Write the entry trigger, invalidation, and target before each entry, and skip anything you cannot write down first.",
      focus: (p) => `only take planned setups (plan adherence was ${p}% this week)`,
    },
    {
      pct: pctOrNull(b.calmTradingPct),
      title: "Trade more often from a calm state",
      why: (p) => `Only ${p}% of trades were tagged calm or focused.`,
      how: "Run a short state check before each entry and stand down when the answer is not calm.",
      focus: (p) => `enter only from a calm or focused state (just ${p}% of trades qualified)`,
    },
    {
      pct: pctOrNull(b.noRevengePct),
      title: "Cut revenge entries after a loss",
      why: (p) => `Your no-revenge rate was ${p}%, so some entries followed a loss without a reset.`,
      how: "Enforce a fixed cool-off period after every loss before the next entry is allowed.",
      focus: (p) => `pause after each loss before re-entering (no-revenge rate was ${p}%)`,
    },
    {
      pct: pctOrNull(b.wouldRetakePct),
      title: "Take only trades you would take again",
      why: (p) => `You said you would retake only ${p}% of this week's trades.`,
      how: "At entry, ask whether you would take this trade again on the same information; if not, pass.",
      focus: (p) => `take only trades you would repeat (you would retake ${p}% of this week's)`,
    },
  ]
    .filter((d) => d.pct !== null && d.pct < 100)
    .sort((a, b2) => a.pct - b2.pct);
}

// Worst losing entry in a breakdown list (sessions / strategies), or null when
// nothing in that list actually lost money.
function worstLosing(list, noun) {
  const entry = (list || [])
    .filter((x) => Number(x?.netPnL) < 0)
    .sort((a, b) => Number(a.netPnL) - Number(b.netPnL))[0];
  if (!entry?.name) return null;
  // Users name their own setups, often ending in the same noun ("Ob setup"),
  // which would otherwise read "your Ob setup setup".
  const label = new RegExp(`\\b${noun}$`, "i").test(String(entry.name).trim())
    ? entry.name
    : `${entry.name} ${noun}`;
  return {
    title: `Review your ${label}`,
    why: `${entry.name} was your weakest ${noun} this week: ${money(entry.netPnL)} net P&L across ${entry.trades ?? entry.count ?? 0} trades at ${entry.winRate ?? 0}% win rate.`,
    how: `Size down in ${entry.name} or pause it until you can write down why the edge should return.`,
    entry,
  };
}

/**
 * Focus areas derived from THIS trader's numbers rather than a fixed template:
 * their weakest psychology dimension, plus any session or setup that actually
 * lost money this week. Each reason quotes the number it came from.
 */
function deriveFallbackImprovements(snapshot) {
  const out = [];
  const weakest = psychologyDimensions(snapshot)[0];
  if (weakest) out.push({ title: weakest.title, why: weakest.why(weakest.pct), how: weakest.how });

  for (const noun of [["topSessions", "session"], ["topStrategies", "setup"]]) {
    const found = worstLosing(snapshot?.breakdowns?.[noun[0]], noun[1]);
    if (found) out.push({ title: found.title, why: found.why, how: found.how });
  }

  if (out.length === 0) {
    out.push({
      title: "Keep the current process steady",
      why: `Nothing in this week's ${snapshot?.counts?.totalTrades ?? 0} tracked trades stands out as the single weakest link.`,
      how: "Keep logging plan, mood, and confidence on every trade so the next report can compare like for like.",
    });
  }
  return out.slice(0, 3);
}

/**
 * Checklist built from the same week's data, so two traders never get the same
 * list unless their numbers genuinely match.
 */
function deriveFallbackChecklist(snapshot) {
  const b = snapshot?.psychology?.scoreBreakdown || {};
  const items = [];

  if (pctOrNull(b.planAdherencePct) !== null && b.planAdherencePct < 90) {
    items.push(`Take only pre-planned setups — plan adherence was ${b.planAdherencePct}%`);
  }
  if (pctOrNull(b.noRevengePct) !== null && b.noRevengePct < 100) {
    items.push(`Stop for the day after 2 consecutive losses — no-revenge rate was ${b.noRevengePct}%`);
  }
  if (pctOrNull(b.calmTradingPct) !== null && b.calmTradingPct < 60) {
    items.push(`Log mood and confidence before every entry — only ${b.calmTradingPct}% of trades were calm`);
  }

  const worstTrade = snapshot?.tradeSamples?.worstTrades?.[0];
  if (worstTrade?.pair) {
    items.push(`Re-read your ${worstTrade.pair} loss (${money(worstTrade.profit)}) and write one rule that would have prevented it`);
  }

  const session = worstLosing(snapshot?.breakdowns?.topSessions, "session");
  if (session) items.push(`Skip or half-size the ${session.entry.name} session until it is net positive again`);

  if (items.length === 0) items.push("Keep logging plan, mood, and confidence on every trade");
  return items.slice(0, 6);
}

function buildFallbackFeedback(snapshot, weekLabel) {
  const totalTrades = snapshot?.counts?.totalTrades ?? 0;
  const winRate = snapshot?.rates?.winRatePct ?? 0;
  const profitFactor = snapshot?.rates?.profitFactor ?? 0;
  const net = snapshot?.pnl?.net ?? 0;
  const bestTrade = snapshot?.tradeSamples?.bestTrades?.[0];
  const worstTrade = snapshot?.tradeSamples?.worstTrades?.[0];
  const psychology = snapshot?.psychology || null;

  const summaryLines = [
    `Week: ${weekLabel}`,
    `Results: ${totalTrades} trades, ${Number(winRate).toFixed(1)}% win rate, net P&L ${Number(net).toFixed(2)}, profit factor ${profitFactor}.`,
  ];
  if (bestTrade) summaryLines.push(`Best trade: ${Number(bestTrade.profit || 0).toFixed(2)} on ${bestTrade.pair || "N/A"} (${bestTrade.session || "session not tagged"}).`);
  if (worstTrade) summaryLines.push(`Worst trade: ${Number(worstTrade.profit || 0).toFixed(2)} on ${worstTrade.pair || "N/A"} (${worstTrade.session || "session not tagged"}).`);

  let psychologyFeedback = "";
  if (psychology && psychology.totalTrackedTrades > 0) {
    const topTag = psychology.topEmotionalTags?.[0];
    const topConf = psychology.topConfidence?.[0];
    psychologyFeedback = [
      `Your psychology score is ${psychology.psychologyScore}/100 across ${psychology.totalTrackedTrades} tracked trades.`,
      `Plan adherence is ${psychology.scoreBreakdown?.planAdherencePct ?? 0}%, calm/focused trading is ${psychology.scoreBreakdown?.calmTradingPct ?? 0}%, and no-revenge rate is ${psychology.scoreBreakdown?.noRevengePct ?? 0}%.`,
      topTag ? `Most frequent emotional tag is "${topTag.tag}" (${topTag.count} trades).` : "",
      topConf ? `Most frequent confidence state is "${topConf.label}" (${topConf.count} trades).` : "",
      // Point at whichever dimension is actually weakest for this trader,
      // rather than the same sentence for everyone.
      (() => {
        const weakest = psychologyDimensions(snapshot)[0];
        return weakest
          ? `Focus next week: ${weakest.focus(weakest.pct)}.`
          : "Focus next week: keep logging plan, mood, and confidence on every trade.";
      })(),
    ].filter(Boolean).join(" ");
  }

  const isTooFewTrades = totalTrades < 10;
  const confidenceNote = isTooFewTrades
    ? `Feedback confidence is limited due to a small sample size (${totalTrades} trade${totalTrades === 1 ? "" : "s"}).`
    : "";
  const dataQualityScore = isTooFewTrades ? Math.min(40, totalTrades * 4) : 75;

  return {
    week: weekLabel,
    summary: summaryLines.join("\n\n"),
    psychologyFeedback,
    mistakes: [],
    improvements: deriveFallbackImprovements(snapshot),
    nextWeekChecklist: deriveFallbackChecklist(snapshot),
    dataQualityScore,
    confidenceNote,
  };
}

async function generateWeeklyFeedback({ snapshot, weekLabel }) {
  const snapshotJson = JSON.stringify(snapshot);
  if (typeof snapshotJson !== "string") {
    throw new Error("[Gemini] Snapshot must be a JSON-serializable object");
  }
  const snapshotBytes = Buffer.byteLength(snapshotJson, "utf8");
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
    throw new Error(
      `[Gemini] Snapshot exceeds the ${MAX_SNAPSHOT_BYTES}-byte prompt limit`
    );
  }

  const genAI = getGeminiClient();
  // Use a stable default Gemini model name; can be overridden via GEMINI_MODEL.
  const modelName = appConfig.ai.geminiModel;
  const model = genAI.getGenerativeModel({ model: modelName });

  const totalTrades = snapshot?.counts?.totalTrades ?? 0;
  const lowSampleWarning = totalTrades < 10
    ? `\nIMPORTANT: Only ${totalTrades} trade(s) were recorded this week. Every observation must be marked as preliminary. State explicitly in the summary and psychologyFeedback that insights are based on a very small sample and may not be statistically reliable.`
    : "";

  const prompt = `You are a senior trading performance coach reviewing a trader's journal.

STRICT DATA RULES — follow every rule without exception:
1. ONLY use numbers, trades, and observations that exist in the Snapshot JSON below.
2. NEVER invent, assume, or extrapolate any statistic, trade, or pattern not present in the data.
3. NEVER mention a currency pair, session, strategy, or trade that does not appear in the snapshot.
4. If a field is missing (e.g. no session data), say "session data not recorded" — do not guess.
5. Do NOT give buy/sell signals, price predictions, or financial advice.
6. Every "evidence" field MUST quote at least one exact number from the snapshot.
7. If totalTrades < 10, prefix every section with a low-sample-size warning.
8. If the snapshot shows a _dataInconsistency field, return a summary stating "Data inconsistency detected" and skip all other analysis.
${lowSampleWarning}

ANALYSIS REQUIREMENTS:
- Summary: 2–4 paragraphs. Cover net P&L, win rate, profit factor, best/worst trades, and high-level themes. State the exact trade count.
- Psychology: 1–3 paragraphs. Only if a "psychology" object is in the snapshot. Reference plan adherence %, mood average, top emotional tags, revenge trade count.
- Mistakes: Up to 5. Each must have a specific title, evidence quoting exact numbers, and a concrete measurable fix.
- Improvements: Up to 5. Each must reference actual edges found in the data (e.g. a session or strategy with higher win rate than average).
- Session Analysis: If "topSessions" data is present, identify the best and worst session by net P&L and win rate.
- Setup Analysis: If "topStrategies" data is present, identify the best and weakest setup by net P&L and win rate.
- Trade Quality: If "tradeQualityAnalysis" is present, analyze Great/Average/Poor self-rating distribution. Note calibration: do "Great" trades have higher win rates than "Poor" ones? Flag mismatches.
- Self-Awareness: If "selfAwareness" is present in the snapshot, generate 1-2 coaching sentences using the exact numbers provided. Reference score, greatAccuracy, averageAccuracy, poorAccuracy. If bestJudgedCategory exists, praise it. If worstJudgedCategory exists, coach on it. If patterns[] is non-empty, incorporate the first pattern verbatim as evidence. NEVER invent self-awareness metrics not present in the data.
- Psychology Cost: If "psychologyCost" is present, generate 1-3 specific coaching statements using only the exact numbers in the snapshot. Reference totalEmotionCost, biggestLeak name and cost, mostExpensiveEmotion, mostProfitableEmotion. Example patterns: "FOMO cost you $X this week", "Your calm trades generated $Y", "Psychology mistakes accounted for Z% of your losses." NEVER invent any cost figures. If unhealthyNetPnL is negative and healthyNetPnL is positive, highlight the contrast.
- Action Plan: Exactly 3 checklist items that are specific, measurable, and derived from actual data patterns.
- Trading DNA: If "dna" is present in the snapshot, generate 1-2 sentences using exact DNA data. Reference dnaSummary.tradingIdentity if available. If bestSession or bestDay is present with netPnL, say "Your DNA shows peak performance during [name] (+$X)." If mostExpensiveEmotion is present, say "[emotion] cost you $X this week." If losingPattern is present, reference conditionLabel and winRate. NEVER invent DNA insights not present in the data.
- Pattern Detection: If "patterns" is present in the snapshot, use it to sharpen coaching. Use topNegative[0] to identify the single biggest behavioral risk this week. Use topPositive[0] to highlight what is working. If mostDangerousCombination is present (e.g. "FOMO + Confidence 9-10"), name it explicitly. If lossStreakInsight is present, include it verbatim in mistakes or psychologyFeedback. If optimalConfidenceRange or optimalSetupScore is present, reference them in the action plan. NEVER invent pattern data — only reference patterns that exist in the snapshot.patterns object.
- Confidence: If totalTrades < 10, set dataQualityScore ≤ 40 and state "Feedback confidence is limited due to a small sample size."

Return ONLY valid JSON (no markdown, no backticks, no explanation outside the JSON):
{
  "week": string,
  "summary": string,
  "psychologyFeedback": string,
  "mistakes": [
    {
      "title": string,
      "evidence": string,
      "fix": string
    }
  ],
  "improvements": [
    {
      "title": string,
      "why": string,
      "how": string
    }
  ],
  "nextWeekChecklist": [string],
  "dataQualityScore": number,
  "confidenceNote": string
}

Week: ${weekLabel}
Snapshot JSON:
${snapshotJson}
`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    });

    // Prefer candidates/parts if available, fallback to .text()
    let text = "";
    const cand = result?.response?.candidates?.[0];
    if (cand?.content?.parts) {
      text = cand.content.parts.map((p) => p.text || "").join("");
    } else {
      text = result?.response?.text?.() || "";
    }

    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const modelParsed = parseFeedbackFromRaw(cleaned);

    // The model answered but the payload was not usable JSON. Fall back — but
    // never report the result as model-authored, because the UI shows aiModel
    // as provenance and a silent swap makes a derived report look like AI
    // coaching. Log the response so the parse failure is diagnosable.
    if (!modelParsed) {
      logger.warn("[Gemini] Weekly feedback did not parse; using derived fallback", {
        model: modelName,
        rawLength: cleaned.length,
        rawPreview: cleaned.slice(0, 500),
      });
      return {
        model: `${modelName}-fallback`,
        fallback: true,
        feedback: buildFallbackFeedback(snapshot, weekLabel),
        raw: cleaned,
      };
    }

    const parsed = modelParsed;

    // Normalize required fields
    parsed.week = parsed.week || weekLabel;
    parsed.summary = typeof parsed.summary === "string" ? parsed.summary : "";
    parsed.psychologyFeedback = typeof parsed.psychologyFeedback === "string" ? parsed.psychologyFeedback : "";
    parsed.mistakes = Array.isArray(parsed.mistakes) ? parsed.mistakes : [];
    parsed.improvements = Array.isArray(parsed.improvements) ? parsed.improvements : [];
    parsed.nextWeekChecklist = Array.isArray(parsed.nextWeekChecklist) ? parsed.nextWeekChecklist : [];
    parsed.dataQualityScore = typeof parsed.dataQualityScore === "number" ? parsed.dataQualityScore : null;
    parsed.confidenceNote = typeof parsed.confidenceNote === "string" ? parsed.confidenceNote : "";

    if (feedbackContainsProhibitedAdvice(parsed)) {
      logger.warn("[Gemini] Weekly feedback contained prohibited financial-advice language; discarding", {
        model: modelName,
      });
      return {
        model: `${modelName}-blocked`,
        fallback: true,
        feedback: buildFallbackFeedback(snapshot, weekLabel),
        raw: cleaned,
      };
    }

    return {
      model: modelName,
      feedback: parsed,
      raw: cleaned,
    };
  } catch (err) {
    const message = err?.message || String(err);
    throw new Error(`[Gemini] Failed to generate weekly feedback: ${message}`);
  }
}

module.exports = { MAX_SNAPSHOT_BYTES, generateWeeklyFeedback };

