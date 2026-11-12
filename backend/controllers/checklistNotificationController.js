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
      // Weekdays by default: markets are shut at the weekend, and "daily"
      // here meant a fresh install pinged on Saturday and Sunday.
      repeatMode: "weekdays",
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
  // A real clock time — the old /^\d{2}:\d{2}$/ accepted "99:99".
  const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (notificationTime && !HHMM.test(notificationTime)) {
    throw new ApiError(400, "Invalid notificationTime format — use HH:mm", "INVALID_TIME");
  }
  if (resetTime && !HHMM.test(resetTime)) {
    throw new ApiError(400, "Invalid resetTime format — use HH:mm", "INVALID_TIME");
  }
  // Older app builds (iOS 1.0, Android 1.1.2) always send customDays, and
  // let the user untick every day before saving. An empty list only matters
  // when the schedule actually uses it; for daily/weekdays it is ignored
  // below rather than rejected, so those saves keep working.
  const emptyDaysIgnored = Array.isArray(customDays) && customDays.length === 0 && repeatMode !== "custom";
  if (customDays !== undefined && !emptyDaysIgnored) {
    const valid = Array.isArray(customDays)
      && customDays.length > 0
      && customDays.length <= 7
      // ISO weekdays, 1 = Monday … 7 = Sunday (model, Android worker and iOS agree).
      && customDays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)
      && new Set(customDays).size === customDays.length;
    if (!valid) {
      throw new ApiError(400, "customDays must be unique ISO weekday numbers 1–7", "INVALID_CUSTOM_DAYS");
    }
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
  if (customDays !== undefined && !emptyDaysIgnored) update.customDays = customDays;
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
