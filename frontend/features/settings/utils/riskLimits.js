// Client-side mirror of the server rules in
// backend/controllers/riskLimitsController.js. The server re-validates; this
// only gives inline errors before a round trip.

export const MAX_TRADES_PER_DAY = 100;
export const MAX_LOSS_LIMIT = 1e9;

export const MARKET_META = {
  Forex: { label: "Forex", currency: "$", example: "200" },
  Indian_Market: { label: "Indian market", currency: "₹", example: "5000" },
};

// "" → null (off). Returns { value } or { error }.
export function parseLossLimitInput(raw) {
  const text = String(raw ?? "").replace(/[,\s₹$]/g, "");
  if (text === "") return { value: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return { error: "Enter an amount above 0, or leave it blank." };
  if (n > MAX_LOSS_LIMIT) return { error: "That amount is too large." };
  return { value: Math.round(n * 100) / 100 };
}

export function parseTradeLimitInput(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return { value: null };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TRADES_PER_DAY) {
    return { error: `Enter a whole number from 1 to ${MAX_TRADES_PER_DAY}, or leave it blank.` };
  }
  return { value: n };
}

export function hasAnyLimit(block) {
  return Boolean(block && (block.dailyLossLimit || block.maxTradesPerDay));
}

// Show the first-time prompt only when nothing is set and it was never answered.
export function shouldPromptForLimits(block) {
  if (!block) return false;
  return !hasAnyLimit(block) && !block.promptAnsweredAt;
}

export function toInputValue(n) {
  return n === null || n === undefined ? "" : String(n);
}
