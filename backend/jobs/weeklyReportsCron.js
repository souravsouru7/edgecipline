const cron = require("node-cron");
const { appConfig } = require("../config");
const userRepository = require("../repositories/user.repository");
const notificationService = require("../services/notificationService");
const { logger } = require("../utils/logger");

let isRunning = false;

function getWeeklyReminderKey(date = new Date()) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const day = start.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  start.setUTCDate(start.getUTCDate() - diff);
  return start.toISOString().slice(0, 10);
}

async function runWeeklyReportsJob() {
  if (isRunning) return;
  isRunning = true;
  let users;
  try {
    users = await userRepository.findUsersForWeeklyReports();
  } catch (e) {
    logger.error("[weeklyReportsCron] failed to fetch users", { error: e.message, stack: e.stack });
    isRunning = false;
    return;
  }

  try {
    const marketTypes = ["Forex", "Indian_Market"];
    const weekKey = getWeeklyReminderKey();

    for (const u of users) {
      for (const marketType of marketTypes) {
        try {
          await notificationService.notifyUser(u._id, {
            type: "weekly_report_reminder",
            title: "Weekly review is ready",
            body: "Your weekly trading review is ready. Generate it when you want AI feedback.",
            sourceType: "cron",
            dedupeKey: `weekly-report-reminder:${u._id}:${marketType}:${weekKey}`,
            deepLink: `/weekly-reports?marketType=${encodeURIComponent(marketType)}`,
            data: {
              screen: "weekly-report",
              marketType,
              action: "generate_on_demand",
            },
          });
        } catch (e) {
          logger.error("[weeklyReportsCron] reminder notification failed for user", {
            userId: u._id?.toString?.(),
            marketType,
            error: e?.message,
          });
        }
      }
    }

    logger.info(`[weeklyReportsCron] reminder job completed for ${users.length} users`);
  } finally {
    isRunning = false;
  }
}

function startWeeklyReportsCron() {
  const enabled = appConfig.weeklyReports.enabled;
  if (!enabled) {
    logger.info("[weeklyReportsCron] disabled by ENABLE_WEEKLY_REPORTS_CRON");
    return;
  }

  // Reminder-only job. It does not generate AI reports; users generate them on demand.
  // You can override schedule with WEEKLY_REPORTS_CRON, e.g. "0 9 * * *"
  const schedule = appConfig.weeklyReports.schedule;

  if (!cron.validate(schedule)) {
    logger.warn("[weeklyReportsCron] invalid cron schedule, skipping", { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    logger.info("[weeklyReportsCron] triggered");
    runWeeklyReportsJob().catch((e) =>
      logger.error("[weeklyReportsCron] job error", { error: e?.message, stack: e?.stack })
    );
  });

  logger.info("[weeklyReportsCron] scheduled", { schedule });
}

module.exports = { startWeeklyReportsCron, runWeeklyReportsJob };

