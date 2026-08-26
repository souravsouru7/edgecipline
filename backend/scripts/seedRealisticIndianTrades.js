/**
 * Seed a realistic Indian-market trade journal for one user.
 *
 * Unlike scripts/seedDummyTrades.js (which wipes the user's data and generates
 * random trades), this script is additive and hand-authored: 20 NSE sessions of
 * Groww-style intraday equity + BANKNIFTY options that read as one trader's
 * four weeks — a loose opening week that ends in a tilt day, the sit-out that
 * starts the journal, a disciplined rebuild, one overconfidence blow-up, and a
 * recovery back to single-trade days.
 *
 * Every seeded trade gets a deterministic ObjectId in the 0x5eed... range, so
 * re-running replaces the seed and never touches real (OCR-extracted or
 * manually logged) trades.
 *
 * Usage: node scripts/seedRealisticIndianTrades.js [email]
 */

require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const User = require("../models/Users");
const IndianTrade = require("../models/IndianTrade");
const SetupStrategy = require("../models/SetupStrategy");
const DailyDisciplineEntry = require("../models/DailyDisciplineEntry");
const streakService = require("../services/streak.service");

const email = process.argv[2] || "soutavr5@gmail.com";

// Seeded docs live in a reserved ObjectId range so a re-run is idempotent
// without deleting the user's real trades.
const SEED_PREFIX = "5eed";
const seedObjectId = (i) =>
  new mongoose.Types.ObjectId(SEED_PREFIX + i.toString(16).padStart(20, "0"));
const SEED_RANGE = {
  $gte: new mongoose.Types.ObjectId(SEED_PREFIX + "0".repeat(20)),
  $lte: new mongoose.Types.ObjectId(SEED_PREFIX + "f".repeat(20)),
};

// ─── Setups (checklists the trader actually uses) ───────────────────────────

const ORB = "Opening Range Breakout";
const VBR = "Volume Breakout Retest";
const VWAP = "BANKNIFTY VWAP Pullback"; // already exists for this user

const SETUPS = {
  [ORB]: [
    "Mark the 9:15-9:30 opening range high and low",
    "Wait for a 5-min close outside the range",
    "Breakout candle volume above the 20-bar average",
    "Stop goes at the opposite end of the opening range",
    "No fresh entry after 11:30 AM",
  ],
  [VBR]: [
    "Level has at least two prior touches",
    "Breakout candle closes above the level on rising volume",
    "Enter only on the retest, never the first push",
    "Risk capped at 1% of capital",
  ],
  [VWAP]: [
    "Trend direction is clear before the pullback",
    "Price pulls back near VWAP or a key moving average",
    "Rejection candle forms in the trend direction",
    "Target gives at least 1:2 risk reward",
  ],
};

const SECTOR = {
  SBIN: "Banking",
  HDFCBANK: "Banking",
  RELIANCE: "Energy",
  TATAMOTORS: "Auto",
  TATASTEEL: "Metal",
  INFY: "IT",
  BEL: "Other",
  HITACHIENERGY: "Energy",
  SUNPHARMA: "Pharma",
  ICICIBANK: "Banking",
};

// BANKNIFTY has monthly expiry only (weeklies were withdrawn in Nov 2024), so
// each option trade carries the contract that was actually near-dated for it.
const BNF_EXPIRY_JUL = "2026-07-30"; // last Thursday of July
const BNF_EXPIRY_AUG = "2026-08-27"; // last Thursday of August

// ─── The journal: 20 sessions, hand-written ─────────────────────────────────
// eq: [symbol, shares]   opt: [underlying, strike, CE|PE, lots, lotSize]
// skip: indices of checklist rules that were NOT followed on this trade.
//
// RULE FOR `tags`, `mood` and `confidence`: these describe the trader's state
// BEFORE the trade, so they must never be a function of the result. A focused,
// fully-checklisted trade that loses still gets tagged "Focused"; a revenge
// trade that happens to pay still gets tagged "Revenge" and graded Poor.
// Letting outcome leak into the tags makes every tag a perfect predictor of
// P&L, which turns the intelligence engine's insights into tautologies -- it
// reports back the label rather than discovering anything.

const SESSIONS = [
  {
    day: "2026-07-27",
    trades: [
      {
        at: "09:41", eq: ["SBIN", 60], type: "BUY",
        entry: 798.60, sl: 793.00, tp: 809.80, exit: 806.20,
        strategy: ORB, skip: [2],
        mood: 3, confidence: "Medium", tags: ["Calm"], basis: "Plan",
        mistake: "", quality: "Average", retake: "Yes",
        notes: "First day writing anything down. SBIN broke the opening range at 798, took 60 shares, out at 806.",
        lesson: "Did not check volume on the breakout candle. Small thing, but it is on the checklist for a reason.",
      },
      {
        at: "10:38", eq: ["TATASTEEL", 500], type: "BUY",
        entry: 148.20, sl: 146.40, tp: 151.80, exit: 146.35,
        strategy: VBR, skip: [1, 2],
        mood: 2, confidence: "Medium", tags: ["FOMO"], basis: "Impulsive",
        mistake: "Held too long", quality: "Poor", retake: "No",
        notes: "Saw it pushing through 148 and bought the first candle. No retest, no volume. Sat through the stop and got out at 146.35.",
        lesson: "Buying the first push is not the setup. The retest is the setup.",
      },
      {
        at: "13:52", eq: ["SBIN", 60], type: "BUY",
        entry: 804.00, sl: 799.00, tp: 814.00, exit: 807.20,
        strategy: ORB, skip: [1, 2, 4],
        mood: 2, confidence: "Low", tags: ["Revenge", "Frustrated"], basis: "Emotion",
        mistake: "Revenge trade", quality: "Poor", retake: "No",
        notes: "Went back to SBIN in the afternoon because it worked in the morning. There was no opening range left to trade by 1:52. It went up anyway and I took 3 points.",
        lesson: "It paid, which is the worst outcome. I broke my own time rule to fix a P&L and got rewarded for it, so now the habit has a payout attached to it. Still grading this Poor.",
      },
    ],
  },
  {
    day: "2026-07-28",
    trades: [
      {
        at: "09:36", eq: ["RELIANCE", 40], type: "BUY",
        entry: 1281.50, sl: 1272.00, tp: 1300.50, exit: 1299.80,
        strategy: ORB, skip: [],
        mood: 4, confidence: "Medium", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "Clean Reliance opening range, 1272-1281. Broke with volume, stop under the low, out just under target at 1299.80.",
        lesson: "Full checklist, no thinking required. This is the one to repeat.",
      },
      {
        at: "12:20", eq: ["SUNPHARMA", 90], type: "BUY",
        entry: 1742.00, sl: 1730.00, tp: 1766.00, exit: 1728.50,
        strategy: VBR, skip: [0, 1, 2],
        mood: 2, confidence: "Overconfident", tags: ["FOMO", "Greed"], basis: "Impulsive",
        mistake: "Held too long", quality: "Poor", retake: "No",
        notes: "SUNPHARMA is not on my watchlist. Saw it on a mover list at lunch and took 90 shares off a chart I had never looked at before.",
        lesson: "No levels on a stock I do not track, so I had no reason to be in it and no idea where to get out.",
      },
    ],
  },
  {
    day: "2026-07-29",
    trades: [
      {
        at: "09:33", eq: ["TATAMOTORS", 150], type: "BUY",
        entry: 705.40, sl: 699.00, tp: 718.20, exit: 698.60,
        strategy: ORB, skip: [1],
        mood: 3, confidence: "Medium", tags: ["Calm"], basis: "Plan",
        mistake: "Chased entry", quality: "Average", retake: "Yes",
        notes: "Took the Tata Motors break at 705 before the 5-min candle actually closed above the range. Stop hit at 698.60.",
        lesson: "Entering two minutes early cost me the whole trade. Wait for the close.",
      },
      {
        at: "10:11", eq: ["TATAMOTORS", 200], type: "BUY",
        entry: 700.20, sl: 692.00, tp: 716.60, exit: 691.80,
        strategy: ORB, skip: [1, 2, 3],
        mood: 1, confidence: "Overconfident", tags: ["Revenge", "Frustrated"], basis: "Emotion",
        mistake: "Revenge trade", quality: "Poor", retake: "No",
        notes: "Straight back into the same stock with 200 shares instead of 150 to get the first loss back in one go.",
        lesson: "Adding size to a trade I just lost on is the single most expensive thing I do.",
      },
      {
        at: "11:47", opt: ["BANKNIFTY", 51500, "CE", 1, 30], type: "BUY",
        entry: 142.00, sl: 118.00, tp: 205.00, exit: 96.40,
        expiry: BNF_EXPIRY_JUL,
        strategy: VWAP, skip: [0, 1, 2, 3],
        mood: 1, confidence: "Low", tags: ["Revenge", "Fear"], basis: "Impulsive",
        mistake: "Revenge trade", quality: "Poor", retake: "No",
        notes: "Bought an expiry-eve 51500 CE with no trend, no pullback and no rejection candle. Premium went 142 to 96 in about twenty minutes.",
        lesson: "Buying a one-day option to recover an equity loss is not trading. Worst day of the month and all three were mine to avoid.",
      },
    ],
  },
  {
    day: "2026-07-30",
    noTrade: "Four red days in a row. Did not take a position, sat and read back through the week's screenshots and set this journal up properly.",
  },
  {
    day: "2026-07-31",
    trades: [
      {
        at: "09:47", eq: ["HITACHIENERGY", 5], type: "BUY",
        entry: 11587.00, sl: 11420.00, tp: 11921.00, exit: 12000.00,
        strategy: VBR, skip: [],
        mood: 4, confidence: "High", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "One trade, full checklist. Hitachi had two touches at 11,580, broke on volume, waited for the retest and took 5 shares. Target was 11,921, it kept going so I flattened at 12,000 even.",
        lesson: "One setup, one entry, one exit. First green day in a week and it was the quietest one.",
      },
    ],
  },
  {
    day: "2026-08-03",
    trades: [
      {
        at: "09:44", eq: ["ICICIBANK", 90], type: "BUY",
        entry: 1024.60, sl: 1017.00, tp: 1039.80, exit: 1038.90,
        strategy: ORB, skip: [],
        mood: 4, confidence: "Medium", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "ICICI opening range 1017-1024, took the break with 90 shares. Out at 1038.90, a rupee under target.",
        lesson: "Second clean single-trade day. Keeping size the same every time is doing most of the work.",
      },
    ],
  },
  {
    day: "2026-08-04",
    trades: [
      {
        at: "09:39", eq: ["BEL", 400], type: "BUY",
        entry: 296.40, sl: 293.20, tp: 302.80, exit: 302.60,
        strategy: ORB, skip: [],
        mood: 4, confidence: "Medium", tags: ["Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "BEL range break at 296.40 on good volume, 400 shares, out at 302.60 into the target.",
        lesson: "Third session in a row where the only trade was the planned one.",
      },
      {
        at: "14:05", eq: ["TATASTEEL", 350], type: "BUY",
        entry: 150.10, sl: 148.60, tp: 153.10, exit: 151.85,
        strategy: VBR, skip: [1, 2, 3],
        mood: 3, confidence: "Overconfident", tags: ["Greed", "FOMO"], basis: "Impulsive",
        mistake: "Overtraded", quality: "Poor", retake: "No",
        notes: "BEL had already paid for the day and I took a second one at 2pm anyway. No retest, no volume, size picked off the top of my head. It went my way.",
        lesson: "A green number on a trade I should not have taken. Counting it as a loss in the review or I will do it again.",
      },
    ],
  },
  {
    day: "2026-08-05",
    trades: [
      {
        at: "09:51", eq: ["HDFCBANK", 55], type: "BUY",
        entry: 1698.40, sl: 1689.00, tp: 1717.20, exit: 1689.20,
        strategy: VBR, skip: [],
        mood: 4, confidence: "Medium", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "HDFCBANK retest at 1698 held for about ten minutes then rolled over. Stop hit at 1689.20, closed it there.",
        lesson: "Stop hit, no argument, no second entry. This is the version of losing I am fine with.",
      },
      {
        at: "10:29", opt: ["BANKNIFTY", 52000, "CE", 1, 30], type: "BUY",
        entry: 171.80, sl: 148.00, tp: 219.00, exit: 218.40,
        strategy: VWAP, skip: [],
        mood: 5, confidence: "High", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "Bank Nifty trending up, pulled back into VWAP at 10:25, rejection candle, took the 52000 CE. Out at 218.40 near the target.",
        lesson: "Taking the option setup right after an equity stop-out is fine as long as it is a real setup and not a reaction.",
      },
    ],
  },
  {
    day: "2026-08-06",
    trades: [
      {
        at: "09:42", eq: ["SBIN", 80], type: "BUY",
        entry: 812.40, sl: 807.00, tp: 823.20, exit: 820.35,
        strategy: ORB, skip: [2],
        mood: 4, confidence: "Medium", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "Exited early", quality: "Average", retake: "Yes",
        notes: "ORB long over the 9:15-9:30 high at 812. Booked at 820 when it stalled under the target.",
        lesson: "Exit was fine but I left the last leg on the table.",
      },
      {
        at: "09:58", eq: ["TATAMOTORS", 120], type: "BUY",
        entry: 726.80, sl: 719.50, tp: 741.40, exit: 711.40,
        strategy: ORB, skip: [1, 2, 3],
        mood: 2, confidence: "Overconfident", tags: ["FOMO", "Greed"], basis: "Impulsive",
        mistake: "Held too long", quality: "Poor", retake: "No",
        notes: "Chased the breakout five minutes after SBIN worked. No retest, just jumped in because it was moving.",
        lesson: "If I miss the entry candle the trade is gone. Do not chase.",
      },
      {
        at: "11:20", eq: ["TATAMOTORS", 90], type: "BUY",
        entry: 713.20, sl: 700.00, tp: 739.60, exit: 700.80,
        strategy: ORB, skip: [1, 2, 3],
        mood: 1, confidence: "Low", tags: ["Revenge", "Frustrated"], basis: "Emotion",
        mistake: "Revenge trade", quality: "Poor", retake: "No",
        notes: "Went straight back into TATAMOTORS to make the loss back. Wider stop so it could not hit me. It did.",
        lesson: "Never re-enter the same stock within 30 minutes of a loss.",
      },
    ],
  },
  {
    day: "2026-08-07",
    trades: [
      {
        at: "09:35", eq: ["RELIANCE", 45], type: "BUY",
        entry: 1298.20, sl: 1288.00, tp: 1328.80, exit: 1328.00,
        strategy: ORB, skip: [],
        mood: 4, confidence: "High", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "Textbook ORB. Range 1290-1298, broke with volume, stop under the range low.",
        lesson: "When the opening range is tight the trade pays. Wait for the tight ones.",
      },
      {
        at: "14:10", eq: ["INFY", 30], type: "SELL",
        entry: 1886.50, sl: 1898.00, tp: 1863.50, exit: 1919.20,
        strategy: VBR, skip: [1, 2],
        mood: 2, confidence: "Low", tags: ["Bored", "FOMO"], basis: "Emotion",
        mistake: "Held too long", quality: "Poor", retake: "No",
        notes: "Afternoon short with no real setup. I was bored after booking Reliance early.",
        lesson: "My edge is before 11:30. After that I am just paying brokerage.",
      },
    ],
  },
  {
    day: "2026-08-10",
    trades: [
      {
        at: "09:52", eq: ["HITACHIENERGY", 3], type: "BUY",
        entry: 12088.00, sl: 11905.00, tp: 12637.00, exit: 12634.00,
        strategy: VBR, skip: [],
        mood: 5, confidence: "High", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "Only trade of the day. Breakout at 12,090, retested, held. Sized small because the stop is wide on this one.",
        lesson: "One good trade beats three average ones.",
      },
    ],
  },
  {
    day: "2026-08-11",
    trades: [
      {
        at: "09:48", opt: ["BANKNIFTY", 52500, "CE", 1, 30], type: "BUY",
        entry: 186.40, sl: 152.00, tp: 255.00, exit: 249.65,
        strategy: VWAP, skip: [],
        mood: 4, confidence: "High", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "BANKNIFTY held VWAP on the 9:45 pullback, took the 52500 CE. Booked at 249 into the 11 o'clock stall.",
        lesson: "The VWAP pullback works best in the first hour.",
      },
      {
        at: "11:05", eq: ["TATASTEEL", 420], type: "SELL",
        entry: 152.85, sl: 154.70, tp: 149.20, exit: 154.65,
        strategy: ORB, skip: [1, 2],
        mood: 3, confidence: "Medium", tags: ["Greed"], basis: "Plan",
        mistake: "", quality: "Average", retake: "No",
        notes: "Short after the failed breakout. Stopped at 154.65, took it without arguing.",
        lesson: "A loss taken at the stop is a good loss.",
      },
    ],
  },
  {
    day: "2026-08-12",
    trades: [
      {
        at: "09:40", eq: ["SBIN", 105], type: "BUY",
        entry: 818.60, sl: 808.50, tp: 838.80, exit: 808.60,
        strategy: ORB, skip: [],
        mood: 4, confidence: "Medium", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "Same SBIN setup as last week, it just did not follow through. Stop hit at 808.60.",
        lesson: "Right process, wrong day. Nothing to fix here.",
      },
    ],
  },
  {
    day: "2026-08-13",
    noTrade: "Gap-up open and choppy after that. No opening range worth trading, sat out.",
  },
  {
    day: "2026-08-14",
    trades: [
      {
        at: "09:38", eq: ["RELIANCE", 50], type: "BUY",
        entry: 1305.40, sl: 1294.00, tp: 1339.60, exit: 1339.80,
        strategy: ORB, skip: [],
        mood: 5, confidence: "High", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "Second Reliance ORB in a week. Same range structure, same stop distance.",
        lesson: "Repeating one setup on one stock is where the money is.",
      },
      {
        at: "10:26", eq: ["HDFCBANK", 40], type: "BUY",
        entry: 1718.20, sl: 1707.00, tp: 1740.60, exit: 1740.20,
        strategy: VBR, skip: [],
        mood: 4, confidence: "High", tags: ["Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "Bank Nifty was the strongest index, so I took HDFCBANK on the 10:20 retest. Out at target.",
        lesson: "Trade the strongest sector, not the loudest ticker.",
      },
    ],
  },
  {
    day: "2026-08-17",
    trades: [
      {
        at: "09:55", eq: ["HITACHIENERGY", 3], type: "BUY",
        entry: 12210.00, sl: 12030.00, tp: 12715.00, exit: 12713.00,
        strategy: VBR, skip: [],
        mood: 5, confidence: "High", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "Back to the Hitachi breakout. Waited for the retest at 12,210 instead of buying the first push.",
        lesson: "Patience on the retest is worth about 100 points on this stock.",
      },
    ],
  },
  {
    day: "2026-08-18",
    trades: [
      {
        at: "09:47", opt: ["BANKNIFTY", 52800, "PE", 1, 30], type: "BUY",
        entry: 214.50, sl: 186.00, tp: 262.00, exit: 262.10,
        strategy: VWAP, skip: [],
        mood: 4, confidence: "High", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "BANKNIFTY rejected VWAP from below at 9:45, took the 52800 PE on the rejection candle. Out at 262.",
        lesson: "Rejection candle first, entry second. In that order it works.",
      },
      {
        at: "10:52", eq: ["BEL", 300], type: "BUY",
        entry: 304.20, sl: 300.80, tp: 311.00, exit: 306.50,
        strategy: ORB, skip: [2],
        mood: 4, confidence: "Medium", tags: ["Focused"], basis: "Plan",
        mistake: "Exited early", quality: "Average", retake: "Yes",
        notes: "BEL ORB, small size. Took two points and left because it felt slow.",
        lesson: "Slow does not mean wrong. Give the trade its time stop.",
      },
    ],
  },
  {
    day: "2026-08-19",
    trades: [
      {
        at: "09:33", eq: ["TATAMOTORS", 240], type: "BUY",
        entry: 731.50, sl: 724.00, tp: 746.50, exit: 718.50,
        strategy: ORB, skip: [1, 2, 3],
        mood: 2, confidence: "Overconfident", tags: ["Greed", "FOMO"], basis: "Impulsive",
        mistake: "Held too long", quality: "Poor", retake: "No",
        notes: "Doubled my usual size after four green days. Entered before the 9:30 candle even closed.",
        lesson: "Size up on the strategy, not on the mood.",
      },
      {
        at: "10:14", eq: ["INFY", 40], type: "BUY",
        entry: 1894.00, sl: 1876.00, tp: 1930.00, exit: 1863.00,
        strategy: VBR, skip: [1, 2, 3],
        mood: 1, confidence: "Low", tags: ["Revenge", "Frustrated"], basis: "Emotion",
        mistake: "Revenge trade", quality: "Poor", retake: "No",
        notes: "Straight into INFY to get the Tata loss back. Bigger stop than the first trade, which tells me everything.",
        lesson: "The second trade after a big loss is never a setup.",
      },
      {
        at: "13:40", eq: ["RELIANCE", 40], type: "BUY",
        entry: 1311.00, sl: 1304.00, tp: 1325.00, exit: 1324.00,
        strategy: ORB, skip: [1, 2, 4],
        mood: 2, confidence: "Low", tags: ["Fear"], basis: "Emotion",
        mistake: "Exited early", quality: "Poor", retake: "No",
        notes: "Small size just to end the day on something green. Took 13 points and shut the terminal.",
        lesson: "Trading to feel better is still trading to feel better, even when it works.",
      },
    ],
  },
  {
    day: "2026-08-20",
    trades: [
      {
        at: "09:44", eq: ["SBIN", 100], type: "BUY",
        entry: 822.30, sl: 815.00, tp: 837.00, exit: 834.10,
        strategy: ORB, skip: [],
        mood: 4, confidence: "Medium", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "One trade, normal size, full checklist. First thing back after yesterday.",
        lesson: "The fix for a bad day is a boring day.",
      },
    ],
  },
  {
    day: "2026-08-21",
    trades: [
      {
        at: "09:50", eq: ["HITACHIENERGY", 2], type: "BUY",
        entry: 12455.00, sl: 12270.00, tp: 13010.00, exit: 13140.00,
        strategy: VBR, skip: [],
        mood: 5, confidence: "High", tags: ["Calm", "Focused"], basis: "Plan",
        mistake: "", quality: "Great", retake: "Yes",
        notes: "Third Hitachi breakout this month on the same rules. Ran past target so I trailed it out at 13,140.",
        lesson: "Trailing beats a fixed target when the whole sector is moving.",
      },
      {
        at: "11:15", opt: ["BANKNIFTY", 53000, "CE", 1, 30], type: "BUY",
        entry: 164.20, sl: 136.00, tp: 220.00, exit: 136.20,
        strategy: VWAP, skip: [0],
        mood: 3, confidence: "Medium", tags: ["Calm"], basis: "Plan",
        mistake: "", quality: "Average", retake: "Yes",
        notes: "VWAP pullback on BANKNIFTY but it was already 11:15 and the momentum had gone. Stopped at 136.",
        lesson: "The pullback setup needs the first hour. Late is a different trade.",
      },
    ],
  },
];

// Weekend "I sat out today" marks. The first weekend is deliberately missed --
// that is what breaks and then restarts the journal streak.
const SAT_OUT_DAYS = [
  { day: "2026-08-01", note: "" },
  { day: "2026-08-02", note: "Wrote up Wednesday's tilt day properly." },
  { day: "2026-08-15", note: "Independence Day, markets shut." },
  { day: "2026-08-16", note: "" },
  { day: "2026-08-22", note: "Reviewed the week instead of trading." },
];

// ─── Charges (Groww, NSE) ───────────────────────────────────────────────────

const r2 = (n) => parseFloat(n.toFixed(2));

function equityIntradayCharges(entry, exit, qty) {
  const buyTurnover = entry * qty;
  const sellTurnover = exit * qty;
  const turnover = buyTurnover + sellTurnover;
  const brokerage = Math.min(20, buyTurnover * 0.0005) + Math.min(20, sellTurnover * 0.0005);
  const stt = sellTurnover * 0.00025;
  const txn = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = buyTurnover * 0.00003;
  const gst = (brokerage + txn + sebi) * 0.18;
  return { brokerage: r2(brokerage), sttTaxes: r2(stt + txn + sebi + stamp + gst) };
}

function optionCharges(entry, exit, units) {
  const buyTurnover = entry * units;
  const sellTurnover = exit * units;
  const turnover = buyTurnover + sellTurnover;
  const brokerage = 40; // Rs 20 flat per executed order
  const stt = sellTurnover * 0.001;
  const txn = turnover * 0.0003503;
  const sebi = turnover * 0.000001;
  const stamp = buyTurnover * 0.00003;
  const gst = (brokerage + txn + sebi) * 0.18;
  return { brokerage, sttTaxes: r2(stt + txn + sebi + stamp + gst) };
}

// ─── Derived fields ─────────────────────────────────────────────────────────

const istDate = (day, at = "00:00") => new Date(`${day}T${at}:00.000+05:30`);

function sessionFor(at) {
  const [h, m] = at.split(":").map(Number);
  const mins = h * 60 + m;
  if (mins < 10 * 60 + 30) return "Opening";
  if (mins < 13 * 60) return "Midday";
  return "Closing";
}

function rrLabelFor(entry, sl, tp) {
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (!risk) return "";
  const r = reward / risk;
  if (r <= 1.1) return "1:1";
  if (r <= 1.6) return "1:1.5";
  if (r <= 2.1) return "1:2";
  if (r <= 3.1) return "1:3";
  if (r <= 4.1) return "1:4";
  return "custom";
}

function buildTrade(t, day, userId, index, ruleLabels) {
  const when = istDate(day, t.at);
  const isEquity = Boolean(t.eq);
  const skip = new Set(t.skip || []);
  const setupRules = ruleLabels.map((label, i) => ({ label, followed: !skip.has(i) }));
  const setupScore = Math.round(((ruleLabels.length - skip.size) / ruleLabels.length) * 100);
  const dir = t.type === "BUY" ? 1 : -1;
  const rr = rrLabelFor(t.entry, t.sl, t.tp);

  const base = {
    _id: seedObjectId(index),
    user: userId,
    type: t.type,
    entryPrice: t.entry,
    exitPrice: t.exit,
    stopLoss: t.sl,
    takeProfit: t.tp,
    strategy: t.strategy,
    setup: t.strategy,
    session: sessionFor(t.at),
    tradeDate: when,
    effectiveTradeDate: when,
    notes: t.notes,
    lesson: t.lesson,
    mistakeTag: t.mistake,
    riskRewardRatio: rr,
    riskRewardCustom: rr === "custom"
      ? `1:${(Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl)).toFixed(1)}`
      : "",
    screenshot: "",
    tradeImages: [],
    tradeType: "INTRADAY",
    entryBasis: t.basis,
    entryBasisCustom: "",
    setupRules,
    setupScore,
    mood: t.mood,
    confidence: t.confidence,
    emotionalTags: t.tags,
    wouldRetake: t.retake,
    tradeQuality: t.quality,
    deletedAt: null,
    createdAt: when,
    updatedAt: when,
  };

  if (isEquity) {
    const [symbol, shares] = t.eq;
    const charges = equityIntradayCharges(t.entry, t.exit, shares);
    return {
      ...base,
      pair: symbol,
      underlying: "",
      segment: "EQUITY",
      instrumentType: "EQUITY",
      stockSymbol: symbol,
      exchange: "NSE",
      sharesQty: shares,
      sector: SECTOR[symbol] || "Other",
      profit: r2((t.exit - t.entry) * dir * shares),
      ...charges,
    };
  }

  const [underlying, strike, optionType, lots, lotSize] = t.opt;
  const units = lots * lotSize;
  const charges = optionCharges(t.entry, t.exit, units);
  return {
    ...base,
    pair: `${underlying} ${strike} ${optionType}`,
    underlying,
    optionType,
    segment: "F&O",
    instrumentType: "OPTION",
    strikePrice: strike,
    expiryDate: istDate(t.expiry || BNF_EXPIRY_AUG, "15:30"),
    quantity: lots,
    lotSize,
    profit: r2((t.exit - t.entry) * dir * units),
    ...charges,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to ${mongoose.connection.name}`);

  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No user found with email: ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`User: ${user.name} <${user.email}> (${user._id})`);

  // 1. Setups -- upsert by name so the user's existing checklist is untouched.
  for (const [name, labels] of Object.entries(SETUPS)) {
    await SetupStrategy.findOneAndUpdate(
      { user: user._id, marketType: "Indian_Market", name },
      {
        $setOnInsert: {
          user: user._id,
          marketType: "Indian_Market",
          name,
          rules: labels.map((label) => ({ label })),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  // Use whatever rules are actually stored, so trade checklists match the setup.
  const setupDocs = await SetupStrategy.find({ user: user._id, marketType: "Indian_Market" }).lean();
  const rulesByName = Object.fromEntries(
    setupDocs.map((s) => [s.name, s.rules.map((r) => r.label)])
  );
  console.log(`Setups ready: ${setupDocs.map((s) => s.name).join(", ")}`);

  // 2. Trades -- replace only the seeded ObjectId range.
  const removed = await IndianTrade.deleteMany({ user: user._id, _id: SEED_RANGE });
  if (removed.deletedCount) console.log(`Removed ${removed.deletedCount} previously seeded trades`);

  const docs = [];
  let i = 1;
  for (const s of SESSIONS) {
    for (const t of s.trades || []) {
      const labels = rulesByName[t.strategy];
      if (!labels) throw new Error(`Missing setup rules for "${t.strategy}"`);
      docs.push(buildTrade(t, s.day, user._id, i++, labels));
    }
  }
  await IndianTrade.insertMany(docs);

  // 3. Discipline entries -- mirror what streakService writes on a real save.
  //    IndianTrade has no marketType, so recordTradeEvent files these under
  //    'Forex'; match that exactly or the calendar splits into two rows a day.
  const threshold = user.streaks?.rule?.threshold ?? 70;
  const seededDays = [];

  for (const s of SESSIONS) {
    if (s.noTrade) {
      await DailyDisciplineEntry.findOneAndUpdate(
        { user: user._id, day: s.day, market: "any" },
        {
          $set: {
            tradeCount: 0,
            noTradeToday: true,
            checklistUsed: false,
            ruleHit: false,
            "meta.note": s.noTrade,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      seededDays.push(`${s.day}  sat out`);
      continue;
    }
    const dayTrades = docs.filter(
      (d) => d.tradeDate >= istDate(s.day) && d.tradeDate < istDate(s.day, "23:59")
    );
    const scores = dayTrades.map((d) => d.setupScore);
    const times = dayTrades.map((d) => d.tradeDate).sort((a, b) => a - b);
    await DailyDisciplineEntry.findOneAndUpdate(
      { user: user._id, day: s.day, market: "Forex" },
      {
        $set: {
          tradeCount: dayTrades.length,
          noTradeToday: false,
          checklistUsed: true,
          ruleHit: scores.some((sc) => sc >= threshold),
          meta: {
            setupScores: scores,
            firstTradeAt: times[0],
            lastTradeAt: times[times.length - 1],
            note: "",
          },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const pnl = dayTrades.reduce((a, d) => a + d.profit, 0);
    seededDays.push(
      `${s.day}  ${String(dayTrades.length).padStart(2)} trade(s)  ${pnl >= 0 ? "+" : "-"}Rs ${Math.abs(pnl).toFixed(2).padStart(8)}  scores ${scores.join(", ")}`
    );
  }

  for (const { day, note } of SAT_OUT_DAYS) {
    await DailyDisciplineEntry.findOneAndUpdate(
      { user: user._id, day, market: "any" },
      { $set: { tradeCount: 0, noTradeToday: true, "meta.note": note } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  // 4. Rebuild the denormalized streak counters from the entries above.
  const streaks = await streakService.recomputeStreaks(user._id);

  const total = docs.reduce((a, d) => a + d.profit, 0);
  const wins = docs.filter((d) => d.profit > 0).length;
  const charges = docs.reduce((a, d) => a + d.brokerage + d.sttTaxes, 0);

  console.log("\n--- Sessions ---");
  seededDays.forEach((l) => console.log("  " + l));
  console.log("\n--- Summary ---");
  console.log(`  Trades          : ${docs.length} over ${SESSIONS.length} sessions`);
  console.log(`  Win rate        : ${((wins / docs.length) * 100).toFixed(1)}%  (${wins}W / ${docs.length - wins}L)`);
  console.log(`  Gross P&L       : Rs ${total.toFixed(2)}`);
  console.log(`  Charges         : Rs ${charges.toFixed(2)}`);
  console.log(`  Net P&L         : Rs ${(total - charges).toFixed(2)}`);
  console.log(`  Journal streak  : ${streaks.streaks.journal.current} (longest ${streaks.streaks.journal.longest})`);
  console.log(`  Checklist streak: ${streaks.streaks.checklist.current} (longest ${streaks.streaks.checklist.longest})`);
  console.log(`  Rule streak     : ${streaks.streaks.rule.current} (longest ${streaks.streaks.rule.longest}, threshold ${threshold})`);

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
