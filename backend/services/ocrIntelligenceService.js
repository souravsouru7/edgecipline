const sharp = require("sharp");

const FOREX_BROKERS = [
  ["MetaTrader 5", /\b(META\s*TRADER\s*5|MT5)\b/i],
  ["MetaTrader 4", /\b(META\s*TRADER\s*4|MT4)\b/i],
  ["Exness", /\bEXNESS\b/i],
  ["IC Markets", /\bIC\s*MARKETS?\b/i],
  ["FTMO", /\bFTMO\b/i],
  ["Funding Pips", /\bFUNDING\s*PIPS?\b/i],
  ["cTrader", /\bCTRADER\b/i],
];

const INDIAN_BROKERS = [
  ["Zerodha", /\b(ZERODHA|KITE)\b/i],
  ["Upstox", /\b(UPSTOX|RKSV)\b/i],
  ["Angel One", /\bANGEL(?:\s*ONE|\s*BROKING)?\b/i],
  ["Dhan", /\bDHAN\b/i],
  ["Groww", /\bGROWW\b/i],
  ["Fyers", /\bFYERS\b/i],
];

const FOREX_MARKERS = /\b(FOREX|PIPS?|LOTS?|XAUUSD|EURUSD|GBPUSD|USDJPY|NAS100|US30|META\s*TRADER|MT[45]|EXNESS|FTMO|FUNDING\s*PIPS|IC\s*MARKETS)\b/i;
const INDIAN_MARKERS = /\b(ZERODHA|KITE|UPSTOX|ANGEL|DHAN|GROWW|FYERS|NSE|BSE|NIFTY|BANKNIFTY|FINNIFTY|SENSEX|BANKEX|INR)\b/i;

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
}

async function analyzeImageQuality(buffer) {
  const image = sharp(buffer, { failOn: "warning" });
  const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  const pixels = width * height;
  const mean = stats.channels?.length
    ? stats.channels.reduce((sum, channel) => sum + Number(channel.mean || 0), 0) / stats.channels.length
    : 0;
  const sharpness = Number(stats.sharpness || 0);
  const issues = [];
  let score = 100;

  if (width < 480 || height < 480 || pixels < 350000) {
    issues.push("LOW_RESOLUTION");
    score -= 40;
  }
  if (sharpness > 0 && sharpness < 1.2) {
    issues.push("BLURRY");
    score -= 30;
  }
  if (mean > 0 && mean < 28) {
    issues.push("TOO_DARK");
    score -= 25;
  }
  if (width > 0 && height > 0 && (Math.max(width, height) / Math.min(width, height) > 3.5)) {
    issues.push("POSSIBLY_CROPPED");
    score -= 20;
  }
  if ([5, 6, 7, 8].includes(Number(metadata.orientation))) {
    issues.push("ROTATED");
    score -= 10;
  }

  score = clamp(score);
  return {
    score,
    acceptable: score >= 50 && !issues.includes("LOW_RESOLUTION"),
    warning: score < 80 ? "Screenshot quality is poor. Results may be inaccurate." : null,
    issues,
    width,
    height,
    sharpness: Number(sharpness.toFixed(2)),
    brightness: Number(mean.toFixed(1)),
  };
}

function detectBroker(text, fallback = "") {
  const source = String(text || "");
  for (const [broker, pattern] of [...INDIAN_BROKERS, ...FOREX_BROKERS]) {
    if (pattern.test(source)) return broker;
  }
  return String(fallback || "").trim() || null;
}

function detectMarket(text, extracted = {}) {
  const source = `${String(text || "")} ${String(extracted.pair || extracted.symbol || "")}`;
  const indian = (source.match(new RegExp(INDIAN_MARKERS.source, "gi")) || []).length;
  const forex = (source.match(new RegExp(FOREX_MARKERS.source, "gi")) || []).length;
  if (!indian && !forex) return { market: "UNKNOWN", confidence: 0 };
  const market = indian > forex ? "INDIAN" : "FOREX";
  return { market, confidence: clamp((Math.max(indian, forex) / Math.max(2, indian + forex)) * 100) };
}

function marketMismatchMessage(requestedMarket, detectedMarket) {
  if (detectedMarket === "UNKNOWN") return null;
  if (requestedMarket === "Forex" && detectedMarket === "INDIAN") {
    return "This appears to be an Indian Market screenshot. Please upload it from the Indian Market page.";
  }
  if (requestedMarket === "Indian_Market" && detectedMarket === "FOREX") {
    return "This appears to be a Forex screenshot. Please upload it from the Forex page.";
  }
  return null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Real NSE option symbols (e.g. "NIFTY24AUG22500CE") butt the strike digits
// directly against CE/PE with no separator, so \b(CE|PE)\b never matches --
// there's no word boundary between a digit and a letter. Treat a digit (or
// string start/space) before, and string end/space after, as the boundary
// instead of relying on \b.
const CE_PE_SUFFIX_RE = /(?:^|[^A-Z])(CE|PE)(?:$|[^A-Z])/;

function validateTradeLogic(trade = {}, marketType = "Forex") {
  const failures = [];
  const warnings = [];
  const type = String(trade.type || trade.tradeType || trade.orderType || "").toUpperCase();
  const entry = number(trade.entryPrice ?? trade.entry);
  const exit = number(trade.exitPrice ?? trade.exit);
  const profit = number(trade.profit ?? trade.pnl);
  const quantity = number(trade.quantity ?? trade.sharesQty ?? trade.lotSize);

  if (entry != null && exit != null && profit != null) {
    if (type === "BUY" && exit < entry && profit > 0) failures.push("BUY_PROFIT_DIRECTION_MISMATCH");
    if (type === "SELL" && exit > entry && profit > 0) failures.push("SELL_PROFIT_DIRECTION_MISMATCH");
    if (quantity != null && quantity > 0) {
      const expected = (type === "SELL" ? entry - exit : exit - entry) * quantity;
      const tolerance = Math.max(1, Math.abs(profit) * 0.08);
      if (Math.abs(expected - profit) > tolerance) warnings.push("PNL_RECALCULATION_MISMATCH");
    }
  }

  if (marketType === "Indian_Market") {
    const pair = String(trade.pair || trade.symbol || "").toUpperCase();
    const optionType = String(trade.optionType || pair.match(CE_PE_SUFFIX_RE)?.[1] || "").toUpperCase();
    if (CE_PE_SUFFIX_RE.test(pair) && !["CE", "PE"].includes(optionType)) failures.push("INVALID_OPTION_TYPE");
    if (["CE", "PE"].includes(optionType) && !(number(trade.strikePrice ?? trade.strike) > 0)) failures.push("INVALID_STRIKE");
  } else {
    const pair = String(trade.pair || trade.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (pair && !/^(?:[A-Z]{6}|XAUUSD|XAGUSD|BTCUSD|ETHUSD|NAS100|US30|US100|SPX500|GER40|UK100|JP225)$/.test(pair)) {
      warnings.push("UNRECOGNIZED_FOREX_SYMBOL");
    }
    if (quantity != null && quantity <= 0) failures.push("INVALID_LOT_SIZE");
  }

  return { isValid: failures.length === 0, failures, warnings };
}

function buildConfidenceReport({ quality, broker, marketDetection, extractionScore, validation, trades = [] }) {
  const rows = trades.length ? trades : [{}];
  const logicResults = rows.map((trade) => validateTradeLogic(trade, marketDetection.requestedMarket));
  const logicValid = logicResults.every((result) => result.isValid);
  const components = {
    imageQuality: clamp(quality?.score ?? 0),
    ocrConfidence: clamp(extractionScore ?? 0),
    brokerMatch: broker ? 100 : 40,
    marketMatch: marketDetection.market === "UNKNOWN" ? 50 : marketDetection.matches ? 100 : 0,
    fieldMatch: validation?.isValid ? 100 : 40,
    tradeLogic: logicValid ? 100 : 25,
  };
  const score = clamp(
    components.imageQuality * 0.15 + components.ocrConfidence * 0.25 +
    components.brokerMatch * 0.1 + components.marketMatch * 0.15 +
    components.fieldMatch * 0.15 + components.tradeLogic * 0.2
  );
  const decision = score >= 95 && logicValid && validation?.isValid
    ? "AUTO_APPROVED"
    : score >= 80 ? "REVIEW_RECOMMENDED" : "VERIFICATION_REQUIRED";

  return { score, decision, components, logic: logicResults };
}

module.exports = {
  analyzeImageQuality,
  buildConfidenceReport,
  detectBroker,
  detectMarket,
  marketMismatchMessage,
  validateTradeLogic,
};
