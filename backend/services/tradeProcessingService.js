const Trade = require("../models/Trade");
const ExtractionLog = require("../models/ExtractionLog");
const { TRADE_CACHE_EVENTS, invalidateTradeCaches } = require("../utils/cacheUtils");
const { buildCacheKey, setCache } = require("../utils/cache");
const { extractText } = require("./ocrService");
const { extractTextWithVision, isVisionAvailable } = require("./visionOcrService");
const { extractIndianTradeWithAI, extractEquityIntradayWithAI, extractTradeWithAI, extractTradeWithGeminiVision } = require("./aiExtractionService");
const {
  parseTrade,
  parseIndianTrade,
  parseTradesFromOCR,
  parseForexTradesFromOCR,
  parseEquityIntradayTrade,
  parseEquityIntradayTrades,
} = require("./parsingService");
const cloudinary = require("../config/cloudinary");
const {
  cleanOcrText,
  detectBrokerPattern,
  validateExtractedTrade,
  validateIndianTrade,
  validateIndianTrades,
  calculateConfidenceScore,
  calculateIndianConfidenceScore,
  isTradeRelatedContent,
} = require("./extractionQualityService");
const { logger } = require("../utils/logger");
const { appConfig } = require("../config");
const { evaluateSmartNotifications } = require("./smartNotificationEvaluator");

const PROCESSING_TIMEOUT_MS = appConfig.timeouts.processingTimeoutMs;
const CONFIDENCE_ZONES = {
  rejectMax: 9,
  reviewMax: 59,
};
const MAX_OCR_TEXT_LENGTH = 50_000;
const MAX_AI_RESPONSE_LENGTH = 50_000;

function createProcessingCancelledError(message = "OCR job cancelled") {
  const error = new Error(message);
  error.code = "OCR_JOB_CANCELLED";
  return error;
}

async function runCancellationCheck(checkCancellation, stage) {
  if (typeof checkCancellation !== "function") return;
  const cancelled = await checkCancellation(stage);
  if (cancelled) {
    throw createProcessingCancelledError();
  }
}

function truncateField(value, maxLength) {
  const s = String(value || "");
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}

function logExtractedTrades({ tradeId, stage, parsedTrade, parsedTrades }) {
  const multiTrades = Array.isArray(parsedTrades) ? parsedTrades.filter(Boolean) : [];

  if (multiTrades.length > 0) {
    logger.info(`${stage} | tradeId=${tradeId} | extractedTrades=${multiTrades.length}`, {
      tradeId,
      stage,
      count: multiTrades.length,
      trades: multiTrades,
    });
    return;
  }

  if (parsedTrade && Object.keys(parsedTrade).length > 0) {
    logger.info(`${stage} | tradeId=${tradeId}`, {
      tradeId,
      stage,
      trade: parsedTrade,
    });
  } else {
    logger.warn(`${stage} | tradeId=${tradeId} | no structured trade extracted`, {
      tradeId,
      stage,
    });
  }
}

function logIndianOptionExtractionDebug({ tradeId, stage, cleanedText = "", aiRawResponse = "", parsedTrade = {}, parsedTrades = [] }) {
  const multiTrades = Array.isArray(parsedTrades) ? parsedTrades.filter(Boolean) : [];
  logger.warn(`Indian options debug | tradeId=${tradeId} | ${stage}`, {
    tradeId,
    stage,
    ocrPreview: cleanedText ? cleanedText.slice(0, 1200) : "",
    aiPreview: aiRawResponse ? aiRawResponse.slice(0, 1200) : "",
    parsedTrade,
    parsedTrades: multiTrades,
    parsedTradesCount: multiTrades.length,
  });
}

function normalizeTradeType(type) {
  const normalized = String(type || "").toUpperCase();
  return normalized === "BUY" || normalized === "SELL" ? normalized : undefined;
}

function withTimeout(promise, message, timeoutMs = PROCESSING_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  // Prevent the original promise from producing an unhandled rejection after
  // the timeout wins the race. Without this, a Gemini Vision call that keeps
  // running past the deadline eventually rejects with nothing catching it,
  // which crashes the worker process and triggers a PM2 restart.
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isWeakOcrText(text) {
  const cleaned = cleanOcrText(text);
  return !cleaned || cleaned.length < 20;
}

/**
 * Extracts a Cloudinary public_id from a secure_url.
 * e.g. https://res.cloudinary.com/cloud/image/upload/v123/trades/abc.jpg → trades/abc
 */
function extractCloudinaryPublicId(url) {
  try {
    const match = String(url || "").match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^./]+)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Marks a trade as failed with NOT_A_TRADE_IMAGE and deletes its Cloudinary image.
 * Called when we're confident the uploaded image is not a broker screenshot.
 */
async function rejectNonTradeImage(tradeId, trade, userMessage) {
  await Trade.findByIdAndUpdate(tradeId, {
    status: "failed",
    error: userMessage,
    processedAt: new Date(),
  });

  // Delete from Cloudinary so it doesn't consume storage
  const imageUrl = trade.imageUrl || trade.screenshot;
  const publicId = extractCloudinaryPublicId(imageUrl);
  if (publicId) {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" }).catch((err) => {
      logger.warn("Failed to delete non-trade image from Cloudinary", { publicId, error: err.message });
    });
  }

  await logExtraction({
    trade,
    extractedText: "",
    parsedTrade: null,
    parsedTrades: [],
    aiUsed: false,
    errorMessage: userMessage,
  });

  await invalidateTradeCaches({
    userId: trade.user,
    event: TRADE_CACHE_EVENTS.DELETE,
    market: trade.marketType || "Forex",
    tradeId,
    source: "ocr_reject",
  });

  logger.warn("Non-trade image rejected and deleted", { tradeId, publicId, userMessage });
}

function safeParseTrade(text) {
  try {
    const result = parseTrade(text || "");
    return { data: result, error: null };
  } catch (error) {
    logger.warn("Trade parse error", { error: error.message });
    return { data: null, error: error.message };
  }
}

function safeParseIndianTrade(text, options) {
  try {
    return parseIndianTrade(text || "", options || {});
  } catch (error) {
    logger.error("Safe parseIndianTrade failed", {
      error: error.message,
      stack: error.stack,
    });
    return {};
  }
}

function safeParseTradesFromOCR(text, options) {
  try {
    return parseTradesFromOCR(text || "", options || {});
  } catch (error) {
    logger.error("Safe parseTradesFromOCR failed", {
      error: error.message,
      stack: error.stack,
    });
    return [];
  }
}

function safeParseForexTradesFromOCR(text) {
  try {
    return parseForexTradesFromOCR(text || "");
  } catch (error) {
    logger.error("Safe parseForexTradesFromOCR failed", {
      error: error.message,
      stack: error.stack,
    });
    return [];
  }
}

function safeParseEquityTrade(text, options) {
  try {
    return parseEquityIntradayTrade(text || "", options || {});
  } catch (error) {
    logger.error("Safe parseEquityIntradayTrade failed", { error: error.message });
    return {};
  }
}

function safeParseEquityTrades(text, options) {
  try {
    return parseEquityIntradayTrades(text || "", options || {});
  } catch (error) {
    logger.error("Safe parseEquityIntradayTrades failed", { error: error.message });
    return [];
  }
}

function mergeEquityAiData(parsedTrade, aiData) {
  if (!aiData) return parsedTrade;
  const merged = { ...parsedTrade };
  // AI (Gemini Vision / text AI) takes precedence over OCR regex — it reads the image
  // directly and understands context; OCR regex is a dumb pattern match.
  const aiSymbol = String(aiData.stockSymbol || "").trim().toUpperCase();
  const parsedSymbol = String(parsedTrade?.stockSymbol || "").trim().toUpperCase();
  const aiSymbolLooksTruncated =
    aiSymbol &&
    parsedSymbol &&
    aiSymbol.length <= 3 &&
    parsedSymbol.length > aiSymbol.length &&
    parsedSymbol.endsWith(aiSymbol);
  const parsedSymbolIsBetterRowMatch =
    aiSymbol &&
    parsedSymbol &&
    aiSymbol.length <= 3 &&
    parsedSymbol.length > 3;
  if (aiSymbol && !aiSymbolLooksTruncated && !parsedSymbolIsBetterRowMatch) merged.stockSymbol = aiSymbol;
  else if (parsedSymbol) merged.stockSymbol = parsedSymbol;
  if (aiData.exchange) merged.exchange = aiData.exchange;
  if (aiData.sharesQty != null && aiData.sharesQty > 0) merged.sharesQty = aiData.sharesQty;
  if (aiData.type) merged.type = aiData.type;
  if (aiData.entryPrice != null && aiData.entryPrice > 0) merged.entryPrice = aiData.entryPrice;
  if (aiData.exitPrice != null && aiData.exitPrice > 0) merged.exitPrice = aiData.exitPrice;
  const parsedHasBetterSymbol =
    parsedSymbol &&
    aiSymbol &&
    aiSymbol.length <= 3 &&
    parsedSymbol.length > aiSymbol.length;
  if (aiData.profit != null && !parsedHasBetterSymbol) merged.profit = aiData.profit;
  if (aiData.broker) merged.broker = aiData.broker;
  if (aiData.sector) merged.sector = aiData.sector;
  merged.instrumentType = "EQUITY";
  merged.segment = "EQUITY";
  merged.tradeType = aiData.productType === "DELIVERY" ? "DELIVERY" : (parsedTrade.tradeType || "INTRADAY");
  if (merged.stockSymbol && !merged.pair) {
    merged.pair = merged.stockSymbol;
  }
  return merged;
}

async function downloadImageBuffer(imageUrl) {
  const res = await withTimeout(fetch(imageUrl), "Image download", 30000);
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

// Returns { text, buffer, mimeType, ocrFailed } — always returns the image buffer so
// Gemini Vision can reuse it without a second download, even when OCR itself fails.
async function runOcrWithRetry(imagePath) {
  // Download the image once upfront — separate from OCR so the buffer is always
  // available to the caller even if Tesseract/Vision times out.
  let imageBuffer, imageMimeType;
  try {
    const result = await downloadImageBuffer(imagePath);
    imageBuffer = result.buffer;
    imageMimeType = result.mimeType;
  } catch (error) {
    // Image itself is unreachable — nothing downstream can help.
    throw error;
  }

  // 1. Google Cloud Vision — most accurate, handles complex broker UIs
  if (isVisionAvailable()) {
    try {
      logger.info("OCR: trying Google Cloud Vision (primary)");
      const result = await withTimeout(
        extractTextWithVision(imageBuffer),
        "Google Vision OCR timeout",
        PROCESSING_TIMEOUT_MS
      );
      if (result?.text && result.text.trim().length > 20) {
        logger.info("OCR: Google Cloud Vision succeeded", { textLength: result.text.length });
        return { text: result.text, buffer: imageBuffer, mimeType: imageMimeType };
      }
      logger.warn("OCR: Google Cloud Vision returned empty text, falling back to Tesseract");
    } catch (error) {
      logger.warn("OCR: Google Cloud Vision failed, falling back to Tesseract", {
        error: error.message,
      });
    }
  }

  // 2. Tesseract — last resort
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      logger.info(`OCR: Tesseract attempt ${attempt}`);
      const text = await withTimeout(extractText(imageBuffer), "Processing timeout");
      return { text, buffer: imageBuffer, mimeType: imageMimeType };
    } catch (error) {
      logger.error(`OCR: Tesseract attempt ${attempt} failed`, { attempt, error: error.message });
    }
  }

  // OCR exhausted — return empty text but keep the buffer for Gemini Vision
  logger.warn("OCR failed after all attempts — returning buffer for Gemini Vision fallback");
  return { text: "", buffer: imageBuffer, mimeType: imageMimeType, ocrFailed: true };
}

async function runAiWithRetry({ marketType, tradeSubType = "OPTION", text, includeRawResponse = true, brokerHint = "", expectedMultiple = false }) {
  const isEquity = marketType === "Indian_Market" && tradeSubType === "EQUITY";
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      logger.info(`AI attempt ${attempt} started | marketType=${marketType}`, {
        attempt,
        marketType,
      });
      const result = await withTimeout(
        isEquity
          ? extractEquityIntradayWithAI(text, { includeRawResponse, brokerHint })
          : marketType === "Indian_Market"
          ? extractIndianTradeWithAI(text, {
              includeRawResponse,
              improvedPrompt: attempt === 2,
              brokerHint,
              expectedMultiple,
            })
          : extractTradeWithAI(text, {
              marketType,
              includeRawResponse,
            }),
        "Processing timeout"
      );

      // If AI returned nothing or couldn't be parsed, we treat it as non-fatal.
      // The pipeline can continue using OCR-only extraction and mark for review.
      if (!result) {
        lastError = new Error("Empty AI response");
        logger.warn(`AI returned empty result | marketType=${marketType} | attempt=${attempt}`, {
          marketType,
          attempt,
        });
        continue;
      }

      return result;
    } catch (error) {
      lastError = error;
      logger.error(`AI attempt ${attempt} failed`, {
        attempt,
        marketType,
        error: error.message,
        stack: error.stack,
      });
    }
  }

  // Non-fatal: let the caller continue with OCR-only values.
  logger.warn(`AI extraction failed after retries | marketType=${marketType}`, {
    marketType,
    lastError: lastError?.message,
  });
  return null;
}

function mergeIndianAiData(parsedTrade, aiData) {
  if (!aiData) return parsedTrade;

  const merged = { ...parsedTrade };
  // AI overrides OCR — wrong strike/optionType from OCR regex must not survive
  if (aiData.pair) merged.pair = aiData.pair;
  if (aiData.profit != null) merged.profit = aiData.profit;
  if (aiData.quantity != null && aiData.quantity > 0) merged.quantity = aiData.quantity;
  if (aiData.strikePrice != null && aiData.strikePrice > 0) merged.strikePrice = aiData.strikePrice;
  if (aiData.optionType) merged.optionType = aiData.optionType;
  if (aiData.underlying) merged.underlying = aiData.underlying;
  if (aiData.entryPrice != null && aiData.entryPrice > 0) merged.entryPrice = aiData.entryPrice;
  if (aiData.exitPrice != null && aiData.exitPrice > 0) merged.exitPrice = aiData.exitPrice;
  if (aiData.broker) merged.broker = aiData.broker;
  return merged;
}

function mergeIndianAiTrades(parsedTrades = [], aiTrades = [], broker = "") {
  const existingTrades = Array.isArray(parsedTrades) ? parsedTrades : [];
  const incomingTrades = Array.isArray(aiTrades) ? aiTrades : [];

  if (incomingTrades.length === 0) {
    return existingTrades;
  }

  if (existingTrades.length === 0) {
    return incomingTrades.map((trade) => ({
      symbol: trade.underlying || trade.pair?.split(" ")[0] || "",
      strike: trade.strikePrice ?? null,
      optionType: trade.optionType || null,
      quantity: trade.quantity ?? null,
      entryPrice: trade.entryPrice ?? null,
      pnl: trade.profit ?? null,
      broker: trade.broker || broker || "",
      tradeType: trade.productType === "DELIVERY" ? "DELIVERY" : "INTRADAY",
    }));
  }

  return existingTrades.map((trade, index) => {
    const aiTrade = incomingTrades[index];
    if (!aiTrade) {
      return {
        ...trade,
        ...(broker && !trade.broker ? { broker } : {}),
      };
    }

    // AI overrides OCR per-row — AI reads context, OCR regex misses expiry/strike typos
    return {
      ...trade,
      symbol: aiTrade.underlying || aiTrade.pair?.split(" ")[0] || trade.symbol,
      strike: (aiTrade.strikePrice != null && aiTrade.strikePrice > 0) ? aiTrade.strikePrice : trade.strike ?? null,
      optionType: aiTrade.optionType || trade.optionType || null,
      quantity: (aiTrade.quantity != null && aiTrade.quantity > 0) ? aiTrade.quantity : trade.quantity ?? null,
      entryPrice: (aiTrade.entryPrice != null && aiTrade.entryPrice > 0) ? aiTrade.entryPrice : trade.entryPrice ?? null,
      pnl: aiTrade.profit ?? trade.pnl ?? null,
      broker: aiTrade.broker || trade.broker || broker || "",
      tradeType: aiTrade.productType === "DELIVERY" ? "DELIVERY" : (trade.tradeType || "INTRADAY"),
    };
  });
}

function buildIndianTradeFromParsedRow(row = {}, fallbackBroker = "") {
  const symbol = String(row.symbol || "").trim().toUpperCase();
  const optionType = String(row.optionType || "").trim().toUpperCase();
  const strike = row.strike ?? null;
  return {
    pair: symbol && strike != null && optionType ? `${symbol} ${strike} ${optionType}` : null,
    underlying: symbol || null,
    optionType: optionType === "CE" || optionType === "PE" ? optionType : null,
    strikePrice: strike,
    quantity: row.quantity ?? null,
    entryPrice: row.entryPrice ?? null,
    profit: row.pnl ?? null,
    broker: row.broker || fallbackBroker || "",
    tradeType: row.tradeType || "INTRADAY",
  };
}

function inferIndianTradeSubType(data) {
  const rows = [data, ...(Array.isArray(data?.trades) ? data.trades : [])].filter(Boolean);
  if (rows.length === 0) return null;

  const hasOptionSignals = rows.some((row) => {
    const pair = String(row?.pair || "").toUpperCase();
    const optionType = String(row?.optionType || "").toUpperCase();
    return (
      optionType === "CE" ||
      optionType === "PE" ||
      row?.strikePrice != null ||
      /\b(CE|PE|CALL|PUT|FUT)\b/.test(pair)
    );
  });
  if (hasOptionSignals) return "OPTION";

  const hasEquitySignals = rows.some((row) => {
    const instrumentType = String(row?.instrumentType || "").toUpperCase();
    return (
      instrumentType === "EQUITY" ||
      !!row?.stockSymbol ||
      row?.sharesQty != null ||
      row?.exchange === "NSE" ||
      row?.exchange === "BSE"
    );
  });
  if (hasEquitySignals) return "EQUITY";

  return null;
}

function isIndianExtractionWeak({ parsedTrade, parsedTrades }) {
  const singleValidation = validateIndianTrade(parsedTrade);
  const multiValidation = validateIndianTrades(parsedTrades);

  if (multiValidation.totalCount > 0) {
    return multiValidation.validCount === 0 || multiValidation.validCount < multiValidation.totalCount;
  }

  return !singleValidation.isValid;
}

function mergeGenericAiData(parsedTrade, aiData) {
  if (!aiData) return parsedTrade;

  // AI overrides OCR — pair names and prices from Gemini are more reliable than regex
  return {
    ...parsedTrade,
    pair: aiData.pair || parsedTrade?.pair || null,
    type: aiData.type || parsedTrade?.type || parsedTrade?.action || null,
    quantity: aiData.quantity ?? parsedTrade?.quantity ?? parsedTrade?.lotSize ?? null,
    lotSize: parsedTrade?.lotSize ?? aiData.quantity ?? null,
    entryPrice: (aiData.entryPrice != null && aiData.entryPrice > 0) ? aiData.entryPrice : parsedTrade?.entryPrice ?? null,
    exitPrice: (aiData.exitPrice != null && aiData.exitPrice > 0) ? aiData.exitPrice : parsedTrade?.exitPrice ?? null,
    profit: aiData.profit ?? parsedTrade?.profit ?? null,
    stopLoss: (aiData.stopLoss != null && aiData.stopLoss > 0) ? aiData.stopLoss : parsedTrade?.stopLoss ?? null,
    takeProfit: (aiData.takeProfit != null && aiData.takeProfit > 0) ? aiData.takeProfit : parsedTrade?.takeProfit ?? null,
    broker: aiData.broker || parsedTrade?.broker || null,
    strikePrice: (aiData.strikePrice != null && aiData.strikePrice > 0) ? aiData.strikePrice : parsedTrade?.strikePrice ?? null,
    optionType: aiData.optionType || parsedTrade?.optionType || null,
    underlying: aiData.underlying || parsedTrade?.underlying || null,
  };
}

function omitUndefinedFields(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  );
}

function buildTradeUpdate({
  trade,
  parsedTrade,
  parsedTrades,
  extractedText,
  aiRawResponse,
  confidenceScore,
  isValid,
  needsReview,
  validationFailures,
}) {
  const tradeDateUpdate = trade.tradeDate
    ? { tradeDate: trade.tradeDate }
    : {};

  return omitUndefinedFields({
    pair: parsedTrade?.pair || trade.pair || undefined,
    type: normalizeTradeType(parsedTrade?.type || parsedTrade?.action) || trade.type || undefined,
    quantity: parsedTrade?.quantity ?? trade.quantity ?? undefined,
    lotSize: parsedTrade?.lotSize ?? trade.lotSize ?? undefined,
    entryPrice: parsedTrade?.entryPrice ?? trade.entryPrice ?? undefined,
    exitPrice: parsedTrade?.exitPrice ?? trade.exitPrice ?? undefined,
    stopLoss: parsedTrade?.stopLoss ?? trade.stopLoss ?? undefined,
    takeProfit: parsedTrade?.takeProfit ?? trade.takeProfit ?? undefined,
    profit: parsedTrade?.profit ?? trade.profit ?? undefined,
    commission: parsedTrade?.commission ?? trade.commission ?? undefined,
    swap: parsedTrade?.swap ?? trade.swap ?? undefined,
    balance: parsedTrade?.balance ?? trade.balance ?? undefined,
    session: parsedTrade?.session ?? trade.session ?? undefined,
    ...tradeDateUpdate,
    broker: parsedTrade?.broker || trade.broker || "",
    segment: parsedTrade?.segment || trade.segment || "",
    instrumentType: parsedTrade?.instrumentType || trade.instrumentType || "",
    strikePrice: parsedTrade?.strikePrice ?? trade.strikePrice ?? undefined,
    expiryDate: parsedTrade?.expiryDate || trade.expiryDate || "",
    // Equity intraday fields
    stockSymbol: parsedTrade?.stockSymbol || trade.stockSymbol || undefined,
    exchange: parsedTrade?.exchange || trade.exchange || undefined,
    sharesQty: parsedTrade?.sharesQty ?? trade.sharesQty ?? undefined,
    sector: parsedTrade?.sector || trade.sector || undefined,
    tradeType: parsedTrade?.tradeType || trade.tradeType || undefined,
    tradeSubType: trade.tradeSubType || undefined,
    extractedText: truncateField(extractedText, MAX_OCR_TEXT_LENGTH),
    rawOCRText: truncateField(extractedText, MAX_OCR_TEXT_LENGTH),
    aiRawResponse: truncateField(aiRawResponse, MAX_AI_RESPONSE_LENGTH),
    extractionConfidence: confidenceScore ?? 0,
    isValid,
    needsReview,
    parsedData: {
      parsedTrade,
      validation: {
        isValid,
        failures: validationFailures,
        confidenceScore: confidenceScore ?? 0,
      },
      ...(Array.isArray(parsedTrades) && parsedTrades.length > 0 ? { parsedTrades } : {}),
    },
    status: "completed",
    error: needsReview ? (validationFailures.join(", ") || "Needs manual review") : null,
    processedAt: new Date(),
  });
}

async function logExtraction({ trade, extractedText, parsedTrade, parsedTrades, aiUsed, errorMessage }) {
  try {
    await ExtractionLog.create({
      user: trade.user,
      imageUrl: trade.imageUrl || trade.screenshot,
      marketType: trade.marketType || "Forex",
      extractedText,
      parsedData: parsedTrades && parsedTrades.length > 0 ? { parsedTrade, parsedTrades } : parsedTrade,
      isSuccess: !errorMessage,
      aiUsed: !!aiUsed,
      errorMessage: errorMessage || undefined,
    });
    logger.info(`Extraction log saved | tradeId=${trade._id}`, {
      tradeId: trade._id,
      success: !errorMessage,
      aiUsed,
    });
  } catch (error) {
    logger.error("Failed to save extraction log", {
      error: error.message,
      stack: error.stack,
      tradeId: trade._id,
    });
  }
}

async function findTradeWithRetry(tradeId) {
  const delays = [500, 1000, 2000];
  for (const delay of delays) {
    const trade = await Trade.findById(tradeId);
    if (trade) return trade;
    await new Promise((r) => setTimeout(r, delay));
  }
  return Trade.findById(tradeId);
}

async function processTradeUpload({
  tradeId,
  ocrJobId,
  imageUrl,
  imagePath,
  jobId,
  attempt = 1,
  tradeRecord = null,
  persistTrade = true,
  checkCancellation = null,
}) {
  const processingId = tradeId || ocrJobId || tradeRecord?._id?.toString?.() || jobId || "unknown";
  if (persistTrade && !tradeId) {
    const error = new Error("OCR payload missing tradeId");
    error.code = "OCR_INVALID_PAYLOAD";
    error.nonRetryable = true;
    throw error;
  }
  if (!persistTrade && !tradeRecord) {
    const error = new Error("OCR payload missing OCR job record");
    error.code = "OCR_INVALID_PAYLOAD";
    error.nonRetryable = true;
    throw error;
  }
  tradeId = processingId;

  const trade = tradeRecord || await findTradeWithRetry(tradeId);
  if (!trade) {
    const error = new Error(persistTrade ? "Trade not found" : "OCR job not found");
    error.code = persistTrade ? "TRADE_NOT_FOUND" : "OCR_JOB_NOT_FOUND";
    error.nonRetryable = true;
    throw error;
  }

  const sourceImage =
    imageUrl ||
    imagePath ||
    trade.imageUrl ||
    trade.screenshot ||
    trade.uploadedImage?.imageUrl;
  if (!sourceImage) {
    const error = new Error("No image URL available for OCR processing");
    error.code = "OCR_INVALID_PAYLOAD";
    error.nonRetryable = true;
    throw error;
  }

  await runCancellationCheck(checkCancellation, "before-status-update");

  if (persistTrade) {
    await Trade.findByIdAndUpdate(tradeId, {
      status: "processing",
      ocrJobId: jobId || trade.ocrJobId || tradeId,
      ocrAttempts: attempt,
      processingStartedAt: trade.processingStartedAt || new Date(),
      error: null,
    });
  }

  return withTimeout((async () => {
    const marketType = trade.marketType || "Forex";
    let tradeSubType = trade.tradeSubType || "OPTION";
    let isEquityIntraday = marketType === "Indian_Market" && tradeSubType === "EQUITY";
    let extractedText = "";
    let ocrSkipped = false;
    let ocrImageBuffer = null;
    let ocrImageMimeType = "image/jpeg";

    await runCancellationCheck(checkCancellation, "before-ocr");
    try {
      const ocrResult = await runOcrWithRetry(sourceImage);
      await runCancellationCheck(checkCancellation, "after-ocr");
      extractedText = ocrResult.text;
      ocrImageBuffer = ocrResult.buffer;
      ocrImageMimeType = ocrResult.mimeType;
      if (ocrResult.ocrFailed) {
        ocrSkipped = true;
        logger.warn(`OCR text extraction failed | tradeId=${processingId} | image buffer retained for Gemini Vision`, { tradeId: processingId });
      }
    } catch (error) {
      // Image download itself failed — no buffer available
      ocrSkipped = true;
      logger.warn(`OCR failed (image unreachable) | tradeId=${processingId} | falling back to AI-only extraction`, {
        tradeId: processingId,
        reason: error.message,
      });
    }

    const cleanedText = cleanOcrText(extractedText);
    await runCancellationCheck(checkCancellation, "before-parsing");
    // Treat as weak if OCR was skipped or produced too little text
    const weakOcr = ocrSkipped || isWeakOcrText(cleanedText);
    const broker = detectBrokerPattern(cleanedText, trade.broker || undefined);

    logger.info(`OCR output | tradeId=${processingId}`, {
      tradeId: processingId,
      textLength: cleanedText.length,
      broker,
      weakOcr: weakOcr,
    });
    if (marketType === "Indian_Market" && !isEquityIntraday) {
      logIndianOptionExtractionDebug({ tradeId, stage: "ocr-output", cleanedText });
    }

    if (cleanedText.length < 1000) {
      logger.debug(`OCR text preview | tradeId=${tradeId}`, { text: cleanedText });
    } else {
      logger.debug(`OCR text preview | tradeId=${tradeId}`, { text: cleanedText.slice(0, 1000) });
    }

    // Early rejection: if OCR produced text but it contains zero trading signals,
    // this is almost certainly not a trade screenshot. Skip AI (saves API credits)
    // and reject immediately with a clear error.
    if (!ocrSkipped && !isTradeRelatedContent(cleanedText, marketType)) {
      logger.warn(`Non-trade image detected (no trading keywords) | tradeId=${tradeId}`, { tradeId, textLength: cleanedText.length });
      if (!persistTrade) {
        const err = new Error("Image does not appear to be a trade screenshot. Please upload a screenshot from your broker platform.");
        err.code = "NOT_A_TRADE_IMAGE";
        throw err;
      }
      await rejectNonTradeImage(tradeId, trade, "Image does not appear to be a trade screenshot. Please upload a screenshot from your broker platform.");
      return { tradeId, status: "failed", reason: "NOT_A_TRADE_IMAGE" };
    }

    let aiData = null;
    let aiRawResponse = "";
    let parsedTrade = {};
    let parsedTrades = [];
    let geminiVisionUsed = false;
    let quality = null;

    if (!weakOcr) {
      if (isEquityIntraday) {
        parsedTrade = safeParseEquityTrade(cleanedText, { broker });
        parsedTrades = safeParseEquityTrades(cleanedText, { broker });
      } else if (marketType === "Indian_Market") {
        parsedTrade = safeParseIndianTrade(cleanedText, { broker });
        parsedTrades = safeParseTradesFromOCR(cleanedText, { broker });
      } else {
        const { data: parsed, error: parseError } = safeParseTrade(cleanedText);
        if (parseError || !parsed) {
          logger.warn("OCR parse error or empty result", { parseError });
          parsedTrade = {};
        } else {
          parsedTrade = parsed;
        }
        parsedTrades = safeParseForexTradesFromOCR(cleanedText);
      }

      logExtractedTrades({ tradeId, stage: "OCR-first extraction", parsedTrade, parsedTrades });
      if (marketType === "Indian_Market" && !isEquityIntraday) {
        logIndianOptionExtractionDebug({
          tradeId,
          stage: "ocr-first",
          cleanedText,
          parsedTrade,
          parsedTrades,
        });
      }
    }

    quality = marketType === "Indian_Market"
      ? calculateIndianConfidenceScore({ parsedTrade, parsedTrades, ocrText: cleanedText, broker })
      : calculateConfidenceScore({ parsedTrade, ocrText: cleanedText });

    const shouldAttemptGeminiVision =
      weakOcr ||
      (marketType === "Indian_Market" ? isIndianExtractionWeak({ parsedTrade, parsedTrades }) : false) ||
      !quality.validation.isValid ||
      quality.isLowConfidence;

    logger.info(`OCR-first confidence score | tradeId=${tradeId}`, {
      tradeId,
      score: quality.score,
      isValid: quality.validation.isValid,
      isLowConfidence: quality.isLowConfidence,
      shouldAttemptGeminiVision,
    });

    // ── Primary extraction: Gemini Vision reads the image directly ──────────
    // Runs on every upload regardless of OCR quality. Direct image → JSON is
    // more accurate than OCR text → AI because it avoids all OCR corruption.
    // Retried once on failure — a single network blip should not drop us to Tesseract.
    if (shouldAttemptGeminiVision) {
    try {
      let visionData = null;
      for (let vAttempt = 1; vAttempt <= 2; vAttempt++) {
        await runCancellationCheck(checkCancellation, "before-gemini-vision");
        try {
          visionData = await withTimeout(
            extractTradeWithGeminiVision(sourceImage, {
              marketType,
              tradeSubType,
              imageBuffer: ocrImageBuffer,
              imageMimeType: ocrImageMimeType,
            }),
            "Gemini Vision timeout"
          );
          await runCancellationCheck(checkCancellation, "after-gemini-vision");
          if (visionData) break;
          logger.warn(`Gemini Vision returned null | tradeId=${tradeId} | attempt=${vAttempt}`, { tradeId, vAttempt });
        } catch (vErr) {
          if (vErr.code === "WRONG_MARKET_TYPE") throw vErr;
          logger.warn(`Gemini Vision attempt ${vAttempt} failed | tradeId=${tradeId}`, { tradeId, vAttempt, error: vErr.message });
          if (vAttempt === 2) visionData = null;
        }
      }

      if (visionData) {
        if (marketType === "Indian_Market") {
          const inferredSubType = inferIndianTradeSubType(visionData);
          if (inferredSubType && inferredSubType !== tradeSubType) {
            logger.warn(`Indian subtype mismatch corrected by AI | tradeId=${tradeId}`, {
              tradeId,
              requestedSubType: tradeSubType,
              inferredSubType,
            });
            tradeSubType = inferredSubType;
            isEquityIntraday = tradeSubType === "EQUITY";
          }
        }

        aiData = visionData;
        aiRawResponse = visionData.rawResponse || "";
        geminiVisionUsed = true;
        logger.info(`Gemini Vision primary extraction succeeded | tradeId=${tradeId}`, { tradeId, marketType });

        if (isEquityIntraday) {
          const ocrEquityTrade = safeParseEquityTrade(cleanedText, { broker });
          const ocrEquityTrades = safeParseEquityTrades(cleanedText, { broker });
          parsedTrade = mergeEquityAiData(ocrEquityTrade, aiData);
          parsedTrades = ocrEquityTrades.length > 0
            ? ocrEquityTrades.map((t, index) => mergeEquityAiData(t, aiData?.trades?.[index] || {}))
            : Array.isArray(aiData?.trades) ? aiData.trades.map((t) => mergeEquityAiData(ocrEquityTrade, t)) : [];
          if (parsedTrades.length > 0) parsedTrade = parsedTrades[0];
        } else if (marketType === "Indian_Market") {
          parsedTrade = mergeIndianAiData({}, aiData);
          parsedTrades = mergeIndianAiTrades([], aiData?.trades || [], broker || aiData.broker || "");
        } else {
          parsedTrade = mergeGenericAiData({}, aiData);
          parsedTrades = Array.isArray(aiData?.trades) && aiData.trades.length > 0
            ? aiData.trades.map((t) => mergeGenericAiData({}, t))
            : [];
        }

        logExtractedTrades({ tradeId, stage: "Gemini Vision extraction", parsedTrade, parsedTrades });
        if (marketType === "Indian_Market" && !isEquityIntraday) {
          logIndianOptionExtractionDebug({
            tradeId,
            stage: "gemini-vision",
            cleanedText,
            aiRawResponse,
            parsedTrade,
            parsedTrades,
          });
        }
      }
    } catch (err) {
      if (err.code === "WRONG_MARKET_TYPE") throw err;
      logger.warn(`Gemini Vision step error | tradeId=${tradeId}`, { error: err.message });
    }
    }

    // ── OCR-based parsing (runs when Gemini Vision unavailable or failed) ───
    if (!geminiVisionUsed && Object.keys(parsedTrade || {}).length === 0 && parsedTrades.length === 0) {
      if (isEquityIntraday && !weakOcr) {
        parsedTrade = safeParseEquityTrade(cleanedText, { broker });
        parsedTrades = safeParseEquityTrades(cleanedText, { broker });
      } else if (marketType === "Indian_Market" && !weakOcr) {
        parsedTrade = safeParseIndianTrade(cleanedText, { broker });
        parsedTrades = safeParseTradesFromOCR(cleanedText, { broker });
      } else if (!weakOcr) {
        const { data: parsed, error: parseError } = safeParseTrade(cleanedText);
        if (parseError || !parsed) {
          logger.warn("OCR parse error or empty result", { parseError });
          parsedTrade = {};
        } else {
          parsedTrade = parsed;
        }
        parsedTrades = safeParseForexTradesFromOCR(cleanedText);
      } else {
        logger.warn(`Weak OCR detected | tradeId=${tradeId} | switching to text AI fallback`, {
          tradeId,
          textLength: cleanedText.length,
        });
      }

      logExtractedTrades({ tradeId, stage: "OCR-based extraction", parsedTrade, parsedTrades });
      if (marketType === "Indian_Market" && !isEquityIntraday) {
        logIndianOptionExtractionDebug({
          tradeId,
          stage: "ocr-parsed",
          cleanedText,
          parsedTrade,
          parsedTrades,
        });
      }
    }

    if (marketType === "Indian_Market" && !isEquityIntraday && !weakOcr) {
      const ocrParsedTrade = safeParseIndianTrade(cleanedText, { broker });
      const ocrParsedTrades = safeParseTradesFromOCR(cleanedText, { broker });
      const hasOcrMultiOptions = Array.isArray(ocrParsedTrades) && ocrParsedTrades.length > 1;
      const hasVisionMultiOptions = Array.isArray(parsedTrades) && parsedTrades.length > 1;

      // Only let OCR override Vision when OCR found more trades AND every one of those
      // trades has a valid symbol + strike + optionType. A partial OCR result (missing
      // strike or CE/PE) is worse than a single-trade Vision result — don't clobber it.
      const ocrTradesAreValid = Array.isArray(ocrParsedTrades) &&
        ocrParsedTrades.every((t) => t.symbol && t.strike > 0 && (t.optionType === "CE" || t.optionType === "PE"));

      if (hasOcrMultiOptions && !hasVisionMultiOptions && ocrTradesAreValid) {
        logger.warn(`Indian options OCR override applied (validated) | tradeId=${tradeId}`, {
          tradeId,
          ocrCount: ocrParsedTrades.length,
          visionCount: Array.isArray(parsedTrades) ? parsedTrades.length : 0,
        });

        parsedTrades = mergeIndianAiTrades(ocrParsedTrades, aiData?.trades || [], broker || aiData?.broker || "");
        parsedTrade = mergeIndianAiData(
          ocrParsedTrade,
          buildIndianTradeFromParsedRow(parsedTrades[0], broker || aiData?.broker || "")
        );
        geminiVisionUsed = false;
      } else if (hasOcrMultiOptions && !hasVisionMultiOptions && !ocrTradesAreValid) {
        logger.warn(`Indian options OCR override skipped — OCR trades failed validation | tradeId=${tradeId}`, {
          tradeId,
          ocrCount: ocrParsedTrades.length,
          invalidTrades: ocrParsedTrades.filter((t) => !t.symbol || !t.strike || !t.optionType).length,
        });
      } else if ((!parsedTrade?.pair || !parsedTrade?.optionType || parsedTrade?.strikePrice == null) && ocrParsedTrade?.pair) {
        parsedTrade = mergeIndianAiData(ocrParsedTrade, aiData);
        if ((!parsedTrades || parsedTrades.length === 0) && ocrParsedTrades.length > 0) {
          parsedTrades = mergeIndianAiTrades(ocrParsedTrades, aiData?.trades || [], broker || aiData?.broker || "");
        }
      }
    }

    quality = marketType === "Indian_Market"
      ? calculateIndianConfidenceScore({ parsedTrade, parsedTrades, ocrText: cleanedText, broker })
      : calculateConfidenceScore({ parsedTrade, ocrText: cleanedText });

    logger.info(`Confidence score | tradeId=${tradeId}`, {
      tradeId,
      score: quality.score,
      isValid: quality.validation.isValid,
      isLowConfidence: quality.isLowConfidence,
      source: geminiVisionUsed ? "gemini-vision" : "ocr",
    });

    // ── Text AI fallback (only when Gemini Vision failed AND quality is low) ─
    const shouldUseTextAi =
      !geminiVisionUsed &&
      (weakOcr ||
        (marketType === "Indian_Market" ? isIndianExtractionWeak({ parsedTrade, parsedTrades }) : false) ||
        !quality.validation.isValid ||
        quality.isLowConfidence);

    await runCancellationCheck(checkCancellation, "before-text-ai-decision");
    if (shouldUseTextAi) {
      try {
        await runCancellationCheck(checkCancellation, "before-text-ai");
        aiData = await runAiWithRetry({
          marketType,
          tradeSubType,
          text: cleanedText || sourceImage,
          includeRawResponse: true,
          brokerHint: broker,
          expectedMultiple: marketType === "Indian_Market" && (isEquityIntraday ? /INTRADAY|POSITIONS|HOLDINGS|CLOSED/i.test(cleanedText) : ((parsedTrades && parsedTrades.length > 1) || /POSITIONS|HOLDINGS|CLOSED/i.test(cleanedText))),
        });
        await runCancellationCheck(checkCancellation, "after-text-ai");
        aiRawResponse = aiData?.rawResponse || "";

        if (aiRawResponse.length < 1000) {
          logger.info(`Text AI output | tradeId=${tradeId}`, { response: aiRawResponse });
        } else {
          logger.info(`Text AI output | tradeId=${tradeId}`, { response: aiRawResponse.slice(0, 1000) });
        }

        if (isEquityIntraday) {
          const ocrEquityTrade = safeParseEquityTrade(cleanedText, { broker });
          const ocrEquityTrades = safeParseEquityTrades(cleanedText, { broker });
          parsedTrade = mergeEquityAiData(ocrEquityTrade, aiData);
          parsedTrades = ocrEquityTrades.length > 0
            ? ocrEquityTrades.map((t, index) => mergeEquityAiData(t, aiData?.trades?.[index] || {}))
            : Array.isArray(aiData?.trades) && aiData.trades.length > 1
            ? aiData.trades.map((t) => mergeEquityAiData(ocrEquityTrade, t))
            : [];
          if (parsedTrades.length > 0) parsedTrade = parsedTrades[0];
        } else if (marketType === "Indian_Market") {
          parsedTrade = mergeIndianAiData(safeParseIndianTrade(cleanedText, { broker }), aiData);
          parsedTrades = mergeIndianAiTrades(
            safeParseTradesFromOCR(cleanedText, { broker }),
            aiData?.trades || [],
            broker
          );
        } else {
          parsedTrade = mergeGenericAiData(safeParseTrade(cleanedText), aiData);
          parsedTrades = safeParseForexTradesFromOCR(cleanedText);
        }

        logExtractedTrades({ tradeId, stage: "Text AI extraction", parsedTrade, parsedTrades });
        if (marketType === "Indian_Market" && !isEquityIntraday) {
          logIndianOptionExtractionDebug({
            tradeId,
            stage: "text-ai",
            cleanedText,
            aiRawResponse,
            parsedTrade,
            parsedTrades,
          });
        }
      } catch (error) {
        logger.error(`AI failure | tradeId=${tradeId}`, {
          tradeId,
          reason: error.message,
          stack: error.stack,
        });
        throw error;
      }

      quality = marketType === "Indian_Market"
        ? calculateIndianConfidenceScore({ parsedTrade, parsedTrades, ocrText: cleanedText, broker })
        : calculateConfidenceScore({ parsedTrade, ocrText: cleanedText });

      logger.info(`Confidence score after text AI | tradeId=${tradeId}`, {
        tradeId,
        score: quality.score,
        isValid: quality.validation.isValid,
      });
    }

    const finalValidation = marketType === "Indian_Market"
      ? validateIndianTrade(parsedTrade)
      : validateExtractedTrade(parsedTrade);
    await runCancellationCheck(checkCancellation, "before-validation-save");
    if (!finalValidation.isValid) {
      logger.warn(`Validation failed after processing | tradeId=${tradeId}`, {
        tradeId,
        failures: finalValidation.failures.join("; "),
      });
    }

    const multiIndianValidation = marketType === "Indian_Market" ? validateIndianTrades(parsedTrades) : null;
    if (marketType === "Indian_Market" && multiIndianValidation && !multiIndianValidation.isValid) {
      logger.warn(`Indian multi-trade validation | tradeId=${tradeId}`, {
        tradeId,
        validCount: multiIndianValidation.validCount,
        totalCount: multiIndianValidation.totalCount,
        isValid: multiIndianValidation.isValid,
      });
    }

    // Post-pipeline rejection: if confidence is still near-zero after both OCR + AI,
    // the image is very likely unrelated to trading (e.g. AI also couldn't find anything).
    // Distinct from needsReview (score 10–60) which is a blurry/partial trade screenshot.
    if (quality.score <= CONFIDENCE_ZONES.rejectMax) {
      logger.warn(`Near-zero confidence after full pipeline | tradeId=${tradeId} | score=${quality.score}`, { tradeId, score: quality.score });
      if (!persistTrade) {
        const err = new Error("Could not extract any trade data from this image. Please upload a clear screenshot from your broker platform.");
        err.code = "NOT_A_TRADE_IMAGE";
        throw err;
      }
      await rejectNonTradeImage(tradeId, trade, "Could not extract any trade data from this image. Please upload a clear screenshot from your broker platform.");
      return { tradeId, status: "failed", reason: "NOT_A_TRADE_IMAGE" };
    }

    const needsReview =
      !finalValidation.isValid ||
      quality.score <= CONFIDENCE_ZONES.reviewMax ||
      (marketType === "Indian_Market" && multiIndianValidation && !multiIndianValidation.isValid);

    logExtractedTrades({
      tradeId,
      stage: "Final extraction",
      parsedTrade,
      parsedTrades,
    });
    if (marketType === "Indian_Market" && !isEquityIntraday) {
      logIndianOptionExtractionDebug({
        tradeId,
        stage: "final",
        cleanedText,
        aiRawResponse,
        parsedTrade,
        parsedTrades,
      });
    }

    if (!persistTrade) {
      await runCancellationCheck(checkCancellation, "before-result-return");
      const resultJobId = ocrJobId || tradeRecord?._id?.toString?.() || jobId || processingId;
      return {
        jobId: resultJobId,
        status: "completed",
        parsedTrade,
        parsedTrades,
        data: {
          parsedData: { parsedTrade, parsedTrades },
          parsedTrade,
          parsedTrades,
          imageUrl: sourceImage,
          screenshot: sourceImage,
          extractedText: cleanedText,
          marketType,
          tradeSubType: marketType === "Indian_Market" ? tradeSubType : trade.tradeSubType || "",
          extractionConfidence: quality.score ?? 0,
          needsReview,
          validation: {
            isValid: finalValidation.isValid,
            failures: finalValidation.failures,
            confidenceScore: quality.score ?? 0,
          },
        },
      };
    }

    // Legacy compatibility: if an old queue item points at a temporary trade,
    // the user will create individual trades from the frontend after reviewing.
    const isMultiTrade = Array.isArray(parsedTrades) && parsedTrades.length > 1;
    await runCancellationCheck(checkCancellation, "before-trade-write");

    if (isMultiTrade) {
      const bridgePayload = {
        jobId: trade.ocrJobId || tradeId,
        status: "completed",
        attemptsMade: attempt || trade.ocrAttempts || 0,
        error: null,
        data: {
          parsedData: { parsedTrade, parsedTrades },
          parsedTrade,
          parsedTrades,
          imageUrl: trade.imageUrl || trade.screenshot || "",
          screenshot: trade.screenshot || trade.imageUrl || "",
          extractedText: cleanedText,
          marketType: trade.marketType || "Forex",
          tradeSubType: marketType === "Indian_Market" ? tradeSubType : trade.tradeSubType || "",
        },
      };
      const statusBridgeKey = buildCacheKey("trade_status_bridge", trade.user?.toString(), tradeId);
      await setCache(
        statusBridgeKey,
        bridgePayload,
        24 * 60 * 60
      );
      await Trade.findByIdAndDelete(tradeId);
      logger.info(`Temporary OCR trade removed after multi-trade extraction | tradeId=${tradeId} | count=${parsedTrades.length}`, {
        tradeId,
        parsedTradeCount: parsedTrades.length,
      });
    } else {
      const update = buildTradeUpdate({
        trade,
        parsedTrade,
        parsedTrades,
        extractedText: cleanedText,
        aiRawResponse,
        confidenceScore: quality.score,
        isValid: finalValidation.isValid,
        needsReview,
        validationFailures: finalValidation.failures,
      });
      update.tradeSubType = marketType === "Indian_Market" ? tradeSubType : trade.tradeSubType || "";
      const updatedTrade = await Trade.findByIdAndUpdate(tradeId, update, { returnDocument: "after", runValidators: true });
      if (updatedTrade) {
        await evaluateSmartNotifications({
          userId: updatedTrade.user,
          trade: updatedTrade,
          marketType: updatedTrade.marketType || marketType,
          collection: "forex",
        });
      }
    }

    await runCancellationCheck(checkCancellation, "before-extraction-log");
    await logExtraction({ trade, extractedText: cleanedText, parsedTrade, parsedTrades, aiUsed: !!aiData });
    await invalidateTradeCaches({
      userId: trade.user,
      event: TRADE_CACHE_EVENTS.IMPORT,
      market: marketType,
      tradeId,
      count: Array.isArray(parsedTrades) && parsedTrades.length > 0 ? parsedTrades.length : 1,
      source: "ocr_process",
    });

    return {
      tradeId,
      status: "completed",
      parsedTrade,
      parsedTrades,
    };
  })(), "Processing timeout");
}

function getFriendlyProcessingError(error) {
  const msg = String(error?.message || "").toLowerCase();
  const code = error?.code;

  if (code === "WRONG_MARKET_TYPE" || msg.includes("wrong screenshot type")) {
    return error.message;
  }
  if (code === 429 || msg.includes("429") || msg.includes("resource_exhausted") || msg.includes("quota") || msg.includes("rate limit")) {
    return "Our AI is currently busy due to high demand. Please try uploading again in a few minutes.";
  }
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("deadline")) {
    return "AI processing timed out due to high load. Please try again shortly.";
  }
  if (code === "OCR_JOB_CANCELLED") {
    return "Upload cancelled.";
  }
  return error?.message || "Processing failed";
}

async function failTradeProcessing(tradeId, error) {
  const failureMessage = getFriendlyProcessingError(error);
  const trade = await Trade.findByIdAndUpdate(
    tradeId,
    {
      status: "failed",
      error: failureMessage,
      processedAt: null,
    },
    { returnDocument: "after" }
  );

  if (trade) {
    await logExtraction({
      trade,
      extractedText: trade.extractedText || "",
      parsedTrade: trade.parsedData?.parsedTrade || null,
      parsedTrades: trade.parsedData?.parsedTrades || [],
      aiUsed: false,
      errorMessage: failureMessage,
    });
    await invalidateTradeCaches({
      userId: trade.user,
      event: TRADE_CACHE_EVENTS.EDIT,
      market: trade.marketType || "Forex",
      tradeId,
      source: "ocr_fail",
    });
  }
}

module.exports = {
  createProcessingCancelledError,
  getFriendlyProcessingError,
  processTradeUpload,
  failTradeProcessing,
};
