const { isTransientGeminiError } = require("./geminiCircuit");

function isQuotaError(error) {
  return Number(error?.status) === 429 || /\[429\s|RESOURCE_EXHAUSTED|quota/i.test(String(error?.message || ""));
}

// Hedged Gemini call.
//
// Measured on 2026-11-19 with gemini-3.5-flash: most calls answer in 0.3-3s,
// but roughly 1 in 4 hangs with no answer for 25s to 140s+. Waiting out a
// hang (45s, then a full retry) is what made screenshot extraction feel slow.
//
// So: send the request; if it hasn't answered after `hedgeAfterMs`, send an
// identical backup and take whichever answers first, aborting the other.
// A first attempt that fails fast with a transient error launches the backup
// straight away. The whole call gives up at `timeoutMs` with a TimeoutError.
//
// `signal` (optional): an outer abort, e.g. the caller's own deadline. When it
// fires, every in-flight request is aborted and no new one starts, so nothing
// keeps running (and billing) after the caller has given up.
//
// `onAttempts(list)` (optional) is called once, just before the promise
// settles, with one entry per request actually sent:
//   { attempt, outcome: "won" | "aborted" | "failed", error, latencyMs }
// Callers wrap this in geminiCircuit.guardedCall, which uses it to meter every
// request: an aborted loser may still be billed by Google.
function hedgedGenerate(model, request, { hedgeAfterMs = 8_000, timeoutMs = 25_000, label = "Gemini call", signal, onAttempts } = {}) {
  return new Promise((resolve, reject) => {
    const attempts = [];
    let settled = false;
    let failed = 0;
    let lastError = null;
    let hedgeTimer = null;
    let deadline = null;

    const report = (winner) => {
      if (typeof onAttempts !== "function") return;
      const now = Date.now();
      try {
        onAttempts(attempts.map((a) => ({
          attempt: a.attempt,
          outcome: a === winner ? "won" : a.error ? "failed" : "aborted",
          error: a.error || null,
          latencyMs: (a.endedAt || now) - a.startedAt,
        })));
      } catch {
        // metering must never break the call
      }
    };

    const finish = (settle, value, winner = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      clearTimeout(deadline);
      if (signal) signal.removeEventListener("abort", onOuterAbort);
      for (const a of attempts) a.controller.abort();
      report(winner);
      settle(value);
    };

    function onOuterAbort() {
      const error = new Error(`${label} aborted by caller`);
      error.name = "TimeoutError";
      error.aborted = true;
      finish(reject, error);
    }

    const launch = () => {
      if (settled || attempts.length >= 2) return;
      const entry = { attempt: attempts.length + 1, controller: new AbortController(), startedAt: Date.now(), endedAt: 0, error: null };
      attempts.push(entry);
      Promise.resolve()
        .then(() => model.generateContent(request, { signal: entry.controller.signal }))
        .then(
          (result) => {
            entry.endedAt = Date.now();
            finish(resolve, result, entry);
          },
          (error) => {
            entry.endedAt = Date.now();
            if (settled) return;
            entry.error = error;
            failed += 1;
            lastError = error;
            // Worth a backup only if the backup could plausibly succeed: a
            // bad key or a bad request will fail the same way twice, and a
            // 429 (rate limit / daily quota) would just burn more quota.
            if (attempts.length < 2 && isTransientGeminiError(error) && !isQuotaError(error)) {
              clearTimeout(hedgeTimer);
              launch();
              return;
            }
            // Both attempts are in and both failed (or this one can't be
            // helped by a retry): report it. Otherwise wait for the other.
            if (failed >= attempts.length || !isTransientGeminiError(error) || isQuotaError(error)) finish(reject, lastError);
          }
        );
    };

    if (signal?.aborted) {
      onOuterAbort();
      return;
    }
    if (signal) signal.addEventListener("abort", onOuterAbort);

    deadline = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      error.duration = timeoutMs;
      finish(reject, error);
    }, timeoutMs);

    launch();
    // No backup when the hedge point is at or past the deadline (or Infinity).
    // Guarded because setTimeout treats any delay above 2^31-1 ms as 1 ms.
    if (Number.isFinite(hedgeAfterMs) && hedgeAfterMs < timeoutMs) {
      hedgeTimer = setTimeout(launch, hedgeAfterMs);
    }
  });
}

module.exports = { hedgedGenerate };
