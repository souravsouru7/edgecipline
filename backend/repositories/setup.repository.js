const mongoose = require("mongoose");
const SetupStrategy = require("../models/SetupStrategy");

async function findSetupsByUserAndMarket(userId, marketType) {
  return SetupStrategy.find({ user: userId, marketType }).sort({ createdAt: 1 });
}

async function findRawSetupsByUserAndMarket(userId, marketType) {
  return SetupStrategy.find({ user: userId, marketType }).sort({ createdAt: 1 });
}

// A rename can collide with a name another document still holds (the classic
// case: swapping two strategy names in one save), and (user, marketType, name)
// is unique. Park every renamed document on a throwaway name first, then set
// the real ones.
function tempName(id) {
  return `__setup_rename_${id}__`;
}

/**
 * Applies an incoming list of strategies as a diff against what is stored:
 * matched documents are updated in place, new ones inserted, missing ones
 * deleted.
 *
 * Documents keep their _id across edits. That matters well beyond tidiness --
 * ChecklistNotificationSetting.strategyId points at these ids, and the previous
 * delete-then-reinsert rewrote every id on every save, silently breaking the
 * link between a saved notification and the strategy it was bound to.
 *
 * Returns { strategies, deletedIds, renamed } so callers can reconcile
 * anything that referenced a strategy that has just changed or gone away.
 */
async function applySetupsDiff(userId, marketType, docs) {
  const existing = await SetupStrategy.find({ user: userId, marketType }).sort({ createdAt: 1 });
  const byId = new Map(existing.map((doc) => [String(doc._id), doc]));
  const byName = new Map(existing.map((doc) => [doc.name.trim().toLowerCase(), doc]));

  const claimed = new Set();
  const updates = [];
  const inserts = [];

  for (const doc of docs) {
    const matched =
      (doc._id && byId.get(String(doc._id))) ||
      byName.get(doc.name.trim().toLowerCase()) ||
      null;

    if (matched && !claimed.has(String(matched._id))) {
      claimed.add(String(matched._id));
      updates.push({ current: matched, next: doc });
    } else {
      inserts.push({
        user: userId,
        marketType,
        name: doc.name,
        rules: doc.rules,
        referenceImages: doc.referenceImages,
      });
    }
  }

  const deleted = existing.filter((doc) => !claimed.has(String(doc._id)));
  const deletedIds = deleted.map((doc) => String(doc._id));

  // Validate everything before the first write, so a bad document can never
  // leave the user half-saved.
  for (const insert of inserts) {
    const validationError = new SetupStrategy(insert).validateSync();
    if (validationError) throw validationError;
  }
  for (const { current, next } of updates) {
    const probe = new SetupStrategy({
      user: userId,
      marketType,
      name: next.name,
      rules: next.rules,
      referenceImages: next.referenceImages,
    });
    probe._id = current._id;
    const validationError = probe.validateSync();
    if (validationError) throw validationError;
  }

  const renamed = updates
    .filter(({ current, next }) => current.name !== next.name)
    .map(({ current, next }) => ({ id: String(current._id), from: current.name, to: next.name }));

  const run = async (session) => {
    const opts = session ? { session } : {};

    if (deletedIds.length) {
      await SetupStrategy.deleteMany(
        { _id: { $in: deleted.map((doc) => doc._id) }, user: userId, marketType },
        opts
      );
    }

    if (renamed.length) {
      await SetupStrategy.bulkWrite(
        renamed.map(({ id }) => ({
          updateOne: { filter: { _id: id, user: userId }, update: { $set: { name: tempName(id) } } },
        })),
        opts
      );
    }

    if (updates.length) {
      await SetupStrategy.bulkWrite(
        updates.map(({ current, next }) => ({
          updateOne: {
            filter: { _id: current._id, user: userId },
            update: { $set: { name: next.name, rules: next.rules, referenceImages: next.referenceImages } },
          },
        })),
        opts
      );
    }

    if (inserts.length) {
      await SetupStrategy.insertMany(inserts, opts);
    }
  };

  // Atomic on replica sets/Atlas; standalone MongoDB has no transactions, so
  // fall back to the same sequence without a session.
  const session = await mongoose.startSession();
  try {
    try {
      await session.withTransaction(() => run(session));
    } catch (error) {
      if (!isTransactionUnsupportedError(error)) throw error;
      await run(null);
    }
  } finally {
    await session.endSession();
  }

  const strategies = await SetupStrategy.find({ user: userId, marketType }).sort({ createdAt: 1 });
  return { strategies, deletedIds, renamed };
}

function isTransactionUnsupportedError(error) {
  const message = error?.message || "";
  return (
    message.includes("Transaction numbers are only allowed on a replica set member or mongos") ||
    message.includes("Transaction numbers are only allowed on a replica set member")
  );
}

module.exports = {
  findSetupsByUserAndMarket,
  findRawSetupsByUserAndMarket,
  applySetupsDiff,
};
