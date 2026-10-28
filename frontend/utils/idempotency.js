"use client";

// Keys for write requests the server deduplicates.
//
// Unlike utils/genId.js — which is explicitly not for anything the server keys
// on — these must be collision-free across devices and sessions, because the
// server stores them and returns the first response for a repeat.
//
// The contract a caller has to honour: mint ONE key per logical submission and
// reuse it for every attempt at that submission. That is what makes a double
// tap, an interceptor retry, and a user retrying after a false timeout all
// resolve to a single write. Minting a fresh key per attempt would make the
// header decorative.

export function newIdempotencyKey() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // Locked-down webview — fall through.
  }
  // Last resort. Weaker, but the key is scoped per user server-side, so the
  // only collision that matters is one user colliding with themselves.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
