#!/usr/bin/env node
"use strict";

/**
 * Screenshot-extraction benchmark. Runs the REAL production function
 * (extractTradeWithGeminiVision: same prompts, hedge and parsing) once per
 * candidate model on every case from exportExtractionSet.js, grades each field
 * against the trader's saved values, and costs every call with the
 * production metering code.
 *
 * Also evaluates "escalation": use the cheap model, and re-run on the strong
 * model only when the pipeline's own validation flags the answer (never
 * using the ground truth). This needs no extra calls: both models already ran.
 *
 * Usage:
 *   node scripts/bench/runExtractionBench.js \
 *     --models gemini-3.6-flash,gemini-3.5-flash-lite \
 *     --baseline gemini-3.6-flash --max-calls 400 [--limit 20] [--concurrency 2] [--dry-run]
 *
 * Output: bench-data/extraction/results-<timestamp>.{json,md}
 */

const fs = require("fs");
const path = require("path");
const { CallBudget, captureUsage, mapLimit, parseArgs, pct, setupBenchEnv } = require("./lib");
const grading = require("./grading");

const args = parseArgs();
const DRY = Boolean(args["dry-run"]);
const DATA_DIR = path.resolve(__dirname, "../../bench-data/extraction");
const models = String(args.models || "gemini-3.6-flash,gemini-3.5-flash-lite").split(",").map((s) => s.trim()).filter(Boolean);
const baseline = String(args.baseline || models[0]);
const budget = new CallBudget(args["max-calls"] || 400);

setupBenchEnv({ dryRun: DRY });
const usage = captureUsage();

if (DRY) {
  // Scripted fake Gemini: proves loading, grading, costing and the report
  // without spending a call.
  const sdk = require("@google/generative-ai");
  sdk.GoogleGenerativeAI.prototype.getGenerativeModel = function getGenerativeModel({ model }) {
    return {
      generateContent: async () => ({
        response: {
          modelVersion: model,
          usageMetadata: { promptTokenCount: 2284, candidatesTokenCount: 180, totalTokenCount: 2464 },
          text: () => JSON.stringify({ pair: "EURUSD", type: "BUY", quantity: 0.1, entryPrice: 1.085, exitPrice: 1.09, profit: 50 }),
        },
      }),
    };
  };
}

const { extractTradeWithGeminiVision } = require("../../services/aiExtractionService");

function loadCases() {
  const file = path.join(DATA_DIR, "expected.json");
  if (!fs.existsSync(file)) {
    if (DRY) {
      return [{
        caseId: "dry1", bucket: "forex", marketType: "Forex", broker: "MetaTrader 5", image: null, mimeType: "image/png",
        trades: [{ pair: "EURUSD", type: "BUY", entryPrice: 1.085, exitPrice: 1.09, profit: 50, tradeDate: "2026-11-01" }],
      }];
    }
    throw new Error(`No dataset at ${file}. Run scripts/bench/exportExtractionSet.js first.`);
  }
  const { cases } = JSON.parse(fs.readFileSync(file, "utf8"));
  return args.limit ? cases.slice(0, Number(args.limit)) : cases;
}

async function runOne(testCase, model) {
  const operationId = `${model}:${testCase.caseId}`;
  const imageBuffer = testCase.image ? fs.readFileSync(path.join(DATA_DIR, testCase.image)) : Buffer.from("dry");
  budget.take(1);
  const started = Date.now();
  let result = null;
  let error = null;
  try {
    result = await extractTradeWithGeminiVision("https://bench.local/image", {
      marketType: testCase.marketType,
      tradeSubType: testCase.tradeSubType,
      imageBuffer,
      imageMimeType: testCase.mimeType,
      brokerHint: testCase.broker || "",
      operationId,
      model,
    });
  } catch (e) {
    error = e.code || e.message; // e.g. WRONG_MARKET_TYPE
  }
  // Let fire-and-forget metering land.
  await new Promise((r) => setImmediate(r));
  const rows = usage.forOperation(operationId);
  // A hedge may have sent a second request.
  if (rows.length > 1) budget.used += rows.length - 1;
  return {
    model, caseId: testCase.caseId, latencyMs: Date.now() - started, error,
    result: result ? { ...result, rawResponse: undefined } : null,
    grade: grading.gradeCase(testCase, result),
    escalate: grading.needsEscalation(testCase, result),
    cost: usage.summarize(rows),
  };
}

function aggregate(runs) {
  const fields = {};
  let silentWrong = 0;
  let invalid = 0;
  let allRows = 0;
  let cost = 0;
  let requests = 0;
  let hedges = 0;
  let correctCases = 0;
  const latencies = [];
  for (const r of runs) {
    for (const [f, t] of Object.entries(r.grade.tally)) {
      fields[f] = fields[f] || { graded: 0, correct: 0, missing: 0, wrong: 0 };
      for (const k of Object.keys(t)) fields[f][k] += t[k];
    }
    silentWrong += r.grade.silentWrong;
    if (r.grade.invalid) invalid += 1;
    if (r.grade.allRowsFound) allRows += 1;
    const caseCorrect = !r.grade.invalid && r.grade.silentWrong === 0 && r.grade.allRowsFound;
    if (caseCorrect) correctCases += 1;
    cost += r.cost.costUsd;
    requests += r.cost.requests;
    hedges += r.cost.hedgedAborted;
    latencies.push(r.latencyMs);
  }
  latencies.sort((a, b) => a - b);
  return {
    cases: runs.length, fields, silentWrong, invalid, allRows, correctCases,
    costUsd: cost, requests, hedges,
    costPerCaseUsd: runs.length ? cost / runs.length : 0,
    costPerCorrectUsd: correctCases ? cost / correctCases : null,
    p50LatencyMs: latencies[Math.floor(latencies.length / 2)] || 0,
    p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] || 0,
  };
}

// Cheap model first; strong model only where validation flagged the answer.
function escalationRuns(byModel, cheap, strong) {
  return byModel[cheap].map((r, i) => {
    const s = byModel[strong][i];
    if (!r.escalate) return r;
    return {
      ...s,
      model: `${cheap}>${strong}`,
      cost: {
        ...s.cost,
        costUsd: r.cost.costUsd + s.cost.costUsd,
        requests: r.cost.requests + s.cost.requests,
        hedgedAborted: r.cost.hedgedAborted + s.cost.hedgedAborted,
      },
      latencyMs: r.latencyMs + s.latencyMs,
      escalated: true,
    };
  });
}

function fieldTable(aggs) {
  const names = Object.keys(aggs);
  const allFields = [...new Set(names.flatMap((n) => Object.keys(aggs[n].fields)))];
  const lines = [`| Field | ${names.join(" | ")} |`, `|---|${names.map(() => "---:").join("|")}|`];
  for (const f of allFields) {
    lines.push(`| ${f} | ${names.map((n) => {
      const t = aggs[n].fields[f];
      return t ? `${pct(t.correct, t.graded)} (wrong ${t.wrong}, empty ${t.missing}, n=${t.graded})` : "—";
    }).join(" | ")} |`);
  }
  return lines.join("\n");
}

function summaryTable(aggs) {
  const names = Object.keys(aggs);
  const row = (label, fn) => `| ${label} | ${names.map((n) => fn(aggs[n])).join(" | ")} |`;
  return [
    `| Metric | ${names.join(" | ")} |`,
    `|---|${names.map(() => "---:").join("|")}|`,
    row("Cases", (a) => a.cases),
    row("Fully correct cases", (a) => `${a.correctCases} (${pct(a.correctCases, a.cases)})`),
    row("Silent wrong critical values", (a) => a.silentWrong),
    row("Invalid / no extraction", (a) => `${a.invalid} (${pct(a.invalid, a.cases)})`),
    row("All saved rows found", (a) => pct(a.allRows, a.cases)),
    row("Requests (incl. hedges)", (a) => `${a.requests} (${a.hedges} hedged)`),
    row("Cost per screenshot", (a) => `$${a.costPerCaseUsd.toFixed(6)}`),
    row("Cost per correct extraction", (a) => (a.costPerCorrectUsd == null ? "n/a" : `$${a.costPerCorrectUsd.toFixed(6)}`)),
    row("Latency p50 / p95", (a) => `${(a.p50LatencyMs / 1000).toFixed(1)}s / ${(a.p95LatencyMs / 1000).toFixed(1)}s`),
  ].join("\n");
}

// Pass bar from the plan: no field more than 1 point worse than baseline,
// and no extra silent wrong critical values.
function verdict(aggs, name) {
  const base = aggs[baseline];
  const cand = aggs[name];
  const reasons = [];
  for (const [f, t] of Object.entries(base.fields)) {
    const c = cand.fields[f];
    if (!c || !t.graded) continue;
    const drop = (100 * t.correct) / t.graded - (100 * c.correct) / c.graded;
    if (drop > 1) reasons.push(`${f} accuracy ${drop.toFixed(1)} pts lower`);
  }
  if (cand.silentWrong > base.silentWrong) reasons.push(`${cand.silentWrong - base.silentWrong} more silent wrong critical values`);
  if (cand.invalid > base.invalid) reasons.push(`${cand.invalid - base.invalid} more failed extractions`);
  return { pass: reasons.length === 0, reasons };
}

async function main() {
  const cases = loadCases();
  console.log(`${cases.length} cases × ${models.length} models${DRY ? " (DRY RUN, fake model)" : ""}`);
  const byModel = {};
  for (const model of models) {
    byModel[model] = await mapLimit(cases, Number(args.concurrency || 2), (c) => runOne(c, model));
    console.log(`  ${model}: done (${budget.used} calls so far)`);
  }

  const aggs = {};
  for (const m of models) aggs[m] = aggregate(byModel[m]);
  const strong = baseline;
  for (const cheap of models.filter((m) => m !== strong)) {
    const runs = escalationRuns(byModel, cheap, strong);
    aggs[`${cheap}>${strong}`] = { ...aggregate(runs), escalated: runs.filter((r) => r.escalated).length };
  }

  const verdicts = Object.fromEntries(Object.keys(aggs).filter((n) => n !== baseline).map((n) => [n, verdict(aggs, n)]));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outBase = path.join(DATA_DIR, `results-${stamp}${DRY ? "-dry" : ""}`);
  fs.writeFileSync(`${outBase}.json`, JSON.stringify({ models, baseline, aggs, verdicts, runs: byModel }, null, 2));

  const md = [
    `# Extraction benchmark ${stamp}${DRY ? " (DRY RUN — fake model, numbers are meaningless)" : ""}`,
    "",
    `Cases: ${cases.length}. Baseline: \`${baseline}\`. Ground truth: values the trader saved after review.`,
    "Field cells: share of saved values extracted exactly (\"wrong\" = a different value was filled in; \"empty\" = left blank for the trader).",
    "",
    "## Summary", "", summaryTable(aggs), "",
    "## Field accuracy", "", fieldTable(aggs), "",
    "## Verdict against the pass bar", "",
    ...Object.entries(verdicts).map(([n, v]) => `- **${n}**: ${v.pass ? "PASS" : "FAIL"}${v.reasons.length ? ` — ${v.reasons.join("; ")}` : ""}${aggs[n].escalated != null ? ` (escalated ${aggs[n].escalated}/${aggs[n].cases})` : ""}`),
    "",
    "## Wrong values (for manual review)", "",
    ...Object.values(byModel).flat().filter((r) => r.grade.wrongDetails.length)
      .map((r) => `- ${r.model} / ${r.caseId}: ${r.grade.wrongDetails.map((w) => `${w.field} expected ${w.expected} got ${w.actual}`).join("; ")}`),
  ].join("\n");
  fs.writeFileSync(`${outBase}.md`, md);
  console.log(md.split("## Field accuracy")[0]);
  console.log(`\nWrote ${outBase}.md and .json  (calls used: ${budget.used})`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
