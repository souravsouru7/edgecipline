const { GoogleGenerativeAI } = require("@google/generative-ai");
const { appConfig } = require("../config");

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
      "Focus next week: only take planned setups, and pause trading after two emotional losses in a row.",
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
    improvements: [
      {
        title: "Improve setup quality and selection",
        why: "Recent performance indicates weak edge concentration and inconsistent process execution.",
        how: "Trade only your top setup criteria, reduce low-conviction entries, and review every loss with one concrete rule correction.",
      },
    ],
    nextWeekChecklist: [
      "Trade only pre-defined setups",
      "Stop for the day after 2 consecutive losses",
      "Log mood and confidence before every entry",
      "Tag the primary mistake for every losing trade",
      "Review top 3 losses at end of day",
      "Reduce size on low-confidence setups",
    ],
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
    const parsed = parseFeedbackFromRaw(cleaned) || buildFallbackFeedback(snapshot, weekLabel);

    // Normalize required fields
    parsed.week = parsed.week || weekLabel;
    parsed.summary = typeof parsed.summary === "string" ? parsed.summary : "";
    parsed.psychologyFeedback = typeof parsed.psychologyFeedback === "string" ? parsed.psychologyFeedback : "";
    parsed.mistakes = Array.isArray(parsed.mistakes) ? parsed.mistakes : [];
    parsed.improvements = Array.isArray(parsed.improvements) ? parsed.improvements : [];
    parsed.nextWeekChecklist = Array.isArray(parsed.nextWeekChecklist) ? parsed.nextWeekChecklist : [];
    parsed.dataQualityScore = typeof parsed.dataQualityScore === "number" ? parsed.dataQualityScore : null;
    parsed.confidenceNote = typeof parsed.confidenceNote === "string" ? parsed.confidenceNote : "";

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

