const express = require("express");
const router = express.Router();
const { 
  getAllPayments, 
  updatePaymentStatus, 
  addManualPayment 
} = require("../controllers/adminPaymentController");
const { adminAuth } = require("../../middleware/adminAuth");
const { validateObjectId } = require("../../middleware/validateObjectId");

// All routes are protected by adminAuth
router.get("/", adminAuth, getAllPayments);
router.patch("/:id/status", adminAuth, validateObjectId("id"), updatePaymentStatus);
router.post("/manual", adminAuth, addManualPayment);

module.exports = router;
