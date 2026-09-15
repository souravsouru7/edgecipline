const asyncHandler = require("../utils/asyncHandler");
const tradeService = require("../services/trade.service");
const tradeQuotaService = require("../services/tradeQuotaService");
const freeTierFunnelService = require("../services/freeTierFunnelService");
const { paginated, success } = require("../utils/apiResponse");
const { withQuota } = require("../utils/tradeQuotaResponse");

exports.getTradeQuota = asyncHandler(async (req, res) => {
  const quota = await tradeQuotaService.getQuota({
    user: req.user,
    market: tradeQuotaService.FOREX,
  });
  // Accounts that filled the allowance before the funnel existed get their
  // T0 stamped the first time the client asks — see the service for why.
  await freeTierFunnelService.backfillExhaustedState({
    user: req.user,
    market: tradeQuotaService.FOREX,
    quota,
  });
  success(res, { quota });
});

exports.createTrade = asyncHandler(async (req, res) => {
  // Gate before the service does any work — an OCR job gets claimed and a
  // trade document built in there, so failing later would burn the job.
  await tradeQuotaService.assertCanCreateTrades({
    user: req.user,
    market: tradeQuotaService.FOREX,
    count: 1,
  });
  const trade = await tradeService.createTrade(req.user._id, req.body, {
    accountCreatedAt: req.user.createdAt,
  });
  // Re-count after the insert so the client can render "1 free trade left"
  // from this response alone, and stamp T0 if that was the last slot.
  const funnel = await freeTierFunnelService.recordTradesCreated({
    user: req.user,
    market: tradeQuotaService.FOREX,
  });
  success(res, withQuota(trade, funnel), { statusCode: 201, message: "Trade created" });
});

exports.createTradesBatch = asyncHandler(async (req, res) => {
  // A batch is all-or-nothing against the allowance: importing 5 trades with
  // 1 slot left is rejected outright rather than silently truncated, so the
  // user never thinks trades were saved when they were not.
  const requested = Array.isArray(req.body?.trades) ? req.body.trades.length : 0;
  if (requested > 0) {
    await tradeQuotaService.assertCanCreateTrades({
      user: req.user,
      market: tradeQuotaService.FOREX,
      count: requested,
    });
  }
  const result = await tradeService.createTradesBatch(req.user._id, req.body, {
    accountCreatedAt: req.user.createdAt,
  });
  const funnel = await freeTierFunnelService.recordTradesCreated({
    user: req.user,
    market: tradeQuotaService.FOREX,
  });
  success(res, withQuota(result, funnel), { statusCode: 201, message: "Trades created" });
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
