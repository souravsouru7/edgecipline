"use strict";

const { appConfig } = require("../config");

const TRADE_FEATURES = new Set(["trade_vision", "trade_text"]);

// Model for one feature: GEMINI_MODEL_<FEATURE> if set, else the existing
// GEMINI_TRADE_MODEL (extraction) or GEMINI_MODEL (everything else). With no
// overrides set this returns exactly what each service used before.
function modelFor(feature) {
  const override = appConfig.ai.featureModels?.[feature];
  if (override) return override;
  return TRADE_FEATURES.has(feature) ? appConfig.ai.geminiTradeModel : appConfig.ai.geminiModel;
}

// `thinkingConfig` is a 2.5+ parameter. Older models reject the field with a
// 400, so a rollback of the model name would otherwise take the feature down.
function supportsThinkingConfig(modelName) {
  const match = /gemini-(\d+)(?:\.(\d+))?/.exec(String(modelName || ""));
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  return major > 2 || (major === 2 && minor >= 5);
}

// Flash-Lite does not think unless asked, and rejects thinkingBudget: 0 with
// a 400 "invalid argument" (live test 2026-11-28, gemini-3.5-flash-lite).
function rejectsZeroThinkingBudget(modelName) {
  return /flash-lite/i.test(String(modelName || ""));
}

// Adds a thinking cap when the model accepts one.
function withThinkingBudget(modelName, generationConfig, budget) {
  if (!supportsThinkingConfig(modelName)) return generationConfig;
  if (budget === 0 && rejectsZeroThinkingBudget(modelName)) return generationConfig;
  return { ...generationConfig, thinkingConfig: { thinkingBudget: budget } };
}

// Configured thinking cap for a feature, or null when none is set.
function thinkingBudgetFor(feature) {
  const raw = appConfig.ai.featureThinkingBudget?.[feature];
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

// Applies the configured cap (if any) to a generationConfig.
function applyFeatureThinking(feature, modelName, generationConfig) {
  const budget = thinkingBudgetFor(feature);
  return budget == null ? generationConfig : withThinkingBudget(modelName, generationConfig, budget);
}

module.exports = { applyFeatureThinking, modelFor, supportsThinkingConfig, thinkingBudgetFor, withThinkingBudget };
