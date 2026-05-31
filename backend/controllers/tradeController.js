const asyncHandler = require("../utils/asyncHandler");
const tradeService = require("../services/trade.service");
const tradeRepository = require("../repositories/trade.repository");

exports.createTrade = asyncHandler(async (req, res) => {
  const trade = await tradeService.createTrade(req.user._id, req.body, {
    accountCreatedAt: req.user.createdAt,
  });
  res.status(201).json(trade);
});

exports.getTrades = asyncHandler(async (req, res) => {
  const trades = await tradeService.getTrades(req.user._id, req.query);
  res.json(trades);
});

exports.getTrade = asyncHandler(async (req, res) => {
  const trade = await tradeService.getTrade(req.user._id, req.params.id);
  res.json(trade);
});

exports.getTradeStatus = asyncHandler(async (req, res) => {
  const tradeStatus = await tradeService.getTradeStatus(req.user._id, req.params.id);
  res.json(tradeStatus);
});

exports.updateTrade = asyncHandler(async (req, res) => {
  const trade = await tradeService.updateTrade(req.user._id, req.params.id, req.body, {
    accountCreatedAt: req.user.createdAt,
  });
  res.json(trade);
});

exports.deleteTrade = asyncHandler(async (req, res) => {
  const result = await tradeService.deleteTrade(req.user._id, req.params.id);
  res.json(result);
});

exports.debugTrades = asyncHandler(async (req, res) => {
  const counts = await tradeRepository.countTradesDebug(req.user._id);
  res.json(counts);
});
