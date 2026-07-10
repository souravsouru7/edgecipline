const express = require("express");

const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const { onboardingSchemas } = require("../validation/onboardingSchemas");
const {
  complete,
  firstInsight,
  getState,
  seedSetup,
  selectMarket,
  selectStyle,
  skipTrade,
} = require("../controllers/onboardingController");

router.get("/",         protect, getState);
router.post("/market",  protect, validateRequest(onboardingSchemas.selectMarket), selectMarket);
router.post("/style",   protect, validateRequest(onboardingSchemas.selectStyle),  selectStyle);
router.post("/setup",   protect, validateRequest(onboardingSchemas.seedSetup),    seedSetup);
router.post("/skip-trade", protect, validateRequest(onboardingSchemas.skipTrade), skipTrade);
router.post("/insight", protect, validateRequest(onboardingSchemas.insight),      firstInsight);
router.post("/complete",protect, validateRequest(onboardingSchemas.complete),     complete);

module.exports = router;
