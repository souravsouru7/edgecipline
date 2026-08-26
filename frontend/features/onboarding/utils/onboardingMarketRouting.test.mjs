import test from "node:test";
import assert from "node:assert/strict";
import {
  getCanonicalOnboardingPath,
  getOnboardingUploadPath,
} from "./onboardingMarketRouting.mjs";

test("routes Indian onboarding setup and upload pages under /indian-market", () => {
  assert.equal(
    getCanonicalOnboardingPath("/setups", "Indian_Market"),
    "/indian-market/setups"
  );
  assert.equal(
    getCanonicalOnboardingPath("/upload-trade", "Indian_Market"),
    "/indian-market/upload-trade"
  );
});

test("routes Forex onboarding pages outside /indian-market", () => {
  assert.equal(
    getCanonicalOnboardingPath("/indian-market/setups", "Forex"),
    "/setups"
  );
  assert.equal(
    getCanonicalOnboardingPath("/indian-market/upload-trade", "Forex"),
    "/upload-trade"
  );
});

test("keeps an already canonical Indian route unchanged", () => {
  assert.equal(
    getCanonicalOnboardingPath("/indian-market/upload-trade", "Indian_Market"),
    "/indian-market/upload-trade"
  );
});

test("keeps the selected market explicit in onboarding demo links", () => {
  assert.equal(
    getOnboardingUploadPath("Indian_Market", { demo: true }),
    "/indian-market/upload-trade?onboarding=1&market=Indian_Market&demo=1"
  );
  assert.equal(
    getOnboardingUploadPath("Forex", { demo: true }),
    "/upload-trade?onboarding=1&market=Forex&demo=1"
  );
});
