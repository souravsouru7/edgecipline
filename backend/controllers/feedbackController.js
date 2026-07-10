const Feedback = require("../models/Feedback");
const Notification = require("../models/Notification");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

const ALLOWED_FEEDBACK_TYPES = new Set(["BUG", "FEATURE_REQUEST", "GENERAL_FEEDBACK"]);
const ALLOWED_FEEDBACK_STATUSES = new Set(["PENDING", "IN_PROGRESS", "RESOLVED"]);
const SUBJECT_MAX = 200;
const MESSAGE_MAX = 4000;
const ADMIN_NOTES_MAX = 4000;

/**
 * @desc    Submit feedback/bug report
 * @route   POST /api/feedback
 * @access  Private
 */
exports.submitFeedback = asyncHandler(async (req, res) => {
  const { type, subject, message } = req.body;
  if (!type || !subject || !message) {
    throw new ApiError(400, "Please provide type, subject and message", "VALIDATION_ERROR");
  }
  if (!ALLOWED_FEEDBACK_TYPES.has(String(type))) {
    throw new ApiError(400, "Invalid feedback type", "VALIDATION_ERROR");
  }
  const trimmedSubject = String(subject).trim().slice(0, SUBJECT_MAX);
  const trimmedMessage = String(message).trim().slice(0, MESSAGE_MAX);
  if (!trimmedSubject || !trimmedMessage) {
    throw new ApiError(400, "Subject and message cannot be empty", "VALIDATION_ERROR");
  }

  const screenshotUrl = req.uploadedImage?.imageUrl || "";

  const feedback = await Feedback.create({
    user: req.user._id,
    type,
    subject: trimmedSubject,
    message: trimmedMessage,
    screenshot: screenshotUrl,
  });

  // Create Admin Notification. Subject is used in the notification message —
  // truncated above so a 1 MB blob can't reach the Notification collection.
  await Notification.create({
    title: `New ${type.toUpperCase()} Received`,
    message: `${req.user.name} submitted a ${type}: ${trimmedSubject}`,
    type: "feedback",
    userId: req.user._id,
    metadata: { feedbackId: feedback._id, type, subject: trimmedSubject },
  });

  res.status(201).json({ message: "Feedback submitted successfully", feedback });
});

/**
 * @desc    Get all feedback (Admin)
 * @route   GET /api/admin/feedback
 * @access  Private/Admin
 */
exports.getAllFeedback = asyncHandler(async (req, res) => {
  // Hard cap. Response stays a flat array (frontend depends on Array.isArray)
  // but can no longer pull the entire feedback collection in one request.
  // Optional ?limit=&page= for future paginated UI.
  const MAX_PAGE_SIZE = 200;
  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || MAX_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const feedback = await Feedback.find()
    .populate("user", "name email")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  res.json(feedback);
});

/**
 * @desc    Update feedback status (Admin)
 * @route   PATCH /api/admin/feedback/:id
 * @access  Private/Admin
 */
exports.updateFeedbackStatus = asyncHandler(async (req, res) => {
  const { status, adminNotes } = req.body;
  if (status !== undefined && !ALLOWED_FEEDBACK_STATUSES.has(String(status))) {
    throw new ApiError(400, "Invalid feedback status", "VALIDATION_ERROR");
  }
  const feedback = await Feedback.findById(req.params.id);

  if (!feedback) {
    throw new ApiError(404, "Feedback not found", "NOT_FOUND");
  }

  if (status) feedback.status = status;
  if (adminNotes !== undefined) {
    feedback.adminNotes = String(adminNotes).slice(0, ADMIN_NOTES_MAX);
  }

  await feedback.save();
  res.json({ message: "Feedback updated successfully", feedback });
});

/**
 * @desc    Delete feedback (Admin)
 * @route   DELETE /api/admin/feedback/:id
 * @access  Private/Admin
 */
exports.deleteFeedback = asyncHandler(async (req, res) => {
  const feedback = await Feedback.findByIdAndDelete(req.params.id);
  if (!feedback) {
    throw new ApiError(404, "Feedback not found", "NOT_FOUND");
  }
  res.json({ message: "Feedback deleted successfully" });
});
