/**
 * Builds the capacity table from the k6 summary exports in results/.
 *
 * Reads every results/<label>.json produced by --summary-export and prints one
 * row per load level, plus the matching peak resource figures from the
 * <label>-resources.csv written by monitor-resources.ps1.
 *
 * Usage:
 *   node tests/performance/scripts/summarize-results.js
 *   node tests/performance/scripts/summarize-results.js --markdown
 */

const fs = require("fs");
const path = require("path");

const RESULTS_DIR = path.join(__dirname, "..", "results");
const MARKDOWN = process.argv.includes("--markdown");

// Explicit ordering so the capacity curve reads low -> high rather than
// alphabetically (which would put 100 before 25).
const ORDER = [
  "L-3vu", "L-10vu", "L-25vu", "L-50vu", "L-100vu",
  "L-150vu", "L-200vu", "L-250vu", "L-300vu", "L-400vu",
  "stress-450", "spike-300", "soak-150", "auth-load", "prodlimit-100vu",
];

function vusFromLabel(label) {
  const m = label.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function num(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return "-";
  return Number(v).toFixed(digits);
}

function readSummary(label) {
  const file = path.join(RESULTS_DIR, `${label}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readResources(label) {
  const file = path.join(RESULTS_DIR, `${label}-resources.csv`);
  if (!fs.existsSync(file)) return null;

  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  const header = lines[0].replace(/^﻿/, "").split(",").map((h) => h.replace(/"/g, ""));
  const idx = (name) => header.indexOf(name);
  const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.replace(/"/g, "")));

  const col = (name) => {
    const i = idx(name);
    if (i === -1) return [];
    return rows.map((r) => Number(r[i])).filter((n) => Number.isFinite(n));
  };

  const max = (arr) => (arr.length ? Math.max(...arr) : null);
  const min = (arr) => (arr.length ? Math.min(...arr) : null);

  return {
    apiCpuPeak: max(col("ApiCpuPct")),
    mongoCpuPeak: max(col("MongoCpuPct")),
    redisCpuPeak: max(col("RedisCpuPct")),
    apiMemPeak: max(col("ApiMemMB")),
    availMin: min(col("SysAvailableMB")),
  };
}

/** k6 summary-export nests metrics under "metrics". */
function metric(summary, name) {
  return summary?.metrics?.[name] || null;
}

function rateOf(summary, name) {
  const m = metric(summary, name);
  if (!m) return null;
  // k6 Rate metrics expose "value" as a 0..1 fraction.
  if (typeof m.value === "number") return m.value * 100;
  return null;
}

function countOf(summary, name) {
  const m = metric(summary, name);
  if (!m) return null;
  return typeof m.count === "number" ? m.count : null;
}

const rows = [];

for (const label of ORDER) {
  const s = readSummary(label);
  if (!s) continue;

  const dur = metric(s, "http_req_duration") || {};
  const reqs = metric(s, "http_reqs") || {};
  const res = readResources(label);

  rows.push({
    label,
    vus: vusFromLabel(label),
    rps: reqs.rate ?? null,
    total: reqs.count ?? null,
    avg: dur.avg ?? null,
    p50: dur.med ?? null,
    p90: dur["p(90)"] ?? null,
    p95: dur["p(95)"] ?? null,
    p99: dur["p(99)"] ?? null,
    max: dur.max ?? null,
    errPct: rateOf(s, "business_errors"),
    httpFailPct: rateOf(s, "http_req_failed"),
    rl429: countOf(s, "rate_limited_429") ?? 0,
    to: countOf(s, "request_timeouts") ?? 0,
    e5xx: countOf(s, "server_errors_5xx") ?? 0,
    journeysOk: countOf(s, "user_journeys_completed") ?? 0,
    journeysBad: countOf(s, "user_journeys_failed") ?? 0,
    res,
  });
}

if (rows.length === 0) {
  console.log("No k6 summary exports found in results/.");
  process.exit(0);
}

if (MARKDOWN) {
  console.log("| Level | VUs | RPS | avg | p50 | p90 | p95 | p99 | max | Err% | 429 | Timeouts | 5xx |");
  console.log("|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const r of rows) {
    console.log(
      `| ${r.label} | ${r.vus ?? "-"} | ${num(r.rps)} | ${num(r.avg)} | ${num(r.p50)} | ${num(r.p90)} | ` +
        `${num(r.p95)} | ${num(r.p99)} | ${num(r.max)} | ${num(r.errPct, 2)} | ${r.rl429} | ${r.to} | ${r.e5xx} |`
    );
  }
  console.log("");
  console.log("| Level | API CPU peak % | Mongo CPU peak % | Redis CPU peak % | API mem peak MB | Host avail min MB |");
  console.log("|---|--:|--:|--:|--:|--:|");
  for (const r of rows) {
    if (!r.res) continue;
    console.log(
      `| ${r.label} | ${num(r.res.apiCpuPeak, 0)} | ${num(r.res.mongoCpuPeak, 0)} | ${num(r.res.redisCpuPeak, 0)} | ` +
        `${num(r.res.apiMemPeak, 0)} | ${num(r.res.availMin, 0)} |`
    );
  }
} else {
  const h =
    "Level".padEnd(12) + "VUs".padStart(5) + "RPS".padStart(8) + "p50".padStart(9) +
    "p90".padStart(9) + "p95".padStart(9) + "p99".padStart(10) + "Err%".padStart(8) +
    "429".padStart(6) + "T/O".padStart(6) + "5xx".padStart(6);
  console.log(h);
  console.log("-".repeat(h.length));
  for (const r of rows) {
    console.log(
      r.label.padEnd(12) +
        String(r.vus ?? "-").padStart(5) +
        num(r.rps).padStart(8) +
        num(r.p50).padStart(9) +
        num(r.p90).padStart(9) +
        num(r.p95).padStart(9) +
        num(r.p99).padStart(10) +
        num(r.errPct, 2).padStart(8) +
        String(r.rl429).padStart(6) +
        String(r.to).padStart(6) +
        String(r.e5xx).padStart(6)
    );
  }
}
