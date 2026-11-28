#!/usr/bin/env node
"use strict";

/**
 * Builds the screenshot-extraction benchmark set from SAVED trades.
 *
 * Ground truth = the values the trader saved after the review/correction
 * screen. It is not perfect (a trader can leave a wrong value or skip a
 * field), so the benchmark grades only fields the trader filled in, and
 * reports both models against the same truth.
 *
 * READ-ONLY: only find() queries; nothing is written to the database.
 * Output (git-ignored): backend/bench-data/extraction/{expected.json, images/}
 * Stored per case: the screenshot and the saved trade fields. No user id,
 * email, name or notes.
 *
 * Usage:
 *   BENCH_MONGODB_URI="mongodb+srv://..." node scripts/bench/exportExtractionSet.js [--per-bucket 30]
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const URI = process.env.BENCH_MONGODB_URI || argVal("uri", "");
const PER_BUCKET = Number(argVal("per-bucket", 30));
const OUT_DIR = path.resolve(__dirname, "../../bench-data/extraction");
const ALLOWED_HOSTS = new Set(["res.cloudinary.com"]);

if (!URI) {
  console.error("Set BENCH_MONGODB_URI (the database to sample from). Nothing was read.");
  process.exit(1);
}

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function forexTruth(t) {
  return {
    pair: t.pair || null, type: t.type || null, quantity: num(t.quantity),
    entryPrice: num(t.entryPrice), exitPrice: num(t.exitPrice),
    stopLoss: num(t.stopLoss), takeProfit: num(t.takeProfit),
    profit: num(t.profit), tradeDate: day(t.tradeDate),
  };
}

function indianTruth(t) {
  const equity = t.instrumentType === "EQUITY";
  return equity
    ? {
        stockSymbol: t.stockSymbol || null, type: t.type || null,
        entryPrice: num(t.entryPrice), exitPrice: num(t.exitPrice),
        profit: num(t.profit), tradeDate: day(t.tradeDate),
      }
    : {
        pair: t.pair || null, underlying: t.underlying || null, optionType: t.optionType || null,
        strikePrice: num(t.strikePrice), quantity: num(t.quantity),
        entryPrice: num(t.entryPrice), exitPrice: num(t.exitPrice),
        stopLoss: num(t.stopLoss), takeProfit: num(t.takeProfit),
        profit: num(t.profit), tradeDate: day(t.tradeDate),
      };
}

async function download(url, file) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) throw new Error(`host not allowed: ${parsed.hostname}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return { mimeType: res.headers.get("content-type")?.split(";")[0] || "image/jpeg", bytes: buf.length };
}

// Pick up to `limit` cases, round-robin across brokers so one broker can't
// dominate, and keep the multi-trade screenshots.
function pickVaried(groups, limit) {
  const byBroker = new Map();
  for (const g of groups) {
    const k = (g.broker || "unknown").toLowerCase();
    if (!byBroker.has(k)) byBroker.set(k, []);
    byBroker.get(k).push(g);
  }
  for (const list of byBroker.values()) list.sort((a, b) => b.trades.length - a.trades.length);
  const out = [];
  while (out.length < limit && [...byBroker.values()].some((l) => l.length)) {
    for (const list of byBroker.values()) if (list.length && out.length < limit) out.push(list.shift());
  }
  return out;
}

async function main() {
  await mongoose.connect(URI, { readPreference: "secondaryPreferred", autoIndex: false, maxPoolSize: 2 });
  const db = mongoose.connection.db;

  const ocrJobs = new Map();
  const jobsCursor = db.collection("ocrjobs").find(
    { "uploadedImage.imageUrl": { $regex: "^https://res\\.cloudinary\\.com/" } },
    { projection: { marketType: 1, tradeSubType: 1, broker: 1, "uploadedImage.imageUrl": 1 } }
  ).sort({ createdAt: -1 }).limit(5000);
  for await (const j of jobsCursor) ocrJobs.set(String(j._id), j);

  const groups = new Map();
  const addTrade = (t, marketType, truth) => {
    const jobId = String(t.ocrJobId || "");
    const job = ocrJobs.get(jobId);
    const image = job?.uploadedImage?.imageUrl || t.screenshot || t.imageUrl;
    if (!jobId || !image || !/^https:\/\/res\.cloudinary\.com\//.test(image)) return;
    if (!groups.has(jobId)) {
      groups.set(jobId, {
        jobId,
        image,
        marketType,
        tradeSubType: marketType === "Indian_Market" ? (t.instrumentType === "EQUITY" ? "EQUITY" : "OPTION") : "",
        broker: job?.broker || t.broker || "",
        trades: [],
      });
    }
    groups.get(jobId).trades.push(truth);
  };

  const forex = db.collection("trades").find(
    { deletedAt: null, ocrJobId: { $nin: ["", null] }, "parsedData.multiTradeGhost": { $ne: true } },
    { projection: { pair: 1, type: 1, quantity: 1, entryPrice: 1, exitPrice: 1, stopLoss: 1, takeProfit: 1, profit: 1, tradeDate: 1, ocrJobId: 1, screenshot: 1, imageUrl: 1, broker: 1 } }
  ).sort({ createdAt: -1 }).limit(3000);
  for await (const t of forex) addTrade(t, "Forex", forexTruth(t));

  const indian = db.collection("indiantrades").find(
    { deletedAt: null, ocrJobId: { $nin: ["", null] } },
    { projection: { pair: 1, underlying: 1, optionType: 1, strikePrice: 1, quantity: 1, entryPrice: 1, exitPrice: 1, stopLoss: 1, takeProfit: 1, profit: 1, tradeDate: 1, stockSymbol: 1, type: 1, instrumentType: 1, ocrJobId: 1, screenshot: 1 } }
  ).sort({ createdAt: -1 }).limit(3000);
  for await (const t of indian) addTrade(t, "Indian_Market", indianTruth(t));

  await mongoose.disconnect();

  const all = [...groups.values()];
  const buckets = {
    forex: all.filter((g) => g.marketType === "Forex"),
    indian_option: all.filter((g) => g.marketType === "Indian_Market" && g.tradeSubType === "OPTION"),
    indian_equity: all.filter((g) => g.marketType === "Indian_Market" && g.tradeSubType === "EQUITY"),
  };

  fs.mkdirSync(path.join(OUT_DIR, "images"), { recursive: true });
  const cases = [];
  for (const [bucket, list] of Object.entries(buckets)) {
    const picked = pickVaried(list, PER_BUCKET);
    for (const g of picked) {
      const caseId = crypto.createHash("sha1").update(g.jobId).digest("hex").slice(0, 12);
      const ext = /\.png(\?|$)/i.test(g.image) ? "png" : "jpg";
      const file = path.join(OUT_DIR, "images", `${caseId}.${ext}`);
      try {
        const { mimeType } = fs.existsSync(file) ? { mimeType: ext === "png" ? "image/png" : "image/jpeg" } : await download(g.image, file);
        cases.push({
          caseId, bucket, marketType: g.marketType, tradeSubType: g.tradeSubType || undefined,
          broker: g.broker || null, image: `images/${caseId}.${ext}`, mimeType, trades: g.trades,
        });
      } catch (error) {
        console.warn(`skip ${caseId}: ${error.message}`);
      }
    }
    console.log(`${bucket}: ${list.length} candidate screenshots, ${cases.filter((c) => c.bucket === bucket).length} exported`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "expected.json"), JSON.stringify({ exportedAt: new Date().toISOString(), cases }, null, 2));
  console.log(`Wrote ${cases.length} cases to ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
