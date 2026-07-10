"use strict";

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn(),
}));

const {
  MAX_SNAPSHOT_BYTES,
  generateWeeklyFeedback,
} = require("../../services/geminiService");

describe("Gemini prompt size limit", () => {
  test("rejects an oversized snapshot before calling Gemini", async () => {
    const snapshot = { payload: "x".repeat(MAX_SNAPSHOT_BYTES + 1) };

    await expect(generateWeeklyFeedback({
      snapshot,
      weekLabel: "2026-W26",
    })).rejects.toThrow(/Snapshot exceeds/);
  });
});
