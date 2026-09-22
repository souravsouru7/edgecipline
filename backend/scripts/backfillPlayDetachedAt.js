"use strict";

require("dotenv").config();

// One-off backfill for PlaySubscription.detachedAt.
//
// BACKGROUND. Before this field existed, account deletion detached a Play
// purchase by nulling `user`. A row created by a Google RTDN that arrived
// before the buyer's verify call ALSO has a null user — and the billing service
// could not tell the two apart, so it refused both as "owner deleted". The
// service now keys that refusal on `detachedAt`, which means every row that
// was detached by a deletion BEFORE this deploy must be stamped, or those
// tokens become bindable again.
//
// WHAT IT DOES. For every row with `user: null` and no `detachedAt`:
//
//   * if the row's `createdAt` is before --before=<ISO date> (the moment this
//     code was deployed), it is treated as a deletion-detached row and gets
//     `detachedAt = updatedAt` (the last write was the detach itself);
//   * otherwise it is left alone — it is a live RTDN-first row waiting for its
//     buyer.
//
// HONESTY NOTE. The collection has no record of WHY a user became null, so
// this is a judgement, not a fact: an RTDN-first row that was created before
// the deploy and whose buyer never opened the app again would be stamped too.
// Those rows are rare (the buyer's next app open binds them within minutes)
// and the alternative — leaving deletion-detached tokens bindable — is a
// security hole, so the script errs towards stamping. Rows that were ever
// entitled (state active/cancelled/grace/expired) are the strongest signal of
// a real former owner and are always stamped when before the cutoff.
//
// Run modes:
//   node backend/scripts/backfillPlayDetachedAt.js --before=2026-09-22T00:00:00Z            → dry-run
//   node backend/scripts/backfillPlayDetachedAt.js --before=2026-09-22T00:00:00Z --apply    → write
//
// Idempotent: rows that already carry detachedAt are never touched.

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const PlaySubscription = require("../models/PlaySubscription");

const APPLY = process.argv.includes("--apply");
const args = Object.fromEntries(
  process.argv
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [k, v] = arg.replace(/^--/, "").split("=");
      return [k, v];
    })
);

function fail(message) {
  console.error(`[play-detached-backfill] ${message}`);
  process.exit(1);
}

async function main() {
  const before = args.before ? new Date(args.before) : null;
  if (!before || Number.isNaN(before.getTime())) {
    fail("--before=<ISO date> is required: the time this code was deployed. Rows created after it are left alone.");
  }

  console.log("[play-detached-backfill] mode:", APPLY ? "APPLY (writing)" : "DRY-RUN");
  console.log("[play-detached-backfill] cutoff:", before.toISOString());

  await connectDB();

  const candidates = await PlaySubscription.find({
    user: null,
    $or: [{ detachedAt: null }, { detachedAt: { $exists: false } }],
  })
    .select("_id purchaseToken state createdAt updatedAt")
    .lean();

  const toStamp = candidates.filter((row) => new Date(row.createdAt) < before);
  const leftAlone = candidates.length - toStamp.length;

  console.log("[play-detached-backfill] unbound rows:", candidates.length);
  console.log("[play-detached-backfill] to stamp (created before cutoff):", toStamp.length);
  console.log("[play-detached-backfill] left alone (RTDN-first after cutoff):", leftAlone);

  for (const row of toStamp) {
    // Never print the token. The _id is enough to find the row again.
    console.log(`  ${row._id}  state=${row.state}  created=${new Date(row.createdAt).toISOString()}  lastWrite=${new Date(row.updatedAt).toISOString()}`);
  }

  if (!APPLY) {
    console.log("[play-detached-backfill] dry-run complete; re-run with --apply to write.");
    return;
  }

  let written = 0;
  for (const row of toStamp) {
    const result = await PlaySubscription.updateOne(
      { _id: row._id, user: null, $or: [{ detachedAt: null }, { detachedAt: { $exists: false } }] },
      { $set: { detachedAt: row.updatedAt || row.createdAt || new Date() } }
    );
    written += result.modifiedCount || result.nModified || 0;
  }

  console.log("[play-detached-backfill] rows stamped:", written);
}

main()
  .catch((error) => {
    console.error("[play-detached-backfill] failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.connection.close();
    } catch {
      // nothing to clean up
    }
  });
