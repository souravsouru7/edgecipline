const mongoose = require("mongoose");
const { appConfig } = require("../config");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const WeeklyReport = require("../models/WeeklyReport");
const SetupStrategy = require("../models/SetupStrategy");
const User = require("../models/Users");
// Support collections carry text and partial indexes, which are the two kinds
// MongoDB rejects outright on a bad definition. Mongoose's background build
// only LOGS that rejection, so an unaudited support model can silently run
// every queue query as a collection scan.
const SupportTicket = require("../models/SupportTicket");
const SupportMessage = require("../models/SupportMessage");
const SupportAuditLog = require("../models/SupportAuditLog");
const KnowledgeBaseArticle = require("../models/KnowledgeBaseArticle");
const ArticleFeedback = require("../models/ArticleFeedback");

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
    await inspectModelIndexes(SupportTicket);
    await inspectModelIndexes(SupportMessage);
    await inspectModelIndexes(SupportAuditLog);
    await inspectModelIndexes(KnowledgeBaseArticle);
    await inspectModelIndexes(ArticleFeedback);
    await inspectModelIndexes(require("../models/Campaign"));
    await inspectModelIndexes(require("../models/Coupon"));
    await inspectModelIndexes(require("../models/Influencer"));
    await inspectModelIndexes(require("../models/CheckoutSession"));
    await inspectModelIndexes(require("../models/CouponRedemption"));
    await inspectModelIndexes(require("../models/AttributionTouch"));
    await explainCoreQueries();
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Index audit failed:", error.message);
  process.exit(1);
});
