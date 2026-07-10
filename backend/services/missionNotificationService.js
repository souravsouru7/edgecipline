"use strict";

const { notifyUser } = require("./notificationService");
const { logger } = require("../utils/logger");

// Mission notifications use the coaching channel (calm, supportive tone)
const MISSION_CHANNEL = "edgecipline_coaching";
const MISSION_NOTIF_TYPE = "mission_update";

/**
 * Send a mission-related push notification.
 *
 * @param {string} userId
 * @param {object} assignment - MissionAssignment document (plain object or Mongoose doc)
 * @param {'completed'|'halfway'|'streak_broken'|'morning_reminder'} eventType
 */
async function sendMissionNotification(userId, assignment, eventType) {
  try {
    const snap = assignment.missionSnapshot || {};
    const name = snap.name || "Your Mission";
    const current = assignment.currentProgress || 0;
    const target = snap.target || 1;
    const unit = snap.unit || "steps";

    let title = "";
    let body = "";
    let dedupeKey = null;

    const today = new Date().toISOString().slice(0, 10);

    switch (eventType) {
      case "completed":
        title = "Mission Complete";
        body = `You've completed "${name}". ${snap.reward?.completionMessage || "Consistency is your edge."}`;
        dedupeKey = `mission:completed:${assignment._id}`;
        break;

      case "halfway":
        title = "Halfway There";
        body = `You're halfway through "${name}" — ${current}/${target} ${unit}. Keep going.`;
        dedupeKey = `mission:halfway:${assignment._id}:${today}`;
        break;

      case "streak_broken":
        title = "Mission Reset";
        body = `Your streak on "${name}" reset today. That's okay — restart from here. Progress is not linear.`;
        dedupeKey = `mission:reset:${assignment._id}:${today}`;
        break;

      case "morning_reminder":
        title = "Today's Mission";
        body = `${name} — ${current}/${target} ${unit}. Stay focused.`;
        dedupeKey = `mission:morning:${assignment._id}:${today}`;
        break;

      default:
        return;
    }

    await notifyUser(userId, {
      type: MISSION_NOTIF_TYPE,
      channel: MISSION_CHANNEL,
      title,
      body,
      dedupeKey,
      data: {
        missionId: String(assignment._id),
        eventType,
        category: snap.category || "discipline",
      },
    });
  } catch (err) {
    logger.warn("[MissionNotification] Failed to send notification", {
      userId,
      missionId: assignment._id,
      eventType,
      error: err.message,
    });
  }
}

/**
 * Send morning mission reminders for all active missions of a user.
 */
async function sendMorningMissionReminders(userId, activeMissions) {
  if (!activeMissions || activeMissions.length === 0) return;

  for (const assignment of activeMissions) {
    await sendMissionNotification(userId, assignment, "morning_reminder");
  }
}

module.exports = {
  sendMissionNotification,
  sendMorningMissionReminders,
};
