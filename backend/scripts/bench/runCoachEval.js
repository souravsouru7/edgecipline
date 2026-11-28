#!/usr/bin/env node
"use strict";

/**
 * AI Coach quality + cost eval on a fixed synthetic set
 * (fixtures/coachScenarios.js). Uses the production prompt builder, system
 * prompt and generation config; only the model and history mode vary.
 *
 *   node scripts/bench/runCoachEval.js \
 *     --configs gemini-3.6-flash:full,gemini-3.5-flash-lite:full,gemini-3.6-flash:summary \
 *     --summary-model gemini-3.5-flash-lite --judge gemini-3.6-flash --max-calls 300 [--dry-run]
 *
 * First config = baseline. Scoring:
 *   - rule checks (from the system prompt): quoted numbers exist in the data,
 *     no financial advice, <= 220 words (+10% slack), ends with an action
 *   - long threads: recall of facts planted early in the conversation
 *   - pairwise judge vs baseline (order randomized), plus a side-by-side
 *     appendix for a human to read
 * Output: bench-data/coach/results-<timestamp>.{json,md}
 */

const fs = require("fs");
const path = require("path");
const { CallBudget, captureUsage, mapLimit, parseArgs, pct, setupBenchEnv } = require("./lib");

const args = parseArgs();
const DRY = Boolean(args["dry-run"]);
const OUT_DIR = path.resolve(__dirname, "../../bench-data/coach");
const configs = String(args.configs || "gemini-3.6-flash:full,gemini-3.5-flash-lite:full,gemini-3.6-flash:summary")
  .split(",").map((s) => s.trim()).filter(Boolean)
  // "model:mode@think", e.g. gemini-3.6-flash:full@128 (think defaults to 512)
  .map((s) => {
    const [spec, think] = s.split("@");
    const [model, mode = "full"] = spec.split(":");
    return { model, mode, think: think === undefined ? 512 : Number(think), name: s };
  });
const SUMMARY_MODEL = String(args["summary-model"] || "gemini-3.5-flash-lite");
const JUDGE_MODEL = String(args.judge || "gemini-3.6-flash");
const budget = new CallBudget(args["max-calls"] || 300);

const { appConfig } = setupBenchEnv({ dryRun: DRY });
const usage = captureUsage();

if (DRY) {
  const sdk = require("@google/generative-ai");
  sdk.GoogleGenerativeAI.prototype.getGenerativeModel = function getGenerativeModel({ model }) {
    return {
      generateContent: async (req) => {
        const prompt = JSON.stringify(req).slice(0, 200);
        const isJudge = prompt.includes("impartial");
        return {
          response: {
            modelVersion: model,
            usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 250, thoughtsTokenCount: 200, totalTokenCount: 3450 },
            text: () => (isJudge
              ? JSON.stringify({ winner: "tie", reason: "dry run" })
              : "Win rate is 42.9% across 14 trades. Your leak is FOMO (-318.2). Tomorrow, wait for the candle close before any entry."),
          },
        };
      },
    };
  };
}

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { guardedCall } = require("../../utils/geminiCircuit");
const { buildModelInput } = require("../../services/coachPromptService");
const { buildGenerationConfig } = require("../../services/coachChatService");
const coachSummary = require("../../services/coachSummaryService");
const { withThinkingBudget } = require("../../utils/geminiConfig");
const { containsProhibitedFinancialAdvice } = require("../../services/geminiService");
const { CONTEXTS, LONG_CONVERSATIONS, QUESTIONS } = require("./fixtures/coachScenarios");

const client = () => new GoogleGenerativeAI(appConfig.ai.geminiApiKey);

async function generate({ model, request, feature, operationId }) {
  budget.take(1);
  const m = client().getGenerativeModel({ model });
  const result = await guardedCall({ feature, model, operationId, call: () => m.generateContent(request) });
  return String(result?.response?.text?.() || "").trim();
}

function withTimes(messages) {
  const start = Date.UTC(2026, 10, 27, 10);
  return messages.map((m, i) => ({ ...m, _id: `h${i}`, status: "complete", createdAt: new Date(start + i * 60_000) }));
}

async function historyFor(config, conv, opId) {
  const history = withTimes(conv.turns);
  if (config.mode !== "summary") return { history, summary: "" };
  const foldable = history.slice(0, Math.max(0, history.length - coachSummary.RECENT_MESSAGES));
  if (foldable.length < coachSummary.MIN_MESSAGES_TO_FOLD) return { history, summary: "" };
  const summary = await generate({
    model: SUMMARY_MODEL,
    feature: "coach_summary",
    operationId: opId,
    request: {
      contents: [{ role: "user", parts: [{ text: coachSummary.buildSummaryPrompt({ previousSummary: "", messages: foldable }) }] }],
      generationConfig: withThinkingBudget(SUMMARY_MODEL, { temperature: 0.1, maxOutputTokens: 700 }, 0),
    },
  });
  const window = coachSummary.selectWindow(history, { summary, summarizedThroughAt: foldable[foldable.length - 1].createdAt });
  return { history: window.recent, summary: window.summary };
}

async function answer(config, item, idx) {
  const opId = `${config.name}:${item.id}`;
  const context = CONTEXTS[item.ctx];
  const { history, summary } = item.turns ? await historyFor(config, item, opId) : { history: [], summary: "" };
  const input = buildModelInput({ context, anchor: { kind: "freeform" }, history, nextUserMessage: item.q, conversationSummary: summary });
  const text = await generate({
    model: config.model,
    feature: "coach",
    operationId: opId,
    request: { systemInstruction: input.systemInstruction, contents: input.contents, generationConfig: buildGenerationConfig(config.model, config.think) },
  }).catch((e) => `__ERROR__ ${e.message}`);
  await new Promise((r) => setImmediate(r));
  return { config: config.name, id: item.id, idx, text, summary, cost: usage.summarize(usage.forOperation(opId)) };
}

// ── rule checks ────────────────────────────────────────────────────────────
function numbersIn(text) {
  return (String(text).match(/-?\d[\d,]*(?:\.\d+)?%?/g) || [])
    .map((s) => s.replace(/[,%]/g, ""))
    .filter((s) => s.replace(/\D/g, "").length >= 3 || s.includes("."));
}

function checks(text, item) {
  const context = CONTEXTS[item.ctx];
  const source = (JSON.stringify(context) + JSON.stringify(item.turns || [])).replace(/,(?=\d{3})/g, "");
  const nums = numbersIn(text);
  const ungrounded = nums.filter((n) => !source.includes(n) && !source.includes(String(Math.abs(Number(n)))));
  const words = String(text).split(/\s+/).filter(Boolean).length;
  const tail = String(text).slice(-260);
  return {
    error: text.startsWith("__ERROR__"),
    grounded: ungrounded.length === 0,
    ungrounded,
    noAdvice: !containsProhibitedFinancialAdvice(text),
    lengthOk: words <= 242,
    words,
    endsWithAction: /\b(tomorrow|next (session|trade|week|time)|before (your|each|the|every) (next )?(trade|entry|session)|today|try|commit|set|write|log|wait|stop|use|only|start|close|limit|skip|step back)\b/i.test(tail),
    recall: item.mustRecall ? item.mustRecall.every((re) => re.test(text)) : null,
  };
}

// ── pairwise judge ─────────────────────────────────────────────────────────
async function judge(item, base, cand, flip) {
  const [A, B] = flip ? [cand, base] : [base, cand];
  const prompt = `You are an impartial reviewer of a trading-psychology coach. Compare two replies to the same trader question.
Judge on: accuracy to the data (no invented numbers), specificity to THIS trader, usefulness of the advice for behaviour (never buy/sell signals), honesty when data is missing, warmth and clarity, and (if the thread had earlier context) remembering what the trader said earlier.
Return ONLY JSON: {"winner":"A"|"B"|"tie","reason":"<one sentence>"}

Trader data (JSON): ${JSON.stringify(CONTEXTS[item.ctx])}
${item.turns ? `Earlier conversation: ${JSON.stringify(item.turns)}\n` : ""}Question: ${item.q}

Reply A:
${A.text}

Reply B:
${B.text}`;
  const raw = await generate({
    model: JUDGE_MODEL,
    feature: "coach",
    operationId: `judge:${cand.config}:${item.id}`,
    request: { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: "application/json" } },
  }).catch(() => "{}");
  let parsed = {};
  try { parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "")); } catch { /* tie */ }
  const w = parsed.winner;
  const candWon = flip ? w === "A" : w === "B";
  const baseWon = flip ? w === "B" : w === "A";
  return { result: candWon ? "win" : baseWon ? "loss" : "tie", reason: parsed.reason || "" };
}

async function main() {
  const items = [
    ...QUESTIONS.map((q, i) => ({ ...q, id: `q${i + 1}` })),
    ...LONG_CONVERSATIONS.map((c) => ({ ...c, q: c.probe })),
  ];
  console.log(`${items.length} items × ${configs.length} configs${DRY ? " (DRY RUN)" : ""}`);

  const answers = {};
  for (const config of configs) {
    answers[config.name] = await mapLimit(items, Number(args.concurrency || 3), (item, i) => answer(config, item, i));
    console.log(`  ${config.name}: done (${budget.used} calls)`);
  }

  const baseName = configs[0].name;
  const judged = {};
  for (const config of configs.slice(1)) {
    judged[config.name] = await mapLimit(items, 3, (item, i) => judge(item, answers[baseName][i], answers[config.name][i], i % 2 === 1));
  }

  const summaryRows = configs.map((c) => {
    const list = answers[c.name];
    const ch = list.map((a, i) => checks(a.text, items[i]));
    const long = ch.filter((x) => x.recall !== null);
    const cost = list.reduce((s, a) => s + a.cost.costUsd, 0);
    const tok = (k) => Math.round(list.reduce((s, a) => s + a.cost[k], 0) / list.length);
    const j = judged[c.name];
    return {
      name: c.name,
      errors: ch.filter((x) => x.error).length,
      grounded: pct(ch.filter((x) => x.grounded).length, ch.length),
      noAdvice: pct(ch.filter((x) => x.noAdvice).length, ch.length),
      lengthOk: pct(ch.filter((x) => x.lengthOk).length, ch.length),
      endsWithAction: pct(ch.filter((x) => x.endsWithAction).length, ch.length),
      recall: long.length ? pct(long.filter((x) => x.recall).length, long.length) : "n/a",
      avgWords: Math.round(ch.reduce((s, x) => s + x.words, 0) / ch.length),
      costPerReplyUsd: cost / list.length,
      avgInput: tok("inputTokens"), avgOutput: tok("outputTokens"), avgThinking: tok("thinkingTokens"),
      judge: j ? `${j.filter((x) => x.result === "win").length} win / ${j.filter((x) => x.result === "tie").length} tie / ${j.filter((x) => x.result === "loss").length} loss` : "baseline",
      checks: ch,
    };
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outBase = path.join(OUT_DIR, `results-${stamp}${DRY ? "-dry" : ""}`);
  fs.writeFileSync(`${outBase}.json`, JSON.stringify({ configs, answers, judged, summaryRows, items }, null, 2));

  const header = ["Config", "Cost/reply", "Avg in/out/think tokens", "Grounded numbers", "No advice", "≤220 words", "Ends with action", "Long-thread recall", "Judge vs baseline", "Errors"];
  const md = [
    `# Coach eval ${stamp}${DRY ? " (DRY RUN — fake model, numbers are meaningless)" : ""}`,
    "",
    `Baseline: \`${baseName}\`. Judge: \`${JUDGE_MODEL}\` (pairwise, order alternated). Summary model: \`${SUMMARY_MODEL}\`.`,
    "Rule checks are heuristics; read the side-by-side answers below before deciding.",
    "",
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...summaryRows.map((r) => `| ${r.name} | $${r.costPerReplyUsd.toFixed(6)} | ${r.avgInput} / ${r.avgOutput} / ${r.avgThinking} | ${r.grounded} | ${r.noAdvice} | ${r.lengthOk} (avg ${r.avgWords}) | ${r.endsWithAction} | ${r.recall} | ${r.judge} | ${r.errors} |`),
    "",
    "## Side by side",
    ...items.flatMap((item, i) => [
      "", `### ${item.id} (${item.ctx}${item.turns ? ", long thread" : ""}): ${item.q}`,
      ...configs.map((c) => {
        const a = answers[c.name][i];
        const ch = summaryRows.find((r) => r.name === c.name).checks[i];
        const j = judged[c.name]?.[i];
        const flags = [!ch.grounded && `ungrounded: ${ch.ungrounded.join(", ")}`, !ch.noAdvice && "ADVICE", !ch.lengthOk && `${ch.words} words`, ch.recall === false && "MISSED RECALL"].filter(Boolean).join("; ");
        return `\n**${c.name}**${j ? ` — judge: ${j.result} (${j.reason})` : ""}${flags ? ` — ⚠ ${flags}` : ""}\n\n> ${a.text.replace(/\n/g, "\n> ")}${a.summary ? `\n\n<details><summary>summary used</summary>\n\n${a.summary}\n</details>` : ""}`;
      }),
    ]),
  ].join("\n");
  fs.writeFileSync(`${outBase}.md`, md);
  console.log(md.split("## Side by side")[0]);
  console.log(`Wrote ${outBase}.md (calls used: ${budget.used})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
