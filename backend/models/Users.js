const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: false,
      select: false
    },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local"
    },
    googleId: {
      type: String
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user"
    },
    // Customer-support capability, layered ON TOP of `role` rather than
    // replacing it — every existing consumer of `role` keeps working. null
    // means "not support staff". Admins hold every support capability
    // regardless of this field; see constants/support resolveCapabilities.
    //
    // In this first release a support agent must also be role:"admin" to sign
    // in, because adminAuthController only issues tokens to admins. supportAuth
    // already accepts `role === "admin" || supportRole`, so enabling dedicated
    // non-admin agent logins later is a change to the login controller alone.
    supportRole: {
      type: String,
      enum: ["agent", "lead", null],
      default: null,
    },
    accountStatus: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
    },
    // Set when account deletion starts, cleared only by the account document
    // itself being removed. Distinguishes "disabled because the user asked us
    // to delete this" from "disabled by an admin" — the deletion endpoint
    // re-admits the former so a failed purge stays retryable, and must not
    // re-admit the latter. See accountDeletionService + authMiddleware.
    pendingDeletion: {
      type: Boolean,
      default: false,
    },
    avatar: {
      type: String
    },
    resetPasswordOTP: {
      type: String
    },
    resetPasswordOTPExpires: {
      type: Date
    },
    // Short-lived opaque token issued by verifyOTP; consumed by resetPassword.
    resetPasswordToken: {
      type: String
    },
    resetPasswordTokenExpires: {
      type: Date
    },
    otpAttempts: {
      type: Number,
      default: 0,
      min: 0,
      max: 10,
    },
    otpLockUntil: {
      type: Date,
    },
    subscriptionStatus: {
      type: String,
      enum: ["inactive", "active", "expired"],
      default: "inactive"
    },
    subscriptionPlan: {
      type: String,
      enum: ["free", "monthly", "yearly", "custom"],
      default: "free"
    },
    subscriptionExpiry: {
      type: Date
    },
    totalPaid: {
      type: Number,
      default: 0
    },
    // 7-day premium trial. Layered on top of subscriptionStatus — isPremium()
    // returns true whenever trial.endsAt is in the future, regardless of plan.
    // trial.used prevents a second trial after expiry; admins can extend via
    // adminTrialController without resetting used.
    trial: {
      startedAt:  { type: Date,    default: null },
      endsAt:     { type: Date,    default: null },
      used:       { type: Boolean, default: false },
      source:     { type: String,  enum: ["auto_register", "manual_grant", "promo", null], default: null },
      extendedBy: { type: Number,  default: 0, min: 0 },
    },
    lastLogin: {
      type: Date
    },
    freeUploadUsed: {
      type: Boolean,
      default: false
    },
    hasSeenWelcomeGuide: {
      type: Boolean,
      default: false
    },
    isOnboardingCompleted: {
      type: Boolean,
      default: false
    },
    preferredMarket: {
      type: String,
      enum: ["Forex", "Indian_Market"],
      default: null,
    },
    // Trader profile signal captured during onboarding. Drives the suggested
    // setup template, the first-insight phrasing, and (later) coaching tone.
    // Kept on the root user record because it survives past the onboarding
    // flow — analytics + coach prompts should be able to reference it.
    tradingStyle: {
      type: String,
      enum: ["scalper", "intraday", "swing", "position", "investor", null],
      default: null,
    },
    onboarding: {
      welcomeSeen:        { type: Boolean, default: false },
      // New step granularity for the 7-step linear flow (Welcome → Market →
      // Style → Setup → First Trade → Insight → Done). Older flags
      // (setupAdded/tradeAdded/etc.) stay so the legacy GettingStartedCard
      // and dashboard derivations keep working.
      marketSelected:     { type: Boolean, default: false },
      styleSelected:      { type: Boolean, default: false },
      setupAdded:         { type: Boolean, default: false },
      tradeAdded:         { type: Boolean, default: false },
      // Set when the user explicitly says "I haven't traded yet" / "Just
      // exploring". Treated as a completed funnel step (the user has made an
      // intentional choice) but does NOT imply tradeAdded — analytics can
      // distinguish "trader who logged" from "explorer/paper trader".
      tradeSkipped:       { type: Boolean, default: false },
      firstInsightSeen:   { type: Boolean, default: false },
      journalSeen:        { type: Boolean, default: false },
      analyticsSeen:      { type: Boolean, default: false },
      notificationsSeen:  { type: Boolean, default: false },
      tourCompleted:      { type: Boolean, default: false },
      checklistDismissed: { type: Boolean, default: false },
      // Funnel timestamps — used by analytics to compute time-to-value
      // (signup → first trade → first insight). Optional and never blocking.
      startedAt:               { type: Date, default: null },
      firstTradeAt:            { type: Date, default: null },
      firstScreenshotUploadAt: { type: Date, default: null },
      firstInsightAt:          { type: Date, default: null },
      completedAt:             { type: Date, default: null },
    },
    termsAcceptance: {
      acceptedTerms: { type: Boolean, default: false },
      acceptedPrivacy: { type: Boolean, default: false },
      acceptedAt: { type: Date, default: null },
      termsVersion: { type: String, default: null }
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    // Discipline streaks. Denormalized for cheap dashboard reads; source of
    // truth is DailyDisciplineEntry — these fields can be rebuilt at any time
    // via streakService.recomputeStreaks.
    streaks: {
      journal: {
        current:            { type: Number, default: 0, min: 0 },
        longest:            { type: Number, default: 0, min: 0 },
        // 'YYYY-MM-DD' in the user's timezone. String avoids TZ drift on read.
        lastQualifyingDate: { type: String, default: null },
        lastBrokenAt:       { type: Date,   default: null },
        // 24h grace recoveries used in the trailing 30 days. Capped at 1/30d.
        recoveredCount:     { type: Number, default: 0, min: 0 },
        lastRecoveryAt:     { type: Date,   default: null },
      },
      checklist: {
        current:            { type: Number, default: 0, min: 0 },
        longest:            { type: Number, default: 0, min: 0 },
        lastQualifyingDate: { type: String, default: null },
      },
      rule: {
        current:     { type: Number, default: 0, min: 0 },
        longest:     { type: Number, default: 0, min: 0 },
        threshold:   { type: Number, default: 70, min: 0, max: 100 },
        lastTradeAt: { type: Date,   default: null },
      },
      // Highest journal-streak milestone the user has been notified about.
      // Prevents re-firing the milestone push if the user dips and recovers.
      lastMilestoneNotified: { type: Number, default: 0 },
      // IANA timezone used for day-boundary math. Falls back to the
      // notification quiet-hours TZ if blank.
      timezone: { type: String, default: "Asia/Kolkata" },
    },
    attribution: {
      anonymousId: { type: String, default: null, maxlength: 80 },
      firstTouch: {
        source: { type: String, default: null },
        refSlug: { type: String, default: "" },
        influencer: { type: mongoose.Schema.Types.ObjectId, ref: "Influencer", default: null },
        campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null },
        at: { type: Date, default: null },
      },
      signupTouch: {
        source: { type: String, default: null },
        refSlug: { type: String, default: "" },
        influencer: { type: mongoose.Schema.Types.ObjectId, ref: "Influencer", default: null },
        campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null },
        at: { type: Date, default: null },
      },
    },
    loginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    loginLockedUntil: {
      type: Date,
      select: false,
    },
  },
  { timestamps: true }
);

// Agent picker + "assignable agents" fan-out. Partial so the index holds only
// the handful of staff rows rather than every user in the database.
userSchema.index(
  { supportRole: 1 },
  {
    name: "support_staff",
    partialFilterExpression: { supportRole: { $type: "string" } },
  }
);

userSchema.index({ role: 1, subscriptionExpiry: -1 });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ role: 1, subscriptionStatus: 1, subscriptionExpiry: -1 });
// M16: Supports expiry-notification cron and subscription-gate queries
userSchema.index({ subscriptionStatus: 1, subscriptionExpiry: -1 });
// Trial expiry cron + day-5/6 warning queries — sparse so legacy users
// without trial data don't bloat the index.
userSchema.index({ "trial.endsAt": 1 }, { sparse: true });
// `sparse` and `partialFilterExpression` can't be combined -- MongoDB
// rejects the index outright, so it silently never got created (Mongoose's
// background ensureIndexes() only logs the failure, it doesn't crash).
// The partial filter alone already achieves what sparse was for here.
userSchema.index(
  { googleId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      googleId: { $type: "string" },
    },
  }
);

module.exports = mongoose.model("User", userSchema);
