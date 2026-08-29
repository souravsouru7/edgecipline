/**
 * Account lockout policy, shared by the user and admin login endpoints.
 *
 * Both endpoints authenticate against the SAME User document and write the
 * same `loginAttempts` / `loginLockedUntil` fields. An admin account has a
 * password that is accepted by BOTH doors:
 *
 *   POST /api/auth/login        (controllers/authController.js)
 *   POST /api/admin/auth/login  (admin/controllers/adminAuthController.js)
 *
 * so the policy has to be chosen by the account's role, not by which endpoint
 * the request happened to arrive at. When the user endpoint used its own
 * softer limit, an attacker could brute-force an admin password there at
 * 5 tries per 15 minutes — roughly 20/hour — while the admin endpoint believed
 * it was enforcing 3 per hour. The stricter limit was decorative because the
 * softer door led to the same credential.
 *
 * Keep both endpoints reading `lockoutPolicyFor()` rather than re-declaring
 * these numbers locally, or the asymmetry silently comes back.
 */

const USER_LOGIN_POLICY = Object.freeze({
  maxAttempts: 5,
  lockMs: 15 * 60 * 1000, // 15 minutes
});

const ADMIN_LOGIN_POLICY = Object.freeze({
  maxAttempts: 3,
  lockMs: 60 * 60 * 1000, // 1 hour
});

/**
 * Returns the lockout policy that governs this account, whichever login
 * endpoint is asking. Unknown/absent users fall back to the user policy so a
 * caller can use it for a not-found account without a null check.
 */
function lockoutPolicyFor(user) {
  return user?.role === "admin" ? ADMIN_LOGIN_POLICY : USER_LOGIN_POLICY;
}

module.exports = {
  USER_LOGIN_POLICY,
  ADMIN_LOGIN_POLICY,
  lockoutPolicyFor,
};
