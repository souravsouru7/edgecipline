const express = require("express");
const { getSummary } = require("../controllers/indianIntelligenceController");
const { protect } = require("../middleware/authMiddleware");
const cacheMiddleware = require("../middleware/cacheMiddleware");

const router = express.Router();

// Indian Market only: the underlying service imports IndianTrade directly and
// never delegates to shared/combined or Forex analytics.
router.use(protect);
router.get(
  "/summary",
  cacheMiddleware({ namespace: "intelligence:indian", scope: "summary", ttlSeconds: 120 }),
  getSummary
);

module.exports = router;
