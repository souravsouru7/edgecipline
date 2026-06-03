/**
 * Seed dummy trade journal data for a given user email.
 * Creates SetupStrategies + 15 days of Forex and Indian Market trades.
 * Usage: node scripts/seedDummyTrades.js soutavr5@gmail.com
 */

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/Users");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const SetupStrategy = require("../models/SetupStrategy");

const email = process.argv[2] || "soutavr5@gmail.com";

// ─── helpers ───────────────────────────────────────────────────────────────

function daysAgo(n) {
  const d = new Date("2026-05-31T00:00:00.000Z");
  d.setDate(d.getDate() - n);
  return d;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rand(min, max, decimals = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

// ─── Forex Setup Strategies ────────────────────────────────────────────────

const forexSetups = [
  {
    name: "London Breakout",
    marketType: "Forex",
    rules: [
      { label: "Wait for London session open (08:00 GMT)" },
      { label: "Identify the 30-min high/low range" },
      { label: "Price must break range with a strong candle" },
      { label: "Volume spike confirms breakout" },
      { label: "SL placed below/above breakout candle" },
      { label: "Min RR of 1:2 before entry" },
      { label: "No entry during high-impact news" },
    ],
  },
  {
    name: "Asian Range Reversion",
    marketType: "Forex",
    rules: [
      { label: "Mark Asian session high and low" },
      { label: "Wait for price to tag range extreme" },
      { label: "Confirmation candle at the level" },
      { label: "RSI showing divergence" },
      { label: "Entry only on H1 chart" },
      { label: "Target mid-range or opposite extreme" },
    ],
  },
  {
    name: "Structure & OB Retest",
    marketType: "Forex",
    rules: [
      { label: "Identify daily bias (trend direction)" },
      { label: "Mark key structure level (HH/LL)" },
      { label: "Find order block at structure" },
      { label: "Price returns to OB on lower TF" },
      { label: "M15 confirmation candle" },
      { label: "FVG or liquidity taken before entry" },
      { label: "RR minimum 1:3" },
    ],
  },
];

// ─── Indian Market Setup Strategies ────────────────────────────────────────

const indianSetups = [
  {
    name: "Opening Range Breakout (ORB)",
    marketType: "Indian_Market",
    rules: [
      { label: "Mark 9:15–9:30 AM opening range candle" },
      { label: "Wait for candle close above/below ORB" },
      { label: "Volume must be 1.5x average" },
      { label: "VIX below 18 for directional trades" },
      { label: "SL below ORB low / above ORB high" },
      { label: "Target minimum 1:2 RR" },
      { label: "No entry after 11:30 AM" },
    ],
  },
  {
    name: "VWAP Rejection",
    marketType: "Indian_Market",
    rules: [
      { label: "Price approaches VWAP from below/above" },
      { label: "Look for pin bar or engulfing at VWAP" },
      { label: "Higher volume at rejection" },
      { label: "Align with daily trend" },
      { label: "Entry on 5-min TF confirmation" },
      { label: "Move SL to breakeven at 1:1" },
    ],
  },
  {
    name: "Support/Resistance Options Play",
    marketType: "Indian_Market",
    rules: [
      { label: "Identify weekly S/R level on Nifty/BankNifty chart" },
      { label: "Check PCR (Put-Call Ratio) for bias" },
      { label: "Wait for price to test level twice" },
      { label: "Buy ATM option after confirmation" },
      { label: "Exit if premium drops 40% from entry" },
      { label: "Avoid trading 30 min before expiry" },
      { label: "No trade on Budget/Fed day without tight SL" },
    ],
  },
];

// ─── Forex trades data (15 days) ───────────────────────────────────────────

function buildForexTrades(userId, setupDocs) {
  const pairs = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "GBP/JPY", "EUR/GBP"];
  const sessions = ["London", "New York", "Asian", "London/NY Overlap"];
  const strategies = setupDocs.map((s) => s.name);
  const moods = [1, 2, 3, 4, 5];
  const confidences = ["Low", "Medium", "High", "Overconfident"];
  const entryBases = ["Plan", "Emotion", "Impulsive", "Plan"];
  const emotionPool = ["Calm", "Anxious", "Focused", "FOMO", "Hesitant", "Confident", "Disciplined", "Greedy", "Patient"];
  const mistakeTags = ["", "Early entry", "Ignored SL", "Chased price", "Overtraded", "Revenge trade", "News risk"];
  const lessons = [
    "Waited patiently for the setup and was rewarded.",
    "Entered too early before confirmation — need more discipline.",
    "Moved SL too tight, got stopped out before the move.",
    "Great execution, stuck to the plan throughout.",
    "Should have closed half at 1:2 and let the rest run.",
    "Checked the news calendar before entering — avoided a whipsaw.",
    "Overconfidence led to sizing up too much. Keep position size consistent.",
    "The setup was textbook, but spreads were wider than usual during news.",
    "Took a revenge trade after a loss. Never do this again.",
    "Trusted the structure and was patient — entry was perfect.",
  ];

  const trades = [];

  for (let day = 0; day < 15; day++) {
    const tradesPerDay = pick([1, 1, 2, 2, 3]);
    const date = daysAgo(14 - day);
    const setupDoc = setupDocs[day % setupDocs.length];

    for (let t = 0; t < tradesPerDay; t++) {
      const type = pick(["BUY", "SELL"]);
      const pair = pick(pairs);
      const isJpy = pair.includes("JPY");
      const baseEntry = isJpy ? rand(140, 158, 3) : rand(1.05, 1.35, 5);
      const pip = isJpy ? 0.01 : 0.0001;
      const slPips = rand(15, 40, 0);
      const tpPips = slPips * rand(1.5, 3.5, 1);
      const entryPrice = baseEntry;
      const stopLoss =
        type === "BUY"
          ? parseFloat((entryPrice - slPips * pip).toFixed(isJpy ? 3 : 5))
          : parseFloat((entryPrice + slPips * pip).toFixed(isJpy ? 3 : 5));
      const takeProfit =
        type === "BUY"
          ? parseFloat((entryPrice + tpPips * pip).toFixed(isJpy ? 3 : 5))
          : parseFloat((entryPrice - tpPips * pip).toFixed(isJpy ? 3 : 5));
      const won = Math.random() > 0.4;
      const exitPrice = won
        ? parseFloat((takeProfit + rand(-2, 2) * pip).toFixed(isJpy ? 3 : 5))
        : parseFloat((stopLoss + rand(-1, 1) * pip).toFixed(isJpy ? 3 : 5));
      const lotSize = pick([0.1, 0.2, 0.5, 1.0]);
      const multiplier = isJpy ? 1000 : 100000;
      const rawProfit = (exitPrice - entryPrice) * (type === "BUY" ? 1 : -1) * lotSize * multiplier;
      const profit = parseFloat(rawProfit.toFixed(2));
      const commission = parseFloat((lotSize * 3.5).toFixed(2));
      const swap = parseFloat((rand(-0.5, 0.5) * lotSize).toFixed(2));
      const mood = pick(moods);
      const confidence = pick(confidences);
      const entryBasis = pick(entryBases);
      const emotionalTags = [pick(emotionPool), pick(emotionPool)].filter((v, i, a) => a.indexOf(v) === i);
      const wouldRetake = profit > 0 ? pick(["Yes", "Yes", "No"]) : pick(["No", "No", "Yes"]);
      const rrNum = parseFloat((tpPips / slPips).toFixed(1));
      const rrLabel =
        rrNum <= 1.1
          ? "1:1"
          : rrNum <= 1.6
          ? "1:1"
          : rrNum <= 2.1
          ? "1:2"
          : rrNum <= 3.1
          ? "1:3"
          : "custom";

      const followedCount = Math.floor(Math.random() * setupDoc.rules.length);
      const setupRules = setupDoc.rules.map((r, i) => ({
        label: r.label,
        followed: i < followedCount,
      }));
      const setupScore = Math.round((followedCount / setupDoc.rules.length) * 100);

      trades.push({
        user: userId,
        pair,
        type,
        quantity: 1,
        lotSize,
        entryPrice,
        exitPrice,
        stopLoss,
        takeProfit,
        profit,
        commission,
        swap,
        balance: parseFloat((10000 + profit - commission + swap).toFixed(2)),
        strategy: setupDoc.name,
        session: pick(sessions),
        tradeDate: date,
        notes: `${pair} ${type} — ${won ? "Hit TP cleanly" : "Stopped out"}. ${entryBasis === "Plan" ? "Followed plan." : "Deviated from plan."} Session: ${pick(sessions)}.`,
        riskRewardRatio: rrLabel === "custom" ? "custom" : rrLabel,
        riskRewardCustom: rrLabel === "custom" ? `1:${rrNum}` : "",
        marketType: "Forex",
        broker: pick(["IC Markets", "Pepperstone", "XM", "FXTM"]),
        segment: "Spot",
        instrumentType: "Currency",
        entryBasis,
        entryBasisCustom: entryBasis === "Custom" ? "Gut feeling based on momentum" : "",
        mood,
        confidence,
        emotionalTags,
        mistakeTag: profit < 0 ? pick(mistakeTags.filter(Boolean)) : "",
        lesson: pick(lessons),
        wouldRetake,
        setupRules,
        setupScore,
        status: "completed",
        isValid: true,
        needsReview: setupScore < 50,
        extractionConfidence: rand(75, 98, 0),
        processedAt: date,
        createdAt: date,
        updatedAt: date,
      });
    }
  }

  return trades;
}

// ─── Indian Market trades data (15 days) ───────────────────────────────────

function buildIndianTrades(userId, setupDocs) {
  const underlyings = ["NIFTY", "BANKNIFTY", "FINNIFTY", "RELIANCE", "TCS", "HDFC"];
  const sessions = ["Morning", "Midday", "Pre-close"];
  const emotionPool = ["Calm", "Anxious", "Focused", "FOMO", "Disciplined", "Patient", "Overconfident", "Greedy"];
  const mistakeTags = ["", "Early entry", "Ignored SL", "Chased price", "Held too long", "Under-sized", "Revenge trade"];
  const lessons = [
    "ORB strategy worked perfectly — patience before 9:30 paid off.",
    "Should not have entered after 11:30 AM. Time discipline matters.",
    "VWAP acted as strong resistance, trade went as planned.",
    "VIX was high, should have sized down.",
    "Perfect PCR reading led to a confident entry.",
    "Held the trade through noise — conviction in the setup was key.",
    "Took loss quickly as plan invalidated. Protected capital.",
    "Overconfident after a winning streak — sized up too much.",
    "News event spiked price, SL was tight enough to save the trade.",
    "Need to wait for second candle close before entering ORB.",
  ];

  const trades = [];

  for (let day = 0; day < 15; day++) {
    const tradesPerDay = pick([1, 1, 2, 2]);
    const date = daysAgo(14 - day);
    const setupDoc = setupDocs[day % setupDocs.length];

    for (let t = 0; t < tradesPerDay; t++) {
      const underlying = pick(underlyings);
      const isEquity = ["RELIANCE", "TCS", "HDFC"].includes(underlying);
      const type = pick(["BUY", "SELL"]);
      const optionType = type === "BUY" ? "CE" : "PE";
      const instrumentType = isEquity ? "EQUITY" : "OPTION";
      const segment = isEquity ? "EQUITY" : "F&O";
      const tradeType = isEquity ? pick(["INTRADAY", "DELIVERY", "SWING"]) : "INTRADAY";

      let pair, strikePrice, expiryDate, quantity, lotSize, entryPrice, exitPrice, stopLoss, takeProfit, stockSymbol, sharesQty, sector;

      if (!isEquity) {
        const spotPrice = underlying === "NIFTY" ? rand(22000, 24500, 0) : underlying === "BANKNIFTY" ? rand(47000, 52000, 0) : rand(20000, 22000, 0);
        strikePrice = Math.round(spotPrice / 100) * 100;
        const expiryOffset = pick([7, 14, 21]);
        expiryDate = new Date(date.getTime() + expiryOffset * 24 * 60 * 60 * 1000);
        lotSize = underlying === "NIFTY" ? 25 : underlying === "BANKNIFTY" ? 15 : 40;
        quantity = pick([1, 2, 3]);
        entryPrice = rand(50, 400, 2);
        const slAmt = rand(10, 60, 2);
        const tpAmt = slAmt * rand(1.5, 3, 1);
        stopLoss = parseFloat((entryPrice - slAmt).toFixed(2));
        takeProfit = parseFloat((entryPrice + tpAmt).toFixed(2));
        const won = Math.random() > 0.45;
        exitPrice = won ? parseFloat((takeProfit + rand(-5, 5)).toFixed(2)) : parseFloat((stopLoss + rand(-3, 3)).toFixed(2));
        pair = `${underlying} ${strikePrice} ${optionType}`;
        stockSymbol = "";
        sharesQty = null;
        sector = "";
      } else {
        const basePrice = underlying === "RELIANCE" ? rand(2800, 3100, 2) : underlying === "TCS" ? rand(3500, 4000, 2) : rand(1600, 1900, 2);
        entryPrice = basePrice;
        const slAmt = rand(20, 80, 2);
        const tpAmt = slAmt * rand(1.5, 2.5, 1);
        stopLoss = parseFloat((entryPrice - slAmt).toFixed(2));
        takeProfit = parseFloat((entryPrice + tpAmt).toFixed(2));
        const won = Math.random() > 0.45;
        exitPrice = won ? parseFloat((takeProfit + rand(-3, 3)).toFixed(2)) : parseFloat((stopLoss + rand(-2, 2)).toFixed(2));
        sharesQty = pick([25, 50, 100]);
        quantity = sharesQty;
        lotSize = 1;
        strikePrice = null;
        expiryDate = null;
        pair = `${underlying} ${type}`;
        stockSymbol = underlying;
        sector = underlying === "RELIANCE" ? "Energy" : underlying === "TCS" ? "IT" : "Banking";
      }

      const rawProfit = (exitPrice - entryPrice) * (type === "BUY" ? 1 : -1) * (isEquity ? sharesQty : quantity * lotSize);
      const profit = parseFloat(rawProfit.toFixed(2));
      const brokerage = parseFloat((quantity * 20).toFixed(2));
      const sttTaxes = parseFloat((Math.abs(profit) * 0.0005).toFixed(2));
      const mood = pick([1, 2, 3, 4, 5]);
      const confidence = pick(["Low", "Medium", "High", "Overconfident"]);
      const entryBasis = pick(["Plan", "Plan", "Emotion", "Impulsive"]);
      const emotionalTags = [pick(emotionPool), pick(emotionPool)].filter((v, i, a) => a.indexOf(v) === i);
      const wouldRetake = profit > 0 ? pick(["Yes", "Yes", "No"]) : pick(["No", "No", "Yes"]);

      const followedCount = Math.floor(Math.random() * setupDoc.rules.length);
      const setupRules = setupDoc.rules.map((r, i) => ({
        label: r.label,
        followed: i < followedCount,
      }));
      const setupScore = Math.round((followedCount / setupDoc.rules.length) * 100);

      const rrRaw = parseFloat(((takeProfit - entryPrice) / (entryPrice - stopLoss)).toFixed(1));
      const rrLabel = rrRaw <= 1.1 ? "1:1" : rrRaw <= 1.6 ? "1:1.5" : rrRaw <= 2.1 ? "1:2" : rrRaw <= 3.1 ? "1:3" : "custom";

      trades.push({
        user: userId,
        pair,
        underlying: isEquity ? stockSymbol : underlying,
        type,
        optionType: isEquity ? "CE" : optionType,
        entryPrice,
        exitPrice,
        stopLoss,
        takeProfit,
        profit,
        strategy: setupDoc.name,
        session: pick(sessions),
        tradeDate: date,
        notes: `${pair} ${type} — ${profit > 0 ? "Profitable" : "Loss"}. ${entryBasis === "Plan" ? "Setup criteria met." : "Emotional entry — must review."} VIX context considered.`,
        riskRewardRatio: rrLabel,
        riskRewardCustom: rrLabel === "custom" ? `1:${rrRaw}` : "",
        segment,
        instrumentType,
        tradeType,
        ...(isEquity
          ? { stockSymbol, exchange: "NSE", sharesQty, sector }
          : { strikePrice, expiryDate, quantity, lotSize }),
        brokerage,
        sttTaxes,
        entryBasis,
        entryBasisCustom: entryBasis === "Impulsive" ? "Saw momentum and jumped in without confirmation" : "",
        setup: setupDoc.name,
        mistakeTag: profit < 0 ? pick(mistakeTags.filter(Boolean)) : "",
        lesson: pick(lessons),
        mood,
        confidence,
        emotionalTags,
        wouldRetake,
        setupRules,
        setupScore,
        createdAt: date,
        updatedAt: date,
      });
    }
  }

  return trades;
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No user found with email: ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Found user: ${user.name} (${user._id})`);

  // Remove existing dummy data for clean re-seed
  await Promise.all([
    SetupStrategy.deleteMany({ user: user._id }),
    Trade.deleteMany({ user: user._id }),
    IndianTrade.deleteMany({ user: user._id }),
  ]);
  console.log("Cleared existing trade and setup data for user");

  // Create Forex setups
  const forexSetupDocs = await SetupStrategy.insertMany(
    forexSetups.map((s) => ({ ...s, user: user._id }))
  );
  console.log(`Created ${forexSetupDocs.length} Forex SetupStrategies`);

  // Create Indian Market setups
  const indianSetupDocs = await SetupStrategy.insertMany(
    indianSetups.map((s) => ({ ...s, user: user._id }))
  );
  console.log(`Created ${indianSetupDocs.length} Indian Market SetupStrategies`);

  // Build and insert Forex trades
  const forexTrades = buildForexTrades(user._id, forexSetupDocs);
  await Trade.insertMany(forexTrades);
  console.log(`Inserted ${forexTrades.length} Forex trades`);

  // Build and insert Indian market trades
  const indianTrades = buildIndianTrades(user._id, indianSetupDocs);
  await IndianTrade.insertMany(indianTrades);
  console.log(`Inserted ${indianTrades.length} Indian Market trades`);

  console.log("\nSeed complete.");
  console.log(`  Forex trades    : ${forexTrades.length}`);
  console.log(`  Indian trades   : ${indianTrades.length}`);
  console.log(`  Setups (Forex)  : ${forexSetupDocs.length}`);
  console.log(`  Setups (Indian) : ${indianSetupDocs.length}`);

  await mongoose.disconnect();
})();
