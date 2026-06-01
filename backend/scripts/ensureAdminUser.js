/**
 * Create or promote an admin user (local/staging MongoDB).
 *
 * Usage:
 *   node scripts/ensureAdminUser.js <email> <password> [name]
 *
 * MongoDB shell (Atlas / Compass) — find admins:
 *   db.users.find({ role: "admin" }, { email: 1, role: 1, authProvider: 1 })
 *
 * Promote existing user:
 *   db.users.updateOne(
 *     { email: "you@example.com" },
 *     { $set: { role: "admin", authProvider: "local" } }
 *   )
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/Users");

const [emailArg, password, nameArg] = process.argv.slice(2);
const email = String(emailArg || "").trim().toLowerCase();

if (!email || !password) {
  console.error("Usage: node scripts/ensureAdminUser.js <email> <password> [name]");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const hashed = await bcrypt.hash(password, 10);
  let user = await User.findOne({ email }).select("+password");

  if (!user) {
    user = await User.create({
      name: nameArg || "Admin",
      email,
      password: hashed,
      role: "admin",
      authProvider: "local",
    });
    console.log("Created admin user:", user.email);
  } else {
    user.role = "admin";
    user.authProvider = "local";
    user.password = hashed;
    if (nameArg) user.name = nameArg;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    console.log("Updated existing user to admin:", user.email);
  }

  const admins = await User.find({ role: "admin" })
    .select("email role authProvider createdAt")
    .lean();
  console.log("\nAll admin users:");
  admins.forEach((a) => console.log(`  - ${a.email} (${a.authProvider})`));

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
