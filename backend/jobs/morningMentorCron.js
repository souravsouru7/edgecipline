const cron = require("node-cron");
const { appConfig } = require("../config");
const userRepository = require("../repositories/user.repository");
const { sendMorningMentor } = require("../services/morningMentorService");
const { logger } = require("../utils/logger");

let isRunning = false;

async function runMorningMentorJob() {
  if (isRunning) return;
  isRunning = true;

  let users;
  try {
    users = await userRepository.findUsersForWeeklyReports();
  } catch (e) {
    logger.error("[morningMentorCron] failed to fetch users", { error: e.message, stack: e.stack });
    isRunning = false;
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  try {
    for (const u of users) {
      try {
        await sendMorningMentor(u._id);
        successCount++;
      } catch (e) {
        errorCount++;
        logger.error("[morningMentorCron] mentor notification failed for user", {
          userId: u._id?.toString?.(),
          error:  e?.message,
        });
      }
    }
    logger.info("[morningMentorCron] job completed", {
      total: users.length,
      success: successCount,
      errors:  errorCount,
    });
  } finally {
    isRunning = false;
  }
}

function startMorningMentorCron() {
  const { enabled, schedule, timezone = "Asia/Kolkata" } = appConfig.morningMentor;

  if (!enabled) {
    logger.info("[morningMentorCron] disabled by ENABLE_MORNING_MENTOR_CRON");
    return;
  }

  if (!cron.validate(schedule)) {
    logger.warn("[morningMentorCron] invalid cron schedule, skipping", { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    logger.info("[morningMentorCron] triggered");
    runMorningMentorJob().catch((e) =>
      logger.error("[morningMentorCron] job error", { error: e?.message, stack: e?.stack })
    );
  }, { timezone });

  logger.info("[morningMentorCron] scheduled", { schedule, timezone });
}

module.exports = { startMorningMentorCron, runMorningMentorJob };
