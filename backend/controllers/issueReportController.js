const asyncHandler = require("../utils/asyncHandler");
const issueReportService = require("../services/issueReport.service");

exports.submitIssue = asyncHandler(async (req, res) => {
  const issue = await issueReportService.createIssue({
    user: req.user,
    body: req.body,
    uploadedImages: req.uploadedImages || [],
  });
  res.status(201).json({
    message: "Issue submitted successfully",
    issue: {
      _id: issue._id,
      issueCode: issue.issueCode,
      status: issue.status,
      createdAt: issue.createdAt,
    },
  });
});

exports.listMyIssues = asyncHandler(async (req, res) => {
  const issues = await issueReportService.listUserIssues(req.user._id, req.query);
  res.json({ issues });
});

exports.getMyIssue = asyncHandler(async (req, res) => {
  const issue = await issueReportService.getUserIssue(req.user._id, req.params.id);
  res.json({ issue });
});

exports.adminListIssues = asyncHandler(async (req, res) => {
  const issues = await issueReportService.listAllIssues(req.query);
  res.json({ issues });
});

exports.adminGetIssue = asyncHandler(async (req, res) => {
  const issue = await issueReportService.getIssueForAdmin(req.params.id);
  res.json({ issue });
});

exports.adminUpdateIssueStatus = asyncHandler(async (req, res) => {
  const { status, fixSummary, fixedVersion, note } = req.body;
  const issue = await issueReportService.updateIssueStatus(req.params.id, {
    status,
    fixSummary,
    fixedVersion,
    note,
  });
  res.json({ message: "Issue updated", issue });
});

exports.adminGetAnalytics = asyncHandler(async (req, res) => {
  const summary = await issueReportService.getAnalyticsSummary();
  res.json(summary);
});
