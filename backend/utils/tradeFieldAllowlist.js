"use strict";

const FOREX_EDITABLE_FIELDS = Object.freeze([
  "pair",
  "type",
  "quantity",
  "lotSize",
  "entryPrice",
  "exitPrice",
  "stopLoss",
  "takeProfit",
  "commission",
  "swap",
  "balance",
  "strategy",
  "session",
  "tradeDate",
  "notes",
  "riskRewardRatio",
  "riskRewardCustom",
  "screenshot",
  "imageUrl",
  "tradeImages",
  "broker",
  "entryBasis",
  "entryBasisCustom",
  "mood",
  "confidence",
  "emotionalTags",
  "mistakeTag",
  "lesson",
  "wouldRetake",
  "tradeQuality",
  "setupRules",
  "setupScore",
]);

const INDIAN_EDITABLE_FIELDS = Object.freeze([
  "pair",
  "underlying",
  "type",
  "optionType",
  "entryPrice",
  "exitPrice",
  "stopLoss",
  "takeProfit",
  "strategy",
  "session",
  "tradeDate",
  "notes",
  "riskRewardRatio",
  "riskRewardCustom",
  "screenshot",
  "tradeImages",
  "instrumentType",
  "stockSymbol",
  "exchange",
  "sharesQty",
  "sector",
  "strikePrice",
  "expiryDate",
  "quantity",
  "lotSize",
  "tradeType",
  "brokerage",
  "sttTaxes",
  "entryBasis",
  "entryBasisCustom",
  "setup",
  "mistakeTag",
  "lesson",
  "setupRules",
  "setupScore",
  "mood",
  "confidence",
  "emotionalTags",
  "wouldRetake",
  "tradeQuality",
]);

function pickAllowedFields(payload, allowedFields) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};

  return Object.fromEntries(
    allowedFields
      .filter((field) => Object.prototype.hasOwnProperty.call(payload, field))
      .filter((field) => payload[field] !== undefined)
      .map((field) => [field, payload[field]])
  );
}

// setupScore arrives from the client, where it is computed from the rule
// checkboxes — so it is a claim, not a fact: a payload can report 100 while
// every rule is marked unfollowed, and that number feeds the discipline score,
// Trading DNA and mission recommendations. Whenever the rules themselves are
// part of the write, derive the score from them instead of trusting it.
function withDerivedSetupScore(fields) {
  if (!Object.prototype.hasOwnProperty.call(fields, "setupRules")) return fields;

  const rules = Array.isArray(fields.setupRules) ? fields.setupRules : [];
  const valid = rules.filter(
    (rule) => rule && typeof rule.label === "string" && rule.label.trim().length > 0
  );
  const followed = valid.filter((rule) => rule.followed === true).length;

  return {
    ...fields,
    setupScore: valid.length > 0 ? Math.round((followed / valid.length) * 100) : null,
  };
}

function pickForexTradeFields(payload) {
  return withDerivedSetupScore(pickAllowedFields(payload, FOREX_EDITABLE_FIELDS));
}

function pickIndianTradeFields(payload) {
  return withDerivedSetupScore(pickAllowedFields(payload, INDIAN_EDITABLE_FIELDS));
}

module.exports = {
  FOREX_EDITABLE_FIELDS,
  INDIAN_EDITABLE_FIELDS,
  pickAllowedFields,
  pickForexTradeFields,
  pickIndianTradeFields,
};
