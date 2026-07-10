const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  getStreaks,
  markNoTradeToday,
  recomputeStreaks,
  updateRuleThreshold,
} = require("../controllers/streakController");

router.get("/", protect, getStreaks);
router.post("/no-trade-today", protect, markNoTradeToday);
router.post("/recompute", protect, recomputeStreaks);
router.put("/threshold", protect, updateRuleThreshold);

module.exports = router;
