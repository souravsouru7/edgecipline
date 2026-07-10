const User = require("../models/Users");
const SetupStrategy = require("../models/SetupStrategy");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { invalidateAuthCache } = require("./authCacheService");

// Linear flow — must match the frontend stepper order so the resume logic
// (server picks the next-incomplete step) and progress meter agree.
const FLOW_STEPS = Object.freeze([
  { key: "welcomeSeen",     label: "Welcome",           weight: 1 },
  { key: "marketSelected",  label: "Market",            weight: 1 },
  { key: "styleSelected",   label: "Trading Style",     weight: 1 },
  { key: "setupAdded",      label: "Default Setup",     weight: 1 },
  { key: "tradeAdded",      label: "First Trade",       weight: 2 },
  { key: "firstInsightSeen", label: "First AI Insight", weight: 2 },
]);

const TOTAL_WEIGHT = FLOW_STEPS.reduce((sum, step) => sum + step.weight, 0);

const TRADING_STYLES = Object.freeze([
  {
    id: "scalper",
    label: "Scalper",
    sub: "Seconds-to-minutes; many trades per session.",
    seedSetup: { name: "Opening 5-min momentum", rules: [
      "Wait for the 5-min open candle to close",
      "Enter only with volume above 20-bar average",
      "Hard stop at the open range mid",
    ]},
  },
  {
    id: "intraday",
    label: "Intraday",
    sub: "Multiple setups per day, flat by close.",
    seedSetup: { name: "London / NY break-and-retest", rules: [
      "Wait for the session range to break",
      "Enter on the first retest of the break",
      "Stop on the wrong side of the retest wick",
    ]},
  },
  {
    id: "swing",
    label: "Swing",
    sub: "Hours-to-days; one or two well-prepared trades.",
    seedSetup: { name: "Daily structure pullback", rules: [
      "Bias from the daily trend direction",
      "Enter on the first pullback to value",
      "Risk no more than 1R; target the prior high/low",
    ]},
  },
  {
    id: "position",
    label: "Position",
    sub: "Days-to-weeks; thesis-driven plays.",
    seedSetup: { name: "Weekly breakout", rules: [
      "Confirm weekly close above the level",
      "Size for a multi-day move (≥ 3R)",
      "Exit on the first weekly reversal candle",
    ]},
  },
  {
    id: "investor",
    label: "Long-term investor",
    sub: "Weeks-to-months; rare adjustments.",
    seedSetup: { name: "Monthly base pattern", rules: [
      "Buy at the base of a multi-month range",
      "Trim only on a monthly break of structure",
      "Hold the core while the thesis is intact",
    ]},
  },
]);

const TRADING_STYLE_IDS = TRADING_STYLES.map((s) => s.id);

// A step counts as complete when either the explicit flag is set OR the user
// has explicitly opted out of it (currently only the trade step has an
// opt-out, but the helper is shaped so future steps can do the same).
function isStepDone(stepKey, onboarding) {
  if (onboarding[stepKey]) return true;
  if (stepKey === "tradeAdded" && onboarding.tradeSkipped) return true;
  return false;
}

function computeFunnel(onboarding = {}) {
  const completedSteps = FLOW_STEPS.filter((s) => isStepDone(s.key, onboarding));
  const completedWeight = completedSteps.reduce((sum, s) => sum + s.weight, 0);
  const percent = Math.round((completedWeight / TOTAL_WEIGHT) * 100);
  const nextStep = FLOW_STEPS.find((s) => !isStepDone(s.key, onboarding)) || null;
  return {
    steps: FLOW_STEPS.map((s) => ({
      key: s.key,
      label: s.label,
      completed: isStepDone(s.key, onboarding),
      skipped:   s.key === "tradeAdded" && !onboarding.tradeAdded && Boolean(onboarding.tradeSkipped),
    })),
    completedCount: completedSteps.length,
    totalCount: FLOW_STEPS.length,
    percent,
    nextStepKey: nextStep?.key || null,
    isComplete: !nextStep,
  };
}

async function ensureStartedAt(userId) {
  return User.updateOne(
    { _id: userId, "onboarding.startedAt": null },
    { $set: { "onboarding.startedAt": new Date() } }
  );
}

async function getState(user) {
  if (!user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");

  // Existing-user backfill — lazy, idempotent. The first time an account
  // created before this deploy hits the new onboarding endpoint, we mirror
  // their existing data (trades / setups / preferredMarket) onto the new
  // funnel flags so they don't get bounced into the flow. Cheap when there's
  // nothing to do (cheap pre-check inside the service).
  // Required separately from ensureStartedAt because the backfill can derive
  // startedAt from the earliest trade rather than "now".
  const backfillService = require("./onboardingBackfillService");
  await backfillService.backfillUserOnboarding(user._id).catch((error) => {
    logger.warn("ONBOARDING_BACKFILL_LAZY_FAILED", {
      userId: String(user._id), error: error?.message,
    });
  });
  await ensureStartedAt(user._id);

  // Read fresh because the cached lean user may not have the new fields the
  // first time this endpoint fires for an existing user.
  const fresh = await User.findById(user._id)
    .select("preferredMarket tradingStyle onboarding isOnboardingCompleted")
    .lean();

  const onboarding = fresh?.onboarding || {};
  const funnel = computeFunnel(onboarding);
  return {
    preferredMarket: fresh?.preferredMarket || null,
    tradingStyle:    fresh?.tradingStyle || null,
    onboarding,
    funnel,
    styles: TRADING_STYLES.map(({ id, label, sub, seedSetup }) => ({ id, label, sub, seedSetup })),
    // Hint for the frontend: if the user was a pre-existing account that
    // the backfill flagged as fully activated, the orchestrator should
    // short-circuit straight to /dashboard instead of running the wizard.
    isPreActivated: Boolean(fresh?.isOnboardingCompleted),
  };
}

async function selectMarket(userId, market) {
  if (!["Forex", "Indian_Market"].includes(market)) {
    throw new ApiError(400, "Invalid market", "VALIDATION_ERROR");
  }
  await User.updateOne({ _id: userId }, {
    $set: {
      preferredMarket: market,
      "onboarding.marketSelected": true,
    },
  });
  await invalidateAuthCache(userId);
  logger.info("ONBOARDING_MARKET_SELECTED", { userId: String(userId), market });
}

async function selectStyle(userId, styleId) {
  if (!TRADING_STYLE_IDS.includes(styleId)) {
    throw new ApiError(400, "Invalid trading style", "VALIDATION_ERROR");
  }
  await User.updateOne({ _id: userId }, {
    $set: {
      tradingStyle: styleId,
      "onboarding.styleSelected": true,
    },
  });
  await invalidateAuthCache(userId);
  logger.info("ONBOARDING_STYLE_SELECTED", { userId: String(userId), style: styleId });
}

// Pre-seeds a starter setup based on the user's chosen trading style. We use
// upsert so calling this twice (or after a manual setup add) is safe — it
// will not overwrite an existing strategy of the same name.
async function seedDefaultSetup({ userId, market, styleId, custom }) {
  const resolvedStyle = TRADING_STYLES.find((s) => s.id === styleId) || TRADING_STYLES[1];
  const seed = custom?.name && custom?.rules?.length
    ? { name: String(custom.name).trim().slice(0, 80), rules: custom.rules.slice(0, 8) }
    : resolvedStyle.seedSetup;

  const safeName = seed.name || "My first setup";

  const update = {
    $setOnInsert: {
      user: userId,
      marketType: market || "Forex",
      name: safeName,
      rules: seed.rules.map((label) => ({ label: String(label).slice(0, 200) })),
      referenceImages: [],
    },
  };

  await SetupStrategy.findOneAndUpdate(
    { user: userId, marketType: market || "Forex", name: safeName },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await User.updateOne({ _id: userId }, { $set: { "onboarding.setupAdded": true } });
  await invalidateAuthCache(userId);
  logger.info("ONBOARDING_SETUP_SEEDED", { userId: String(userId), market, name: safeName });
  return { name: safeName, rules: seed.rules };
}

// Called by the trade-create + trade-upload paths. Idempotent: only stamps
// the first-trade timestamp once, but is safe to call from every create.
async function markTradeLogged({ userId, fromScreenshot = false }) {
  const now = new Date();
  const update = {
    $set: { "onboarding.tradeAdded": true },
  };
  // Only set first-trade / first-screenshot timestamps if they're still null.
  const filterTradeStamp = { _id: userId, "onboarding.firstTradeAt": null };
  const filterScreenshotStamp = { _id: userId, "onboarding.firstScreenshotUploadAt": null };

  await User.updateOne({ _id: userId }, update);
  await User.updateOne(filterTradeStamp, { $set: { "onboarding.firstTradeAt": now } });
  if (fromScreenshot) {
    await User.updateOne(filterScreenshotStamp, {
      $set: { "onboarding.firstScreenshotUploadAt": now },
    });
  }
  await invalidateAuthCache(userId);
}

// Explicit "I haven't traded yet" / "Just exploring" path. We mark tradeSkipped
// instead of tradeAdded so analytics can distinguish active traders from
// people kicking the tyres, and so the first insight uses the explorer copy.
// Idempotent — safe to call from a button that fires on every render.
async function markTradeSkipped({ userId, reason = "not_traded_yet" } = {}) {
  await User.updateOne({ _id: userId }, {
    $set: { "onboarding.tradeSkipped": true },
  });
  await invalidateAuthCache(userId);
  logger.info("ONBOARDING_TRADE_SKIPPED", { userId: String(userId), reason });
}

async function markInsightSeen(userId) {
  const now = new Date();
  await User.updateOne({ _id: userId }, {
    $set: { "onboarding.firstInsightSeen": true },
  });
  await User.updateOne(
    { _id: userId, "onboarding.firstInsightAt": null },
    { $set: { "onboarding.firstInsightAt": now } }
  );
  await invalidateAuthCache(userId);
}

async function maybeMarkComplete(userId) {
  const user = await User.findById(userId).select("onboarding isOnboardingCompleted").lean();
  const funnel = computeFunnel(user?.onboarding || {});
  if (funnel.isComplete && !user?.isOnboardingCompleted) {
    await User.updateOne({ _id: userId }, {
      $set: {
        isOnboardingCompleted: true,
        hasSeenWelcomeGuide: true,
        "onboarding.completedAt": new Date(),
        "onboarding.tourCompleted": true,
      },
    });
    await invalidateAuthCache(userId);
    logger.info("ONBOARDING_COMPLETED", { userId: String(userId) });
    return true;
  }
  return false;
}

// Builds a personal first-insight string. Three branches:
//   1. The user logged a trade → evidence-based welcome
//   2. The user explicitly said "I haven't traded yet" (tradeSkipped) →
//      paper-trader / explorer welcome that does NOT pressure them
//   3. The user landed here without a trade and without a skip (resumed
//      mid-flow) → generic "we're ready" welcome
// Never throws — failure surfaces to the controller as a generic "we're
// warming up" line so onboarding can't be blocked by AI flakiness.
async function buildFirstInsight({ userId, market, tradingStyle }) {
  const recent = await loadOneRecentTrade(userId);
  const user = await User.findById(userId).select("onboarding").lean();
  const isExplorer = Boolean(user?.onboarding?.tradeSkipped) && !recent;
  const styleLabel = (TRADING_STYLES.find((s) => s.id === tradingStyle)?.label || "trader").toLowerCase();
  const marketLabel = market ? ` for ${market.replace("_", " ")}` : "";

  if (recent) {
    const pnl = Number(recent.profit) || 0;
    const direction = pnl >= 0 ? "win" : "loss";
    const tone = pnl >= 0
      ? `That ${direction} is now a data point — keep logging and we can tell you which setup is repeatable.`
      : `That ${direction} is now part of your edge map — three more entries and we can spot what's eating the wins.`;
    return {
      title:    "Your first trade is logged.",
      body:     `Welcome in. As a ${styleLabel}, your edge will compound from this sample. ${tone}`,
      evidence: `1 trade logged · ${pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(2)} ${recent.pair || ""}`.trim(),
      action:   "Open the dashboard — the coach can now answer 'why' on any trade you log.",
      variant:  "logged",
    };
  }

  if (isExplorer) {
    return {
      title:    "You're set up for when the first trade lands.",
      body:     `No trades yet — and that's fine. Your ${styleLabel} profile${marketLabel} is wired in, your default setup is saved, and Edgecipline only coaches from real data. Paper trade or watch — the moment you log your first one, the coach turns on.`,
      evidence: "0 trades logged · explorer mode",
      action:   "Try a paper trade tomorrow, screenshot it, and upload — AI fills the rest in ~30 seconds.",
      variant:  "explorer",
    };
  }

  return {
    title:    "You're set up. Now we wait for evidence.",
    body:     `Your ${styleLabel} profile is wired in${marketLabel}. The coach is data-only — log a trade (manual or screenshot) and the first real insight will fire automatically.`,
    evidence: "0 trades logged yet · setup ready",
    action:   "Tap “Log a trade” when you have one — or upload a broker screenshot and the AI will pre-fill it.",
    variant:  "waiting",
  };
}

async function loadOneRecentTrade(userId) {
  const projection = { profit: 1, pair: 1, marketType: 1, createdAt: 1, tradeDate: 1 };
  const [forex, indian] = await Promise.all([
    Trade.findOne(
      { user: userId, deletedAt: null, "parsedData.multiTradeGhost": { $ne: true } },
      projection
    ).sort({ effectiveTradeDate: -1 }).lean(),
    IndianTrade.findOne(
      { user: userId, deletedAt: null },
      projection
    ).sort({ effectiveTradeDate: -1 }).lean(),
  ]);
  if (!forex && !indian) return null;
  if (!forex) return indian;
  if (!indian) return forex;
  return new Date(forex.effectiveTradeDate || forex.createdAt) >
    new Date(indian.effectiveTradeDate || indian.createdAt)
    ? forex
    : indian;
}

module.exports = {
  FLOW_STEPS,
  TRADING_STYLES,
  TRADING_STYLE_IDS,
  buildFirstInsight,
  computeFunnel,
  getState,
  isStepDone,
  markInsightSeen,
  markTradeLogged,
  markTradeSkipped,
  maybeMarkComplete,
  seedDefaultSetup,
  selectMarket,
  selectStyle,
};
