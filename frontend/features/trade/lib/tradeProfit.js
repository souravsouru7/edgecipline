// P&L exactly as the server will save it — a port of
// backend/utils/tradeProfit.js (deriveForexProfit / deriveIndianProfit).
// The server always recalculates P&L from the trade fields, so the form shows
// this value instead of letting the trader type a number that gets replaced.
// Kept in sync by features/trade/lib/tradeProfit.test.mjs, which runs both
// implementations against the same cases.

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.replace(/,/g, "").trim()) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function directionFor(type) {
  const t = String(type || "").toUpperCase();
  if (t === "BUY") return 1;
  if (t === "SELL") return -1;
  return null;
}

function roundCurrency(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function forexContractSize(pair) {
  const symbol = String(pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (symbol.includes("XAU")) return 100;
  if (symbol.includes("XAG")) return 5000;
  if (symbol.includes("USOIL") || symbol.includes("WTI")) return 1000;
  if (/^(BTC|ETH|LTC|XRP|ADA|DOGE|SOL|BNB)/.test(symbol)) return null;
  if (/\d/.test(symbol)) return null;
  if (!/^[A-Z]{6}/.test(symbol)) return null;
  return 100_000;
}

/** True when the server can price this Forex symbol automatically. */
export function isForexPricable(pair) {
  const contractSize = forexContractSize(pair);
  if (contractSize == null) return false;
  const symbol = String(pair || "").toUpperCase().replace(/[^A-Z]/g, "");
  const m = symbol.match(/^([A-Z]{3})([A-Z]{3})/);
  if (!m) return true;
  return m[2] === "USD" || m[1] === "USD";
}

export function deriveForexProfit(trade) {
  const direction = directionFor(trade?.type);
  const entryPrice = toFiniteNumber(trade?.entryPrice);
  const exitPrice = toFiniteNumber(trade?.exitPrice);
  const lots = toFiniteNumber(trade?.lotSize ?? trade?.quantity);
  if (direction == null || entryPrice == null || exitPrice == null || lots == null || lots <= 0) return null;

  const commission = Math.abs(toFiniteNumber(trade?.commission) || 0);
  const swap = toFiniteNumber(trade?.swap) || 0;
  const contractSize = forexContractSize(trade?.pair);
  if (contractSize == null) return null;

  let gross = direction * (exitPrice - entryPrice) * lots * contractSize;
  const symbol = String(trade?.pair || "").toUpperCase().replace(/[^A-Z]/g, "");
  const currencyPair = symbol.match(/^([A-Z]{3})([A-Z]{3})/);
  if (currencyPair) {
    const [, baseCurrency, quoteCurrency] = currencyPair;
    if (quoteCurrency === "USD") {
      // already USD
    } else if (baseCurrency === "USD") {
      gross /= exitPrice;
    } else {
      return null;
    }
  }
  return roundCurrency(gross - commission + swap);
}

export function deriveIndianProfit(trade) {
  const direction = directionFor(trade?.type);
  const entryPrice = toFiniteNumber(trade?.entryPrice);
  const exitPrice = toFiniteNumber(trade?.exitPrice);
  const instrumentType = String(trade?.instrumentType || "").toUpperCase();
  let units;
  if (instrumentType === "EQUITY") {
    units = toFiniteNumber(trade?.sharesQty);
  } else {
    const quantity = toFiniteNumber(trade?.quantity);
    const lotSize = toFiniteNumber(trade?.lotSize);
    units = quantity != null && lotSize != null ? quantity * lotSize : null;
  }
  if (direction == null || entryPrice == null || exitPrice == null || units == null || units <= 0) return null;
  return roundCurrency(direction * (exitPrice - entryPrice) * units);
}

/** Indian P&L after brokerage + STT (what analytics shows as net). */
export function indianNetProfit(trade) {
  const gross = deriveIndianProfit(trade);
  if (gross == null) return null;
  // Brokers print charges negative; they are a cost either way (the server
  // stores the absolute value).
  const charges = Math.abs(toFiniteNumber(trade?.brokerage) || 0) + Math.abs(toFiniteNumber(trade?.sttTaxes) || 0);
  return roundCurrency(gross - charges);
}
