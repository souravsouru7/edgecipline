const { withTimeout, TIMEOUT_CONFIG } = require("../middleware/timeout");
const { logger } = require("../utils/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { appConfig } = require("../config");

const GEMINI_EXTRACTION_TIMEOUT_MS = Math.max(TIMEOUT_CONFIG.aiTimeout, 90_000);

const FOREX_VISION_PROMPT = `You are a trading data extraction specialist analyzing a Forex/CFD broker screenshot.
Return ONLY a single valid JSON object. No markdown, no explanation, no extra text.

MARKET TYPE CHECK — DO THIS FIRST:
If the screenshot is clearly from an Indian stock broker (Zerodha, Upstox, Angel One, Groww, Dhan, Fyers, ICICI Direct, Kotak, Paytm Money, Sharekhan, 5paisa) OR shows Indian F&O/options (CE/PE, strike prices, NIFTY/BANKNIFTY options) OR shows Indian equities (NSE/BSE stock names), return ONLY this JSON and nothing else:
{"error":"WRONG_MARKET_TYPE","detectedMarket":"Indian_Market","message":"This appears to be an Indian market screenshot. Please use the Indian Market upload page."}

FIELD EXTRACTION RULES:
- pair: currency/instrument symbol (e.g. EURUSD, XAUUSD, US30, BTCUSD). Normalize: remove spaces, slashes.
- type: exactly "BUY" or "SELL". Look for: Buy/Sell labels, green/red color indicators, Long/Short labels, B/S abbreviations.
- quantity: lot size or volume (e.g. 0.01, 1.00). Look for: "Lots", "Vol", "Volume", "Size" columns.
- entryPrice: opening price. Look for: "Open", "Entry", "Open Price", "Price" columns.
- exitPrice: closing price. Look for: "Close", "Exit", "Close Price", "Current" columns.
- profit: net P&L in account currency. Look for: "Profit", "P&L", "Net P&L", "Realized P&L" columns. Negative if shown in red or with minus sign.
- stopLoss: SL value. Look for: "S/L", "Stop Loss", "SL" columns.
- takeProfit: TP value. Look for: "T/P", "Take Profit", "TP" columns.
- broker: platform name visible in logo or title (MetaTrader 4, MetaTrader 5, cTrader, TradingView, etc.)

NUMBER FORMAT: Return raw numbers only. Remove currency symbols ($, €, £). Profit is negative if the trade is a loss.

MULTI-TRADE: If MULTIPLE trade rows are visible on screen, extract ALL of them into a "trades" array. Set top-level fields to the first trade. EVERY VISIBLE ROW = ONE SEPARATE TRADE — do not skip any row.

SINGLE TRADE EXAMPLE:
JSON: {"pair":"EURUSD","type":"BUY","quantity":0.01,"entryPrice":1.08500,"exitPrice":1.09000,"profit":50.00,"stopLoss":1.08000,"takeProfit":1.09500,"broker":"MetaTrader 5"}

MULTI-TRADE EXAMPLE (2 rows visible):
JSON: {"pair":"GBPUSD","type":"BUY","quantity":0.90,"entryPrice":1.35949,"exitPrice":1.35897,"profit":-46.80,"stopLoss":1.35898,"takeProfit":1.36288,"broker":"MetaTrader 5","trades":[{"pair":"GBPUSD","type":"BUY","quantity":0.90,"entryPrice":1.35949,"exitPrice":1.35897,"profit":-46.80,"stopLoss":1.35898,"takeProfit":1.36288},{"pair":"GBPUSD","type":"SELL","quantity":0.30,"entryPrice":1.35861,"exitPrice":1.35955,"profit":-28.20,"stopLoss":1.35950,"takeProfit":1.35677}]}`;

const INDIAN_VISION_PROMPT = `You are a trading data extraction specialist analyzing an Indian broker screenshot (Zerodha, Upstox, Angel One, Groww, Dhan, Fyers, 5paisa, ICICI Direct, Kotak Neo, Paytm Money, Motilal Oswal, Sharekhan).
Return ONLY a single valid JSON object. No markdown, no explanation, no extra text.

MARKET TYPE CHECK — DO THIS FIRST:
If the screenshot is clearly from a Forex/CFD broker (MetaTrader 4, MetaTrader 5, cTrader, TradingView) OR shows Forex currency pairs (EURUSD, XAUUSD, GBPJPY, USDJPY etc.) OR shows lot sizes / pip values instead of Indian quantities, return ONLY this JSON and nothing else:
{"error":"WRONG_MARKET_TYPE","detectedMarket":"Forex","message":"This appears to be a Forex/MT5 screenshot. Please use the Forex upload page."}

CRITICAL RULES:
1. If this is a POSITIONS / F&O / OPEN POSITIONS screen, IGNORE "TOTAL P&L", index quotes/cards, tabs, and summary widgets. Extract only the individual option rows.
2. Never invent a strike price. Use the exact strike visible in each row.
3. Convert option names exactly:
   - "Call" => "CE"
   - "Put" => "PE"
4. EVERY VISIBLE ROW = ONE SEPARATE TRADE. Do not collapse or merge rows. If you see 4 rows, return exactly 4 items in "trades".
5. SAME INSTRUMENT + DIFFERENT PRODUCT TYPE = TWO SEPARATE TRADES. Example: "NIFTY 24200 CE" appearing once as "Overnight" and once as "Intraday-BO" = 2 trades, each with its own P&L.
6. LTP (Last Traded Price) is the CURRENT MARKET PRICE — it is NOT the entry price and NOT the exit price. NEVER put LTP into entryPrice or exitPrice. entryPrice comes only from "Avg", "Avg Price", "Buy Avg", "Entry". exitPrice comes only from "Sell Avg", "Exit Price", "Close Price".
7. When "Avg" or "Avg Price" shows "0", "0.00", or "₹0.00" — the position is fully closed. Set entryPrice = null and exitPrice = null for that row.
8. P&L sign: GREEN color or "+" prefix = positive number. RED color or "-" prefix = negative number. Extract the P&L for EACH ROW INDEPENDENTLY — never copy P&L from one row to another.

FIELD EXTRACTION RULES:
- pair: instrument name with strike (e.g. "NIFTY 24200 CE", "BANKNIFTY 48000 PE").
- underlying: index name only (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, or stock ticker).
- optionType: "CE" or "PE".
- strikePrice: the numeric strike price only.
- quantity: Qty shown in the row (may be 0 for closed positions).
- entryPrice: null if Avg=0/0.00 or not shown. Otherwise the Avg/Buy Avg value. NEVER LTP.
- exitPrice: null unless "Sell Avg" or "Exit Price" or "Close Price" is explicitly shown. NEVER LTP.
- profit: the P&L value of THIS row only. Strip ₹, commas. Negative if red/minus. Indian lakh format "1,23,456" = 123456.
- productType: "Overnight"/"NRML"/"CNC"/"Delivery" => "DELIVERY". "Intraday"/"Intraday-BO"/"MIS"/"BO"/"CO" => "INTRADAY". Default "INTRADAY".
- broker: app/platform name from logo or title bar.

FYERS / ZERODHA POSITIONS PAGE EXAMPLE:
Row 1: NIFTY 24200 CE  +₹520.00 | LTP 79.70 | Qty 0 | Overnight | Avg 0.00
Row 2: NIFTY 24200 CE  +₹338.00 | LTP 79.70 | Qty 0 | Intraday-BO | Avg 0.00
Row 3: NIFTY 24300 CE  +₹334.75 | LTP 48.25 | Qty 0 | Overnight | Avg 0.00
Row 4: NIFTY 24300 CE  -₹1072.50 | LTP 48.25 | Qty 0 | Intraday-BO | Avg 0.00

Correct output for above:
{"trades":[
  {"pair":"NIFTY 24200 CE","underlying":"NIFTY","strikePrice":24200,"optionType":"CE","quantity":0,"entryPrice":null,"exitPrice":null,"profit":520.00,"productType":"DELIVERY"},
  {"pair":"NIFTY 24200 CE","underlying":"NIFTY","strikePrice":24200,"optionType":"CE","quantity":0,"entryPrice":null,"exitPrice":null,"profit":338.00,"productType":"INTRADAY"},
  {"pair":"NIFTY 24300 CE","underlying":"NIFTY","strikePrice":24300,"optionType":"CE","quantity":0,"entryPrice":null,"exitPrice":null,"profit":334.75,"productType":"DELIVERY"},
  {"pair":"NIFTY 24300 CE","underlying":"NIFTY","strikePrice":24300,"optionType":"CE","quantity":0,"entryPrice":null,"exitPrice":null,"profit":-1072.50,"productType":"INTRADAY"}
]}

Extract ALL rows into "trades" array. Set top-level fields to the first trade.

JSON: {"pair":"NIFTY 24200 CE","optionType":"CE","strikePrice":24200,"underlying":"NIFTY","quantity":0,"entryPrice":null,"exitPrice":null,"profit":520.00,"productType":"DELIVERY","broker":"Fyers","trades":[{"pair":"NIFTY 24200 CE","optionType":"CE","strikePrice":24200,"underlying":"NIFTY","quantity":0,"entryPrice":null,"exitPrice":null,"profit":520.00,"productType":"DELIVERY"},{"pair":"NIFTY 24200 CE","optionType":"CE","strikePrice":24200,"underlying":"NIFTY","quantity":0,"entryPrice":null,"exitPrice":null,"profit":338.00,"productType":"INTRADAY"}]}`;

const INDIAN_EQUITY_VISION_PROMPT = `You are a trading data extraction specialist analyzing an Indian broker app screenshot showing EQUITY (stock) trades — both INTRADAY and DELIVERY/CNC — NOT options/F&O.
Return ONLY a single valid JSON object. No markdown, no explanation, no extra text.

MARKET TYPE CHECK — DO THIS FIRST:
If the screenshot is clearly from a Forex/CFD broker (MetaTrader 4, MetaTrader 5, cTrader, TradingView) OR shows Forex currency pairs (EURUSD, XAUUSD, GBPJPY etc.) OR shows lot sizes / pip values, return ONLY this JSON and nothing else:
{"error":"WRONG_MARKET_TYPE","detectedMarket":"Forex","message":"This appears to be a Forex/MT5 screenshot. Please use the Forex upload page."}

CRITICAL RULES — READ CAREFULLY:
1. IGNORE any "Today's P&L", "TOTAL RETURNS", "Total P&L", "Overall P&L", or any aggregate/summary row at the top or bottom. These are NOT stock names.
2. Only extract individual stock/company rows (e.g. "POWERGRID", "Vedanta", "HDFC Bank", "Reliance", "TCS").
3. This may be a Positions / Holdings / Closed Trades page. Each stock row has: stock name, P&L value (right side), and optionally Qty, Avg price, LTP/Mkt price.
4. CLOSED POSITION: If Qty shows "0" and Avg shows "0.00" or "₹0.00" — the position is fully closed. Set entryPrice=null and exitPrice=null. The P&L shown in GREEN/RED for THAT ROW is the realized profit/loss — extract it.
5. The P&L is GREEN/positive (+₹) or RED/negative (-₹). Extract the exact number with correct sign.
6. LTP (Last Traded Price) is the CURRENT MARKET PRICE — NEVER put LTP into entryPrice or exitPrice.
7. productType: "Delivery"/"CNC"/"DELIVERY" => "DELIVERY". "Intraday"/"MIS"/"BO"/"CO" => "INTRADAY". Default "INTRADAY".
8. Ignore market index rows and header values such as NIFTY 50, NIFTY BANK, BANKNIFTY, SENSEX, market index P&L, time, battery, network, navigation, and portfolio summary widgets.
9. For each stock row, find the stock symbol first, then use the nearest P&L and nearest LTP inside that same row/card. Never assign a NIFTY/BANKNIFTY/SENSEX value to a stock.

STOCK SYMBOL RULES — VERY IMPORTANT:
- If the stock name IS already a known NSE ticker (all caps, no spaces), keep it EXACTLY as shown. Do NOT strip or abbreviate it.
- Examples: "POWERGRID"→POWERGRID, "RELIANCE"→RELIANCE, "TCS"→TCS, "NTPC"→NTPC, "ONGC"→ONGC, "SBIN"→SBIN.
- Convert full company names: "Vedanta"→VEDL, "HDFC Bank"→HDFCBANK, "Voltas"→VOLTAS, "Shipping Corporation"→SCI, "Infosys"→INFY, "Wipro"→WIPRO, "ICICI Bank"→ICICIBANK, "Power Grid"→POWERGRID, "Power Grid Corporation"→POWERGRID, "Coforge"→COFORGE, "NIIT Technologies"→COFORGE.
- Never extract "LT" from UI labels like "LTP" or "Total P&L". Use LT only when the stock row itself visibly says "LT" or "L&T".
- If unsure, use the name in UPPERCASE with spaces removed. NEVER invent a short abbreviation not visible in the image.

FIELD EXTRACTION RULES:
- stockSymbol: NSE ticker as described above.
- exchange: "NSE" or "BSE". If row shows "NSE EQ" or "NSE" → "NSE". If "BSE EQ" or "BSE" → "BSE". Default "NSE".
- sharesQty: integer shares quantity from the Qty field. null if Qty=0 or not shown.
- type: "BUY" for long/buy, "SELL" for short/sell. Default "BUY" if direction not shown.
- entryPrice: avg buy price per share in ₹. null if Avg=0/0.00 or not shown.
- exitPrice: avg sell price per share in ₹. null if not explicitly shown as Sell Avg / Close price.
- profit: net realized P&L in ₹ from THAT SPECIFIC STOCK ROW (not the summary total). Green/+ = positive. Red/- = negative. Strip ₹ and commas. Indian format: "1,23,456" = 123456. "+1,554.60" = 1554.60.
- productType: "DELIVERY" or "INTRADAY" as per rule 7 above.
- broker: app/platform name visible (Zerodha/Upstox/Angel One/Groww/Dhan/Fyers/5paisa/ICICI Direct/Kotak/Paytm Money). null if not visible.

MULTI-TRADE: If MULTIPLE stock rows are visible, extract ALL of them into "trades" array. The top-level fields should contain the first trade.

UPSTOX POSITIONS PAGE EXAMPLE:
Screen shows: "Closed (1)" section, row: "POWERGRID  +1,554.60 | NSE EQ | Delivery  Qty. 0 | 0.00 Avg. | 296.55 (-3.04%) LTP"
Correct output:
JSON: {"stockSymbol":"POWERGRID","exchange":"NSE","sharesQty":null,"type":"BUY","entryPrice":null,"exitPrice":null,"profit":1554.60,"productType":"DELIVERY","broker":"Upstox","trades":[{"stockSymbol":"POWERGRID","exchange":"NSE","sharesQty":null,"type":"BUY","entryPrice":null,"exitPrice":null,"profit":1554.60,"productType":"DELIVERY","broker":"Upstox"}]}

ZERODHA POSITIONS PAGE EXAMPLE (2 stocks):
JSON: {"stockSymbol":"VEDL","exchange":"NSE","sharesQty":null,"type":"BUY","entryPrice":null,"exitPrice":null,"profit":211.90,"productType":"INTRADAY","broker":"Zerodha","trades":[{"stockSymbol":"VEDL","exchange":"NSE","sharesQty":null,"type":"BUY","entryPrice":null,"exitPrice":null,"profit":211.90,"productType":"INTRADAY"},{"stockSymbol":"VOLTAS","exchange":"NSE","sharesQty":null,"type":"SELL","entryPrice":null,"exitPrice":null,"profit":-2783.20,"productType":"INTRADAY"}]}`;

// Forex pair patterns: 6-char currency pairs, commodity codes, index CFDs
const FOREX_PAIR_RE = /^([A-Z]{3}[A-Z]{3}(\.[A-Z]+)?|XAU|XAG|GOLD|SILVER|OIL|BRENT|US(30|100|500)|NAS(DAQ)?100|DAX|FTSE|SP500|CRUDE)/i;
// Indian market signals in the pair name
const INDIAN_PAIR_RE = /(CE|PE)$|\d{4,6}\s*(CE|PE)/i;

function throwIfMarketMismatch(parsed, marketType) {
  if (!parsed || typeof parsed !== "object") return;

  const isIndianMarket = marketType === "Indian_Market";
  const pair = String(parsed.pair || parsed.stockSymbol || "").trim().toUpperCase();

  if (isIndianMarket) {
    // Signals that extracted data is actually Forex
    const hasForexPair    = pair.length >= 6 && FOREX_PAIR_RE.test(pair);
    const hasForexBroker  = /metatrader|mt4|mt5|ctrader|tradingview/i.test(String(parsed.broker || ""));
    const hasLotSize      = typeof parsed.lotSize === "number" || (typeof parsed.quantity === "number" && parsed.quantity > 0 && parsed.quantity < 10 && !Number.isInteger(parsed.quantity));
    const noIndianSignals = !INDIAN_PAIR_RE.test(pair) && parsed.strikePrice == null && parsed.underlying == null;

    if ((hasForexPair || hasForexBroker) && noIndianSignals) {
      const err = new Error("Wrong screenshot type. This looks like a Forex/MT5 screenshot. Please go back and use the Forex upload page instead.");
      err.code = "WRONG_MARKET_TYPE";
      throw err;
    }
    // Also catch lot sizes like 0.06 with no Indian signals
    if (hasLotSize && noIndianSignals && !pair.match(/^[A-Z]{2,5}$/)) {
      const err = new Error("Wrong screenshot type. This looks like a Forex/MT5 screenshot. Please go back and use the Forex upload page instead.");
      err.code = "WRONG_MARKET_TYPE";
      throw err;
    }
  } else {
    // Signals that extracted data is actually Indian market
    const hasIndianPair   = INDIAN_PAIR_RE.test(pair);
    const hasStrikePrice  = parsed.strikePrice != null;
    const hasIndianBroker = /zerodha|upstox|angel|groww|dhan|fyers|kite|5paisa|kotak|paytm|motilal|sharekhan/i.test(String(parsed.broker || ""));

    if (hasIndianPair || hasStrikePrice || hasIndianBroker) {
      const err = new Error("Wrong screenshot type. This looks like an Indian broker screenshot. Please go back and use the Indian Market upload page instead.");
      err.code = "WRONG_MARKET_TYPE";
      throw err;
    }
  }
}

async function extractTradeWithGeminiVision(imageUrl, options = {}) {
  const geminiKey = appConfig.ai.geminiApiKey;
  if (!geminiKey || !imageUrl) return null;

  const marketType = options.marketType || "Forex";
  const isIndian = marketType === "Indian_Market";
  const isEquity = isIndian && options.tradeSubType === "EQUITY";
  const timeoutMs = Math.max(TIMEOUT_CONFIG.aiTimeout || 45000, GEMINI_EXTRACTION_TIMEOUT_MS);

  try {
    let base64, mimeType;

    if (options.imageBuffer) {
      // Use pre-downloaded buffer — avoids a duplicate HTTP round-trip
      base64 = options.imageBuffer.toString("base64");
      mimeType = options.imageMimeType || "image/jpeg";
    } else {
      // Fallback: download the image ourselves (30s — was 15s)
      const imgResponse = await withTimeout(fetch(imageUrl), "Image download for Gemini Vision", 30000);
      if (!imgResponse.ok) {
        logger.warn("Gemini Vision: failed to download image", { imageUrl, status: imgResponse.status });
        return null;
      }
      const buffer = await imgResponse.arrayBuffer();
      base64 = Buffer.from(buffer).toString("base64");
      mimeType = imgResponse.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    }

    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: appConfig.ai.geminiTradeModel,
      generationConfig: { temperature: 0, maxOutputTokens: 2048 },
    });

    const prompt = isEquity ? INDIAN_EQUITY_VISION_PROMPT : isIndian ? INDIAN_VISION_PROMPT : FOREX_VISION_PROMPT;
    const visionPromise = model.generateContent([
      { inlineData: { data: base64, mimeType } },
      { text: prompt },
    ]);

    const result = await withTimeout(visionPromise, "Gemini Vision call", timeoutMs);
    const rawText = result?.response?.text?.()?.trim();
    if (!rawText) return null;

    let parsed;
    try {
      parsed = JSON.parse(stripJsonEnvelope(rawText));
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) {
        logger.warn("Gemini Vision: no JSON in response", { snippet: rawText.slice(0, 200) });
        return null;
      }
      parsed = JSON.parse(stripJsonEnvelope(match[0]));
    }

    // Prompt-based detection (Gemini self-detected wrong market)
    if (parsed?.error === "WRONG_MARKET_TYPE") {
      const detected = parsed.detectedMarket || "unknown";
      const uploadPage = detected === "Forex" ? "Forex upload page" : "Indian Market upload page";
      const err = new Error(
        `Wrong screenshot type. This looks like a ${detected === "Forex" ? "Forex/MT5" : "Indian broker"} screenshot. Please upload it on the ${uploadPage} instead.`
      );
      err.code = "WRONG_MARKET_TYPE";
      throw err;
    }

    // Deterministic post-extraction market type validation
    // (Gemini sometimes ignores prompt instructions — check the extracted fields directly)
    throwIfMarketMismatch(parsed, marketType);

    logger.info("Gemini Vision extraction succeeded", { marketType, imageUrl });

    if (isEquity) {
      const mapOne = (item) => ({
        stockSymbol: item.stockSymbol && typeof item.stockSymbol === "string" ? item.stockSymbol.trim().toUpperCase() : null,
        exchange: item.exchange === "BSE" ? "BSE" : "NSE",
        sharesQty: toNumberOrNull(item.sharesQty),
        type: item.type === "BUY" || item.type === "SELL" ? item.type : null,
        entryPrice: toNumberOrNull(item.entryPrice),
        exitPrice: toNumberOrNull(item.exitPrice),
        profit: toNumberOrNull(item.profit),
        productType: item.productType === "DELIVERY" ? "DELIVERY" : "INTRADAY",
        broker: item.broker ?? null,
      });
      const main = mapOne(parsed);
      const trades = Array.isArray(parsed.trades) ? parsed.trades.map(mapOne) : [];
      return { ...main, trades, rawResponse: rawText };
    }

    if (isIndian) {
      const mapOne = (item) => ({
        pair: item.pair ?? null,
        profit: toNumberOrNull(item.profit),
        quantity: toNumberOrNull(item.quantity),
        strikePrice: toNumberOrNull(item.strikePrice),
        optionType: item.optionType === "PE" || item.optionType === "CE" ? item.optionType : null,
        underlying: item.underlying ?? null,
        entryPrice: toNumberOrNull(item.entryPrice),
        exitPrice: toNumberOrNull(item.exitPrice),
        broker: item.broker ?? null,
        productType: item.productType === "DELIVERY" ? "DELIVERY" : "INTRADAY",
      });
      const main = mapOne(parsed);
      const trades = Array.isArray(parsed.trades) ? parsed.trades.map(mapOne) : [];
      return { ...main, trades, rawResponse: rawText };
    }

    const mapOneForex = (item) => ({
      pair: item.pair ?? null,
      type: item.type === "BUY" || item.type === "SELL" ? item.type : null,
      quantity: toNumberOrNull(item.quantity),
      entryPrice: toNumberOrNull(item.entryPrice),
      exitPrice: toNumberOrNull(item.exitPrice),
      profit: toNumberOrNull(item.profit),
      stopLoss: toNumberOrNull(item.stopLoss),
      takeProfit: toNumberOrNull(item.takeProfit),
      broker: item.broker ?? null,
      strikePrice: toNumberOrNull(item.strikePrice),
      optionType: item.optionType === "PE" || item.optionType === "CE" ? item.optionType : null,
      underlying: item.underlying ?? null,
    });
    const mainForex = mapOneForex(parsed);
    const forexTrades = Array.isArray(parsed.trades) ? parsed.trades.map(mapOneForex) : [];
    return { ...mainForex, trades: forexTrades, rawResponse: rawText };
  } catch (err) {
    if (err.code === "WRONG_MARKET_TYPE") {
      throw err;
    }
    logger.warn("Gemini Vision extraction failed", { error: err.message, imageUrl });
    return null;
  }
}

async function callAIForTradeExtraction(prompt, timeoutMs = TIMEOUT_CONFIG.aiTimeout, { preferGemini = false } = {}) {
  const openaiKey = appConfig.ai.openaiApiKey;
  const geminiKey = appConfig.ai.geminiApiKey;

  // For Indian market data, Gemini has stronger knowledge of Indian broker formats.
  // preferGemini=true skips OpenAI and goes straight to Gemini.
  if (openaiKey && !preferGemini) {
    try {
      const fetchPromise = fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: appConfig.ai.openaiModel,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 500,
        }),
      });

      const res = await withTimeout(fetchPromise, "OpenAI AI API call", timeoutMs);

      if (!res.ok) {
        const err = await res.text();
        logger.warn(`OpenAI API error | status=${res.status}`, {
          status: res.status,
          error: err,
        });
        return null;
      }

      const result = await withTimeout(res.json(), "OpenAI AI API response parsing", 5000);
      return result;
    } catch (err) {
      if (err.name === "TimeoutError") {
        logger.error(`OpenAI AI extraction timed out`, {
          error: err.message,
          duration: err.duration,
        });
      } else {
        logger.warn(`OpenAI AI extraction error`, {
          error: err.message,
        });
      }
      return null;
    }
  }

  if (!geminiKey) {
    logger.warn("AI extraction skipped: neither OPENAI_API_KEY nor GEMINI_API_KEY is set");
    return null;
  }

  // Gemini fallback (returns an OpenAI-like shape so downstream parsing works unchanged)
  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const modelName = appConfig.ai.geminiTradeModel;
    const model = genAI.getGenerativeModel({ model: modelName });
    const geminiTimeout = Math.max(timeoutMs, GEMINI_EXTRACTION_TIMEOUT_MS);

    const runGemini = async (inputPrompt) => {
      const geminiPromise = model.generateContent({
        contents: [{ role: "user", parts: [{ text: inputPrompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 600,
        },
      });
      return withTimeout(geminiPromise, "Gemini AI call", geminiTimeout);
    };

    let result;
    try {
      result = await runGemini(prompt);
    } catch (err) {
      if (err.name !== "TimeoutError") throw err;

      // Retry once with a shorter prompt to reduce model latency on large OCR text.
      logger.warn("Gemini AI extraction timed out on first attempt, retrying with compact prompt", {
        timeout: `${geminiTimeout}ms`,
      });
      const compactPrompt = String(prompt).slice(0, 2600);
      result = await runGemini(compactPrompt);
    }

    const text = result?.response?.text?.() || "";
    return { choices: [{ message: { content: text } }] };
  } catch (err) {
    if (err.name === "TimeoutError") {
      logger.error(`Gemini AI extraction timed out`, {
        error: err.message,
        duration: err.duration,
      });
    } else {
      logger.warn(`Gemini AI extraction error`, {
        error: err.message,
      });
    }
    return null;
  }
}

function stripJsonEnvelope(content) {
  if (!content) return null;
  return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function toNumberOrNull(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  let s = value.trim();
  if (!s) return null;

  // Bracket-negative: (1,234.50) → -1234.50
  const bracketNeg = s.match(/^\(([^)]+)\)$/);
  if (bracketNeg) s = "-" + bracketNeg[1];

  // Strip currency symbols and whitespace: ₹, Rs., INR, $, €, £
  s = s.replace(/[₹$€£]|Rs\.|INR/gi, "").trim();

  // Indian lakh format: 1,23,456 — commas at non-standard positions
  // Standard: 1,234,567 — works fine with simple comma removal
  // Both handled by just removing all commas
  s = s.replace(/,/g, "");

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function mapIndianTradePayload(parsed) {
  return {
    pair: parsed.pair && typeof parsed.pair === "string" ? parsed.pair.trim() : null,
    profit: toNumberOrNull(parsed.profit),
    quantity: toNumberOrNull(parsed.quantity),
    strikePrice: toNumberOrNull(parsed.strikePrice),
    optionType: parsed.optionType === "PE" || parsed.optionType === "CE" ? parsed.optionType : null,
    underlying: parsed.underlying && typeof parsed.underlying === "string" ? parsed.underlying.trim() : null,
    entryPrice: toNumberOrNull(parsed.entryPrice),
    exitPrice: toNumberOrNull(parsed.exitPrice),
    broker: parsed.broker && typeof parsed.broker === "string" ? parsed.broker.trim() : null,
  };
}

function mapIndianTradeList(parsed) {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => mapIndianTradePayload(item || {}))
    .filter((item) => item.pair || item.quantity != null || item.profit != null || item.entryPrice != null);
}

async function extractIndianTradeWithAI(extractedText, options = {}) {
  const textWithoutPercents = String(extractedText || "")
    .replace(/([=~-])%/g, "-₹")
    .replace(/(\d):(\d{2})(?!\d)/g, "$1.$2")
    .replace(/\(?\s*[+\-]?\s*[\d,]+\.\d*\s*%\s*\)?/g, " ");
  if (!textWithoutPercents || textWithoutPercents.trim().length < 10) {
    return null;
  }

  const brokerHint = options.brokerHint ? `Broker hint: ${options.brokerHint}\n` : "";
  const multiHint = options.expectedMultiple
    ? "The screenshot may contain multiple trades. Return every detected trade in the trades array.\n"
    : "";
  const ocrSlice = String(textWithoutPercents).slice(0, options.improvedPrompt ? 5000 : 4000);
  const prompt = `You are extracting Indian F&O/options trade data from broker OCR text. Return ONLY valid JSON, no markdown, no explanation.
${brokerHint}${multiHint}
EXTRACTION RULES:
- pair: full instrument string e.g. "NIFTY 26000 PE", "BANKNIFTY 48000 CE 30JAN". Include expiry if visible.
- underlying: index/stock only — NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, or stock ticker.
- optionType: "CE" (Call/bullish) or "PE" (Put/bearish). Never null if visible.
- strikePrice: number only e.g. 26000.
- quantity: number of lots.
- entryPrice: avg buy price. Look for "Avg. Price", "Avg Price", "Buy Avg", "Entry".
- exitPrice: avg sell price. Look for "Sell Avg", "Exit", "LTP".
- profit: realized P&L as signed number. Negative = loss.
  Formats: "-₹500", "₹-500", "(500)", red/minus sign all mean -500.
  Indian lakh: "1,23,456" = 123456 (remove all commas).
  ₹ / Rs. / INR prefix — strip it, return number only.
- broker: Zerodha/Upstox/Angel One/Groww/Dhan/Fyers/5paisa/ICICI Direct/Kotak/Paytm Money.

COMMON OCR ERRORS: "PE"→"P E"/"FE"/"Re", "CE"→"GE"/"OE", ₹→"T"/"F"/"Rs", minus→"="/"~".

Return ALL visible trades in "trades". Set top-level to first/main trade. Use null for missing.

OCR text:
${ocrSlice}

JSON: {"pair":"NIFTY 26000 PE","optionType":"PE","strikePrice":26000,"underlying":"NIFTY","quantity":1,"entryPrice":150.00,"exitPrice":200.00,"profit":2500.00,"broker":"Zerodha","trades":[{"pair":"NIFTY 26000 PE","optionType":"PE","strikePrice":26000,"underlying":"NIFTY","quantity":1,"entryPrice":150.00,"exitPrice":200.00,"profit":2500.00,"broker":"Zerodha"}]}`;

  // Gemini preferred for Indian market — stronger knowledge of Indian broker formats
  const data = await callAIForTradeExtraction(prompt, TIMEOUT_CONFIG.aiTimeout, { preferGemini: true });
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  try {
    const jsonStr = stripJsonEnvelope(content);
    const parsed = JSON.parse(jsonStr);
    const mapped = mapIndianTradePayload(parsed);
    const mappedTrades = mapIndianTradeList(parsed?.trades);
    const response = mappedTrades.length > 0 ? { ...mapped, trades: mappedTrades } : mapped;
    return options.includeRawResponse ? { ...response, rawResponse: content } : response;
  } catch (err) {
    // Gemini sometimes returns extra text around JSON. Try to recover the first JSON object.
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw err;
      const jsonStr = stripJsonEnvelope(match[0]);
      const parsed = JSON.parse(jsonStr);
      const mapped = mapIndianTradePayload(parsed);
      const mappedTrades = mapIndianTradeList(parsed?.trades);
      const response = mappedTrades.length > 0 ? { ...mapped, trades: mappedTrades } : mapped;
      return options.includeRawResponse ? { ...response, rawResponse: content } : response;
    } catch (err2) {
      logger.warn("[AI extraction] Indian JSON parse error", { error: err.message });
      return null;
    }
  }
}

async function extractTradeWithAI(extractedText, options = {}) {
  if (!extractedText || extractedText.trim().length < 10) {
    return null;
  }

  const marketType = options.marketType || "Forex";
  const prompt = `You are extracting ${marketType} trade data from broker OCR text. Return ONLY valid JSON, no markdown, no explanation.

EXTRACTION RULES:
- pair: instrument symbol. Forex: EURUSD, GBPUSD, XAUUSD, BTCUSD. Remove spaces/slashes.
- type: exactly "BUY" or "SELL". Look for: Buy/Sell, Long/Short, B/S labels.
- quantity: lot size or volume e.g. 0.01, 1.00.
- entryPrice: open price. Look for "Open", "Entry", "Price".
- exitPrice: close price. Look for "Close", "Exit", "Current".
- profit: net P&L. Negative = loss. Strip $ € £ symbols. Return signed number.
- stopLoss: S/L value.
- takeProfit: T/P value.
- broker: platform name (MetaTrader 4, MetaTrader 5, cTrader, TradingView, etc.)

Use null for missing fields. Return the best numeric value you can — don't leave numbers as strings.

OCR text:
${String(extractedText).slice(0, 5000)}

JSON: {"pair":"EURUSD","type":"BUY","quantity":0.01,"entryPrice":1.08500,"exitPrice":1.09000,"profit":50.00,"stopLoss":1.08000,"takeProfit":1.09500,"broker":"MetaTrader 5"}`;

  const data = await callAIForTradeExtraction(prompt);
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  try {
    const jsonStr = stripJsonEnvelope(content);
    const parsed = JSON.parse(jsonStr);
    const mapped = {
      pair: parsed.pair && typeof parsed.pair === "string" ? parsed.pair.trim() : null,
      type: parsed.type && typeof parsed.type === "string" ? parsed.type.trim().toUpperCase() : null,
      quantity: typeof parsed.quantity === "number" ? parsed.quantity : null,
      entryPrice: typeof parsed.entryPrice === "number" ? parsed.entryPrice : null,
      exitPrice: typeof parsed.exitPrice === "number" ? parsed.exitPrice : null,
      profit: typeof parsed.profit === "number" ? parsed.profit : null,
      stopLoss: typeof parsed.stopLoss === "number" ? parsed.stopLoss : null,
      takeProfit: typeof parsed.takeProfit === "number" ? parsed.takeProfit : null,
      broker: parsed.broker && typeof parsed.broker === "string" ? parsed.broker.trim() : null,
      strikePrice: typeof parsed.strikePrice === "number" ? parsed.strikePrice : null,
      optionType: parsed.optionType === "PE" || parsed.optionType === "CE" ? parsed.optionType : null,
      underlying: parsed.underlying && typeof parsed.underlying === "string" ? parsed.underlying.trim() : null,
    };
    return options.includeRawResponse ? { ...mapped, rawResponse: content } : mapped;
  } catch (err) {
    logger.warn("[AI extraction] Forex JSON parse error", { error: err.message });
    return null;
  }
}

// Sector lookup for top liquid NSE stocks
const STOCK_SECTOR_MAP = {
  RELIANCE: "Oil & Gas", TCS: "IT", INFY: "IT", WIPRO: "IT", HCLTECH: "IT", TECHM: "IT", COFORGE: "IT",
  ICICIBANK: "Banking", HDFCBANK: "Banking", SBIN: "Banking", KOTAKBANK: "Banking", AXISBANK: "Banking", BANKBARODA: "Banking", PNB: "Banking", CANBK: "Banking",
  HDFC: "Finance", BAJFINANCE: "Finance", BAJAJFINSV: "Finance", MUTHOOTFIN: "Finance",
  HINDUNILVR: "FMCG", ITC: "FMCG", BRITANNIA: "FMCG", NESTLEIND: "FMCG",
  MARUTI: "Auto", TATAMOTORS: "Auto", M_M: "Auto", BAJAJ_AUTO: "Auto", HEROMOTOCO: "Auto", EICHERMOT: "Auto",
  SUNPHARMA: "Pharma", DRREDDY: "Pharma", CIPLA: "Pharma", DIVISLAB: "Pharma", AUROPHARMA: "Pharma",
  TATASTEEL: "Metals", HINDALCO: "Metals", JSWSTEEL: "Metals", SAIL: "Metals",
  NTPC: "Power", POWERGRID: "Power", ADANIGREEN: "Power", TATAPOWER: "Power",
  ONGC: "Oil & Gas", BPCL: "Oil & Gas", IOC: "Oil & Gas",
  BHARTIARTL: "Telecom", INDUSINDBK: "Banking", SHREECEM: "Cement", ULTRACEMCO: "Cement", GRASIM: "Cement",
  ADANIENT: "Conglomerate", ADANIPORTS: "Infrastructure", LT: "Infrastructure",
  ASIANPAINT: "Paints", BERGEPAINT: "Paints",
  ZOMATO: "Consumer Tech", PAYTM: "Consumer Tech", NYKAA: "Consumer Tech",
};

function detectSector(symbol) {
  if (!symbol) return "";
  const normalized = symbol.replace(/[-&]/g, "_").toUpperCase();
  return STOCK_SECTOR_MAP[normalized] || "";
}

async function extractEquityIntradayWithAI(extractedText, options = {}) {
  const cleanText = String(extractedText || "")
    .replace(/(\d):(\d{2})(?!\d)/g, "$1.$2")
    .replace(/\(?\s*[+\-]?\s*[\d,]+\.\d*\s*%\s*\)?/g, " ");
  if (!cleanText || cleanText.trim().length < 10) return null;

  const brokerHint = options.brokerHint ? `Broker: ${options.brokerHint}\n` : "";
  const ocrSlice = cleanText.slice(0, 4000);
  const prompt = `You are extracting Indian EQUITY (stock) trade data from broker app OCR text — both INTRADAY and DELIVERY/CNC — NOT options/F&O.
Return ONLY valid JSON, no markdown, no explanation.
${brokerHint}
CRITICAL: IGNORE any "Today's P&L", "Total Returns", "TOTAL RETURNS", "Total P&L", "Overall P&L", or any aggregate/summary line. These are NOT stock names.
Only extract individual company/stock rows.
Ignore all market index/header values such as NIFTY 50, NIFTY BANK, BANKNIFTY, SENSEX, index P&L, time, battery, network, navigation, and summary widgets.
For each stock row, find the stock symbol first, then use the nearest row-level P&L and LTP. Never assign index values to a stock.

This may be a Positions/Holdings/Closed-Trades page. Format per row: stock name, P&L, optionally Qty + Avg price + LTP/Mkt price.
If Avg shows "0.00" or "₹0.00" with Qty=0, the position is closed — set entryPrice=null, exitPrice=null, use the P&L shown for THAT ROW.
LTP (Last Traded Price) is NEVER the entry or exit price.

STOCK SYMBOL RULES:
- If stock name is already a known NSE ticker (all caps), keep it exactly: POWERGRID→POWERGRID, RELIANCE→RELIANCE, TCS→TCS, NTPC→NTPC, ONGC→ONGC, SBIN→SBIN, HDFCBANK→HDFCBANK.
- Convert full names: VEDANTA→VEDL, HDFC BANK→HDFCBANK, SHIPPING CORPORATION→SCI, VOLTAS→VOLTAS, INFOSYS→INFY, WIPRO→WIPRO, ICICI BANK→ICICIBANK, STATE BANK→SBIN, POWER GRID→POWERGRID, POWER GRID CORPORATION→POWERGRID, COFORGE→COFORGE, NIIT TECHNOLOGIES→COFORGE.
- Never extract "LT" from UI labels like "LTP" or "Total P&L". Use LT only when the stock row itself visibly says "LT" or "L&T".
- If unsure, uppercase the name with spaces removed. NEVER invent a short abbreviation.

EXTRACTION RULES:
- stockSymbol: NSE ticker as above.
- exchange: "NSE" or "BSE". "NSE EQ" → "NSE". Default "NSE".
- sharesQty: integer shares. null if Qty=0 or not shown.
- type: "BUY" for long/buy, "SELL" for short/sell. Default "BUY".
- entryPrice: avg buy price ₹. null if "₹0.00" or not shown.
- exitPrice: avg sell price ₹. null if not shown as explicit sell/close price.
- profit: realized P&L signed number in ₹ for THAT SPECIFIC STOCK ROW. Green/+ = positive, Red/- = negative. Indian lakh: "1,23,456"=123456. Strip ₹. "+1,554.60"=1554.60.
- productType: "Delivery"/"CNC" → "DELIVERY". "Intraday"/"MIS" → "INTRADAY". Default "INTRADAY".
- broker: app name (Upstox/Zerodha/Angel One/Groww/Dhan/Fyers). null if not found.

Return ALL stock rows in "trades" array (top-level = first trade). Use null for missing fields.

OCR text:
${ocrSlice}

JSON: {"stockSymbol":"POWERGRID","exchange":"NSE","sharesQty":null,"type":"BUY","entryPrice":null,"exitPrice":null,"profit":1554.60,"productType":"DELIVERY","broker":"Upstox","trades":[{"stockSymbol":"POWERGRID","exchange":"NSE","sharesQty":null,"type":"BUY","entryPrice":null,"exitPrice":null,"profit":1554.60,"productType":"DELIVERY"}]}`;

  const data = await callAIForTradeExtraction(prompt, TIMEOUT_CONFIG.aiTimeout, { preferGemini: true });
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  const mapOne = (item) => ({
    stockSymbol: item.stockSymbol && typeof item.stockSymbol === "string" ? item.stockSymbol.trim().toUpperCase() : null,
    exchange: item.exchange === "BSE" ? "BSE" : "NSE",
    sharesQty: toNumberOrNull(item.sharesQty),
    type: item.type === "BUY" || item.type === "SELL" ? item.type : null,
    entryPrice: toNumberOrNull(item.entryPrice),
    exitPrice: toNumberOrNull(item.exitPrice),
    profit: toNumberOrNull(item.profit),
    productType: item.productType === "DELIVERY" ? "DELIVERY" : "INTRADAY",
    broker: item.broker ?? null,
  });

  try {
    const jsonStr = stripJsonEnvelope(content);
    const parsed = JSON.parse(jsonStr);
    const main = mapOne(parsed);
    if (main.stockSymbol) main.sector = detectSector(main.stockSymbol);
    const trades = Array.isArray(parsed.trades)
      ? parsed.trades.map((t) => { const m = mapOne(t); if (m.stockSymbol) m.sector = detectSector(m.stockSymbol); return m; })
      : [];
    return options.includeRawResponse ? { ...main, trades, rawResponse: content } : { ...main, trades };
  } catch {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(stripJsonEnvelope(match[0]));
      const main = mapOne(parsed);
      if (main.stockSymbol) main.sector = detectSector(main.stockSymbol);
      return { ...main, trades: [] };
    } catch {
      return null;
    }
  }
}

module.exports = { extractIndianTradeWithAI, extractEquityIntradayWithAI, extractTradeWithAI, extractTradeWithGeminiVision };
