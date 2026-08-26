jest.mock("../../services/ocrJob.service", () => ({
  cancelOcrJob: jest.fn(),
  createOcrJob: jest.fn(),
  getOcrJobStatus: jest.fn(),
}));

jest.mock("../../config/cloudinary", () => ({
  uploader: { destroy: jest.fn() },
}));

jest.mock("../../queues/ocrQueue", () => ({
  ocrQueue: { add: jest.fn(), getJob: jest.fn() },
}));

jest.mock("../../repositories/user.repository", () => ({
  findUserById: jest.fn(),
  markFreeUploadConsumed: jest.fn(),
  releaseFreeUploadClaim: jest.fn(),
}));

jest.mock("../../config/redis", () => ({
  isRedisReady: jest.fn(() => true),
}));

jest.mock("../../utils/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const ocrJobService = require("../../services/ocrJob.service");
const uploadService = require("../../services/upload.service");

describe("upload and screenshot ownership boundaries", () => {
  const jobId = "507f1f77bcf86cd799439011";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("checks OCR screenshot job status using the authenticated user ID", async () => {
    const status = { id: jobId, status: "PENDING" };
    ocrJobService.getOcrJobStatus.mockResolvedValue(status);

    await expect(uploadService.getUploadJobStatus("user-b", jobId)).resolves.toBe(status);

    expect(ocrJobService.getOcrJobStatus).toHaveBeenCalledWith("user-b", jobId);
  });

  it("cancels OCR screenshot jobs using the authenticated user ID", async () => {
    const status = { id: jobId, status: "CANCELLED" };
    ocrJobService.cancelOcrJob.mockResolvedValue(status);

    await expect(uploadService.cancelUploadJob("user-b", jobId)).resolves.toBe(status);

    expect(ocrJobService.cancelOcrJob).toHaveBeenCalledWith("user-b", jobId);
  });
});
