const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const cacheMiddleware = require("../middleware/cacheMiddleware");
const { getDashboardSnapshot } = require("../controllers/dashboardController");

router.get(
  "/snapshot",
  protect,
  cacheMiddleware({ namespace: "dashboard_snapshot", scope: (req) => req.query.market || "Forex", ttlSeconds: 90 }),
  getDashboardSnapshot
);

module.exports = router;
