const asyncHandler = require("../utils/asyncHandler");
const weeklyReportService = require("../services/weeklyReport.service");

exports.listWeeklyReports = asyncHandler(async (req, res) => {
  // M18: Clamp limit to a safe range so callers can't request unbounded results
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 12;
  const reports = await weeklyReportService.listWeeklyReports(
    req.user._id,
    (req.query.marketType || "Forex").toString(),
    limit
  );
  res.json(reports);
});

exports.getWeeklyReport = asyncHandler(async (req, res) => {
  const report = await weeklyReportService.getWeeklyReport(req.user._id, req.params.id);
  res.json(report);
});

exports.generateRolling7dReportForUser = weeklyReportService.generateRolling7dReportForUser;

exports.generateNowOnce = asyncHandler(async (req, res) => {
  // Gemini AI can take 30–90s. Extend the global 15s timeout so the
  // middleware doesn't fire mid-generation and cause ERR_HTTP_HEADERS_SENT.
  req.timeoutConfig?.extendTimeout?.(120_000);

  const report = await weeklyReportService.generateNowOnce(
    req.user._id,
    (req.query.marketType || "Forex").toString()
  );
  res.json(report);
});
