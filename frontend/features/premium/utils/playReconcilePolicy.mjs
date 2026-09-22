// Pure decision logic for usePlayBillingReconcile, kept React-free so it can
// run under `node --test`.

// Resume fires liberally on Android (notification shade, permission dialogs,
// the Play sheet itself closing). Without a floor the reconcile would
// re-verify on every one of them, spending a Play Developer API call each time.
export const RECONCILE_COOLDOWN_MS = 60 * 1000;

// A 401 means the reconcile ran while nobody was signed in. It must NOT count
// against the cooldown: the sign-in that follows has to be able to reconcile
// immediately, or a purchase completed while signed out stays unverified.
export function isAuthFailure(error) {
  const status = error?.response?.status ?? error?.status;
  const code =
    error?.response?.data?.error?.code ||
    error?.response?.data?.errorCode ||
    error?.errorCode ||
    error?.code;
  return status === 401 || code === "AUTH_REQUIRED" || code === "AUTH_FAILED";
}

// Whether a reconcile may run now.
export function canReconcile({ now, lastRun, inFlight, force = false }) {
  if (inFlight) return false;
  if (force) return true;
  return now - lastRun >= RECONCILE_COOLDOWN_MS;
}

// Which token transitions are a SIGN-IN. Token rotation (previous → new) is
// not; hydration from storage and login both are (null → token).
export function isSignIn({ token, previous }) {
  return Boolean(token) && !previous;
}
