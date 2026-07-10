const mongoose = require("mongoose");
const { appConfig } = require("../config");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const WeeklyReport = require("../models/WeeklyReport");
const SetupStrategy = require("../models/SetupStrategy");
const User = require("../models/Users");

const APPLY_CREATE = process.argv.includes("--apply-create");
const DROP_OBSOLETE = process.argv.includes("--drop-obsolete");
const userIdArgument = process.argv.find((argument) => argument.startsWith("--user-id="));
const userId = userIdArgument?.split("=")[1];

async function inspectModelIndexes(model) {
  const diff = await model.diffIndexes();

  if (DROP_OBSOLETE) {
    const dropped = await model.syncIndexes();
    console.log(`\n[${model.modelName}] synchronized; dropped: ${JSON.stringify(dropped)}`);
  } else if (APPLY_CREATE) {
    await model.createIndexes();
    console.log(`\n[${model.modelName}] missing indexes created; no indexes dropped`);
  } else {
    console.log(`\n[${model.modelName}] audit only`);
  }

  console.log("Index diff:", JSON.stringify(diff));
  const indexes = await model.collection.indexes();
  console.log("Active indexes:");
  indexes.forEach((index) => {
    console.log(`- ${index.name}: ${JSON.stringify(index.key)}`);
  });
}

async function explainCoreQueries() {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    console.log("\n[Explain] skipped; pass --user-id=<existing ObjectId> for meaningful execution stats");
    return;
  }

  const targetUser = new mongoose.Types.ObjectId(userId);
  const tradeExplain = await Trade.find({
    user: targetUser,
    deletedAt: null,
    marketType: { $ne: "Indian_Market" },
  })
    .sort({ effectiveTradeDate: -1, _id: -1 })
    .limit(20)
    .explain("executionStats");

  const weeklyReportExplain = await WeeklyReport.find({
    user: targetUser,
    marketType: "Forex",
    periodType: "rolling7d",
  })
    .sort({ createdAt: -1 })
    .limit(1)
    .explain("executionStats");

  console.log("\n[Explain] Trade feed winning plan:");
  console.log(JSON.stringify(tradeExplain.queryPlanner.winningPlan, null, 2));

  console.log("\n[Explain] Weekly report lookup winning plan:");
  console.log(JSON.stringify(weeklyReportExplain.queryPlanner.winningPlan, null, 2));
}

async function main() {
  await mongoose.connect(appConfig.mongoUri);

  try {
    await inspectModelIndexes(Trade);
    await inspectModelIndexes(IndianTrade);
    await inspectModelIndexes(WeeklyReport);
    await inspectModelIndexes(SetupStrategy);
    await inspectModelIndexes(User);
    await explainCoreQueries();
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Index audit failed:", error.message);
  process.exit(1);
});
