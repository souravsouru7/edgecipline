const express = require("express");

const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const { reflectionSchemas } = require("../validation/reflectionSchemas");
const {
  getReflectionSummary,
  getTodayReflection,
  listReflections,
  skipReflection,
  submitReflection,
} = require("../controllers/reflectionController");

router.get("/today",   protect, getTodayReflection);
router.get("/summary", protect, getReflectionSummary);
router.get(
  "/",
  protect,
  validateRequest(reflectionSchemas.history),
  listReflections
);
router.post(
  "/",
  protect,
  validateRequest(reflectionSchemas.submit),
  submitReflection
);
router.post(
  "/skip",
  protect,
  validateRequest(reflectionSchemas.skip),
  skipReflection
);

module.exports = router;
