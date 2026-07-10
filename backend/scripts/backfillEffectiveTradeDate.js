"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = Math.min(
  5000,
  Math.max(100, Number(process.env.EFFECTIVE_DATE_BACKFILL_BATCH_SIZE) || 1000)
);
const MISSING_EFFECTIVE_DATE = {
  $or: [
    { effectiveTradeDate: { $exists: false } },
    { effectiveTradeDate: null },
  ],
};

async function backfillModel(model) {
  const pending = await model.countDocuments(MISSING_EFFECTIVE_DATE);
  console.log(`${model.modelName}: ${pending} documents need effectiveTradeDate`);

  if (!APPLY || pending === 0) return { pending, updated: 0 };

  const cursor = model
    .find(MISSING_EFFECTIVE_DATE)
    .select("_id tradeDate createdAt")
    .sort({ _id: 1 })
    .lean()
    .cursor();

  let operations = [];
  let updated = 0;

  async function flush() {
    if (operations.length === 0) return;
    const result = await model.bulkWrite(operations, { ordered: false });
    updated += result.modifiedCount;
    operations = [];
    console.log(`${model.modelName}: updated ${updated}/${pending}`);
  }

  for await (const document of cursor) {
    operations.push({
      updateOne: {
        filter: { _id: document._id, ...MISSING_EFFECTIVE_DATE },
        update: {
          $set: {
            effectiveTradeDate: document.tradeDate || document.createdAt || new Date(),
          },
        },
      },
    });

    if (operations.length >= BATCH_SIZE) {
      await flush();
    }
  }

  await flush();
  return { pending, updated };
}

async function main() {
  await connectDB();

  try {
    const results = [];
    results.push(await backfillModel(Trade));
    results.push(await backfillModel(IndianTrade));

    const pending = results.reduce((sum, result) => sum + result.pending, 0);
    const updated = results.reduce((sum, result) => sum + result.updated, 0);

    if (!APPLY) {
      console.log(`Dry run only: ${pending} documents would be updated.`);
      console.log("Re-run with --apply after reviewing this count.");
      return;
    }

    console.log(`Backfill complete: ${updated}/${pending} documents updated.`);
  } finally {
    await mongoose.connection.close();
  }
}

main().catch(async (error) => {
  console.error("effectiveTradeDate backfill failed:", error.message);
  await mongoose.connection.close().catch(() => {});
  process.exitCode = 1;
});
