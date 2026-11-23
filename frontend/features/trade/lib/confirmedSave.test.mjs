import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAVE_UNCONFIRMED,
  isUnansweredSaveError,
  submitWithConfirmation,
} from "./confirmedSave.js";

const noSleep = async () => {};
const timeout = () => Object.assign(new Error("Request timed out. Please try again."), {
  code: "REQUEST_TIMEOUT",
  isTransportError: true,
});
const http = (status, errorCode) => Object.assign(new Error(`HTTP ${status}`), {
  status,
  data: { errorCode },
});

function sequence(...outcomes) {
  let i = 0;
  const send = async () => {
    const next = outcomes[Math.min(i, outcomes.length - 1)];
    i += 1;
    if (next instanceof Error) throw next;
    return next;
  };
  send.calls = () => i;
  return send;
}

test("a first-try success passes straight through", async () => {
  const send = sequence({ _id: "t1" });
  const out = await submitWithConfirmation(send, { sleep: noSleep });
  assert.deepEqual(out, { res: { _id: "t1" }, recovered: false, alreadySaved: false });
  assert.equal(send.calls(), 1);
});

test("timeout then idempotent replay resolves as recovered success", async () => {
  const send = sequence(timeout(), { _id: "t1" });
  const out = await submitWithConfirmation(send, { sleep: noSleep });
  assert.equal(out.recovered, true);
  assert.deepEqual(out.res, { _id: "t1" });
});

test("timeout then 'already saved' means the first attempt landed", async () => {
  const send = sequence(timeout(), http(409, "OCR_JOB_ALREADY_CONFIRMED"));
  const out = await submitWithConfirmation(send, { sleep: noSleep });
  assert.equal(out.alreadySaved, true);
  assert.equal(out.res, null);
});

test("'already saved' with no earlier unanswered attempt is a real refusal", async () => {
  const send = sequence(http(409, "OCR_JOB_ALREADY_CONFIRMED"));
  await assert.rejects(submitWithConfirmation(send, { sleep: noSleep }), (err) => err.status === 409);
});

test("server 408 then in-progress then replay waits it out", async () => {
  const send = sequence(http(408, "REQUEST_TIMEOUT"), http(409, "IDEMPOTENT_REQUEST_IN_PROGRESS"), { _id: "t1" });
  const out = await submitWithConfirmation(send, { sleep: noSleep });
  assert.equal(out.recovered, true);
  assert.equal(send.calls(), 3);
});

test("a validation refusal is not retried and keeps its own message", async () => {
  const send = sequence(http(400, "VALIDATION_ERROR"));
  await assert.rejects(submitWithConfirmation(send, { sleep: noSleep }), (err) => err.status === 400);
  assert.equal(send.calls(), 1);
});

test("still unanswered after every retry reports an unconfirmed save, not a timeout", async () => {
  const send = sequence(timeout());
  const retried = [];
  await assert.rejects(
    submitWithConfirmation(send, { sleep: noSleep, retryDelaysMs: [1, 1], onRetrying: (n) => retried.push(n) }),
    (err) => err.code === SAVE_UNCONFIRMED
  );
  assert.equal(send.calls(), 3);
  assert.deepEqual(retried, [1, 2]);
});

test("going offline after an unanswered attempt is still 'unconfirmed'", async () => {
  const offline = Object.assign(new Error("You're offline."), { isOffline: true, status: 0 });
  const send = sequence(timeout(), offline);
  await assert.rejects(submitWithConfirmation(send, { sleep: noSleep }), (err) => err.code === SAVE_UNCONFIRMED);
});

test("offline on the first attempt keeps the offline error (nothing was sent)", async () => {
  const offline = Object.assign(new Error("You're offline."), { isOffline: true, status: 0 });
  assert.equal(isUnansweredSaveError(offline), false);
  await assert.rejects(submitWithConfirmation(sequence(offline), { sleep: noSleep }), (err) => err.isOffline);
});
