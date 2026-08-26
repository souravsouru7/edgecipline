// Bundled extraction results for demo mode (`?demo=1`).
//
// Demo used to run a genuine upload: the sample screenshot was pushed to
// Cloudinary, an OCRJob row was written, and a paid Vision + Gemini extraction
// ran -- all to re-derive the same answer every time, because the sample is a
// fixed asset in /public. Worse, the backend has no concept of demo mode, so a
// demo click burned the user's one free upload and 403'd with the paywall once
// it was spent, and a second demo run collided with the duplicate-image check
// (the sample hashes identically for everyone).
//
// These fixtures are those extractions, transcribed by hand from the two
// bundled screenshots, so a demo run touches no network and no storage.
//
// Shape matches the COMPLETED job payload the server returns
// (`jobStatusQuery.data.data`), so `applyProcessedTradeData` in
// useUploadTrade.js consumes it unchanged. Field names follow
// buildForexTradeTemplate / buildIndianTradeTemplate in that same file.
//
// Kept free of React/Next imports so it stays runnable under `node --test`.

const INDIAN_MARKET = "Indian_Market";

// /public/sample.png -- MetaTrader 5, History > Positions, one closed position.
const FOREX_DEMO_EXTRACTION = {
  imageUrl: "/sample.png",
  brokerType: "MetaTrader 5",
  detectedMarket: "Forex",
  imageQuality: "good",
  needsReview: false,
  confidenceReport: {
    overall: "high",
    notes: "Sample screenshot bundled with the app — fields are known exactly.",
  },
  extractedText: [
    "History  All symbols",
    "POSITIONS   ORDERS   DEALS",
    "Profit: -57.62",
    "Deposit: 0.00",
    "Swap: 0.00",
    "Commission: -2.20",
    "Balance: -59.82",
    "USDCHF, sell 0.55   2026.03.04 09:35:47",
    "0.78195 -> 0.78277   -57.62",
    "#20071245   Open: 2026.03.04 09:20:55",
    "S / L: 0.78268   Swap: 0.00",
    "T / P: 0.78057   Commission: -2.20",
  ].join("\n"),
  parsedData: {
    parsedTrade: {
      pair: "USDCHF",
      action: "sell",
      lotSize: 0.55,
      entryPrice: 0.78195,
      exitPrice: 0.78277,
      stopLoss: 0.78268,
      takeProfit: 0.78057,
      profit: -57.62,
      commission: -2.2,
      swap: 0,
      balance: -59.82,
      tradeDate: "2026-03-04",
    },
    parsedTrades: [],
  },
};

// /public/sample_indianmarket.jpeg -- Upstox positions, "Closed (2)".
//
// Both rows show "0.00 Avg." with the 202.35 / 385.45 figures being LTP, not an
// exit fill, so entryPrice/exitPrice are deliberately absent: this is the
// P&L-only closed position the save validation already special-cases. lotSize
// is omitted too so inferIndianLotSize derives it from the pair (NIFTY 25,
// SENSEX 10).
const INDIAN_DEMO_EXTRACTION = {
  imageUrl: "/sample_indianmarket.jpeg",
  brokerType: "Upstox",
  detectedMarket: INDIAN_MARKET,
  tradeSubType: "OPTION",
  imageQuality: "good",
  needsReview: false,
  confidenceReport: {
    overall: "high",
    notes: "Sample screenshot bundled with the app — fields are known exactly.",
  },
  extractedText: [
    "Regular (2)   MTF   Strategy",
    "Today's P&L +4,214.75    Overall P&L +4,214.75",
    "Closed (2)",
    "NIFTY 24100 PE   +1,127.75",
    "NFO 14 JUL 26   0.00 Avg.",
    "Delivery  Qty. 0   202.35 (-35.61%) LTP",
    "SENSEX 77200 PE   +3,087.00",
    "BFO 09 JUL 26   0.00 Avg.",
    "Delivery  Qty. 0   385.45 (-54.38%) LTP",
  ].join("\n"),
  parsedData: {
    parsedTrade: {
      pair: "NIFTY 24100 PE",
      symbol: "NIFTY",
      strike: "24100",
      optionType: "PE",
      pnl: 1127.75,
      tradeDate: "2026-07-09",
    },
    parsedTrades: [
      {
        symbol: "NIFTY",
        strike: "24100",
        optionType: "PE",
        pnl: 1127.75,
        quantity: 0,
        expiryDate: "2026-07-14",
        tradeDate: "2026-07-09",
      },
      {
        symbol: "SENSEX",
        strike: "77200",
        optionType: "PE",
        pnl: 3087,
        quantity: 0,
        expiryDate: "2026-07-09",
        tradeDate: "2026-07-09",
      },
    ],
  },
};

// Broker the Indian sample was actually captured from. The demo pre-selects it
// so the dropdown matches the screenshot the user is looking at.
export const INDIAN_DEMO_BROKER = "Upstox";

// Deep-cloned per call: applyProcessedTradeData feeds these into React state,
// and a demo can be re-run, so handing out the shared module object would let
// one run's edits leak into the next.
export function getDemoExtraction(marketType) {
  const source =
    marketType === INDIAN_MARKET ? INDIAN_DEMO_EXTRACTION : FOREX_DEMO_EXTRACTION;
  return structuredClone(source);
}
