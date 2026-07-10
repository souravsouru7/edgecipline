const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const tradingDnaService = require("../services/tradingDnaService");

const ALLOWED_MARKETS = new Set(["Forex", "Indian_Market"]);
const ALLOWED_PERIODS = new Set(["30d", "90d", "365d"]);

function resolveMarket(req) {
  const raw = (req.query.marketType || "Forex").toString();
  if (!ALLOWED_MARKETS.has(raw)) {
    throw new ApiError(
      400,
      "marketType must be Forex or Indian_Market",
      "VALIDATION_ERROR"
    );
  }
  return raw;
}

function resolvePeriod(req) {
  const raw = (req.query.period || tradingDnaService.DEFAULT_PERIOD).toString();
  if (!ALLOWED_PERIODS.has(raw)) {
    throw new ApiError(
      400,
      "period must be 30d, 90d, or 365d",
      "VALIDATION_ERROR"
    );
  }
  return raw;
}

exports.getLatest = asyncHandler(async (req, res) => {
  const marketType = resolveMarket(req);
  const periodType = resolvePeriod(req);
  const report = await tradingDnaService.getLatest(
    req.user._id,
    marketType,
    periodType
  );
  res.json(report || null);
});

exports.listReports = asyncHandler(async (req, res) => {
  const marketType = resolveMarket(req);
  const reports = await tradingDnaService.listReports(
    req.user._id,
    marketType,
    req.query.limit
  );
  res.json(reports);
});

exports.getReportById = asyncHandler(async (req, res) => {
  const report = await tradingDnaService.getReportById(
    req.user._id,
    req.params.id
  );
  res.json(report);
});

// Mint a share token for one of this user's reports. Ownership is enforced
// inside the service (findByIdAndUser).
exports.createShareToken = asyncHandler(async (req, res) => {
  const reportId = String(req.params.id || "");
  if (!reportId) {
    throw new ApiError(400, "reportId is required", "VALIDATION_ERROR");
  }
  const ttlDays = req.body?.ttlDays ?? req.query?.ttlDays;
  const payload = await tradingDnaService.createShareToken({
    userId: req.user._id,
    reportId,
    ttlDays,
  });
  res.json(payload);
});

// Public: anyone with a valid share token can fetch a sanitized payload.
// No auth middleware on the route; the token itself is the bearer.
exports.getSharedReport = asyncHandler(async (req, res) => {
  const token = String(req.params.token || "");
  const payload = await tradingDnaService.getSharedReport(token);
  // Disable caching at intermediaries so a stale link doesn't get served
  // from a CDN after the underlying report changes.
  res.setHeader("Cache-Control", "private, no-store");
  res.json(payload);
});

// Async path — enqueues a BullMQ job and returns a job id immediately.
// Frontend polls /jobs/:jobId until state is "completed" or "failed".
exports.enqueueGenerate = asyncHandler(async (req, res) => {
  const marketType = resolveMarket(req);
  const periodType = resolvePeriod(req);
  const force = req.query.force === "true" || req.body?.force === true;
  const enqueued = await tradingDnaService.enqueueGeneration({
    userId: req.user._id,
    marketType,
    periodType,
    force,
  });
  // 202 — request accepted; processing happens asynchronously on the worker.
  res.status(202).json(enqueued);
});

exports.getJobStatus = asyncHandler(async (req, res) => {
  const jobId = String(req.params.jobId || "");
  const status = await tradingDnaService.getJobStatus({
    userId: req.user._id,
    jobId,
  });
  res.json(status);
});

exports.generate = asyncHandler(async (req, res) => {
  // Gemini takes up to ~30–90s on a full 90-day bundle. Extend the global
  // 15s request timeout to match the weekly-report pattern.
  req.timeoutConfig?.extendTimeout?.(120_000);

  const marketType = resolveMarket(req);
  const periodType = resolvePeriod(req);
  const force = req.query.force === "true" || req.body?.force === true;
  const report = await tradingDnaService.generateNowOnce({
    userId: req.user._id,
    marketType,
    periodType,
    force,
  });
  // The freshly generated report is by definition not stale — annotate it
  // with the same `meta` shape as the read endpoints so the frontend can
  // consume both responses with one code path.
  const annotated = await tradingDnaService.attachStaleness(report);
  res.json(annotated);
});
