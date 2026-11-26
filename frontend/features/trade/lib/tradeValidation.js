// Trade rules shared by every trade form (add, upload review, edit — Forex and
// Indian). Mirrors backend/utils/tradeValidation.js so the trader hears about a
// problem at the field, not as a server error after pressing Save.
//
// Each form keeps its own required-field checks (they differ by screen); this
// module adds the rules that must be identical everywhere.

import { parseNumericField } from "./numericInput.js";
import { deriveForexProfit, isForexPricable } from "./tradeProfit.js";

const RR_PATTERN = /^\s*(\d+(?:\.\d{1,2})?)\s*(?:[:/]\s*(\d+(?:\.\d{1,2})?))?\s*$/;
const RR_MAX_SIDE = 100;

/** "1:2.5", "1/3" or "2.5" (= 1:2.5) → { value: "1:2.5" } | { error }. */
export function parseRiskReward(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { value: "" };
  const m = RR_PATTERN.exec(text);
  if (!m) return { error: "Custom R:R must look like 1:2.5" };
  const risk = m[2] === undefined ? 1 : Number(m[1]);
  const reward = m[2] === undefined ? Number(m[1]) : Number(m[2]);
  if (!(risk > 0) || !(reward > 0)) return { error: "Both sides of the R:R must be above 0" };
  if (risk > RR_MAX_SIDE || reward > RR_MAX_SIDE) return { error: `R:R values can't be above ${RR_MAX_SIDE}` };
  const fmt = (n) => String(Math.round(n * 100) / 100);
  return { value: `${fmt(risk)}:${fmt(reward)}` };
}

/**
 * The R:R pair to send. Custom text only goes out when "custom" is actually
 * selected — leftover text used to force "custom" over a chosen preset.
 */
export function riskRewardPayload(ratio, custom) {
  if (ratio !== "custom") return { riskRewardRatio: ratio || "", riskRewardCustom: "" };
  const parsed = parseRiskReward(custom);
  return { riskRewardRatio: "custom", riskRewardCustom: parsed.value || String(custom || "").trim() };
}

const LABELS = {
  entryPrice: "Entry price", exitPrice: "Exit price", stopLoss: "Stop loss", takeProfit: "Take profit",
  lotSize: "Lot size", quantity: "Quantity", sharesQty: "Shares", strikePrice: "Strike price",
  brokerage: "Brokerage", sttTaxes: "STT / taxes", commission: "Commission", swap: "Swap", profit: "P&L",
};

const TEXT_LIMITS = [
  ["notes", "Notes", 2000], ["lesson", "Lesson", 2000], ["setup", "Setup", 200],
  ["mistakeTag", "Mistake", 100], ["session", "Session", 50], ["entryBasisCustom", "Custom entry basis", 200],
];

const blank = (v) => v === undefined || v === null || String(v).trim() === "";
const num = (v) => (blank(v) ? null : parseNumericField(v));

/**
 * @param {object} t   form state
 * @param {object} ctx {
 *   market: "Forex" | "Indian_Market", instrumentType, hasTrustedPnl,
 *   fields: optional list of the field names this form actually shows.
 *           A field outside it is never reported: a message must always
 *           point at an input the trader can see and fix.
 * }
 * @returns {{ field: string, message: string } | null}  first problem, or null
 */
export function validateTradeRules(t, { market = "Forex", instrumentType, hasTrustedPnl = false, fields } = {}) {
  const indian = market === "Indian_Market";
  const isEquity = String(instrumentType || t.instrumentType || "").toUpperCase() === "EQUITY";
  const shown = fields ? new Set(fields) : null;
  const problem = (field, message) => (!shown || shown.has(field) ? { field, message } : null);
  let p;

  // Any filled number box must hold a real number.
  for (const field of Object.keys(LABELS)) {
    if (!blank(t[field]) && num(t[field]) === undefined && (p = problem(field, `${LABELS[field]} must be a number`))) return p;
  }
  for (const field of ["entryPrice", "exitPrice", "lotSize", "quantity", "sharesQty", "strikePrice"]) {
    const n = num(t[field]);
    if (n != null && !(n > 0) && (p = problem(field, `${LABELS[field]} must be more than 0`))) return p;
  }
  if (!indian && num(t.lotSize) > 1000 && (p = problem("lotSize", "Lot size looks too large (max 1000)"))) return p;
  // Commission, brokerage and STT are charges whatever their sign: brokers
  // print them negative and the server takes the absolute value. Never block.

  // Levels: take profit on the wrong side is an error; a stop beyond entry is
  // allowed (trailed / break-even stop).
  const entry = num(t.entryPrice);
  const sl = num(t.stopLoss);
  const tp = num(t.takeProfit);
  if (sl != null && sl < 0 && (p = problem("stopLoss", "Stop loss must be a positive price"))) return p;
  if (tp != null && tp < 0 && (p = problem("takeProfit", "Take profit must be a positive price"))) return p;
  if (sl > 0 && tp > 0 && sl === tp && (p = problem("takeProfit", "Stop loss and take profit can't be the same price"))) return p;
  const side = String(t.type || "").toUpperCase();
  if (tp > 0 && entry > 0) {
    if (side === "BUY" && tp <= entry && (p = problem("takeProfit", "Take profit must be above your entry price for a BUY"))) return p;
    if (side === "SELL" && tp >= entry && (p = problem("takeProfit", "Take profit must be below your entry price for a SELL"))) return p;
  }

  if (t.riskRewardRatio === "custom") {
    const rr = parseRiskReward(t.riskRewardCustom);
    if (rr.error && (p = problem("riskRewardCustom", rr.error))) return p;
    if (!rr.error && !rr.value && (p = problem("riskRewardCustom", "Enter your custom R:R, like 1:2.5"))) return p;
  }

  if (t.entryBasis === "Custom" && String(t.entryBasisCustom || "").trim().length < 3 &&
    (p = problem("entryBasisCustom", "Describe your custom entry basis (at least 3 characters)"))) return p;

  if (indian && !isEquity && !blank(t.expiryDate) && !blank(t.tradeDate) &&
    String(t.expiryDate).slice(0, 10) < String(t.tradeDate).slice(0, 10) &&
    (p = problem("expiryDate", "Expiry can't be before the trade date"))) return p;

  // Forex: the server prices the trade itself; catch symbols it can't price.
  if (!indian && !hasTrustedPnl && !blank(t.pair) && !isForexPricable(t.pair) &&
    (p = problem("pair", `Automatic P&L isn't supported for ${String(t.pair).toUpperCase()} yet`))) return p;

  for (const [field, label, max] of TEXT_LIMITS) {
    if (String(t[field] || "").length > max && (p = problem(field, `${label} is too long (max ${max} characters)`))) return p;
  }
  return null;
}

/**
 * Screenshot P&L vs the P&L its own prices give (Forex, net of commission
 * and swap). A screenshot reader can misread one number; entry, exit and lot
 * size have to agree with each other.
 * @returns {{ calculated: number, differs: boolean } | null}  null = can't price
 */
export function checkForexPnl(t) {
  const calculated = deriveForexProfit({ ...t, type: t.type || t.action });
  if (calculated == null) return null;
  const shown = num(t.profit);
  if (shown == null) return { calculated, differs: false };
  const tolerance = Math.max(0.5, Math.abs(calculated) * 0.01);
  return { calculated, differs: Math.abs(shown - calculated) > tolerance };
}

/** Live Forex P&L for display (null when it can't be calculated yet). */
export function previewForexProfit(t) {
  return deriveForexProfit(t);
}

/**
 * Point the trader at the problem: scroll to the field, focus it and outline
 * it until they edit it.
 */
export function focusTradeField(field) {
  if (typeof document === "undefined" || !field) return;
  const el = document.querySelector(`[name="${field}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.setAttribute("aria-invalid", "true");
  el.classList.add("ec-field-error");
  const clear = () => {
    el.removeAttribute("aria-invalid");
    el.classList.remove("ec-field-error");
    el.removeEventListener("input", clear);
    el.removeEventListener("change", clear);
  };
  el.addEventListener("input", clear);
  el.addEventListener("change", clear);
  setTimeout(() => el.focus({ preventScroll: true }), 250);
}
