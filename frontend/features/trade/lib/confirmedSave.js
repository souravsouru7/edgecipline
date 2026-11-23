// Saving a trade over a phone connection can fail in two very different ways:
//
//   - refused: the server answered "no" (validation, quota, 4xx). Nothing was
//     written; show the message and let the user fix it.
//   - unanswered: a timeout, a dropped connection, a gateway 502/504, or the
//     server's own 408. The trade may well be in the database already — the
//     server commits first and answers last.
//
// Telling the user "Request timed out. Please try again." for the second kind
// was wrong twice over: often the trade HAD saved, and a manual retry could
// then hit "already saved" (OCR) or write a duplicate (manual entry).
//
// submitWithConfirmation() re-sends an unanswered save with the SAME
// idempotency key. The server then either replays the stored result of the
// first attempt, answers 409-in-progress while it is still running (we wait),
// or — for a screenshot whose trades are all saved — answers
// OCR_JOB_ALREADY_CONFIRMED, which after an unanswered attempt means "your
// first attempt landed".

const UNANSWERED_STATUSES = new Set([408, 502, 503, 504]);

export const SAVE_UNCONFIRMED = "SAVE_UNCONFIRMED";
export const SAVE_UNCONFIRMED_MESSAGE =
  "We couldn't confirm the save. Check your trade log before trying again.";

const errorCodeOf = (err) => err?.data?.errorCode || err?.data?.error || err?.code || null;

export function isUnansweredSaveError(err) {
  if (!err || err.isOffline) return false;
  if (err.name === "CanceledError" || err.code === "ERR_CANCELED") return false;
  if (err.isTransportError) return true;
  if (UNANSWERED_STATUSES.has(err.status)) return true;
  // An untyped failure with no HTTP status never got an answer either.
  return !err.status && !err.data;
}

export function isSaveInProgressError(err) {
  return err?.status === 409 && errorCodeOf(err) === "IDEMPOTENT_REQUEST_IN_PROGRESS";
}

export function isAlreadySavedError(err) {
  return err?.status === 409 && errorCodeOf(err) === "OCR_JOB_ALREADY_CONFIRMED";
}

export function isSaveUnconfirmedError(err) {
  return err?.code === SAVE_UNCONFIRMED;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `send` (one POST carrying a fixed idempotency key) until the outcome is
 * known.
 *
 * Resolves `{ res, recovered, alreadySaved }`:
 *   - res          the server response (null when only inferred as saved)
 *   - recovered    an earlier attempt went unanswered but the save is confirmed
 *   - alreadySaved confirmed via OCR_JOB_ALREADY_CONFIRMED, no response body
 *
 * Rejects with the server's own error for a refusal, or with a
 * SAVE_UNCONFIRMED error when the outcome is still unknown after every retry.
 */
export async function submitWithConfirmation(send, {
  retryDelaysMs = [2000, 4000, 4000],
  sleep = defaultSleep,
  onRetrying,
} = {}) {
  let unanswered = false;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await send();
      return { res, recovered: unanswered, alreadySaved: false };
    } catch (err) {
      if (unanswered && isAlreadySavedError(err)) {
        return { res: null, recovered: true, alreadySaved: true };
      }

      const wasUnanswered = isUnansweredSaveError(err);
      const retryable = wasUnanswered || isSaveInProgressError(err);
      if (wasUnanswered) unanswered = true;

      if (!retryable || attempt >= retryDelaysMs.length) {
        // A refusal on the very first attempt is just a refusal. Once any
        // attempt went unanswered, though, "offline" or "still running" is not
        // an answer about the first one — say we don't know.
        if (unanswered || isSaveInProgressError(err)) {
          const unconfirmed = new Error(SAVE_UNCONFIRMED_MESSAGE);
          unconfirmed.code = SAVE_UNCONFIRMED;
          unconfirmed.cause = err;
          throw unconfirmed;
        }
        throw err;
      }

      onRetrying?.(attempt + 1, err);
      await sleep(retryDelaysMs[attempt]);
    }
  }
}
