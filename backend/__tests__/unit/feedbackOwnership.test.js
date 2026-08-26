jest.mock("../../models/Feedback", () => ({
  create: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
}));

jest.mock("../../models/Notification", () => ({
  create: jest.fn(),
}));

const Feedback = require("../../models/Feedback");
const Notification = require("../../models/Notification");
const feedbackController = require("../../controllers/feedbackController");

function invoke(handler, req) {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return handler(req, res, next).then(() => ({ res, next }));
}

describe("feedback ownership boundaries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates feedback for the authenticated user, ignoring body owner/status fields", async () => {
    const feedback = { _id: "feedback-a", user: "user-a", status: "PENDING" };
    Feedback.create.mockResolvedValue(feedback);
    Notification.create.mockResolvedValue({});

    const { res, next } = await invoke(feedbackController.submitFeedback, {
      user: { _id: "user-a", name: "Alice" },
      body: {
        type: "BUG",
        subject: "Upload issue",
        message: "The upload failed",
        user: "user-b",
        status: "RESOLVED",
        adminNotes: "self-approved",
      },
      uploadedImage: { imageUrl: "https://example.test/shot.png" },
    });

    expect(next).not.toHaveBeenCalled();
    expect(Feedback.create).toHaveBeenCalledWith({
      user: "user-a",
      type: "BUG",
      subject: "Upload issue",
      message: "The upload failed",
      screenshot: "https://example.test/shot.png",
    });
    expect(JSON.stringify(Feedback.create.mock.calls[0][0])).not.toMatch(/user-b|RESOLVED|self-approved/);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ feedback }));
  });
});
