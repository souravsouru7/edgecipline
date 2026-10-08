// node --test scripts/test-user-message.mjs
//
// Nothing written for a developer may reach the UI. These are the exact strings
// this app can actually produce — the Capacitor bridge's own wording, Firebase
// auth codes, the axios fallback from services/apiClient.js, Chromium net
// errors, and the dev host that used to be hardcoded into the sign-in copy.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

const { getUserMessage, isTechnicalMessage, isConnectivityError, OFFLINE_MESSAGE } =
  await import("../utils/userMessage.js");

const FALLBACK = "We couldn't save that. Please try again.";

test("native bridge errors never reach the user", () => {
  for (const message of [
    '"ChecklistNotification" plugin is not implemented on ios',
    "EdgeBilling plugin is not implemented on ios",
    "Secure storage read temporarily unavailable on capacitor://localhost",
    "CapacitorException: bridge not ready",
  ]) {
    assert.equal(getUserMessage(new Error(message), FALLBACK), FALLBACK, message);
  }
});

test("raw Firebase codes and errors never reach the user", () => {
  for (const message of [
    "auth/popup-closed-by-user",
    "Firebase: Error (auth/invalid-credential).",
    "FirebaseError: Firebase: Error (auth/too-many-requests).",
  ]) {
    assert.equal(getUserMessage(new Error(message), FALLBACK), FALLBACK, message);
  }
});

test("dev hosts and browser advice never reach the user", () => {
  // The two strings this cleanup removed from getGoogleAuthErrorMessage.
  for (const message of [
    "Google sign-in was closed before it finished. Try again, or allow popups for localhost:3000.",
    "Google sign-in popup was blocked. Allow popups for localhost:3000 and try again.",
    "Please refresh the page and try again.",
    "Check your browser settings and try again.",
    "Open this in another tab.",
  ]) {
    assert.equal(getUserMessage(new Error(message), FALLBACK), FALLBACK, message);
  }
});

test("transport and server internals never reach the user", () => {
  for (const message of [
    "Request failed with status undefined",
    "Request failed with status 500",
    "E11000 duplicate key error collection: edgecipline.users",
    "ValidationError: email: Path `email` is required.",
    "TypeError: Cannot read properties of undefined (reading 'token')",
    "    at handleAuthSuccess (useLogin.js:318)",
    "[object Object]",
    '{"errorCode":"AUTH_FAILED"}',
  ]) {
    assert.equal(getUserMessage(new Error(message), FALLBACK), FALLBACK, message);
  }
});

test("a bare code with no spaces is treated as technical", () => {
  assert.equal(isTechnicalMessage("AUTH_PROVIDER_CONFLICT"), true);
  assert.equal(isTechnicalMessage(""), true);
  assert.equal(isTechnicalMessage(undefined), true);
  // A log line, not a toast.
  assert.equal(isTechnicalMessage("x ".repeat(120)), true);
});

test("the backend's own sanitised message IS shown — it is written for users", () => {
  const error = Object.assign(new Error("Request failed with status 409"), {
    status: 409,
    data: { message: "This email is already registered with a password. Please sign in with your password instead." },
  });
  assert.match(getUserMessage(error, FALLBACK), /already registered with a password/);
});

test("a technical server message is rejected even though it came from the API", () => {
  const error = Object.assign(new Error("boom"), {
    data: { message: "MongoServerError: E11000 duplicate key" },
  });
  assert.equal(getUserMessage(error, FALLBACK), FALLBACK);
});

test("plain human copy passes through unchanged", () => {
  assert.equal(
    getUserMessage(new Error("Incorrect email or password."), FALLBACK),
    "Incorrect email or password."
  );
});

test("connectivity failures get an actionable message, not the generic one", () => {
  for (const error of [
    new Error("auth/network-request-failed"),
    // Both reach the user as "you appear to be offline", which is more useful
    // than a generic apology — and neither leaks the axios/Chromium wording.
    new Error("AxiosError: Network Error"),
    new Error("net::ERR_CONNECTION_REFUSED"),
    Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ECONNABORTED" }),
    Object.assign(new Error("boom"), { status: 0 }),
  ]) {
    assert.equal(getUserMessage(error, FALLBACK), OFFLINE_MESSAGE, error.message);
    assert.equal(isConnectivityError(error), true, error.message);
  }
});

test("being offline outranks everything, including a server message", () => {
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
  try {
    const error = Object.assign(new Error("x"), { data: { message: "Your session expired." } });
    assert.equal(getUserMessage(error, FALLBACK), OFFLINE_MESSAGE);
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  }
});

test("a string error is accepted as the message", () => {
  assert.equal(getUserMessage("Select your mood.", FALLBACK), "Select your mood.");
  assert.equal(getUserMessage("auth/wrong-password", FALLBACK), FALLBACK);
});
