"use strict";

// Shared helpers for the AI benchmarks: key setup, in-memory metering
// capture (no database needed), call budget guard, simple concurrency.

const path = require("path");

function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

// Must run before any service is required: services read appConfig lazily,
// but the key decides which billing project pays for the benchmark.
function setupBenchEnv({ dryRun = false } = {}) {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
  const { appConfig } = require("../../config");
  const key = process.env.GEMINI_BENCH_API_KEY || process.env.GEMINI_API_KEY || "";
  if (!dryRun && !key) {
    throw new Error("Set GEMINI_BENCH_API_KEY (a paid-tier key) in backend/.env. The local free-tier key allows only 20 calls a day.");
  }
  appConfig.ai.geminiApiKey = dryRun ? "dry-run" : key;
  appConfig.ai.openaiApiKey = ""; // benchmark Gemini only
  appConfig.ai.dailyTokenBudget = 0;
  appConfig.ai.spendAlerts = { dailyUsd: 0, userDailyUsd: 0 };
  // A benchmark must not be skipped by the circuit after a few hangs.
  appConfig.ai.circuit = { failureThreshold: 1_000_000, windowMs: 60_000, openMs: 1_000 };
  return { appConfig, usingBenchKey: Boolean(process.env.GEMINI_BENCH_API_KEY) };
}

// Replaces the AiUsage write with an in-memory list, so every metered call
// (cost, tokens, hedges) is captured exactly as production would record it.
function captureUsage() {
  const AiUsage = require("../../models/AiUsage");
  const rows = [];
  AiUsage.create = async (row) => { rows.push(row); return row; };
  return {
    rows,
    forOperation(id) { return rows.filter((r) => r.operationId === id); },
    summarize(list = rows) {
      const sum = (k) => list.reduce((s, r) => s + (Number(r[k]) || 0), 0);
      return {
        requests: list.length,
        costUsd: sum("costUsd"),
        estimatedUsd: list.filter((r) => r.costSource === "estimated").reduce((s, r) => s + r.costUsd, 0),
        inputTokens: sum("inputTokens"),
        outputTokens: sum("outputTokens"),
        thinkingTokens: sum("thinkingTokens"),
        cachedTokens: sum("cachedTokens"),
        hedgedAborted: list.filter((r) => r.aborted).length,
        failures: list.filter((r) => r.ok === false && !r.aborted).length,
      };
    },
  };
}

class CallBudget {
  constructor(max) { this.max = Number(max) || Infinity; this.used = 0; }
  take(n = 1) {
    if (this.used + n > this.max) throw new Error(`--max-calls ${this.max} reached; stopping before spending more`);
    this.used += n;
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next; next += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

module.exports = { CallBudget, captureUsage, mapLimit, parseArgs, pct, setupBenchEnv };
