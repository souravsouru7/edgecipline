/**
 * Removes everything seed-test-data.js created.
 *
 * Same safety rail as the seeder: the target database name must contain
 * "loadtest", and only accounts on the @loadtest.invalid domain (plus the
 * documents they own) are deleted.
 *
 * Usage:
 *   node tests/performance/scripts/cleanup-test-data.js
 *   node tests/performance/scripts/cleanup-test-data.js --drop   # drop whole DB
 */

const path = require("path");
const fs = require("fs");
const BACKEND_MODULES = path.join(__dirname, "../../../backend/node_modules");
const mongoose = require(path.join(BACKEND_MODULES, "mongoose"));

require(path.join(BACKEND_MODULES, "dotenv")).config({
  
  path: path.join(__dirname, "../../../backend/.env"),
  quiet: true,
});

const User = require(path.join(__dirname, "../../../backend/models/Users"));
const Trade = require(path.join(__dirname, "../../../backend/models/Trade"));
const SetupStrategy = require(path.join(__dirname, "../../../backend/models/SetupStrategy"));

const TEST_EMAIL_DOMAIN = "loadtest.invalid";
const MONGO_URI = process.env.LOADTEST_MONGO_URI;
const DROP_DB = process.argv.includes("--drop");

function assertSafeTarget(uri) {
  if (!uri) throw new Error("LOADTEST_MONGO_URI is not set.");
  const dbName = uri.replace(/^mongodb(\+srv)?:\/\//, "").split("/")[1]?.split("?")[0];
  if (!dbName) throw new Error(`LOADTEST_MONGO_URI has no database name: ${uri}`);
  if (!/loadtest/i.test(dbName)) {
    throw new Error(`Refusing to clean database "${dbName}" — name must contain "loadtest".`);
  }
  return dbName;
}

(async () => {
  const dbName = assertSafeTarget(MONGO_URI);
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000, family: 4 });

  if (DROP_DB) {
    await mongoose.connection.db.dropDatabase();
    console.log(`  Dropped database "${dbName}".`);
  } else {
    const users = await User.find({ email: new RegExp(`@${TEST_EMAIL_DOMAIN}$`) })
      .select("_id")
      .lean();
    const ids = users.map((u) => u._id);

    const [trades, setups, removed] = await Promise.all([
      Trade.deleteMany({ user: { $in: ids } }),
      SetupStrategy.deleteMany({ user: { $in: ids } }),
      User.deleteMany({ _id: { $in: ids } }),
    ]);

    console.log(`  Database        : ${dbName}`);
    console.log(`  Users removed   : ${removed.deletedCount}`);
    console.log(`  Trades removed  : ${trades.deletedCount}`);
    console.log(`  Setups removed  : ${setups.deletedCount}`);
  }

  const testDataFile = path.join(__dirname, "..", ".testdata", "users.json");
  if (fs.existsSync(testDataFile)) {
    fs.unlinkSync(testDataFile);
    console.log("  Removed .testdata/users.json (held tokens).");
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((error) => {
  console.error("  CLEANUP FAILED:", error.message);
  process.exit(1);
});
