"use strict";

/**
 * Small numeric coercion helpers shared across controllers and services.
 *
 * Every one of these used to be re-declared locally (analytics, dashboard,
 * snapshot, parsing, extraction-quality...). Keep them here so the "invalid
 * input → 0" contract is defined once.
 */

// Number(value) when finite, otherwise 0. Alias: safeSignedNumber.
function toNum(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Number(value) when finite and > 0, otherwise 0.
function safePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

// Division that never yields NaN/Infinity: 0 when the denominator is 0 or
// the result is not finite.
function safeDivide(numerator, denominator) {
  const d = toNum(denominator);
  if (d === 0) return 0;
  const result = toNum(numerator) / d;
  return Number.isFinite(result) ? result : 0;
}

// String with fixed decimals; non-numeric input renders as "0.00".
function fixed(value, digits = 2) {
  return toNum(value).toFixed(digits);
}

module.exports = {
  toNum,
  safeSignedNumber: toNum,
  safePositiveNumber,
  safeDivide,
  fixed,
};
