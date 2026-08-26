const express = require("express");
const router = express.Router();

const {
  registerUser,
  loginUser,
  googleLogin,
  getMe,
  getMyPreferences,
  updateMyPreferences,
  updateOnboardingStep,
  acceptTerms,
  forgotPassword,
  verifyOTP,
  resetPassword,
  refreshToken,
  logoutUser,
  logoutAll,
  deleteMyAccount,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");
const {
  authRateLimiter,
  passwordResetRequestRateLimiter,
  passwordResetEmailRateLimiter,
  profileRateLimiter,
  refreshRateLimiter,
} = require("../middleware/rateLimiter");

// ---------------------------------------------------------------------------
// Credential-submitting routes — strict limit (default: 5 req / 60 s per IP)
// These are the brute-force / credential-stuffing targets.
// ---------------------------------------------------------------------------
router.post("/register",         authRateLimiter, registerUser);
router.post("/login",            authRateLimiter, loginUser);
router.post("/google",           authRateLimiter, googleLogin);
// Two reset-specific limiters: one caps a caller cycling emails, the other caps
// how often any one inbox can be mailed no matter how many IPs ask.
router.post("/forgot-password",  passwordResetRequestRateLimiter, passwordResetEmailRateLimiter, forgotPassword);
router.post("/verify-otp",       authRateLimiter, verifyOTP);
router.post("/reset-password",   authRateLimiter, resetPassword);

// ---------------------------------------------------------------------------
// Token refresh — medium limit (default: 10 req / 60 s per user/IP)
// Called silently by the client when the 15-minute access token expires.
// Multiple open tabs can trigger simultaneous refreshes — keep headroom.
// ---------------------------------------------------------------------------
router.post("/refresh",  refreshRateLimiter, refreshToken);

// ---------------------------------------------------------------------------
// Logout — no extra rate limit; covered by global limiter only.
// Idempotent and safe. Does NOT require authentication so that partially
// authenticated clients (valid refresh cookie, expired access token) can
// still cleanly sign out without going through the refresh dance first.
// ---------------------------------------------------------------------------
router.post("/logout",     logoutUser);
router.post("/logout-all", protect, logoutAll);

// ---------------------------------------------------------------------------
// Authenticated profile endpoints — loose limit (default: 60 req / 60 s)
// These are called on every page load (auto-login check, preferences fetch).
// Previously they shared the strict authRateLimiter — that was the root cause
// of the 429 Too Many Requests errors seen in the browser console.
// ---------------------------------------------------------------------------
router.post("/accept-terms",         protect, profileRateLimiter, acceptTerms);
router.get("/me",                    protect, profileRateLimiter, getMe);
router.get("/me/preferences",        protect, profileRateLimiter, getMyPreferences);
router.patch("/me/preferences",      protect, profileRateLimiter, updateMyPreferences);
router.patch("/me/onboarding",       protect, profileRateLimiter, updateOnboardingStep);

// ---------------------------------------------------------------------------
// Account deletion — Play User Data policy / Apple 5.1.1(v).
// Irreversible. Guarded by re-typed email confirmation in the controller and
// the strict auth limiter, since it is the most destructive endpoint we have.
// ---------------------------------------------------------------------------
router.delete("/account",            protect, authRateLimiter, deleteMyAccount);

module.exports = router;
