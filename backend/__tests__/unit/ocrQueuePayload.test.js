describe("OCR queue payload validation", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function loadQueue({ existingJob = null } = {}) {
    const add = jest.fn().mockResolvedValue({ id: "job-1", name: "processOcrJob" });
    const getJob = jest.fn().mockResolvedValue(existingJob);

    jest.doMock("bullmq", () => ({
      Queue: jest.fn().mockImplementation(() => ({
        add,
        getJob,
        on: jest.fn(),
      })),
    }));
    jest.doMock("../../config", () => ({
      appConfig: {
        ocrQueue: {
          name: "ocr-test",
          attempts: 3,
          backoffMs: 100,
          initialDelayMs: 0,
        },
      },
    }));
    jest.doMock("../../config/redis", () => ({
      bullmqConnection: {},
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    return {
      add,
      getJob,
      queue: require("../../queues/ocrQueue"),
    };
  }

  test("rejects missing job id before adding to BullMQ", async () => {
    const { add, queue } = loadQueue();

    await expect(queue.enqueueOcrJob({
      imageUrl: "https://example.test/image.png",
      userId: "507f1f77bcf86cd799439012",
      marketType: "Forex",
    })).rejects.toMatchObject({
      code: "OCR_INVALID_PAYLOAD",
      message: "OCR queue payload missing jobId",
    });
    expect(add).not.toHaveBeenCalled();
  });

  test("adds valid OCR job payload using jobId as BullMQ id", async () => {
    const { add, queue } = loadQueue();

    await queue.enqueueOcrJob({
      jobId: "507f1f77bcf86cd799439011",
      imageUrl: "https://example.test/image.png",
      userId: "507f1f77bcf86cd799439012",
      marketType: "Forex",
      broker: "",
    });

    expect(add).toHaveBeenCalledWith(
      "processOcrJob",
      expect.objectContaining({
        jobId: "507f1f77bcf86cd799439011",
        imageUrl: "https://example.test/image.png",
        userId: "507f1f77bcf86cd799439012",
        marketType: "Forex",
      }),
      expect.objectContaining({
        jobId: "507f1f77bcf86cd799439011",
      }),
    );
  });
});
