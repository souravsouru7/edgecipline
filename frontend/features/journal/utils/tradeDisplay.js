// How a trade is labelled in the journal, for both markets.

export function isEquityTrade(trade) {
  const instrumentType = String(trade?.instrumentType || "").toUpperCase();
  if (instrumentType === "EQUITY") return true;
  if (instrumentType === "OPTION") return false;
  // Older trades have no instrumentType: options carry CE/PE, a strike or FUT.
  const optionType = String(trade?.optionType || "").toUpperCase();
  const pair = String(trade?.pair || "").toUpperCase().trim();
  return !(
    optionType === "CE" ||
    optionType === "PE" ||
    trade?.strikePrice != null ||
    /\b(CE|PE|CALL|PUT|FUT)\b/.test(pair)
  );
}

export function tradeSymbol(trade, indian) {
  if (!trade) return "—";
  if (!indian) return trade.pair || "—";
  if (isEquityTrade(trade)) return trade.stockSymbol || trade.pair || "—";
  if (trade.pair) return trade.pair;
  const opt = trade.optionType || "";
  return [trade.underlying, trade.strikePrice, opt].filter((p) => p !== undefined && p !== null && p !== "").join(" ") || "—";
}

export function tradeSide(trade) {
  const t = String(trade?.type || "").toUpperCase();
  if (t === "BUY" || t === "LONG") return { label: "Long", long: true };
  if (t === "SELL" || t === "SHORT") return { label: "Short", long: false };
  return null;
}

// Setup name if the trade was linked to one, else the old free-text strategy,
// else the entry basis ("Plan", "Emotion", …).
export function tradeSetupLabel(trade) {
  const setup = String(trade?.setup || "").trim();
  if (setup) return setup;
  const strategy = String(trade?.strategy || "").trim();
  if (strategy) return strategy;
  if (trade?.entryBasis === "Custom") return String(trade?.entryBasisCustom || "").trim() || null;
  return trade?.entryBasis || null;
}

export function tradeScore(trade) {
  if (trade?.setupScore === null || trade?.setupScore === undefined || trade?.setupScore === "") return null;
  const n = Number(trade.setupScore);
  return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : null;
}

export function tradeMistake(trade) {
  const m = String(trade?.mistakeTag || "").trim();
  if (!m || /^none$/i.test(m)) return null;
  return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function tradeProfit(trade) {
  if (trade?.profit === null || trade?.profit === undefined || trade?.profit === "") return null;
  const n = Number(trade.profit);
  return Number.isFinite(n) ? n : null;
}
