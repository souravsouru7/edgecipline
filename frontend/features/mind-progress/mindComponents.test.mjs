import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIND_COMPONENTS, MIND_LEVELS } from "./mindComponents.js";

// The "How it works" sheet states weights and level thresholds; they must match
// the engine. Read the backend source as text (requiring it pulls in Mongo deps).
const src = readFileSync(new URL("../../../backend/utils/mindProgress.js", import.meta.url), "utf8");

test("component weights match backend WEIGHTS", () => {
  const block = src.match(/const WEIGHTS = Object\.freeze\(\{([\s\S]*?)\}\);/)[1];
  const backend = Object.fromEntries([...block.matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
  const front = Object.fromEntries(MIND_COMPONENTS.map((c) => [c.key, c.weight]));
  assert.deepEqual(front, backend);
  assert.equal(MIND_COMPONENTS.reduce((s, c) => s + c.weight, 0), 100);
});

test("levels match backend LEVELS", () => {
  const block = src.match(/const LEVELS = Object\.freeze\(\[([\s\S]*?)\]\);/)[1];
  const backend = [...block.matchAll(/level:\s*(\d+),\s*min:\s*(\d+),\s*name:\s*"([^"]+)",\s*emoji:\s*"([^"]+)"/g)]
    .map((m) => ({ level: Number(m[1]), min: Number(m[2]), name: m[3], emoji: m[4] }));
  assert.equal(backend.length, 6);
  assert.deepEqual(MIND_LEVELS, backend);
});
