const jwt = require("jsonwebtoken");
const User = require("../models/Users");
const { appConfig } = require("../config");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { ADMIN_COOKIE_NAME } = require("./adminAuth");
const {
  isSupportStaff,
  resolveCapabilities,
  hasCapability,
} = require("../constants/support");

/**
 * Authentication for the agent-facing support console.
 *
 * Rides the existing admin session — same `admin_sid` cookie, same dedicated
 * ADMIN_JWT_SECRET — so there is no second login to build, and a user access
 * token still cannot reach a staff endpoint even if a role check were bypassed.
 *
 * The one difference from adminAuth: this accepts `role === "admin"` OR a
 * non-null `supportRole`. Today only admins can obtain an admin token, so in
 * practice every agent is also an admin and supportRole refines what they may
 * do. Writing the check this way now means enabling dedicated agent logins
 * later is a change to adminAuthController alone — not to every support route.
 *
 * Authorisation is re-derived from the DATABASE on every request, never from
 * the token. An agent whose access is revoked mid-session loses it on their
 * very next call, exactly the way tokenVersion already handles logout.
 */
const supportAuth = asyncHandler(async (req, _res, next) => {
  const cookieToken = req.cookies?.[ADMIN_COOKIE_NAME];
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : null;

  const token = cookieToken || headerToken;
  if (!token) {
    throw new ApiError(401, "No token provided", "AUTH_REQUIRED");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, appConfig.jwt.adminSecret, { algorithms: ["HS256"] });
  } catch {
    throw new ApiError(401, "Not authorized, token failed", "INVALID_TOKEN");
  }

  const user = await User.findById(decoded.id)
    .select("name email role supportRole accountStatus tokenVersion")
    .lean();

  if (!user) {
    throw new ApiError(401, "Not authorized, user not found", "AUTH_FAILED");
  }

  // Revocation gate — same contract as adminAuth and protect().
  if (decoded.tokenVersion === undefined || decoded.tokenVersion !== user.tokenVersion) {
    throw new ApiError(401, "Session expired, please login again", "TOKEN_INVALIDATED");
  }

  // A disabled staff account keeps a valid token until it expires. Without
  // this, suspending an agent would not actually stop them reading customer
  // conversations for another quarter of an hour.
  if (user.accountStatus && user.accountStatus !== "active") {
    throw new ApiError(401, "Account disabled", "ACCOUNT_DISABLED");
  }

  if (!isSupportStaff(user)) {
    throw new ApiError(403, "Support access required", "FORBIDDEN");
  }

  req.user = user;
  req.supportCapabilities = resolveCapabilities(user);
  // Normalised actor role for audit rows and message attribution.
  req.supportActorRole = user.role === "admin" ? "admin" : user.supportRole;

  return next();
});

/**
 * Route guard for a single capability. Compose after supportAuth:
 *
 *   router.patch("/:id/assign", supportAuth, requireCapability(REASSIGN), handler)
 *
 * Kept as a separate factory rather than folded into supportAuth so each route
 * declares exactly what it needs, and so a reader can see the permission
 * without opening the controller.
 */
function requireCapability(capability) {
  return (req, _res, next) => {
    if (!hasCapability(req.user, capability)) {
      return next(
        new ApiError(
          403,
          "You do not have permission to perform this action",
          "FORBIDDEN"
        )
      );
    }
    return next();
  };
}

module.exports = { supportAuth, requireCapability };
