/**
 * Journal-event hook for the Mind Score.
 *
 * Every trade mutation and reflection calls `scheduleMindRecompute` after its
 * write is committed. The recompute is debounced per user so a bulk import or
 * a burst of edits costs one rebuild, and it runs fully detached: it can never
 * delay or fail the save that triggered it.
 *
 * Old app builds don't call the instant-reward endpoint, so this hook is what
 * keeps their dashboard card current.
 */

const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

const DEBOUNCE_MS = 3000;
const timers = new Map();

function scheduleMindRecompute(userId, source = "journal") {
  const cfg = appConfig.mindProgress || {};
  if (!cfg.enabled || !cfg.hooksEnabled) return;
  const id = userId?.toString?.() || String(userId || "");
  if (!id) return;

  const pending = timers.get(id);
  if (pending) clearTimeout(pending);
  const timer = setTimeout(() => {
    timers.delete(id);
    // Lazy: keeps the trade/reflection services' module graph unchanged.
    require("./mindProgress.service")
      .recompute(id, { source })
      .catch((error) => logger.warn("MIND_SCORE_UPDATE_FAILED", { userId: id, source, error: error?.message }));
  }, DEBOUNCE_MS);
  // Never hold the process open for this (graceful shutdown, test runners).
  if (typeof timer.unref === "function") timer.unref();
  timers.set(id, timer);
}

// Test helper.
function pendingCount() {
  return timers.size;
}

module.exports = { DEBOUNCE_MS, pendingCount, scheduleMindRecompute };
