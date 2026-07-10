const asyncHandler = require("../utils/asyncHandler");
const onboardingService = require("../services/onboardingService");

exports.getState = asyncHandler(async (req, res) => {
  const state = await onboardingService.getState(req.user);
  res.json(state);
});

exports.selectMarket = asyncHandler(async (req, res) => {
  const { market } = req.validated?.body || req.body;
  await onboardingService.selectMarket(req.user._id, market);
  const state = await onboardingService.getState(req.user);
  res.json(state);
});

exports.selectStyle = asyncHandler(async (req, res) => {
  const { style } = req.validated?.body || req.body;
  await onboardingService.selectStyle(req.user._id, style);
  const state = await onboardingService.getState(req.user);
  res.json(state);
});

exports.seedSetup = asyncHandler(async (req, res) => {
  const body = req.validated?.body || req.body || {};
  const style = body.style || req.user?.tradingStyle || null;
  const market = body.market || req.user?.preferredMarket || "Forex";
  const seeded = await onboardingService.seedDefaultSetup({
    userId: req.user._id,
    market,
    styleId: style,
    custom: body.custom,
  });
  const state = await onboardingService.getState(req.user);
  res.status(201).json({ ...state, seeded });
});

exports.skipTrade = asyncHandler(async (req, res) => {
  const body = req.validated?.body || req.body || {};
  await onboardingService.markTradeSkipped({
    userId: req.user._id,
    reason: body.reason || "not_traded_yet",
  });
  const state = await onboardingService.getState(req.user);
  res.status(201).json(state);
});

exports.firstInsight = asyncHandler(async (req, res) => {
  const insight = await onboardingService.buildFirstInsight({
    userId: req.user._id,
    market: req.user.preferredMarket || "Forex",
    tradingStyle: req.user.tradingStyle || null,
  });
  await onboardingService.markInsightSeen(req.user._id);
  await onboardingService.maybeMarkComplete(req.user._id);
  const state = await onboardingService.getState(req.user);
  res.json({ insight, ...state });
});

exports.complete = asyncHandler(async (req, res) => {
  await onboardingService.maybeMarkComplete(req.user._id);
  const state = await onboardingService.getState(req.user);
  res.json(state);
});
