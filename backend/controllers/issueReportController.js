const asyncHandler = require("../utils/asyncHandler");
const issueReportService = require("../services/issueReport.service");
const { paginated, success } = require("../utils/apiResponse");

exports.submitIssue = asyncHandler(async (req, res) => {
  const issue = await issueReportService.createIssue({
    user: req.user,
    body: req.body,
    uploadedImages: req.uploadedImages || [],
  });
  success(res, {
    _id: issue._id,
    issueCode: issue.issueCode,
    status: issue.status,
    createdAt: issue.createdAt,
  }, {
    statusCode: 201,
    message: "Issue submitted successfully",
  });
});

exports.listMyIssues = asyncHandler(async (req, res) => {
  const result = await issueReportService.listUserIssues(req.user._id, req.validated.query);
  paginated(res, result.items, result.pagination);
});

exports.getMyIssue = asyncHandler(async (req, res) => {
  const issue = await issueReportService.getUserIssue(req.user._id, req.params.id);
  success(res, issue);
});

exports.adminListIssues = asyncHandler(async (req, res) => {
  const result = await issueReportService.listAllIssues(req.validated.query);
  paginated(res, result.items, result.pagination);
});

exports.adminGetIssue = asyncHandler(async (req, res) => {
  const issue = await issueReportService.getIssueForAdmin(req.params.id);
  success(res, issue);
});

exports.adminUpdateIssueStatus = asyncHandler(async (req, res) => {
  const { status, fixSummary, fixedVersion, note } = req.body;
  const issue = await issueReportService.updateIssueStatus(req.params.id, {
    status,
    fixSummary,
    fixedVersion,
    note,
  });
  success(res, issue, { message: "Issue updated" });
});

exports.adminGetAnalytics = asyncHandler(async (req, res) => {
  const summary = await issueReportService.getAnalyticsSummary();
  success(res, summary);
});
