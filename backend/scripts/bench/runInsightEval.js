#!/usr/bin/env node
"use strict";

/**
 * Weekly report / reflection / Mind Score quality + cost eval on fixed
 * synthetic inputs. Calls the production functions (generateWeeklyFeedback,
 * generateInsight) or the production prompt (Mind Score), varying only the
 * model and the thinking cap.
 *
 *   node scripts/bench/runInsightEval.js \
 *     --weekly gemini-3.6-flash,gemini-3.6-flash@1024,gemini-3.5-flash-lite \
 *     --short gemini-3.6-flash,gemini-3.5-flash-lite \
 *     --judge gemini-3.6-flash --max-calls 150 [--dry-run]
 *
 * "model@N" = thinking budget N (weekly report only; no suffix = today's
 * default dynamic thinking). First entry of each list = baseline.
 * Output: bench-data/insights/results-<timestamp>.{json,md}
 */

const fs = require("fs");
const path = require("path");
const { CallBudget, captureUsage, parseArgs, pct, setupBenchEnv } = require("./lib");

const args = parseArgs();
const DRY = Boolean(args["dry-run"]);
const OUT_DIR = path.resolve(__dirname, "../../bench-data/insights");
const list = (v, d) => String(v || d).split(",").map((s) => s.trim()).filter(Boolean);
const WEEKLY = list(args.weekly, "gemini-3.6-flash,gemini-3.6-flash@1024,gemini-3.5-flash-lite");
const SHORT = list(args.short, "gemini-3.6-flash,gemini-3.5-flash-lite");
const JUDGE_MODEL = String(args.judge || "gemini-3.6-flash");
const budget = new CallBudget(args["max-calls"] || 150);

const { appConfig } = setupBenchEnv({ dryRun: DRY });
const usage = captureUsage();

if (DRY) {
  const sdk = require("@google/generative-ai");
  sdk.GoogleGenerativeAI.prototype.getGenerativeModel = function getGenerativeModel({ model }) {
    return {
      generateContent: async (req) => {
        const text = JSON.stringify(req);
        const weekly = text.includes("senior trading performance coach");
        const judge = text.includes("impartial");
        return {
          response: {
            modelVersion: model,
            usageMetadata: { promptTokenCount: weekly ? 6800 : 400, candidatesTokenCount: weekly ? 900 : 40, thoughtsTokenCount: weekly ? 600 : 0, totalTokenCount: 1 },
            candidates: [{ content: { parts: [{ text: judge ? '{"winner":"tie","reason":"dry"}' : weekly ? JSON.stringify({ week: "w", summary: "16 trades, win rate 50.0%.", psychologyFeedback: "p", mistakes: [], improvements: [], nextWeekChecklist: ["a", "b", "c"], dataQualityScore: 75, confidenceNote: "" }) : "You followed your plan on a red day; tomorrow keep the same stop discipline." }] } }],
            text: () => "dry",
          },
        };
      },
    };
  };
}

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { guardedCall } = require("../../utils/geminiCircuit");
const { withThinkingBudget } = require("../../utils/geminiConfig");
const { generateWeeklyFeedback, containsProhibitedFinancialAdvice } = require("../../services/geminiService");
const { computeSnapshot } = require("../../services/weeklyReport.service");
const { generateInsight, MAX_INSIGHT_CHARS } = require("../../services/reflectionInsightService");
const { buildInsightPrompt } = require("../../services/mindProgress.service");

// ── fixtures ───────────────────────────────────────────────────────────────
function syntheticTrades(n, seed = 7) {
  let x = seed;
  const rnd = () => { x = (x * 48271) % 2147483647; return x / 2147483647; };
  const pairs = ["EURUSD", "GBPUSD", "XAUUSD", "USDJPY"];
  const sessions = ["London", "New York", "Asian"];
  const strategies = ["Pullback", "Breakout", "Reversal"];
  const tags = [["Calm"], ["FOMO"], ["Revenge"], ["Calm", "Focused"], []];
  return Array.from({ length: n }, (_, i) => {
    const session = sessions[i % 3];
    const strategy = strategies[(i * 2) % 3];
    const good = strategy === "Pullback" && session === "London";
    const profit = Number(((good ? 1 : -0.6) * (20 + rnd() * 120) * (rnd() < 0.7 ? 1 : -1)).toFixed(2));
    return {
      _id: `t${i}`, pair: pairs[i % 4], type: rnd() < 0.5 ? "BUY" : "SELL", profit, session, strategy,
      setupScore: Math.round(3 + rnd() * 6), mood: Math.round(1 + rnd() * 4), confidence: ["Low", "Medium", "High"][i % 3],
      emotionalTags: tags[i % 5], mistakeTag: profit < 0 && i % 2 ? "Chased entry" : "", entryBasis: i % 3 ? "Plan" : "Impulse",
      tradeQuality: profit > 0 ? "Great" : "Poor", wouldRetake: profit > 0 ? "yes" : "no",
      tradeDate: new Date(Date.UTC(2026, 10, 20 + (i % 7), 9 + (i % 8))), createdAt: new Date(Date.UTC(2026, 10, 20 + (i % 7))),
      commission: -1.5, swap: 0, marketType: "Forex",
    };
  });
}

const WEEKLY_CASES = [
  { id: "forex-16", trades: syntheticTrades(16) },
  { id: "forex-4-low-sample", trades: syntheticTrades(4, 11) },
].map((c) => ({ ...c, snapshot: { marketType: "Forex", periodType: "rolling7d", ...computeSnapshot(c.trades, "Forex") } }));

const REFLECTIONS = [
  { reflection: { followedPlan: "yes", mood: 2, confidence: 3, wouldRepeat: "yes", improvement: "" }, context: { tradeCount: 3, grossPnL: -142.5, followedChecklist: true } },
  { reflection: { followedPlan: "no", mood: 1, confidence: 2, wouldRepeat: "no", improvement: "Stop after two losses" }, context: { tradeCount: 5, grossPnL: -4200.5, followedChecklist: false } },
  { reflection: { followedPlan: "yes", mood: 4, confidence: 4, wouldRepeat: "yes", improvement: "Size up only on A+ setups" }, context: { tradeCount: 1, grossPnL: 88.3, followedChecklist: true } },
  { reflection: { followedPlan: "partly", mood: 3, confidence: 3, wouldRepeat: "no", improvement: "No trades in first 15 minutes" }, context: { tradeCount: 2, grossPnL: 12.0, followedChecklist: false } },
];

const MIND_FACTS = [
  { mindScore: 62, level: "Steady", changeToday: 4, startingScore: 51, headline: { type: "plan_streak", days: 3 }, weekVsLastWeek: [{ type: "revenge_down", from: 3, to: 1 }], lastJournalDay: [{ type: "followed_plan" }], weeklyFocus: "Wait for candle close" },
  { mindScore: 38, level: "Rebuilding", changeToday: -6, startingScore: 45, headline: { type: "rule_broken", rule: "Max 2 losses per day" }, weekVsLastWeek: [], lastJournalDay: [{ type: "revenge_trade", count: 2 }], weeklyFocus: null },
  { mindScore: 75, level: "Disciplined", changeToday: 0, startingScore: 60, headline: null, weekVsLastWeek: [{ type: "calm_up", fromPct: 40, toPct: 65 }], lastJournalDay: [], weeklyFocus: "Journal every trade" },
];

// ── helpers ────────────────────────────────────────────────────────────────
const parseSpec = (spec) => { const [model, think] = spec.split("@"); return { model, think: think === undefined ? "" : think, name: spec }; };

function numbersGrounded(text, source) {
  const src = JSON.stringify(source).replace(/,(?=\d{3})/g, "");
  const nums = (String(text).match(/-?\d[\d,]*(?:\.\d+)?/g) || []).map((s) => s.replace(/,/g, "")).filter((s) => s.replace(/\D/g, "").length >= 2);
  const bad = nums.filter((n) => !src.includes(n) && !src.includes(String(Math.abs(Number(n)))) && !src.includes(Number(n).toFixed(1)) && !src.includes(Number(n).toFixed(2)));
  return { total: nums.length, ungrounded: bad };
}

function rowsSince(start) { return usage.rows.slice(start); }

async function judge(kind, input, base, cand, flip) {
  const [A, B] = flip ? [cand, base] : [base, cand];
  const prompt = `You are an impartial reviewer of AI-written trading-journal ${kind}. Compare two outputs for the same input.
Judge on: accuracy to the input data (no invented numbers), specificity and usefulness for the trader's behaviour, no buy/sell advice, clarity.
Return ONLY JSON: {"winner":"A"|"B"|"tie","reason":"<one sentence>"}

Input: ${JSON.stringify(input).slice(0, 20000)}

Output A:
${typeof A === "string" ? A : JSON.stringify(A)}

Output B:
${typeof B === "string" ? B : JSON.stringify(B)}`;
  budget.take(1);
  const m = new GoogleGenerativeAI(appConfig.ai.geminiApiKey).getGenerativeModel({ model: JUDGE_MODEL });
  const res = await guardedCall({ feature: "coach", model: JUDGE_MODEL, operationId: "judge", call: () => m.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: "application/json" } }) }).catch(() => null);
  const raw = res?.response?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || res?.response?.text?.() || "{}";
  let w = "tie";
  try { w = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "")).winner || "tie"; } catch { /* tie */ }
  return (flip ? w === "A" : w === "B") ? "win" : (flip ? w === "B" : w === "A") ? "loss" : "tie";
}

const tally = (arr) => `${arr.filter((x) => x === "win").length} win / ${arr.filter((x) => x === "tie").length} tie / ${arr.filter((x) => x === "loss").length} loss`;

async function main() {
  const report = { weekly: {}, reflection: {}, mind: {} };

  // Weekly report: production function, sequential so metering rows line up.
  for (const spec of WEEKLY.map(parseSpec)) {
    appConfig.ai.featureModels.weekly_report = spec.model;
    appConfig.ai.featureThinkingBudget.weekly_report = spec.think;
    report.weekly[spec.name] = [];
    for (const c of WEEKLY_CASES) {
      budget.take(1);
      const start = usage.rows.length;
      const out = await generateWeeklyFeedback({ snapshot: c.snapshot, weekLabel: "Nov 20 -> Nov 27 (Last 7 days)" }).catch((e) => ({ model: "error", feedback: null, error: e.message }));
      await new Promise((r) => setImmediate(r));
      const fb = out.feedback || {};
      const g = numbersGrounded([fb.summary, fb.psychologyFeedback, JSON.stringify(fb.mistakes), JSON.stringify(fb.improvements)].join(" "), c.snapshot);
      report.weekly[spec.name].push({
        id: c.id, model: out.model, fallback: /fallback|blocked|error/.test(String(out.model)),
        checklist3: Array.isArray(fb.nextWeekChecklist) && fb.nextWeekChecklist.length === 3,
        grounded: g, feedback: fb, cost: usage.summarize(rowsSince(start)),
      });
    }
  }

  // Reflection: production generateInsight.
  for (const model of SHORT) {
    appConfig.ai.featureModels.reflection = model;
    report.reflection[model] = [];
    for (const [i, r] of REFLECTIONS.entries()) {
      budget.take(1);
      const start = usage.rows.length;
      const out = await generateInsight({ ...r, day: `2026-11-2${i}`, premium: true });
      await new Promise((res) => setImmediate(res));
      report.reflection[model].push({
        id: `r${i + 1}`, text: out.insight, fallback: out.fallback,
        complete: /[.!?…]$/.test(String(out.insight).trim()) && String(out.insight).length <= MAX_INSIGHT_CHARS,
        grounded: numbersGrounded(out.insight, r), cost: usage.summarize(rowsSince(start)),
      });
    }
  }

  // Mind Score line: production prompt; old config (no thinking cap) vs new (cap 0).
  for (const model of SHORT) {
    for (const cap of ["nocap", "cap0"]) {
      const name = `${model}:${cap}`;
      report.mind[name] = [];
      for (const [i, facts] of MIND_FACTS.entries()) {
        budget.take(1);
        const start = usage.rows.length;
        const m = new GoogleGenerativeAI(appConfig.ai.geminiApiKey).getGenerativeModel({ model });
        const base = { temperature: 0.6, maxOutputTokens: 160 };
        const res = await guardedCall({ feature: "mind_progress", model, call: () => m.generateContent({ contents: [{ role: "user", parts: [{ text: buildInsightPrompt(facts) }] }], generationConfig: cap === "cap0" ? withThinkingBudget(model, base, 0) : base }) }).catch(() => null);
        await new Promise((r) => setImmediate(r));
        const cand = res?.response?.candidates?.[0];
        const text = (cand?.content?.parts ? cand.content.parts.map((p) => p.text || "").join("") : res?.response?.text?.() || "").trim();
        report.mind[name].push({
          id: `m${i + 1}`, text, finishReason: cand?.finishReason || null,
          usable: text.length >= 20 && !containsProhibitedFinancialAdvice(text),
          grounded: numbersGrounded(text, facts), cost: usage.summarize(rowsSince(start)),
        });
      }
    }
  }

  // Pairwise judge vs each baseline.
  const judged = { weekly: {}, reflection: {}, mind: {} };
  const wBase = WEEKLY[0];
  for (const name of WEEKLY.slice(1)) {
    judged.weekly[name] = [];
    for (const [i, c] of WEEKLY_CASES.entries()) judged.weekly[name].push(await judge("weekly reports", c.snapshot, report.weekly[wBase][i].feedback, report.weekly[name][i].feedback, i % 2 === 1));
  }
  for (const model of SHORT.slice(1)) {
    judged.reflection[model] = [];
    for (const [i, r] of REFLECTIONS.entries()) judged.reflection[model].push(await judge("end-of-day reflection lines", r, report.reflection[SHORT[0]][i].text, report.reflection[model][i].text, i % 2 === 1));
  }
  const mindBase = `${SHORT[0]}:cap0`;
  for (const name of Object.keys(report.mind).filter((n) => n !== mindBase)) {
    judged.mind[name] = [];
    for (const [i, f] of MIND_FACTS.entries()) judged.mind[name].push(await judge("Mind Score card lines", f, report.mind[mindBase][i].text, report.mind[name][i].text, i % 2 === 1));
  }

  const avg = (rows, k) => rows.reduce((s, r) => s + r.cost[k], 0) / (rows.length || 1);
  const ungroundedShare = (rows) => { const t = rows.reduce((s, r) => s + r.grounded.total, 0); const b = rows.reduce((s, r) => s + r.grounded.ungrounded.length, 0); return t ? pct(t - b, t) : "n/a"; };

  const md = [
    `# Insight eval ${new Date().toISOString()}${DRY ? " (DRY RUN — fake model, numbers are meaningless)" : ""}`, "",
    `Judge: \`${JUDGE_MODEL}\`. Snapshots built with production computeSnapshot from fixed synthetic trades.`, "",
    "## Weekly report", "",
    "| Config | Cost/report | Avg in / out / think tokens | AI (not fallback) | 3-item checklist | Numbers grounded | Judge vs baseline |",
    "|---|---|---|---|---|---|---|",
    ...WEEKLY.map((n) => { const r = report.weekly[n]; return `| ${n} | $${avg(r, "costUsd").toFixed(6)} | ${Math.round(avg(r, "inputTokens"))} / ${Math.round(avg(r, "outputTokens"))} / ${Math.round(avg(r, "thinkingTokens"))} | ${pct(r.filter((x) => !x.fallback).length, r.length)} | ${pct(r.filter((x) => x.checklist3).length, r.length)} | ${ungroundedShare(r)} | ${judged.weekly[n] ? tally(judged.weekly[n]) : "baseline"} |`; }),
    "", "## Reflection insight", "",
    "| Model | Cost/insight | Avg out / think tokens | Complete sentence ≤ limit | Numbers grounded | Judge vs baseline |",
    "|---|---|---|---|---|---|",
    ...SHORT.map((n) => { const r = report.reflection[n]; return `| ${n} | $${avg(r, "costUsd").toFixed(6)} | ${Math.round(avg(r, "outputTokens"))} / ${Math.round(avg(r, "thinkingTokens"))} | ${pct(r.filter((x) => x.complete && !x.fallback).length, r.length)} | ${ungroundedShare(r)} | ${judged.reflection[n] ? tally(judged.reflection[n]) : "baseline"} |`; }),
    "", "## Mind Score line (nocap = old config, cap0 = new)", "",
    "| Config | Cost/line | Avg out / think tokens | Usable line | Numbers grounded | Judge vs baseline |",
    "|---|---|---|---|---|---|",
    ...Object.keys(report.mind).map((n) => { const r = report.mind[n]; return `| ${n} | $${avg(r, "costUsd").toFixed(6)} | ${Math.round(avg(r, "outputTokens"))} / ${Math.round(avg(r, "thinkingTokens"))} | ${pct(r.filter((x) => x.usable).length, r.length)} | ${ungroundedShare(r)} | ${judged.mind[n] ? tally(judged.mind[n]) : "baseline"} |`; }),
    "", "## Outputs", "",
    ...Object.entries(report.reflection).flatMap(([n, rows]) => [`**Reflection · ${n}**`, ...rows.map((r) => `- ${r.id}: ${r.text}`), ""]),
    ...Object.entries(report.mind).flatMap(([n, rows]) => [`**Mind · ${n}**`, ...rows.map((r) => `- ${r.id} (${r.finishReason}): ${r.text || "(empty)"}`), ""]),
    ...Object.entries(report.weekly).flatMap(([n, rows]) => [`**Weekly · ${n}**`, ...rows.map((r) => `- ${r.id}: ${String(r.feedback?.summary || "").slice(0, 600).replace(/\n/g, " ")}`), ""]),
  ].join("\n");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outBase = path.join(OUT_DIR, `results-${stamp}${DRY ? "-dry" : ""}`);
  fs.writeFileSync(`${outBase}.json`, JSON.stringify({ report, judged }, null, 2));
  fs.writeFileSync(`${outBase}.md`, md);
  console.log(md.split("## Outputs")[0]);
  console.log(`Wrote ${outBase}.md (calls used: ${budget.used})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e); process.exit(1); });
