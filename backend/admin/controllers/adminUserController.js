const User = require("../../models/Users");
const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const ApiError = require("../../utils/ApiError");
const asyncHandler = require("../../utils/asyncHandler");
const { logger } = require("../../utils/logger");
const { invalidateAuthCache } = require("../../services/authCacheService");

/**
 * @desc    Get all users with their statistics
 * @route   GET /api/admin/users
 * @access  Private/Admin
 */
exports.getAllUsers = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const skip = (page - 1) * limit;

  const filter = { role: { $ne: "admin" } };
  const [users, total] = await Promise.all([
    User.find(filter).select("-password").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  const userIds = users.map(u => u._id);
  const [forexCounts, indianCounts] = await Promise.all([
    Trade.aggregate([{ $match: { user: { $in: userIds } } }, { $group: { _id: "$user", count: { $sum: 1 } } }]),
    IndianTrade.aggregate([{ $match: { user: { $in: userIds } } }, { $group: { _id: "$user", count: { $sum: 1 } } }]),
  ]);

  const forexMap = Object.fromEntries(forexCounts.map(r => [String(r._id), r.count]));
  const indianMap = Object.fromEntries(indianCounts.map(r => [String(r._id), r.count]));

  const enrichedUsers = users.map(user => ({
    ...user,
    tradeCount: (forexMap[String(user._id)] || 0) + (indianMap[String(user._id)] || 0),
    forexTradeCount: forexMap[String(user._id)] || 0,
    indianTradeCount: indianMap[String(user._id)] || 0,
  }));

  res.json({ users: enrichedUsers, total, page, limit });
});

/**
 * @desc    Delete a user and all their data
 * @route   DELETE /api/admin/users/:id
 * @access  Private/Admin
 */
exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    throw new ApiError(404, "User not found", "NOT_FOUND");
  }

  if (user.role === "admin") {
    throw new ApiError(403, "Cannot delete an admin user", "FORBIDDEN");
  }

    // Delete associated data
    await Promise.all([
      Trade.deleteMany({ user: user._id }),
      IndianTrade.deleteMany({ user: user._id }),
      User.findByIdAndDelete(user._id)
    ]);

  // Drop the auth cache — any in-flight JWT for this user must now fail.
  await invalidateAuthCache(user._id);

  // M17: Structured audit log for destructive admin action
  logger.warn("Admin deleted user", {
    adminId: req.user?._id,
    adminEmail: req.user?.email,
    deletedUserId: user._id,
    deletedUserEmail: user.email,
  });

  res.json({ message: "User and all associated data deleted successfully" });
});

/**
 * @desc    Toggle user active/inactive status
 * @route   PATCH /api/admin/users/:id/status
 * @access  Private/Admin
 */
exports.toggleUserStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    throw new ApiError(404, "User not found", "NOT_FOUND");
  }

    // Toggle logic: active <-> inactive
    // If it's expired, we might want to keep it expired or move to inactive
    user.subscriptionStatus = user.subscriptionStatus === "active" ? "inactive" : "active";
    
    await user.save();
  res.json({ 
    message: `User status updated to ${user.subscriptionStatus}`,
    user: {
      _id: user._id,
      subscriptionStatus: user.subscriptionStatus
    }
  });
});

/**
 * @desc    Extend user subscription plan
 * @route   PATCH /api/admin/users/:id/extend
 * @access  Private/Admin
 */
exports.extendUserPlan = asyncHandler(async (req, res) => {
  const { days } = req.body;
  const parsed = parseInt(days, 10);
  if (!parsed || parsed <= 0) {
    throw new ApiError(400, "days must be a positive integer", "VALIDATION_ERROR");
  }
  const extensionDays = Math.min(parsed, 365); // cap at 1 year per single extension

  const user = await User.findById(req.params.id);
  if (!user) {
    throw new ApiError(404, "User not found", "NOT_FOUND");
  }

    let newExpiry;
    const now = new Date();

    // If already active and has expiry, extend from current expiry
    // Otherwise extend from today
    if (user.subscriptionExpiry && user.subscriptionExpiry > now) {
      newExpiry = new Date(user.subscriptionExpiry);
    } else {
      newExpiry = now;
    }

    newExpiry.setDate(newExpiry.getDate() + extensionDays);
    
    user.subscriptionExpiry = newExpiry;
    user.subscriptionStatus = "active"; // Reactivate if it was expired/inactive
    
    await user.save();
  res.json({ 
    message: `Plan extended by ${extensionDays} days`,
    expiry: user.subscriptionExpiry,
    status: user.subscriptionStatus
  });
});

/**
 * @desc    Get all users whose plans have expired
 * @route   GET /api/admin/users/expired
 * @access  Private/Admin
 */
exports.getExpiredUsers = asyncHandler(async (req, res) => {
  const now = new Date();
  const expiredUsers = await User.find({
    role: { $ne: "admin" },
    subscriptionExpiry: { $lt: now }
  }).sort({ subscriptionExpiry: -1 }).lean();

  res.json(expiredUsers);
});

/**
 * @desc    Send renewal reminder email to a user
 * @route   POST /api/admin/users/:id/remind
 * @access  Private/Admin
 */
const { sendRenewalReminder } = require("../../services/mailService");

exports.sendRenewalReminderAction = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    throw new ApiError(404, "User not found", "NOT_FOUND");
  }

  if (!user.subscriptionExpiry) {
    throw new ApiError(400, "User has no subscription history", "VALIDATION_ERROR");
  }

  await sendRenewalReminder(user.email, user.name, user.subscriptionExpiry);
  res.json({ message: `Renewal reminder sent to ${user.email}` });
};

exports.sendRenewalReminderAction = asyncHandler(exports.sendRenewalReminderAction);

