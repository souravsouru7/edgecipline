const NotificationHistory = require("../../models/NotificationHistory");

describe("NotificationHistory model", () => {
  it.each(["ocr_job", "issue_report", "streak"])(
    "accepts %s sourceType emitted by notification producers",
    async (sourceType) => {
      const doc = new NotificationHistory({
        user: "507f1f77bcf86cd799439011",
        type: "system",
        title: "Title",
        body: "Body",
        sourceType,
        dedupeKey: `dedupe:${sourceType}`,
      });

      await expect(doc.validate()).resolves.toBeUndefined();
    }
  );
});
