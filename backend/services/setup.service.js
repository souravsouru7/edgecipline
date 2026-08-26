const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");
const setupRepository = require("../repositories/setup.repository");
const ChecklistNotificationSetting = require("../models/ChecklistNotificationSetting");
const cloudinary = require("../config/cloudinary");
const { logger } = require("../utils/logger");
const { TRADE_CACHE_EVENTS, invalidateTradeCaches } = require("../utils/cacheUtils");

const SETUP_MARKET_TYPES = new Set(["Forex", "Indian_Market"]);
const MAX_STRATEGIES = 50;
const MAX_NAME_LENGTH = 100;
// Matches Trade/IndianTrade.setupRules — a strategy with more rules than a
// trade can carry is a strategy the user can never actually log a trade with.
const MAX_RULES_PER_STRATEGY = 20;
// Matches the SetupStrategy schema's maxlength on rules[].label.
const MAX_RULE_LABEL_LENGTH = 200;

function requireSetupMarketType(marketType) {
  if (!SETUP_MARKET_TYPES.has(marketType)) {
    throw new ApiError(400, "Invalid setup market type", "VALIDATION_ERROR");
  }
  return marketType;
}

function normalizeImages(referenceImages) {
  if (!Array.isArray(referenceImages)) return [];
  return referenceImages
    .filter((image) => image && (image.url || image.publicId))
    .map((image) => ({
      url: String(image.url || "").trim(),
      publicId: String(image.publicId || "").trim(),
    }))
    .filter((image) => image.url);
}

function normalizeRules(rules, strategyName) {
  if (rules === undefined || rules === null) return [];
  if (!Array.isArray(rules)) {
    throw new ApiError(
      400,
      `Rules for "${strategyName}" must be a list.`,
      "VALIDATION_ERROR"
    );
  }
  const cleaned = rules
    .filter((rule) => rule && typeof rule.label === "string" && rule.label.trim().length > 0)
    .map((rule) => ({ label: rule.label.trim() }));

  const tooLong = cleaned.find((rule) => rule.label.length > MAX_RULE_LABEL_LENGTH);
  if (tooLong) {
    // Caught here so the user gets this instead of a raw Mongoose
    // "Path `label` ... is longer than the maximum allowed length" string.
    throw new ApiError(
      400,
      `A rule in "${strategyName}" is too long (${tooLong.label.length} characters). Keep each rule under ${MAX_RULE_LABEL_LENGTH}.`,
      "RULE_LABEL_TOO_LONG"
    );
  }

  if (cleaned.length > MAX_RULES_PER_STRATEGY) {
    throw new ApiError(
      400,
      `"${strategyName}" has ${cleaned.length} rules. A strategy can hold at most ${MAX_RULES_PER_STRATEGY}, because that is the most a single trade can record.`,
      "TOO_MANY_RULES"
    );
  }
  return cleaned;
}

// An unnamed row the user never filled in is just an empty row -- drop it.
// An unnamed row that already carries rules or screenshots is *work*, and
// silently discarding it (the old behaviour) looked like a successful save
// until the page was reloaded.
function isAbandonedRow(strategy) {
  const hasRules = Array.isArray(strategy?.rules) && strategy.rules.some((r) => r?.label?.trim());
  const hasImages = normalizeImages(strategy?.referenceImages).length > 0;
  return !hasRules && !hasImages;
}

function buildDocs(strategies) {
  const docs = [];

  strategies.forEach((strategy, index) => {
    if (!strategy || typeof strategy !== "object") return;

    const name = typeof strategy.name === "string" ? strategy.name.trim() : "";
    if (!name) {
      if (isAbandonedRow(strategy)) return;
      throw new ApiError(
        400,
        `Strategy ${index + 1} has rules but no name. Name it before saving.`,
        "STRATEGY_NAME_REQUIRED"
      );
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new ApiError(
        400,
        `Strategy name is too long (${name.length} characters). Keep it under ${MAX_NAME_LENGTH}.`,
        "STRATEGY_NAME_TOO_LONG"
      );
    }

    docs.push({
      _id: mongoose.Types.ObjectId.isValid(strategy._id) ? String(strategy._id) : null,
      name,
      referenceImages: normalizeImages(strategy.referenceImages),
      rules: normalizeRules(strategy.rules, name),
    });
  });

  return docs;
}

function assertNoDuplicateNames(docs) {
  // The unique index on (user, marketType, name) is case-sensitive, so it
  // won't catch "Breakout" vs "breakout".
  const seenNames = new Map();
  for (const doc of docs) {
    const key = doc.name.toLowerCase();
    if (seenNames.has(key)) {
      throw new ApiError(
        400,
        `Duplicate strategy name "${doc.name}" (matches "${seenNames.get(key)}")`,
        "DUPLICATE_STRATEGY_NAME"
      );
    }
    seenNames.set(key, doc.name);
  }
}

async function destroyStaleImages(existingStrategies, docs) {
  const nextPublicIds = new Set(
    docs.flatMap((doc) => doc.referenceImages.map((image) => image.publicId).filter(Boolean))
  );
  const stalePublicIds = existingStrategies
    .flatMap((strategy) => (Array.isArray(strategy.referenceImages) ? strategy.referenceImages : []))
    .map((image) => image.publicId)
    .filter((publicId) => publicId && !nextPublicIds.has(publicId));

  if (stalePublicIds.length === 0) return;

  await Promise.allSettled(
    stalePublicIds.map((publicId) =>
      cloudinary.uploader.destroy(publicId, { resource_type: "image" })
    )
  );
}

// The pre-trade checklist notification is bound to a strategy by id and shows
// its name. Keep that record honest when the strategy is renamed or deleted --
// otherwise the notification keeps advertising a strategy the user no longer
// has, and the settings screen silently falls back to the first one in the list.
async function reconcileChecklistNotification(userId, marketType, { deletedIds, renamed }) {
  if (!deletedIds.length && !renamed.length) return;

  try {
    const setting = await ChecklistNotificationSetting.findOne({ user: userId, market: marketType });
    if (!setting?.strategyId) return;

    const boundId = String(setting.strategyId);

    if (deletedIds.includes(boundId)) {
      setting.strategyId = null;
      setting.strategyName = "";
      await setting.save();
      logger.info("Checklist notification unbound after its strategy was deleted", {
        userId: String(userId),
        market: marketType,
        strategyId: boundId,
      });
      return;
    }

    const rename = renamed.find((entry) => entry.id === boundId);
    if (rename && setting.strategyName !== rename.to) {
      setting.strategyName = rename.to;
      await setting.save();
      logger.info("Checklist notification name updated after strategy rename", {
        userId: String(userId),
        market: marketType,
        strategyId: boundId,
        from: rename.from,
        to: rename.to,
      });
    }
  } catch (error) {
    // Never fail a setup save because the notification record could not be
    // reconciled; the save itself is already committed.
    logger.warn("Failed to reconcile checklist notification after setup save", {
      userId: String(userId),
      market: marketType,
      error: error.message,
    });
  }
}

async function getSetups(userId, marketType = "Forex") {
  return setupRepository.findSetupsByUserAndMarket(userId, requireSetupMarketType(marketType));
}

async function saveSetups(userId, marketType = "Forex", strategies) {
  if (!Array.isArray(strategies)) {
    throw new ApiError(400, "strategies must be an array", "VALIDATION_ERROR");
  }
  requireSetupMarketType(marketType);

  if (strategies.length > MAX_STRATEGIES) {
    throw new ApiError(
      400,
      `You can keep up to ${MAX_STRATEGIES} strategies per market.`,
      "TOO_MANY_STRATEGIES"
    );
  }

  const docs = buildDocs(strategies);
  assertNoDuplicateNames(docs);

  const existingStrategies = await setupRepository.findRawSetupsByUserAndMarket(userId, marketType);

  await destroyStaleImages(existingStrategies, docs);

  const { strategies: saved, deletedIds, renamed } = await setupRepository.applySetupsDiff(
    userId,
    marketType,
    docs
  );

  await reconcileChecklistNotification(userId, marketType, { deletedIds, renamed });

  // Advance the version before the successful response reaches the browser.
  // This prevents an immediate client refetch from racing the invalidation.
  // Redis failures resolve to version 0 and never undo the committed DB write.
  await invalidateTradeCaches({
    userId,
    event: TRADE_CACHE_EVENTS.SETUP_EDIT,
    market: marketType,
    source: "setup_replace",
    count: saved.length,
  });

  return saved;
}

module.exports = {
  getSetups,
  saveSetups,
  MAX_RULES_PER_STRATEGY,
  MAX_STRATEGIES,
  MAX_NAME_LENGTH,
};
