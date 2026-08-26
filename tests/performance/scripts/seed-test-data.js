
/**
 * Seeds a DEDICATED load-test database with test users, setups and trades,
 * then mints access tokens for k6 to consume.
 *
 * Safety rails (all of them must pass before anything is written):
 *   1. The target Mongo URI must be supplied via LOADTEST_MONGO_URI.
 *   2. Its database name must contain "loadtest" — this makes it impossible to
 *      point the seeder at trading_latest (the dev DB) by accident.
 *   3. Every document written is tagged so cleanup-test-data.js can find it.
 *
 * Output: tests/performance/.testdata/users.json  (gitignored — holds tokens)
 *
 * Usage:
 *   node tests/performance/scripts/seed-test-data.js --users 60 --trades 120
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
// Dependencies resolve from backend/node_modules — this script lives outside
// the backend package, so bare requires would not find them.
const BACKEND_MODULES = path.join(__dirname, "../../../backend/node_modules");
const mongoose = require(path.join(BACKEND_MODULES, "mongoose"));
const jwt = require(path.join(BACKEND_MODULES, "jsonwebtoken"));

// Load backend/.env explicitly — we may be invoked from any cwd.
require(path.join(BACKEND_MODULES, "dotenv")).config({
  path: path.join(__dirname, "../../../backend/.env"),
  quiet: true,
});

const User = require(path.join(__dirname, "../../../backend/models/Users"));
const Trade = require(path.join(__dirname, "../../../backend/models/Trade"));
const SetupStrategy = require(path.join(__dirname, "../../../backend/models/SetupStrategy"));

const CURRENT_TERMS_VERSION = require(path.join(
  __dirname,
  "../../../backend/constants/terms"
)).CURRENT_TERMS_VERSION;

// --------------------------------------------------------------------------
// Args
// --------------------------------------------------------------------------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return process.argv[i + 1];
}

const USER_COUNT = Number(arg("users", 60));
const TRADES_PER_USER = Number(arg("trades", 120));
const TOKEN_TTL = arg("token-ttl", "12h");

// Every seeded account shares this prefix so cleanup is unambiguous.
const TEST_EMAIL_DOMAIN = "loadtest.invalid";
const TEST_NAME_PREFIX = "k6-loadtest";
// Shared password for every seeded account. This is throwaway test-only data in
// a throwaway database; it is passed to the login-path scenario via env var.
const TEST_PASSWORD = process.env.LOADTEST_PASSWORD || "LoadTest!2026#pw";

const MONGO_URI = process.env.LOADTEST_MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

// --------------------------------------------------------------------------
// Safety rails
// --------------------------------------------------------------------------
function assertSafeTarget(uri) {
  if (!uri) {
    throw new Error(
      "LOADTEST_MONGO_URI is not set. Refusing to guess a target database.\n" +
        "  Example: LOADTEST_MONGO_URI=mongodb://127.0.0.1:27017/stratedge_loadtest"
    );
  }
  const dbName = uri.replace(/^mongodb(\+srv)?:\/\//, "").split("/")[1]?.split("?")[0];
  if (!dbName) {
    throw new Error(`LOADTEST_MONGO_URI has no database name: ${uri}`);
  }
  if (!/loadtest/i.test(dbName)) {
    throw new Error(
      `Refusing to seed database "${dbName}" — the name must contain "loadtest".\n` +
        "  This guard exists so the seeder can never touch a real database."
    );
  }
  return dbName;
}

// --------------------------------------------------------------------------
// Deterministic-but-varied fake trade data
// --------------------------------------------------------------------------
const PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "AUDUSD", "USDCAD", "BTCUSD", "NAS100"];
const SESSIONS = ["London", "New York", "Asian", "Overlap"];
const ENTRY_BASIS = ["Plan", "Emotion", "Impulsive", "Custom"];
// mood is a 1–5 numeric scale on the Trade model (1 = stressed, 5 = peak focus),
// not a label.
const MOODS = [1, 2, 3, 4, 5];
const CONFIDENCE = ["Low", "Medium", "High", "Overconfident"];
const QUALITY = ["Great", "Average", "Poor"];
const MISTAKES = ["Moved stop loss", "Overleveraged", "Revenge trade", "No setup", "Exited early", null];
const RR = ["1:1", "1:2", "1:3", "1:4", "1:5"];
const SETUP_NAMES = ["Breakout Retest", "Liquidity Sweep", "Trend Continuation", "Range Reversal"];

// Seeded PRNG so re-running the seeder produces the same corpus — this keeps
// load-test runs comparable to each other instead of drifting with new data.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function buildSetups(userId, rng) {
  return SETUP_NAMES.map((name) => ({
    user: userId,
    marketType: "Forex",
    name,
    rules: [
      { label: "Higher timeframe trend aligned", isActive: true },
      { label: "Clear invalidation level", isActive: true },
      { label: "Minimum 1:2 R:R", isActive: true },
      { label: "No news within 30 min", isActive: rng() > 0.3 },
    ],
  }));
}

function buildTrades(userId, count, rng) {
  const trades = [];
  const now = Date.now();

  for (let i = 0; i < count; i += 1) {
    // Spread trades across the last 180 days so time-bucketed analytics
    // (weekly, drawdown, psychology-timeline) have real data to chew on.
    const daysAgo = Math.floor(rng() * 180);
    const tradeDate = new Date(now - daysAgo * 24 * 60 * 60 * 1000);

    const isWin = rng() > 0.42;
    const magnitude = Math.round((rng() * 480 + 20) * 100) / 100;
    const profit = isWin ? magnitude : -magnitude * 0.8;
    const entryPrice = Math.round((rng() * 200 + 1) * 10000) / 10000;
    const setupScore = Math.round(rng() * 100);

    const rules = [
      { label: "Higher timeframe trend aligned", followed: rng() > 0.25 },
      { label: "Clear invalidation level", followed: rng() > 0.2 },
      { label: "Minimum 1:2 R:R", followed: rng() > 0.35 },
    ];

    trades.push({
      user: userId,
      pair: PAIRS[Math.floor(rng() * PAIRS.length)],
      type: rng() > 0.5 ? "BUY" : "SELL",
      quantity: Math.round(rng() * 5 * 100) / 100,
      lotSize: Math.round(rng() * 3 * 100) / 100,
      entryPrice,
      exitPrice: Math.round((entryPrice + (isWin ? 1 : -1) * rng() * 5) * 10000) / 10000,
      stopLoss: Math.round((entryPrice - rng() * 3) * 10000) / 10000,
      takeProfit: Math.round((entryPrice + rng() * 6) * 10000) / 10000,
      profit,
      commission: Math.round(rng() * 8 * 100) / 100,
      swap: Math.round(rng() * 3 * 100) / 100,
      balance: 10000 + profit * i,
      strategy: SETUP_NAMES[Math.floor(rng() * SETUP_NAMES.length)],
      session: SESSIONS[Math.floor(rng() * SESSIONS.length)],
      tradeDate,
      effectiveTradeDate: tradeDate,
      marketType: "Forex",
      notes: `k6 seeded trade #${i}`,
      riskRewardRatio: RR[Math.floor(rng() * RR.length)],
      setupRules: rules,
      setupScore,
      entryBasis: ENTRY_BASIS[Math.floor(rng() * ENTRY_BASIS.length)],
      mood: MOODS[Math.floor(rng() * MOODS.length)],
      confidence: CONFIDENCE[Math.floor(rng() * CONFIDENCE.length)],
      tradeQuality: QUALITY[Math.floor(rng() * QUALITY.length)],
      mistakeTag: MISTAKES[Math.floor(rng() * MISTAKES.length)],
      wouldRetake: rng() > 0.4 ? "Yes" : "No",
      status: "completed",
      isValid: true,
      deletedAt: null,
    });
  }
  return trades;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
(async () => {
  const dbName = assertSafeTarget(MONGO_URI);

  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET missing from backend/.env — cannot mint test tokens.");
  }

  console.log(`\n  Target database : ${dbName}  (guard: name contains "loadtest")`);
  console.log(`  Users           : ${USER_COUNT}`);
  console.log(`  Trades per user : ${TRADES_PER_USER}`);
  console.log(`  Token TTL       : ${TOKEN_TTL}\n`);

  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    family: 4,
    maxPoolSize: 20,
  });
  console.log("  Connected.");

  // Wipe only previously-seeded load-test data, then rebuild.
  const previous = await User.find({ email: new RegExp(`@${TEST_EMAIL_DOMAIN}$`) })
    .select("_id")
    .lean();
  if (previous.length > 0) {
    const ids = previous.map((u) => u._id);
    await Promise.all([
      Trade.deleteMany({ user: { $in: ids } }),
      SetupStrategy.deleteMany({ user: { $in: ids } }),
      User.deleteMany({ _id: { $in: ids } }),
    ]);
    console.log(`  Cleared ${previous.length} previously seeded users and their data.`);
  }

  // bcrypt hash of TEST_PASSWORD. Generated once and reused for every seeded
  // account — hashing 60 times would add minutes for zero test value.
  const bcrypt = require(path.join(BACKEND_MODULES, "bcryptjs"));
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  const runId = crypto.randomBytes(4).toString("hex");
  const seededUsers = [];

  for (let i = 0; i < USER_COUNT; i += 1) {
    const rng = makeRng(1000 + i);
    const email = `${TEST_NAME_PREFIX}-${i}@${TEST_EMAIL_DOMAIN}`;

    const user = await User.create({
      name: `${TEST_NAME_PREFIX}-${i}`,
      email,
      password: passwordHash,
      authProvider: "local",
      role: "user",
      accountStatus: "active",
      // The terms gate in authMiddleware rejects every request with 403 unless
      // the accepted version matches exactly.
      termsAcceptance: {
        acceptedTerms: true,
        acceptedPrivacy: true,
        acceptedAt: new Date(),
        termsVersion: CURRENT_TERMS_VERSION,
      },
      preferredMarket: "Forex",
      tradingStyle: "intraday",
      isOnboardingCompleted: true,
      hasSeenWelcomeGuide: true,
      subscriptionStatus: "active",
      subscriptionPlan: "monthly",
      subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      tokenVersion: 0,
    });

    await SetupStrategy.insertMany(buildSetups(user._id, rng));
    // throwOnValidationError is essential here: without it Mongoose silently
    // drops documents that fail validation, and the seeder would happily report
    // success while leaving the load test with an empty trades collection.
    await Trade.insertMany(buildTrades(user._id, TRADES_PER_USER, rng), {
      ordered: false,
      throwOnValidationError: true,
    });
    

    // Mint the same access token shape the real app issues, using the real
    // secret. authMiddleware validates signature + tokenVersion normally.
    const token = jwt.sign(
      { id: String(user._id), role: user.role, tokenVersion: user.tokenVersion },
      JWT_SECRET,
      { expiresIn: TOKEN_TTL }
    );

    seededUsers.push({ id: String(user._id), email, token });

    if ((i + 1) % 10 === 0 || i === USER_COUNT - 1) {
      console.log(`  Seeded ${i + 1}/${USER_COUNT} users…`);
    }
  }

  const outDir = path.join(__dirname, "..", ".testdata");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "users.json");
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        runId,
        seededAt: new Date().toISOString(),
        database: dbName,
        userCount: seededUsers.length,
        tradesPerUser: TRADES_PER_USER,
        tokenTtl: TOKEN_TTL,
        users: seededUsers,
      },
      null,
      2
    )
  );

  const totalTrades = await Trade.countDocuments({});
  const expectedTrades = USER_COUNT * TRADES_PER_USER;
  if (totalTrades !== expectedTrades) {
    throw new Error(
      `Expected ${expectedTrades} trades but the collection holds ${totalTrades}. ` +
        "Refusing to hand k6 a half-seeded database."
    );
  }

  console.log(`\n  Wrote ${outFile}`);
  console.log(`  Total trades in test DB: ${totalTrades}`);
  console.log(`  Done.\n`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((error) => {
  console.error("\n  SEED FAILED:", error.message, "\n");
  process.exit(1);
});
