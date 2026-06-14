const express = require("express");
const router = express.Router();
const { adminAuth } = require("../../middleware/adminAuth");
const { snapshotAuthCacheMetrics } = require("../../services/authCacheService");

// GET /api/admin/auth-cache-metrics
router.get("/", adminAuth, (_req, res) => {
  res.json(snapshotAuthCacheMetrics());
});

module.exports = router;
