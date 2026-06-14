const { logger } = require("./logger");

/**
 * Cron execution metrics.
 *
 * Keeps the LAST N runs per cron name in memory (cheap; cron names are tiny,
 * runs are infrequent). Each run is also emitted as a structured log line at
 * job completion so it ends up in the same aggregator as everything else.
 *
 * Surfaced via the admin endpoint when wired (see queue-metrics pattern).
 */
const HISTORY_PER_CRON = 20;
const history = new Map(); // name -> [runRecord, ...]

function recordCronRun(name, record) {
  const entry = {
    name,
    startedAt:   record.startedAt   instanceof Date ? record.startedAt.toISOString() : record.startedAt,
    finishedAt:  new Date().toISOString(),
    durationMs:  record.durationMs,
    concurrency: record.concurrency ?? null,
    totalItems:  record.totalItems  ?? 0,
    success:     record.success     ?? 0,
    failure:     record.failure     ?? 0,
    skipped:     record.skipped     ?? 0,
    error:       record.error       || null,
  };

  // Append + cap the per-cron history ring.
  const arr = history.get(name) || [];
  arr.unshift(entry);
  if (arr.length > HISTORY_PER_CRON) arr.length = HISTORY_PER_CRON;
  history.set(name, arr);

  // Structured log — grep [CronMetrics] to see every cron's outcome.
  logger.info("[CronMetrics] run completed", entry);

  return entry;
}

function getCronHistory() {
  const out = {};
  for (const [name, runs] of history.entries()) out[name] = runs;
  return out;
}

function getLastCronRun(name) {
  return history.get(name)?.[0] || null;
}

/**
 * Wraps a parallel cron loop. Caller provides:
 *   - name: cron identifier (e.g. "morningMentorCron")
 *   - items: array to iterate
 *   - concurrency: max parallel tasks
 *   - work: async (item) => void   — throws to mark failure
 *
 * Returns { totalItems, success, failure, durationMs }. Always resolves; never
 * throws. Records metrics + emits structured log.
 */
async function runCronWithMetrics({ name, items, concurrency, work }) {
  const { createLimiter } = require("./concurrency");
  const limit = createLimiter(concurrency);
  const startedAt = new Date();
  const start = Date.now();

  let success = 0;
  let failure = 0;

  const results = await Promise.allSettled(
    items.map((item) =>
      limit(async () => {
        try {
          await work(item);
          success += 1;
        } catch (error) {
          failure += 1;
          logger.error(`[${name}] item failed`, {
            error: error?.message,
            stack: error?.stack,
          });
        }
      })
    )
  );

  // Defensive: if a limit() promise itself rejected (shouldn't, but just in case)
  for (const r of results) {
    if (r.status === "rejected") failure += 1;
  }

  return recordCronRun(name, {
    startedAt,
    durationMs: Date.now() - start,
    concurrency,
    totalItems: items.length,
    success,
    failure,
  });
}

module.exports = {
  recordCronRun,
  runCronWithMetrics,
  getCronHistory,
  getLastCronRun,
};
