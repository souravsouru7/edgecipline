const express = require("express");
const router = express.Router();
const { 
  getAllFeedback, 
  updateFeedbackStatus, 
  deleteFeedback 
} = require("../../controllers/feedbackController");
const { adminAuth } = require("../../middleware/adminAuth");
const { validateObjectId } = require("../../middleware/validateObjectId");

router.get("/", adminAuth, getAllFeedback);
router.patch("/:id", adminAuth, validateObjectId("id"), updateFeedbackStatus);
router.delete("/:id", adminAuth, validateObjectId("id"), deleteFeedback);

module.exports = router;
