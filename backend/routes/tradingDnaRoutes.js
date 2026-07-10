const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const { createRedisRateLimiter } = require("../middleware/rateLimiter");
const {
  createShareToken,
  enqueueGenerate,
  generate,
  getJobStatus,
  getLatest,
  getReportById,
  getSharedReport,
  listReports,
} = require("../controllers/tradingDnaController");

// 2 generations per minute per user. Trading DNA is meant to be regenerated
// occasionally, not on every page view — and each call hits Gemini.
const generateLimiter = createRedisRateLimiter({
  scope: "trading-dna-generate",
  windowMs: 60 * 1000,
  maxRequests: 2,
  message: "Too many Trading DNA generations. Please wait a minute.",
});

// Tighter window on share-token minting to discourage abuse via scripting.
const shareMintLimiter = createRedisRateLimiter({
  scope: "trading-dna-share-mint",
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: "Too many share-link requests. Please slow down.",
});

// Per-IP throttle on the public read so a leaked token cannot be brute-
// scraped or wrapped in a hot-link to amplify load.
const shareReadLimiter = createRedisRateLimiter({
  scope: "trading-dna-share-read",
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: "Too many requests for this shared report.",
});

// Higher cadence on the status endpoint — frontends poll it. 60/min is
// generous enough for a 2s interval but well below abuse thresholds.
const jobStatusLimiter = createRedisRateLimiter({
  scope: "trading-dna-job-status",
  windowMs: 60 * 1000,
  maxRequests: 60,
  message: "Polling too quickly. Please slow down.",
});

// Public share read MUST be declared before any `/:id` route or Express
// will match the literal "share" against the dynamic id segment.
router.get("/share/:token", shareReadLimiter, getSharedReport);

router.get("/", protect, getLatest);
router.get("/list", protect, listReports);
// Likewise, /jobs/:jobId must beat /:id. `jobs` is reserved.
router.get("/jobs/:jobId", protect, jobStatusLimiter, getJobStatus);
router.get("/:id", protect, getReportById);
router.post("/:id/share-token", protect, shareMintLimiter, createShareToken);
// `protect` runs before the limiter so unauthenticated/forged requests are
// rejected at auth and do not consume the limit budget.
router.post("/generate", protect, generateLimiter, generate);
router.post("/generate-async", protect, generateLimiter, enqueueGenerate);

module.exports = router;
