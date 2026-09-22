import test from "node:test";
import assert from "node:assert/strict";
import { RECONCILE_COOLDOWN_MS, isAuthFailure, canReconcile, isSignIn } from "./playReconcilePolicy.mjs";

test("reconcile re-runs on login and does not stamp cooldown on 401", () => {
  // The hook only advances lastRun when the failure is NOT an auth failure;
  // these are the two halves of that rule.
  assert.equal(isAuthFailure({ response: { status: 401 } }), true);
  assert.equal(isAuthFailure({ response: { status: 401, data: { error: { code: "AUTH_REQUIRED" } } } }), true);
  assert.equal(isAuthFailure({ errorCode: "AUTH_REQUIRED" }), true);
  assert.equal(isAuthFailure({ response: { status: 502 } }), false);
  assert.equal(isAuthFailure(new Error("network")), false);

  // Sign-in (null → token) triggers; rotation (token → token) and sign-out do not.
  assert.equal(isSignIn({ token: "jwt-1", previous: null }), true);
  assert.equal(isSignIn({ token: "jwt-2", previous: "jwt-1" }), false);
  assert.equal(isSignIn({ token: null, previous: "jwt-1" }), false);
});

test("cooldown applies to unforced runs only, and never while one is in flight", () => {
  const now = 1_000_000;
  assert.equal(canReconcile({ now, lastRun: now - RECONCILE_COOLDOWN_MS + 1, inFlight: false }), false);
  assert.equal(canReconcile({ now, lastRun: now - RECONCILE_COOLDOWN_MS, inFlight: false }), true);
  assert.equal(canReconcile({ now, lastRun: now - 1, inFlight: false, force: true }), true);
  assert.equal(canReconcile({ now, lastRun: 0, inFlight: true, force: true }), false);
});
