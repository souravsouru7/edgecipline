/**
 * Every notification type a producer can emit must be:
 *   1. accepted by the NotificationHistory enum (otherwise notifyUser throws a
 *      ValidationError before FCM is ever called — this is exactly how streak,
 *      evening-reflection and mission pushes were silently lost),
 *   2. mapped to an Android channel the app creates,
 *   3. gated by a NotificationPreference flag (or deliberately ungated).
 */
const mongoose = require("mongoose");
const NotificationHistory = require("../../models/NotificationHistory");
const NotificationPreference = require("../../models/NotificationPreference");

const FIXED_TYPES = [
  "streak_milestone",
  "streak_at_risk",
  "streak_broken",
  "evening_reflection",
  "mission_update",
];

// Channels the Android app creates (frontend/services/pushNotifications.js +
// NotificationChannelInitializer.java). Keep in sync by hand — that is the
// point of this test.
const ANDROID_CHANNELS = new Set([
  "edgecipline_risk",
  "edgecipline_discipline",
  "edgecipline_insights",
  "edgecipline_coaching",
  "edgecipline_session",
  "edgecipline_ocr",
  "edgecipline_support",
  "edgecipline_checklist",
]);

function historyEnum() {
  return NotificationHistory.schema.path("type").enumValues;
}

function buildDoc(type, extra = {}) {
  return new NotificationHistory({
    user: new mongoose.Types.ObjectId(),
    type,
    title: "t",
    body: "b",
    dedupeKey: `test:${type}`,
    ...extra,
  });
}

describe("NotificationHistory type enum", () => {
  it.each(FIXED_TYPES)("accepts %s (previously rejected → push never sent)", (type) => {
    expect(buildDoc(type).validateSync()).toBeUndefined();
  });

  it("accepts the streak and mission sourceTypes their producers use", () => {
    expect(buildDoc("streak_milestone", { sourceType: "streak" }).validateSync()).toBeUndefined();
    expect(buildDoc("mission_update", { sourceType: "mission" }).validateSync()).toBeUndefined();
    expect(buildDoc("evening_reflection", { sourceType: "cron" }).validateSync()).toBeUndefined();
  });

  it("still rejects an unknown type", () => {
    const err = buildDoc("not_a_real_type").validateSync();
    expect(err?.errors?.type).toBeDefined();
  });
});

describe("type → channel / preference mapping", () => {
  // Read the private maps through the module source rather than exporting
  // them: the service is the single owner of these tables.
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "../../services/notificationService.js"), "utf8");

  function extractMap(name) {
    const start = source.indexOf(`const ${name} = {`);
    const end = source.indexOf("};", start);
    const body = source.slice(start, end);
    const entries = {};
    for (const m of body.matchAll(/^\s*([a-z_0-9]+):\s*"([^"]+)"/gm)) entries[m[1]] = m[2];
    return entries;
  }

  const typeChannel = extractMap("TYPE_CHANNEL");
  const smartPref = extractMap("SMART_TYPE_TO_PREF");
  const reminderPref = extractMap("REMINDER_TYPE_TO_PREF");
  const { resolvePreferenceFlag } = require("../../services/notificationService");
  const supportPref = extractMap("SUPPORT_TYPE_TO_PREF");
  const prefPaths = new Set(Object.keys(NotificationPreference.schema.paths));

  it.each(FIXED_TYPES)("%s has an Android channel the app creates", (type) => {
    expect(ANDROID_CHANNELS.has(typeChannel[type])).toBe(true);
  });

  it("every channel referenced by the backend exists on the device", () => {
    for (const channel of new Set(Object.values(typeChannel))) {
      expect(ANDROID_CHANNELS.has(channel)).toBe(true);
    }
  });

  it("every preference flag referenced by the gate exists on NotificationPreference", () => {
    for (const flag of new Set([...Object.values(smartPref), ...Object.values(reminderPref), ...Object.values(supportPref)])) {
      expect(prefPaths.has(flag)).toBe(true);
    }
  });

  it("the fixed types are gated by the expected flags", () => {
    expect(resolvePreferenceFlag("streak_milestone")).toBe("streakProtection");
    expect(resolvePreferenceFlag("streak_at_risk")).toBe("streakProtection");
    expect(resolvePreferenceFlag("streak_broken")).toBe("streakProtection");
    expect(resolvePreferenceFlag("evening_reflection")).toBe("eveningReflection");
    expect(resolvePreferenceFlag("mission_update")).toBe("smartCoach");
  });

  it("scheduled reminders are NOT under the smart-coach umbrella (own switch only)", () => {
    for (const type of ["session_reminder", "morning_mentor", "evening_reflection", "streak_at_risk", "weekly_report_reminder"]) {
      expect(smartPref[type]).toBeUndefined();
      expect(reminderPref[type]).toBeDefined();
    }
  });

  it("daily-loss warnings and promotions have their own switches", () => {
    expect(resolvePreferenceFlag("daily_loss_warning")).toBe("dailyLossWarning");
    expect(resolvePreferenceFlag("no_stop_loss")).toBe("noStopLoss");
    for (const type of ["renewal_d_minus_1", "winback_d_plus_7", "free_tier_d_plus_3"]) {
      expect(resolvePreferenceFlag(type)).toBe("promotions");
    }
  });

  it("every enum type except deliberate system ones has a preference switch", () => {
    const ungated = new Set(["ocr_completed", "ocr_failed", "issue_fixed", "admin_issue_report", "payment", "feedback", "system",
      "support_new_ticket_staff", "support_user_reply_staff"]);
    for (const type of historyEnum()) {
      if (ungated.has(type)) continue;
      const flag = resolvePreferenceFlag(type);
      expect({ type, flag, exists: prefPaths.has(flag) }).toEqual({ type, flag, exists: true });
    }
  });

  it("every enum type that is a coaching/smart type has a channel (no silent fallback)", () => {
    const coaching = historyEnum().filter((t) =>
      !/^(payment|feedback|system|issue_fixed|admin_issue_report|renewal_|winback_)/.test(t)
    );
    for (const type of coaching) {
      expect(typeChannel[type]).toBeDefined();
    }
  });
});
