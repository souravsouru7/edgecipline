const asyncHandler = require("../utils/asyncHandler");
const tradeService = require("../services/trade.service");
const { paginated, success } = require("../utils/apiResponse");

exports.createTrade = asyncHandler(async (req, res) => {
  const trade = await tradeService.createTrade(req.user._id, req.body, {
    accountCreatedAt: req.user.createdAt,
  });
  success(res, trade, { statusCode: 201, message: "Trade created" });
});

exports.createTradesBatch = asyncHandler(async (req, res) => {
  const result = await tradeService.createTradesBatch(req.user._id, req.body, {
    accountCreatedAt: req.user.createdAt,
  });
  success(res, result, { statusCode: 201, message: "Trades created" });
});

exports.getTrades = asyncHandler(async (req, res) => {
  const result = await tradeService.getTrades(req.user._id, req.validated.query);
  paginated(res, result.items, result.pagination);
});

exports.getTrade = asyncHandler(async (req, res) => {
  const trade = await tradeService.getTrade(req.user._id, req.params.id);
  success(res, trade);
});

exports.getTradeStatus = asyncHandler(async (req, res) => {
  const tradeStatus = await tradeService.getTradeStatus(req.user._id, req.params.id);
  success(res, tradeStatus);
});

exports.updateTrade = asyncHandler(async (req, res) => {
  const trade = await tradeService.updateTrade(req.user._id, req.params.id, req.body, {
    accountCreatedAt: req.user.createdAt,
  });
  success(res, trade);
});

exports.deleteTrade = asyncHandler(async (req, res) => {
  const result = await tradeService.deleteTrade(req.user._id, req.params.id);
  success(res, result, { message: "Trade deleted" });
});

exports.restoreTrade = asyncHandler(async (req, res) => {
  const result = await tradeService.restoreTrade(req.user._id, req.params.id);
  success(res, result, { message: "Trade restored" });
});
