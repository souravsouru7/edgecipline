const express = require("express");
const router = express.Router();
const { adminAuth } = require("../../middleware/adminAuth");
const {
  getAllTemplates,
  createTemplate,
  updateTemplate,
  deactivateTemplate,
  getUserMissions,
  pushMissionToUser,
  getAnalytics,
  seedTemplates,
} = require("../controllers/adminMissionController");

// Template management
router.get("/templates", adminAuth, getAllTemplates);
router.post("/templates", adminAuth, createTemplate);
router.put("/templates/:id", adminAuth, updateTemplate);
router.delete("/templates/:id", adminAuth, deactivateTemplate);

// User assignment management
router.get("/users/:userId/missions", adminAuth, getUserMissions);
router.post("/assign", adminAuth, pushMissionToUser);

// Analytics
router.get("/analytics", adminAuth, getAnalytics);

// Seed
router.post("/seed", adminAuth, seedTemplates);

module.exports = router;
