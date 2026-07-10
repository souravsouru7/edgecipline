const express = require("express");
const router = express.Router();
const { 
  getAllPayments, 
  updatePaymentStatus, 
  addManualPayment 
} = require("../controllers/adminPaymentController");
const { adminAuth } = require("../../middleware/adminAuth");
const { validateObjectId } = require("../../middleware/validateObjectId");
const { adminFinancialRateLimiter } = require("../../middleware/rateLimiter");

// All routes are protected by adminAuth
router.get("/", adminAuth, getAllPayments);
router.patch(
  "/:id/status",
  adminAuth,
  adminFinancialRateLimiter,
  validateObjectId("id"),
  updatePaymentStatus
);
router.post("/manual", adminAuth, adminFinancialRateLimiter, addManualPayment);

module.exports = router;
