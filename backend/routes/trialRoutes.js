const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  getStatus,
  getPaywallContext,
  recordEvent,
  dismissLastFreeTradeSheet,
} = require("../controllers/trialController");

router.get("/status", protect, getStatus);
router.get("/paywall-context", protect, getPaywallContext);
router.post("/event", protect, recordEvent);
router.post("/free-tier/sheet-dismissed", protect, dismissLastFreeTradeSheet);

module.exports = router;
