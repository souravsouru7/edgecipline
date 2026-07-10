const mongoose = require("mongoose");
const SetupStrategy = require("../models/SetupStrategy");

function isTransactionUnsupportedError(error) {
  const message = error?.message || "";
  return (
    message.includes("Transaction numbers are only allowed on a replica set member or mongos") ||
    message.includes("Transaction numbers are only allowed on a replica set member")
  );
}

async function findSetupsByUserAndMarket(userId, marketType) {
  return SetupStrategy.find({ user: userId, marketType }).sort({ createdAt: 1 });
}

async function findRawSetupsByUserAndMarket(userId, marketType) {
  return SetupStrategy.find({ user: userId, marketType }).sort({ createdAt: 1 });
}

async function replaceSetupsByUserAndMarket(userId, marketType, docs) {
  const safeDocs = docs.map((doc) => ({
    user: userId,
    marketType,
    name: doc.name,
    referenceImages: doc.referenceImages,
    rules: doc.rules,
  }));

  const replaceWithoutTransaction = async () => {
    await SetupStrategy.deleteMany({ user: userId, marketType });
    if (!safeDocs.length) {
      return [];
    }
    return SetupStrategy.insertMany(safeDocs);
  };

  // Atomic on replica sets/Atlas. Local standalone MongoDB cannot run
  // transactions, so retry without a session to keep local/dev saves working.
  const session = await mongoose.startSession();
  try {
    let inserted = [];
    try {
      await session.withTransaction(async () => {
        await SetupStrategy.deleteMany({ user: userId, marketType }, { session });
        if (safeDocs.length) {
          inserted = await SetupStrategy.insertMany(safeDocs, { session });
        }
      });
      return inserted;
    } catch (error) {
      if (!isTransactionUnsupportedError(error)) {
        throw error;
      }
      return replaceWithoutTransaction();
    }
  } finally {
    await session.endSession();
  }
}

module.exports = {
  findSetupsByUserAndMarket,
  findRawSetupsByUserAndMarket,
  replaceSetupsByUserAndMarket,
};
