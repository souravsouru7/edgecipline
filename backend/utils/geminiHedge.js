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
// Callers wrap this in geminiCircuit.guardedCall, so a hang the backup rescues
// is metered and counted as a success, not as a circuit failure.
function hedgedGenerate(model, request, { hedgeAfterMs = 8_000, timeoutMs = 25_000, label = "Gemini call" } = {}) {
  return new Promise((resolve, reject) => {
    const controllers = [];
    let settled = false;
    let launched = 0;
    let failed = 0;
    let lastError = null;
    let hedgeTimer = null;

    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      clearTimeout(deadline);
      for (const controller of controllers) controller.abort();
      settle(value);
    };

    const launch = () => {
      if (settled || launched >= 2) return;
      launched += 1;
      const controller = new AbortController();
      controllers.push(controller);
      Promise.resolve()
        .then(() => model.generateContent(request, { signal: controller.signal }))
        .then(
          (result) => finish(resolve, result),
          (error) => {
            if (settled) return;
            failed += 1;
            lastError = error;
            // Worth a backup only if the backup could plausibly succeed: a
            // bad key or a bad request will fail the same way twice, and a
            // 429 (rate limit / daily quota) would just burn more quota.
            if (launched < 2 && isTransientGeminiError(error) && !isQuotaError(error)) {
              clearTimeout(hedgeTimer);
              launch();
              return;
            }
            // Both attempts are in and both failed (or this one can't be
            // helped by a retry): report it. Otherwise wait for the other.
            if (failed >= launched || !isTransientGeminiError(error) || isQuotaError(error)) finish(reject, lastError);
          }
        );
    };

    const deadline = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      error.duration = timeoutMs;
      finish(reject, error);
    }, timeoutMs);

    launch();
    hedgeTimer = setTimeout(launch, hedgeAfterMs);
  });
}

module.exports = { hedgedGenerate };
