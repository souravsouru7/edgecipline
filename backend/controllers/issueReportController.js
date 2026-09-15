const asyncHandler = require("../utils/asyncHandler");
const issueReportService = require("../services/issueReport.service");
const { paginated, success } = require("../utils/apiResponse");

exports.submitIssue = asyncHandler(async (req, res) => {
  const { issue, ticket, deduped } = await issueReportService.createIssue({
    user: req.user,
    body: req.body,
    uploadedImages: req.uploadedImages || [],
    requestId: req.requestId,
  });
  success(res, {
    // `issue` can be null in the rare case the ticket was written but the
    // telemetry row was not. The ticket is the customer-facing record either
    // way, so the client keys its success screen on that.
    _id: issue?._id || null,
    issueCode: issue?.issueCode || null,
    status: issue?.status || null,
    createdAt: issue?.createdAt || ticket.createdAt,
    ticket: {
      id: String(ticket._id),
      ticketCode: ticket.ticketCode,
      status: ticket.status,
    },
  }, {
    statusCode: deduped ? 200 : 201,
    message: deduped ? "This report was already submitted" : "Issue submitted successfully",
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
    staffUser: req.user,
  });
  success(res, issue, { message: "Issue updated" });
});

exports.adminGetAnalytics = asyncHandler(async (req, res) => {
  const summary = await issueReportService.getAnalyticsSummary();
  success(res, summary);
});
