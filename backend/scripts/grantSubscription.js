/**
 * One-shot script: grant an active subscription to a user by email.
 * Usage: node scripts/grantSubscription.js <email> <days>
 * Example: node scripts/grantSubscription.js soutavr5@gmail.com 365
 */

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/Users");

const [email, daysArg] = process.argv.slice(2);
const days = parseInt(daysArg, 10) || 365;

if (!email) {
  console.error("Usage: node scripts/grantSubscription.js <email> [days]");
  process.exit(1);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No user found with email: ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const now = new Date();
  const expiry = new Date(now);
  expiry.setDate(expiry.getDate() + days);

  user.subscriptionStatus = "active";
  user.subscriptionPlan   = "yearly";
  user.subscriptionExpiry = expiry;
  await user.save();

  console.log(`✓ Subscription granted`);
  console.log(`  Email  : ${user.email}`);
  console.log(`  Plan   : ${user.subscriptionPlan}`);
  console.log(`  Status : ${user.subscriptionStatus}`);
  console.log(`  Expiry : ${user.subscriptionExpiry.toDateString()}`);

  await mongoose.disconnect();
})();
