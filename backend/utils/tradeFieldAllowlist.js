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

function pickForexTradeFields(payload) {
  return pickAllowedFields(payload, FOREX_EDITABLE_FIELDS);
}

function pickIndianTradeFields(payload) {
  return pickAllowedFields(payload, INDIAN_EDITABLE_FIELDS);
}

module.exports = {
  FOREX_EDITABLE_FIELDS,
  INDIAN_EDITABLE_FIELDS,
  pickAllowedFields,
  pickForexTradeFields,
  pickIndianTradeFields,
};
