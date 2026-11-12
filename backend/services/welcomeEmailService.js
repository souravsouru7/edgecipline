"use strict";

const User = require("../models/Users");
const { sendWelcomeEmail } = require("./mailService");
const { logger } = require("../utils/logger");

// Only accounts created this recently are "new". Without this window, an
// existing user re-accepting terms after a version bump would be welcomed.
const NEW_ACCOUNT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sends the signup welcome email at most once per account.
 *
 * The claim (setting welcomeEmailSentAt) happens atomically BEFORE the send,
 * so two concurrent requests (double-tapped signup, retried terms accept)
 * cannot both send. A failed send is not retried — a missed welcome is not
 * worth a second email days later.
 *
 * Never rejects; callers fire and forget.
 */
async function maybeSendWelcomeEmail(userId, { now = new Date() } = {}) {
  try {
    if (!userId) return { sent: false, reason: "no_user" };

    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        welcomeEmailSentAt: { $exists: false },
        createdAt: { $gte: new Date(now.getTime() - NEW_ACCOUNT_WINDOW_MS) },
      },
      { $set: { welcomeEmailSentAt: now } },
      { new: true, projection: { email: 1, name: 1, trial: 1 } }
    ).lean();

    if (!user) return { sent: false, reason: "already_sent_or_not_new" };

    const result = await sendWelcomeEmail({
      to: user.email,
      userName: user.name,
      trialEndsAt: user.trial?.endsAt || null,
    });

    if (result.sent) logger.info("WELCOME_EMAIL_SENT", { userId: String(userId) });
    return result;
  } catch (error) {
    logger.error("WELCOME_EMAIL_ERROR", { userId: String(userId), error: error.message });
    return { sent: false, reason: "exception" };
  }
}

module.exports = { maybeSendWelcomeEmail, NEW_ACCOUNT_WINDOW_MS };
