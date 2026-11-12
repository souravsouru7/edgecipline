const cron = require("node-cron");
const { appConfig } = require("../config");
const { sendMorningMentor } = require("../services/morningMentorService");
const { runLocalTimeJob } = require("../services/localTimeJobRunner");
const { LOCAL_TIME_TICK, parseLocalTime } = require("../utils/localTimeSchedule");
const { logger } = require("../utils/logger");

const CRON_NAME = "morningMentorCron";
const LOCK_NAME = "morning-mentor";
const DEFAULT_TARGET = { hour: 7, minute: 0 };

let isRunning = false;

function resolveConcurrency() {
  return appConfig.cron.morningMentorConcurrency || appConfig.cron.concurrency;
}

// 07:00 in each user's own timezone, to users who have logged at least one
// trade (someone who never traded got "No trade is a trade… you stayed
// disciplined" every single morning) and whose account is reachable.
async function runMorningMentorJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return null;
  }
  isRunning = true;
  try {
    return await runLocalTimeJob({
      name: CRON_NAME,
      lockName: LOCK_NAME,
      target: parseLocalTime(appConfig.morningMentor?.localTime, DEFAULT_TARGET),
      requireTrades: true,
      concurrency: resolveConcurrency(),
      now,
      work: (user, ctx) => sendMorningMentor(user, { now: ctx.now }),
    });
  } finally {
    isRunning = false;
  }
}

function startMorningMentorCron() {
  if (!appConfig.morningMentor?.enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_MORNING_MENTOR_CRON`);
    return;
  }

  cron.schedule(LOCAL_TIME_TICK, () => {
    runMorningMentorJob().catch((e) =>
      logger.error(`[${CRON_NAME}] job error`, { error: e?.message, stack: e?.stack })
    );
  });

  logger.info(`[${CRON_NAME}] scheduled`, {
    tick: LOCAL_TIME_TICK,
    localTime: appConfig.morningMentor?.localTime || "07:00",
    concurrency: resolveConcurrency(),
  });
}

module.exports = { startMorningMentorCron, runMorningMentorJob };
