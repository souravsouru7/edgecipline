const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  getTemplates,
  getActiveMissions,
  getMissionHistory,
  getMission,
  getMissionStats,
  acceptMission,
  archiveMission,
  getRecommendations,
  getBehaviorProfile,
} = require("../controllers/missionController");

// Templates (browsable by user)
router.get("/templates", protect, getTemplates);

// Active missions + stats
router.get("/", protect, getActiveMissions);
router.get("/stats", protect, getMissionStats);
router.get("/history", protect, getMissionHistory);
router.get("/profile", protect, getBehaviorProfile);

// AI Recommendations
router.post("/recommend", protect, getRecommendations);

// Single mission
router.get("/:id", protect, getMission);

// Lifecycle
router.post("/:id/accept", protect, acceptMission);
router.post("/:id/archive", protect, archiveMission);

module.exports = router;
