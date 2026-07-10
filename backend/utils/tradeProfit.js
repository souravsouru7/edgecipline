"use strict";

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "string"
    ? Number(value.replace(/,/g, "").trim())
    : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function directionFor(type) {
  const normalized = String(type || "").toUpperCase();
  if (normalized === "BUY") return 1;
  if (normalized === "SELL") return -1;
  return null;
}

function roundCurrency(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function forexContractSize(pair) {
  const symbol = String(pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (symbol.includes("XAU")) return 100;
  if (symbol.includes("XAG")) return 5000;
  if (symbol.includes("USOIL") || symbol.includes("WTI")) return 1000;
  return 100_000;
}

function deriveForexProfit(trade) {
  const direction = directionFor(trade?.type);
  const entryPrice = toFiniteNumber(trade?.entryPrice);
  const exitPrice = toFiniteNumber(trade?.exitPrice);
  const lots = toFiniteNumber(trade?.lotSize ?? trade?.quantity);

  if (
    direction == null ||
    entryPrice == null ||
    exitPrice == null ||
    lots == null ||
    lots <= 0
  ) {
    return null;
  }

  const commission = Math.abs(toFiniteNumber(trade?.commission) || 0);
  const swap = toFiniteNumber(trade?.swap) || 0;
  let gross = direction
    * (exitPrice - entryPrice)
    * lots
    * forexContractSize(trade?.pair);

  // Forex price deltas are denominated in the quote currency. The journal's
  // Forex P&L is USD-denominated, so direct USD-base pairs need conversion.
  // Crosses without USD require a live conversion rate and are left unset
  // instead of recording a confidently wrong number.
  const symbol = String(trade?.pair || "").toUpperCase().replace(/[^A-Z]/g, "");
  const currencyPair = symbol.match(/^([A-Z]{3})([A-Z]{3})/);
  if (currencyPair) {
    const [, baseCurrency, quoteCurrency] = currencyPair;
    if (quoteCurrency === "USD") {
      // Already denominated in USD.
    } else if (baseCurrency === "USD") {
      gross /= exitPrice;
    } else {
      return null;
    }
  }

  return roundCurrency(gross - commission + swap);
}

function deriveIndianProfit(trade) {
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

  if (
    direction == null ||
    entryPrice == null ||
    exitPrice == null ||
    units == null ||
    units <= 0
  ) {
    return null;
  }

  const brokerage = Math.abs(toFiniteNumber(trade?.brokerage) || 0);
  const taxes = Math.abs(toFiniteNumber(trade?.sttTaxes) || 0);
  const gross = direction * (exitPrice - entryPrice) * units;

  return roundCurrency(gross - brokerage - taxes);
}

function normalizedTradeIdentity(trade) {
  return String(
    trade?.pair ||
    trade?.stockSymbol ||
    trade?.symbol ||
    ""
  ).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function trustedOcrProfitForTrade(payload, extractedTrades, index = 0) {
  if (!Array.isArray(extractedTrades) || extractedTrades.length === 0) return null;

  const identity = normalizedTradeIdentity(payload);
  const type = String(payload?.type || "").toUpperCase();
  const matchingTrades = extractedTrades.filter((trade) => {
    const candidateIdentity = normalizedTradeIdentity(trade);
    const candidateType = String(trade?.type || "").toUpperCase();
    return (
      (!identity || !candidateIdentity || identity === candidateIdentity) &&
      (!type || !candidateType || type === candidateType)
    );
  });

  const candidates = matchingTrades.length > 0 ? matchingTrades : [];
  const requestedProfit = toFiniteNumber(payload?.profit);
  if (requestedProfit != null) {
    const exact = candidates.find((trade) => {
      const candidateProfit = toFiniteNumber(trade?.profit ?? trade?.pnl);
      return candidateProfit != null && Math.abs(candidateProfit - requestedProfit) <= 0.01;
    });
    if (exact) return roundCurrency(toFiniteNumber(exact.profit ?? exact.pnl));
    return null;
  }

  if (candidates.length === 1) {
    return roundCurrency(toFiniteNumber(candidates[0].profit ?? candidates[0].pnl));
  }

  const indexed = candidates[index];
  return indexed
    ? roundCurrency(toFiniteNumber(indexed.profit ?? indexed.pnl))
    : null;
}

module.exports = {
  deriveForexProfit,
  deriveIndianProfit,
  trustedOcrProfitForTrade,
};
