/**
 * Audit admin users in MongoDB. Optionally create a seed admin if none are valid.
 *
 * Usage:
 *   node scripts/checkAdminUser.js
 *   node scripts/checkAdminUser.js --email admin@example.com
 *   node scripts/checkAdminUser.js --create admin@example.com "Password123" "Admin Name"
 *
 * Requires MONGO_URI in backend/.env
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/Users");

const args = process.argv.slice(2);
const createMode = args[0] === "--create";
const emailFilter =
  args[0] === "--email" ? String(args[1] || "").trim().toLowerCase() : null;
const createEmail = createMode ? String(args[1] || "").trim().toLowerCase() : null;
const createPassword = createMode ? args[2] : null;
const createName = createMode ? args[3] || "Admin" : null;

function auditAdmin(user) {
  const issues = [];
  const ok = [];

  if (!user) {
    return { valid: false, issues: ["User not found"], ok };
  }

  if (user.role !== "admin") {
    issues.push(`role is "${user.role}" (expected "admin")`);
  } else {
    ok.push('role is "admin"');
  }

  if (user.authProvider === "google") {
    issues.push("authProvider is google — admin login needs local password");
  } else if (user.authProvider !== "local") {
    issues.push(`authProvider is "${user.authProvider}" (expected "local")`);
  } else {
    ok.push('authProvider is "local"');
  }

  if (!user.password) {
    issues.push("no password hash — cannot use email/password admin login");
  } else {
    ok.push("password hash present");
  }

  return {
    valid: issues.length === 0,
    issues,
    ok,
  };
}

(async () => {
  if (!process.env.MONGO_URI) {
    console.error("Missing MONGO_URI in backend/.env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  const query = emailFilter ? { email: emailFilter } : { role: "admin" };
  const users = await User.find(query).select("+password").lean();

  if (users.length === 0) {
    console.log(
      emailFilter
        ? `No user found with email: ${emailFilter}`
        : "No users with role: admin"
    );
  } else {
    console.log(`Found ${users.length} user(s):\n`);
    let anyValid = false;

    for (const user of users) {
      const { valid, issues, ok } = auditAdmin(user);
      if (valid) anyValid = true;

      console.log("─".repeat(50));
      console.log(`Email:    ${user.email}`);
      console.log(`Name:     ${user.name}`);
      console.log(`Role:     ${user.role}`);
      console.log(`Provider: ${user.authProvider}`);
      console.log(`ID:       ${user._id}`);
      console.log(`Status:   ${valid ? "✓ VALID for admin login" : "✗ NOT valid"}`);
      if (ok.length) console.log("  OK:", ok.join("; "));
      if (issues.length) console.log("  Issues:", issues.join("; "));
      console.log("");
    }

    if (!emailFilter && !anyValid) {
      console.log("⚠ No admin user is fully configured for email/password login.\n");
    } else if (!emailFilter && anyValid) {
      console.log("✓ At least one admin is correctly configured.\n");
    }
  }

  if (createMode) {
    if (!createEmail || !createPassword) {
      console.error('Usage: node scripts/checkAdminUser.js --create <email> <password> [name]');
      process.exit(1);
    }
    if (createPassword.length < 8) {
      console.error("Password must be at least 8 characters.");
      process.exit(1);
    }

    const existing = await User.findOne({ email: createEmail }).select("+password");
    const { valid } = auditAdmin(existing);

    if (existing && valid) {
      console.log(`Seed skipped — ${createEmail} is already a valid admin.`);
    } else {
      const hashed = await bcrypt.hash(createPassword, 10);
      if (!existing) {
        await User.create({
          name: createName,
          email: createEmail,
          password: hashed,
          role: "admin",
          authProvider: "local",
        });
        console.log(`Created seed admin: ${createEmail}`);
      } else {
        await User.updateOne(
          { email: createEmail },
          {
            $set: {
              role: "admin",
              authProvider: "local",
              password: hashed,
              name: createName,
            },
            $inc: { tokenVersion: 1 },
          }
        );
        console.log(`Fixed/promoted user to valid admin: ${createEmail}`);
      }
    }
  } else if (users.length === 0 || !users.some((u) => auditAdmin(u).valid)) {
    console.log("To create/fix an admin after review:");
    console.log(
      '  node scripts/checkAdminUser.js --create "admin@example.com" "YourPass123!" "Admin"'
    );
    console.log("\nMongoDB shell queries:");
    console.log('  db.users.find({ role: "admin" }, { email: 1, role: 1, authProvider: 1, password: 1 })');
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
