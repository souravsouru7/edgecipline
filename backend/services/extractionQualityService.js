function cleanOcrText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\x20-\x7E\n₹]/g, " ")
    .trim();
}

function detectBrokerPattern(text, fallbackBroker = null) {
  const source = String(text || "").toUpperCase();
  if (source.includes("ZERODHA") || source.includes("KITE")) return "Zerodha";
  if (source.includes("UPSTOX") || source.includes("RKSV")) return "Upstox";
  if (source.includes("ANGEL")) return "Angel One";
  if (source.includes("GROWW")) return "Groww";
  if (source.includes("DHAN")) return "Dhan";
  if (source.includes("FYERS")) return "Fyers";
  if (source.includes("5PAISA") || source.includes("FIVE PAISA")) return "5paisa";
  if (source.includes("ICICI")) return "ICICI Direct";
  if (source.includes("KOTAK") || source.includes("NEO")) return "Kotak";
  if (source.includes("PAYTM")) return "Paytm Money";
  return fallbackBroker || null;
}

function safePositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function safeSignedNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeValidationPayload(parsedTrade = {}) {
  return {
    symbol: String(parsedTrade.symbol || parsedTrade.pair || "").trim(),
    quantity: parsedTrade.quantity ?? parsedTrade.lotSize ?? null,
    price: parsedTrade.price ?? parsedTrade.entryPrice ?? parsedTrade.exitPrice ?? null,
    pnl: parsedTrade.pnl ?? parsedTrade.profit ?? null,
  };
}

function validateExtractedTrade(parsedTrade = {}) {
  const normalized = normalizeValidationPayload(parsedTrade);
  const failures = [];

  if (!normalized.symbol) failures.push("symbol is missing");
  if (!(Number(normalized.quantity) > 0)) failures.push("quantity must be greater than 0");
  if (!(Number(normalized.price) > 0)) failures.push("price must be greater than 0");
  if (normalized.pnl == null || !Number.isFinite(Number(normalized.pnl))) failures.push("pnl must be a valid number");

  return {
    isValid: failures.length === 0,
    failures,
    normalized,
  };
}

function validateIndianTrade(parsedTrade = {}) {
  const failures = [];
  const pair = String(parsedTrade.pair || parsedTrade.symbol || "").trim().toUpperCase();
  const quantity = Number(parsedTrade.quantity ?? 0);
  const price = Number(parsedTrade.entryPrice ?? parsedTrade.exitPrice ?? 0);
  const pnl = parsedTrade.pnl ?? parsedTrade.profit ?? null;
  const strikePrice = Number(parsedTrade.strikePrice ?? 0);
  const optionType = String(parsedTrade.optionType || "").trim().toUpperCase();
  const broker = String(parsedTrade.broker || "").trim();
  const hasUnderlying = /\b(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX)\b/i.test(pair);

  if (!pair) failures.push("pair is missing");
  if (!hasUnderlying) failures.push("underlying is missing");
  if (!(strikePrice > 0) && !/\bFUT\b/i.test(pair)) failures.push("strike price is missing");
  if (!["CE", "PE", "FUT"].includes(optionType) && !/\b(CE|PE|FUT)\b/i.test(pair)) failures.push("option type is invalid");
  // quantity = 0 is valid for closed positions (P&L/portfolio screenshots show Qty 0 after exit)
  // quantity = null means it was not extracted at all — flag it; 0 is intentional
  if (quantity == null && parsedTrade.quantity !== 0) failures.push("quantity must be greater than 0");
  // price is optional — P&L views often only show LTP or P&L, not entry/exit price
  if (pnl == null || !Number.isFinite(Number(pnl))) failures.push("pnl must be a valid number");

  return {
    isValid: failures.length === 0,
    failures,
    normalized: {
      pair,
      quantity,
      price,
      pnl: pnl == null ? null : Number(pnl),
      strikePrice,
      optionType: optionType || (pair.match(/\b(CE|PE|FUT)\b/i)?.[1]?.toUpperCase() || ""),
      broker,
    },
  };
}

function validateIndianTrades(parsedTrades = []) {
  const trades = Array.isArray(parsedTrades) ? parsedTrades : [];
  const results = trades.map((trade) => validateIndianTrade(trade));
  return {
    isValid: results.length > 0 && results.every((result) => result.isValid),
    results,
    validCount: results.filter((result) => result.isValid).length,
    totalCount: results.length,
  };
}

function calculateConfidenceScore({ parsedTrade = {}, ocrText = "" }) {
  const validation = validateExtractedTrade(parsedTrade);
  let score = 0;
  const normalized = validation.normalized;
  const cleanedText = cleanOcrText(ocrText);

  if (normalized.symbol && normalized.quantity > 0 && normalized.price > 0 && Number.isFinite(Number(normalized.pnl))) {
    score += 40;
  }

  if (
    Number.isFinite(Number(normalized.quantity)) &&
    Number.isFinite(Number(normalized.price)) &&
    Number.isFinite(Number(normalized.pnl))
  ) {
    score += 30;
  }

  if (cleanedText.length >= 40 && cleanedText.length <= 4000) {
    score += 10;
  }

  if (/\b(BUY|SELL|P&L|PNL|PROFIT|LOSS)\b/i.test(cleanedText)) {
    score += 20;
  }

  return {
    score,
    isLowConfidence: score < 60,
    validation,
  };
}

function calculateIndianConfidenceScore({ parsedTrade = {}, parsedTrades = [], ocrText = "", broker = "" }) {
  const validation = validateIndianTrade(parsedTrade);
  const multiValidation = validateIndianTrades(parsedTrades);
  let score = 0;
  const cleanedText = cleanOcrText(ocrText);
  const upperText = cleanedText.toUpperCase();
  const effectiveTradeCount = multiValidation.totalCount || (parsedTrade && Object.keys(parsedTrade).length ? 1 : 0);

  if (validation.isValid) score += 30;
  if (multiValidation.totalCount > 0 && multiValidation.validCount === multiValidation.totalCount) score += 25;
  else if (multiValidation.validCount > 0) score += 15;
  if (cleanedText.length >= 40 && cleanedText.length <= 5000) score += 10;
  if (/\b(CE|PE|FUT|QTY|LTP|P&L|PNL|AVG|PRICE)\b/i.test(upperText)) score += 20;
  if (broker || detectBrokerPattern(cleanedText)) score += 15;

  return {
    score,
    isLowConfidence: score < 65,
    validation,
    multiValidation,
    tradeCount: effectiveTradeCount,
  };
}

// Keywords that strongly indicate a trading screenshot.
// Intentionally broad — covers Forex, Indian equities, options, and broker UIs.
const FOREX_KEYWORDS = ["buy", "sell", "profit", "loss", "pnl", "p&l", "pip", "lot", "entry", "exit", "trade", "order", "position", "balance", "equity", "margin", "swap", "commission", "eurusd", "gbpusd", "usdjpy", "xauusd", "usdcad", "audusd", "usdchf", "gbpjpy", "gold", "forex", "spread", "drawdown", "us30", "us100", "us500", "nas100", "spx500", "ger40", "uk100", "jp225", "aus200", "dow", "nasdaq", "indices", "index", "cfd"];
const INDIAN_KEYWORDS = ["nifty", "banknifty", "finnifty", "sensex", "bankex", "ce", "pe", "fut", "nse", "bse", "qty", "ltp", "avg", "strike", "premium", "expiry", "zerodha", "upstox", "kite", "groww", "dhan", "fyers", "icici", "kotak", "intraday", "delivery", "options", "futures"];

/**
 * Returns true if the OCR text looks like it came from a trading screenshot.
 * Requires BOTH a price-like number AND at least one trading keyword.
 * A selfie, meme, or random document will have neither.
 */
function isTradeRelatedContent(text, marketType = "Forex") {
  if (!text || text.trim().length < 5) return false;

  const lower = text.toLowerCase();
  const keywords = marketType === "Indian_Market"
    ? [...INDIAN_KEYWORDS, ...FOREX_KEYWORDS]
    : [...FOREX_KEYWORDS, ...INDIAN_KEYWORDS];

  const hasTradeKeyword = keywords.some((kw) => lower.includes(kw));

  // Must have at least one number that looks like a price or P&L value
  // (e.g. 1.23456, 18500, -250.50, +1200)
  const hasPriceNumber = /[+-]?\d{1,6}\.?\d{0,5}/.test(text);

  return hasTradeKeyword && hasPriceNumber;
}

module.exports = {
  cleanOcrText,
  detectBrokerPattern,
  safePositiveNumber,
  safeSignedNumber,
  validateExtractedTrade,
  validateIndianTrade,
  validateIndianTrades,
  calculateConfidenceScore,
  calculateIndianConfidenceScore,
  isTradeRelatedContent,
};
