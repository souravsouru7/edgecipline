"use strict";

jest.mock("../../utils/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn() },
}));

const { jobFailureTracker } = require("../../utils/jobFailureTracker");

describe("jobFailureTracker memory bounds", () => {
  beforeEach(() => {
    jobFailureTracker.failures.clear();
  });

  test("stores a bounded error snapshot instead of retaining the Error object", () => {
    const error = new Error("boom");
    jobFailureTracker.recordFailure("job-1", error, "trade-1");

    const stored = jobFailureTracker.failures.get("job-1");
    expect(stored.lastError).not.toBe(error);
    expect(stored.lastError).toMatchObject({ name: "Error", message: "boom" });
  });

  test("caps retained timestamps for a repeatedly failing job", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      jobFailureTracker.recordFailure("job-1", new Error("boom"), "trade-1");
    }

    const stored = jobFailureTracker.failures.get("job-1");
    expect(stored.timestamps).toHaveLength(jobFailureTracker.maxFailures);
    expect(stored.count).toBe(jobFailureTracker.maxFailures);
  });
});
