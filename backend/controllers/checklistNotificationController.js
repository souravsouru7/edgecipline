const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ChecklistNotificationSetting = require("../models/ChecklistNotificationSetting");
const SetupStrategy = require("../models/SetupStrategy");

// GET /api/checklists/notification-settings?market=Forex
const getNotificationSettings = asyncHandler(async (req, res) => {
  const market = req.query.market || "Forex";

  const setting = await ChecklistNotificationSetting.findOne({
    user: req.user._id,
    market,
  }).lean();

  if (!setting) {
    return res.status(200).json({
      enabled: false,
      strategyId: null,
      strategyName: "",
      market,
      notificationTime: "09:00",
      repeatMode: "daily",
      customDays: [1, 2, 3, 4, 5],
      persistent: false,
      resetEnabled: true,
      resetTime: "00:00",
    });
  }

  res.status(200).json(setting);
});

// PUT /api/checklists/notification-settings
const saveNotificationSettings = asyncHandler(async (req, res) => {
  const {
    enabled,
    strategyId,
    strategyName,
    market,
    notificationTime,
    repeatMode,
    customDays,
    persistent,
    resetEnabled,
    resetTime,
  } = req.body;

  if (market && !["Forex", "Indian_Market"].includes(market)) {
    throw new ApiError(400, "Invalid market", "INVALID_MARKET");
  }
  if (notificationTime && !/^\d{2}:\d{2}$/.test(notificationTime)) {
    throw new ApiError(400, "Invalid notificationTime format — use HH:mm", "INVALID_TIME");
  }
  if (resetTime && !/^\d{2}:\d{2}$/.test(resetTime)) {
    throw new ApiError(400, "Invalid resetTime format — use HH:mm", "INVALID_TIME");
  }
  if (
    repeatMode &&
    !["daily", "weekdays", "custom"].includes(repeatMode)
  ) {
    throw new ApiError(400, "Invalid repeatMode", "INVALID_REPEAT_MODE");
  }

  // Verify strategy belongs to this user if provided
  if (strategyId) {
    const strategy = await SetupStrategy.findOne({
      _id: strategyId,
      user: req.user._id,
    });
    if (!strategy) {
      throw new ApiError(404, "Strategy not found", "STRATEGY_NOT_FOUND");
    }
  }

  const update = {};
  if (enabled !== undefined) update.enabled = Boolean(enabled);
  if (strategyId !== undefined) update.strategyId = strategyId || null;
  if (strategyName !== undefined) update.strategyName = strategyName;
  if (market !== undefined) update.market = market;
  if (notificationTime !== undefined) update.notificationTime = notificationTime;
  if (repeatMode !== undefined) update.repeatMode = repeatMode;
  if (customDays !== undefined) update.customDays = customDays;
  if (persistent !== undefined) update.persistent = Boolean(persistent);
  if (resetEnabled !== undefined) update.resetEnabled = Boolean(resetEnabled);
  if (resetTime !== undefined) update.resetTime = resetTime;

  const docMarket = market || "Forex";
  update.market = docMarket;

  const setting = await ChecklistNotificationSetting.findOneAndUpdate(
    { user: req.user._id, market: docMarket },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(200).json(setting);
});

module.exports = { getNotificationSettings, saveNotificationSettings };
