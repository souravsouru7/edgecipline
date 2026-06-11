"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const WeeklyReport = require("../models/WeeklyReport");
const SetupStrategy = require("../models/SetupStrategy");
const Notification = require("../models/Notification");
const ChecklistTracking = require("../models/ChecklistTracking");
const User = require("../models/Users");
const RefreshToken = require("../models/RefreshToken");

async function createIndexes(model, indexes) {
  for (const [keys, options] of indexes) {
    await model.collection.createIndex(keys, {
      background: true,
      ...options,
    });
    console.log(`ensured ${model.modelName}: ${JSON.stringify(keys)}`);
  }
}

async function main() {
  await connectDB();

  await createIndexes(Trade, [
    [{ user: 1, marketType: 1, deletedAt: 1, createdAt: -1, _id: -1 }],
    [{ user: 1, marketType: 1, deletedAt: 1, tradeDate: -1, _id: -1 }],
    [{ user: 1, marketType: 1, deletedAt: 1, status: 1, tradeDate: -1 }],
    [{ user: 1, deletedAt: 1, tradeDate: 1, createdAt: 1 }],
    [{ user: 1, deletedAt: 1, setupScore: 1, tradeDate: 1 }],
    [{ user: 1, deletedAt: 1, mistakeTag: 1, tradeDate: 1 }],
  ]);

  await createIndexes(IndianTrade, [
    [{ user: 1, instrumentType: 1, createdAt: -1, _id: -1 }],
    [{ user: 1, instrumentType: 1, tradeDate: -1, _id: -1 }],
    [{ user: 1, instrumentType: 1, tradeDate: 1, createdAt: 1 }],
    [{ user: 1, instrumentType: 1, setupScore: 1, tradeDate: 1 }],
    [{ user: 1, instrumentType: 1, mistakeTag: 1, tradeDate: 1 }],
  ]);

  await createIndexes(WeeklyReport, [
    [{ user: 1, marketType: 1, weekStart: -1 }],
    [{ user: 1, marketType: 1, generatedAt: -1 }],
  ]);

  await createIndexes(SetupStrategy, [
    [{ user: 1, marketType: 1, createdAt: 1 }],
  ]);

  await createIndexes(Notification, [
    [{ active: 1, createdAt: -1 }],
    [{ targetAudience: 1, active: 1, createdAt: -1 }],
  ]);

  await createIndexes(ChecklistTracking, [
    [{ user: 1, createdAt: -1 }],
    [{ user: 1, checklistType: 1, createdAt: -1 }],
  ]);

  await createIndexes(User, [
    [{ email: 1 }, { unique: true, sparse: true }],
    [{ role: 1, createdAt: -1 }],
  ]);

  await createIndexes(RefreshToken, [
    [{ user: 1, revokedAt: 1, expiresAt: 1 }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ]);

  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
