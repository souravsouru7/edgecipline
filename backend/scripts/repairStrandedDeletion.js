/**
 * Repair accounts stranded by a failed account deletion.
 *
 * deleteAccount() disables the account and revokes its refresh tokens BEFORE it
 * purges anything, so a half-erased account can never keep being used. If the
 * purge then throws, the account is left in a state it cannot get out of on its
 * own: disabled (so login and every authenticated route reject it) but with all
 * of its data still present. The user sees "Something went wrong", then gets
 * bounced to the login page and locked out of an account that was never deleted.
 *
 * That is what the OCRJob export bug did — `require("../models/OCRJob")` handed
 * back `{ OCR_JOB_STATUSES, OCRJob }` rather than the model, so the purge died on
 * "Model.deleteMany is not a function" partway through. This script cleans up
 * after accounts caught by that, or by any future mid-purge failure.
 *
 * Usage:
 *   node scripts/repairStrandedDeletion.js --list
 *   node scripts/repairStrandedDeletion.js <email> --restore
 *   node scripts/repairStrandedDeletion.js <email> --purge
 *
 *   --list     show every disabled account and what data it still holds
 *   --restore  reactivate the account (the deletion did not happen; undo the lockout)
 *   --purge    finish the deletion that failed (irreversible)
 *
 * --restore bumps tokenVersion, so any access token issued before the failed
 * deletion is dead and the user signs in fresh.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const User = require("../models/Users");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const { deleteAccount } = require("../services/accountDeletionService");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const email = args.find((a) => !a.startsWith("--"));

const USAGE = `Usage:
  node scripts/repairStrandedDeletion.js --list
  node scripts/repairStrandedDeletion.js <email> --restore
  node scripts/repairStrandedDeletion.js <email> --purge`;

// Best-effort: the auth cache holds accountStatus, so a stale entry would keep
// rejecting a restored user until it expires (default 300s). Redis is lazyConnect,
// and the repair is still correct without it — never let this abort the run.
async function clearAuthCache(userId) {
  try {
    const { connectRedis } = require("../config/redis");
    const { invalidateAuthCache } = require("../services/authCacheService");
    await connectRedis();
    await invalidateAuthCache(userId);
    return true;
  } catch {
    return false;
  }
}

async function describe(user) {
  const [forex, indian] = await Promise.all([
    Trade.countDocuments({ user: user._id }),
    IndianTrade.countDocuments({ user: user._id }),
  ]);
  return { forex, indian };
}

(async () => {
  if (!flags.has("--list") && !flags.has("--restore") && !flags.has("--purge")) {
    console.error(USAGE);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  if (flags.has("--list")) {
    const stranded = await User.find({ accountStatus: "disabled" })
      .select("_id email name accountStatus pendingDeletion updatedAt")
      .lean();

    if (stranded.length === 0) {
      console.log("No disabled accounts found — nothing to repair.");
      await mongoose.disconnect();
      return;
    }

    console.log(`Found ${stranded.length} disabled account(s):\n`);
    for (const user of stranded) {
      const { forex, indian } = await describe(user);
      // Surviving trades mean the purge never finished. A genuinely deleted
      // account has no Users document left to list in the first place.
      console.log(`  ${user.email}`);
      console.log(`    id              : ${user._id}`);
      console.log(`    pendingDeletion : ${user.pendingDeletion === true}`);
      console.log(`    trades left     : ${forex} forex, ${indian} indian`);
      console.log(`    last updated    : ${user.updatedAt || "unknown"}`);
      console.log("");
    }
    console.log("Re-run with <email> --restore to reactivate, or --purge to finish deleting.");
    await mongoose.disconnect();
    return;
  }

  if (!email) {
    console.error(USAGE);
    await mongoose.disconnect();
    process.exit(1);
  }

  const user = await User.findOne({ email: String(email).toLowerCase().trim() })
    .select("_id email accountStatus pendingDeletion")
    .lean();

  if (!user) {
    console.error(`No user found with email: ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (flags.has("--restore")) {
    if (user.accountStatus !== "disabled") {
      console.log(`${user.email} is already active — nothing to do.`);
      await mongoose.disconnect();
      return;
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: { accountStatus: "active", pendingDeletion: false },
        $inc: { tokenVersion: 1 },
      }
    );
    const cacheCleared = await clearAuthCache(user._id);

    const { forex, indian } = await describe(user);
    console.log(`✓ Restored ${user.email}`);
    console.log(`  Trades intact : ${forex} forex, ${indian} indian`);
    console.log(`  Auth cache    : ${cacheCleared ? "invalidated" : "not reachable (expires within ~5 min)"}`);
    console.log(`  The user must sign in again — all previous tokens were revoked.`);
    await mongoose.disconnect();
    return;
  }

  // --purge
  console.log(`Finishing the failed deletion for ${user.email} (${user._id})...`);
  const summary = await deleteAccount(user._id);
  console.log(`✓ Deleted ${summary.email}`);
  console.log(`  Collections cleared : ${Object.keys(summary.documentsDeleted).length}`);
  console.log(`  Images destroyed    : ${summary.images.destroyed} (${summary.images.failed} failed)`);
  console.log(`  Firebase identity   : ${summary.firebase.deleted ? "deleted" : summary.firebase.reason}`);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("Repair failed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
