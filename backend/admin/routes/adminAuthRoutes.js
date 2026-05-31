const express = require("express");
const router = express.Router();

const { adminLogin, adminLogout, getAdminProfile } = require("../controllers/adminAuthController");
const { adminAuth } = require("../../middleware/adminAuth");
const { authRateLimiter } = require("../../middleware/rateLimiter");

// POST /api/admin/auth/login — rate limited to prevent brute force
router.post("/login", authRateLimiter, adminLogin);

// POST /api/admin/auth/logout — clears the admin session cookie
router.post("/logout", adminLogout);

// GET /api/admin/auth/me (protected – admin only)
router.get("/me", adminAuth, getAdminProfile);

module.exports = router;
