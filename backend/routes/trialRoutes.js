const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  getStatus,
  getPaywallContext,
  recordEvent,
} = require("../controllers/trialController");

router.get("/status", protect, getStatus);
router.get("/paywall-context", protect, getPaywallContext);
router.post("/event", protect, recordEvent);

module.exports = router;
