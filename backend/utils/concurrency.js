/**
 * Tiny p-limit-shaped concurrency limiter.
 *
 * Usage:
 *   const limit = createLimiter(50);
 *   const results = await Promise.allSettled(
 *     users.map((u) => limit(() => processUser(u)))
 *   );
 *
 * Guarantees:
 *   - At most `maxConcurrent` tasks run at once.
 *   - Backpressure: queued tasks await their slot without spawning timers.
 *   - Rejection-safe: a thrown task does not corrupt the active counter.
 *   - Memory-bounded by the input iterable — does not buffer additional state
 *     per task beyond the resolve/reject pair.
 */
function createLimiter(maxConcurrent) {
  const limit = Math.max(1, Number(maxConcurrent) || 1);
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= limit) return;
    const task = queue.shift();
    if (!task) return;
    active += 1;
    Promise.resolve()
      .then(task.fn)
      .then(task.resolve, task.reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };

  const limiter = (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });

  // Diagnostics — useful for cron metrics: how many tasks are still waiting?
  limiter.activeCount  = () => active;
  limiter.pendingCount = () => queue.length;
  limiter.concurrency  = limit;

  return limiter;
}

module.exports = { createLimiter };
