const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const ExtractionLog = require("../../models/ExtractionLog");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const tradeRepository = require("../../repositories/trade.repository");

/**
 * @desc    Get all trades across all markets (Forex + Indian)
 * @route   GET /api/admin/trades
 * @access  Private/Admin
 */
exports.getAllTrades = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const skip = (page - 1) * limit;

  const [forexTrades, indianTrades, totalForex, totalIndian] = await Promise.all([
    // ObjectId order is creation order and uses MongoDB's built-in _id index,
    // avoiding global createdAt indexes on the write-heavy trade collections.
    Trade.find().populate("user", "name email").sort({ _id: -1 }).skip(skip).limit(limit).lean(),
    IndianTrade.find().populate("user", "name email").sort({ _id: -1 }).skip(skip).limit(limit).lean(),
    Trade.countDocuments(),
    IndianTrade.countDocuments(),
  ]);

  const allTrades = [
    ...forexTrades.map(t => ({ ...t, marketType: "Forex" })),
    ...indianTrades.map(t => ({ ...t, marketType: "Indian_Market" })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ trades: allTrades, total: totalForex + totalIndian, page, limit });
});

/**
 * @desc    Get all OCR extraction logs
 * @route   GET /api/admin/trades/logs
 * @access  Private/Admin
 */
exports.getExtractionLogs = asyncHandler(async (req, res) => {
  const logs = await ExtractionLog.find()
    .populate("user", "name email")
    .sort({ _id: -1 })
    .limit(100);
  res.json(logs);
});

/**
 * @desc    Inspect visibility counts for one explicitly selected user
 * @route   GET /api/admin/trades/debug?userId=<ObjectId>
 * @access  Private/Admin
 */
exports.getTradeDebug = asyncHandler(async (req, res) => {
  const { userId } = req.query;
  if (!/^[0-9a-fA-F]{24}$/.test(String(userId || ""))) {
    throw new ApiError(400, "A valid target userId is required", "VALIDATION_ERROR");
  }

  const counts = await tradeRepository.countTradesDebug(userId);
  res.json(counts);
});
