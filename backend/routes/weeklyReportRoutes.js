const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const { createRedisRateLimiter } = require("../middleware/rateLimiter");
const { validateObjectId } = require("../middleware/validateObjectId");
const {
  listWeeklyReports,
  getWeeklyReport,
  generateNowOnce,
} = require("../controllers/weeklyReportController");

// Redis-backed so the budget is shared across all API processes/replicas.
// The previous express-rate-limit instance used the in-memory default store
// and silently lost counts on restart and never coordinated across workers.
const generateLimiter = createRedisRateLimiter({
  scope: "weekly-generate",
  windowMs: 60 * 1000,
  maxRequests: 5,
  message: "Too many generate attempts. Please slow down.",
});

router.get("/weekly", protect, listWeeklyReports);
router.get("/weekly/:id", protect, validateObjectId("id"), getWeeklyReport);
// `protect` runs before the limiter so unauthenticated/forged requests are
// rejected at auth and do not consume the limit budget.
router.post("/weekly/generate-now", protect, generateLimiter, generateNowOnce);

module.exports = router;

