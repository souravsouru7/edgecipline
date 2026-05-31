const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const ExtractionLog = require("../../models/ExtractionLog");
const asyncHandler = require("../../utils/asyncHandler");

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
    Trade.find().populate("user", "name email").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    IndianTrade.find().populate("user", "name email").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
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
    .sort({ createdAt: -1 })
    .limit(100);
  res.json(logs);
});
