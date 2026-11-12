import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePreference, resolveTheme, THEME_BOOT_SCRIPT } from "./themeBoot.js";

test("explicit preferences resolve to themselves", () => {
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("light", false), "light");
});

test("system follows the OS", () => {
  assert.equal(resolveTheme("system", true), "light");
  assert.equal(resolveTheme("system", false), "dark");
});

test("unknown or missing preference falls back to dark", () => {
  assert.equal(normalizePreference("purple"), "dark");
  assert.equal(resolveTheme(undefined, true), "dark");
});

test("boot script sets both resolved theme and preference", () => {
  const dataset = {};
  const store = { "ec-theme": "system" };
  const fn = new Function("document", "localStorage", "window", THEME_BOOT_SCRIPT);
  fn({ documentElement: { dataset } }, { getItem: (k) => store[k] ?? null },
    { matchMedia: () => ({ matches: true }) });
  assert.deepEqual(dataset, { theme: "light", themePref: "system" });
});

test("boot script survives blocked storage", () => {
  const dataset = {};
  const fn = new Function("document", "localStorage", "window", THEME_BOOT_SCRIPT);
  fn({ documentElement: { dataset } }, { getItem: () => { throw new Error("blocked"); } }, {});
  assert.deepEqual(dataset, { theme: "dark", themePref: "dark" });
});
