jest.mock("../../models/ChecklistNotificationSetting", () => ({
  findOne: jest.fn(() => ({ lean: async () => null })),
  findOneAndUpdate: jest.fn(() => ({ lean: async () => ({ ok: true }) })),
}));
jest.mock("../../models/SetupStrategy", () => ({ findOne: jest.fn() }));

const ChecklistNotificationSetting = require("../../models/ChecklistNotificationSetting");
const controller = require("../../controllers/checklistNotificationController");

const save = controller.saveNotificationSettings;
const get = controller.getNotificationSettings;

function res() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => jest.clearAllMocks());

it("defaults a brand-new reminder to weekdays, not daily", async () => {
  const r = res();
  await get({ user: { _id: "u" }, query: { market: "Forex" } }, r, jest.fn());
  expect(r.json.mock.calls[0][0].repeatMode).toBe("weekdays");
});

it.each([
  [{ notificationTime: "99:99" }, "INVALID_TIME"],
  [{ resetTime: "24:00" }, "INVALID_TIME"],
  [{ repeatMode: "custom", customDays: [] }, "INVALID_CUSTOM_DAYS"],
  [{ customDays: [0] }, "INVALID_CUSTOM_DAYS"],
  [{ customDays: [8] }, "INVALID_CUSTOM_DAYS"],
  [{ customDays: [1, 1] }, "INVALID_CUSTOM_DAYS"],
  [{ customDays: "1,2" }, "INVALID_CUSTOM_DAYS"],
])("rejects %j", async (body, code) => {
  const next = jest.fn();
  await save({ user: { _id: "u" }, body: { market: "Forex", ...body } }, res(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, errorCode: code }));
  expect(ChecklistNotificationSetting.findOneAndUpdate).not.toHaveBeenCalled();
});

// Older app builds always send customDays and allow an empty list; for a
// daily/weekdays schedule that must save, and must not wipe the stored days.
it.each(["daily", "weekdays", undefined])("ignores an empty customDays with repeatMode %s", async (repeatMode) => {
  const next = jest.fn();
  await save({ user: { _id: "u" }, body: { market: "Forex", repeatMode, customDays: [] } }, res(), next);
  expect(next).not.toHaveBeenCalled();
  const update = ChecklistNotificationSetting.findOneAndUpdate.mock.calls[0][1];
  expect(JSON.stringify(update)).not.toContain("customDays");
});

it("accepts Sunday (ISO 7) and a valid time", async () => {
  const next = jest.fn();
  await save({ user: { _id: "u" }, body: { market: "Forex", customDays: [6, 7], notificationTime: "23:59" } }, res(), next);
  expect(next).not.toHaveBeenCalled();
  expect(ChecklistNotificationSetting.findOneAndUpdate).toHaveBeenCalled();
});
