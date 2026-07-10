"use strict";

require("dotenv").config();

// Bulk backfill for the new onboarding funnel.
//
// Run modes:
//   node backend/scripts/backfillOnboarding.js              → dry-run summary
//   node backend/scripts/backfillOnboarding.js --apply      → write changes
//   node backend/scripts/backfillOnboarding.js --apply --concurrency=50
//
// Idempotent and safe to re-run. Only writes "true" flags and earliest-known
// timestamps (via $min), so a second pass produces zero further writes when
// the data hasn't changed.

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/Users");
const { backfillUserOnboarding } = require("../services/onboardingBackfillService");

const APPLY = process.argv.includes("--apply");
const args = Object.fromEntries(
  process.argv
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [k, v] = arg.replace(/^--/, "").split("=");
      return [k, v];
    })
);

const CONCURRENCY = Math.min(100, Math.max(1, Number(args.concurrency) || 25));
const BATCH_SIZE = Math.min(5000, Math.max(50, Number(args.batchSize) || 500));
const LOG_EVERY = Math.max(25, Number(args.logEvery) || 200);

function logMode() {
  console.log("[onboarding-backfill] mode:", APPLY ? "APPLY (writing)" : "DRY-RUN");
  console.log("[onboarding-backfill] concurrency:", CONCURRENCY, "batch:", BATCH_SIZE);
}

async function main() {
  logMode();
  await connectDB();
  console.log("[onboarding-backfill] db ready");

  const total = await User.countDocuments({});
  console.log(`[onboarding-backfill] users to scan: ${total}`);

  let processed = 0;
  let changed = 0;
  let skipped = 0;
  const reasonCounts = {};

  for (let skip = 0; skip < total; skip += BATCH_SIZE) {
    const batch = await User.find({}, { _id: 1 }).skip(skip).limit(BATCH_SIZE).lean();

    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY);
      await Promise.all(slice.map(async (user) => {
        try {
          const result = await backfillUserOnboarding(user._id, {
            force: true,
            dryRun: !APPLY,
          });
          if (result.changed) {
            changed += 1;
          } else {
            skipped += 1;
            reasonCounts[result.reason] = (reasonCounts[result.reason] || 0) + 1;
          }
        } catch (error) {
          console.warn(`[onboarding-backfill] user ${user._id} failed:`, error?.message);
        }
      }));
      processed += slice.length;
      if (processed % LOG_EVERY < CONCURRENCY) {
        console.log(`[onboarding-backfill] progress: ${processed}/${total} · changed=${changed} skipped=${skipped}`);
      }
    }
  }

  console.log("\n[onboarding-backfill] summary");
  console.log("  processed :", processed);
  console.log("  changed   :", changed);
  console.log("  skipped   :", skipped);
  if (Object.keys(reasonCounts).length) {
    console.log("  skip reasons:");
    for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${reason.padEnd(24)} ${count}`);
    }
  }

  if (!APPLY) {
    console.log("\nDry-run only — no writes. Re-run with --apply to commit.");
  }

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("[onboarding-backfill] fatal", error);
  process.exit(1);
});
