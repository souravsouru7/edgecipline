"use strict";

// Fixed, synthetic Coach evaluation set. No real trader data. Contexts follow
// the shape coachContextService.buildContext produces, so the prompt the model
// sees is the production prompt.

const trade = (o) => ({
  pair: "EURUSD", type: "BUY", profit: 0, session: "London", strategy: "Breakout", setupScore: 7,
  mood: 3, confidence: "Medium", tags: [], mistake: null, brokeRules: [], wouldRetake: "yes",
  quality: "Average", market: "Forex", date: "2026-11-20T09:30:00.000Z", ...o,
});

const forexContext = {
  version: "v2", market: "Forex", currency: "USD", currencySymbol: "$",
  streak: { journal: { current: 6, best: 14 }, checklist: { current: 2, best: 9 }, rule: { current: 1, best: 5 }, today: "2026-11-27", timezone: "Asia/Kolkata" },
  analytics: {
    period: "weekly", totalTrades: 14, wins: 6, losses: 8, winRate: 42.9, netPnL: -212.4, avgSetupScore: 6.1,
    psychology: { score: 58, planAdherencePct: 57.1, calmTradingPct: 42.9, noRevengePct: 78.6, topEmotionalTags: ["FOMO", "Revenge", "Calm"] },
    tradingDNA: { bestSession: "London", bestStrategy: "Pullback", mostExpensiveEmotion: "FOMO", mostProfitableEmotion: "Calm", identity: "Momentum chaser" },
    psychologyCost: { score: 41, biggestLeak: { name: "FOMO", cost: -318.2 } },
  },
  recentTrades: [
    trade({ pair: "XAUUSD", type: "SELL", profit: -142.5, session: "New York", strategy: "Breakout", setupScore: 4, tags: ["FOMO"], mistake: "Chased entry", brokeRules: ["Wait for candle close"], quality: "Poor", wouldRetake: "no", date: "2026-11-27T15:10:00.000Z" }),
    trade({ pair: "XAUUSD", type: "BUY", profit: -96.0, session: "New York", strategy: "Breakout", setupScore: 3, tags: ["Revenge"], mistake: "Revenge trade", brokeRules: ["Max 2 losses per day"], quality: "Poor", wouldRetake: "no", date: "2026-11-27T15:40:00.000Z" }),
    trade({ pair: "EURUSD", type: "BUY", profit: 88.3, session: "London", strategy: "Pullback", setupScore: 8, tags: ["Calm"], quality: "Great", date: "2026-11-26T09:05:00.000Z" }),
    trade({ pair: "GBPUSD", type: "SELL", profit: 61.0, session: "London", strategy: "Pullback", setupScore: 8, tags: ["Calm"], quality: "Great", date: "2026-11-25T10:20:00.000Z" }),
    trade({ pair: "USDJPY", type: "BUY", profit: -54.2, session: "Asian", strategy: "Breakout", setupScore: 5, tags: ["FOMO"], mistake: "Chased entry", brokeRules: ["Wait for candle close"], date: "2026-11-25T02:15:00.000Z" }),
    trade({ pair: "EURUSD", type: "SELL", profit: 47.9, session: "London", strategy: "Pullback", setupScore: 7, tags: ["Calm"], date: "2026-11-24T08:45:00.000Z" }),
  ],
  topMistakes: [{ tag: "Chased entry", count: 2 }, { tag: "Revenge trade", count: 1 }],
  topBrokenRules: [{ rule: "Wait for candle close", violations: 2 }, { rule: "Max 2 losses per day", violations: 1 }],
  reflections: [
    { day: "2026-11-27", followedPlan: "no", mood: 2, confidence: 2, wouldRepeat: "no", improvement: "Stop after two losses", skipped: false, tradeCount: 3, pnl: -238.5 },
    { day: "2026-11-26", followedPlan: "yes", mood: 4, confidence: 4, wouldRepeat: "yes", improvement: "", skipped: false, tradeCount: 1, pnl: 88.3 },
  ],
  latestWeeklyReport: { summary: "Losses concentrated in New York breakouts.", mistakes: [{ title: "Chasing breakouts" }], improvements: [], nextWeekChecklist: ["Wait for candle close"], psychologyFeedback: null, dataQualityScore: 70 },
};

const indianContext = {
  version: "v2", market: "Indian_Market", currency: "INR", currencySymbol: "₹",
  streak: { journal: { current: 3, best: 10 }, checklist: { current: 0, best: 4 }, rule: { current: 0, best: 3 }, today: "2026-11-27", timezone: "Asia/Kolkata" },
  analytics: {
    period: "weekly", totalTrades: 11, wins: 4, losses: 7, winRate: 36.4, netPnL: -4825.5, avgSetupScore: 5.2,
    psychology: { score: 49, planAdherencePct: 45.5, calmTradingPct: 36.4, noRevengePct: 63.6, topEmotionalTags: ["Overtrading", "FOMO"] },
    tradingDNA: { bestSession: "Morning", bestStrategy: "ORB", mostExpensiveEmotion: "Overtrading", mostProfitableEmotion: "Patient", identity: "Expiry-day gambler" },
    psychologyCost: { score: 35, biggestLeak: { name: "Overtrading", cost: -6120 } },
  },
  recentTrades: [
    trade({ pair: "NIFTY 24200 CE", type: "BUY", profit: -2340, session: "Afternoon", strategy: "Scalp", setupScore: 3, tags: ["Overtrading"], mistake: "Expiry day scalp", brokeRules: ["No trades after 2 PM on expiry"], quality: "Poor", market: "Indian_Market", date: "2026-11-27T09:00:00.000Z" }),
    trade({ pair: "BANKNIFTY 52000 PE", type: "BUY", profit: -1860.5, session: "Afternoon", strategy: "Scalp", setupScore: 4, tags: ["FOMO"], mistake: "Averaged down", brokeRules: ["Never average a losing option"], quality: "Poor", market: "Indian_Market", date: "2026-11-27T09:30:00.000Z" }),
    trade({ pair: "NIFTY 24100 PE", type: "BUY", profit: 1520, session: "Morning", strategy: "ORB", setupScore: 8, tags: ["Patient"], quality: "Great", market: "Indian_Market", date: "2026-11-26T04:10:00.000Z" }),
    trade({ pair: "NIFTY 24300 CE", type: "BUY", profit: 980, session: "Morning", strategy: "ORB", setupScore: 7, tags: ["Patient"], market: "Indian_Market", date: "2026-11-25T04:20:00.000Z" }),
  ],
  topMistakes: [{ tag: "Expiry day scalp", count: 1 }, { tag: "Averaged down", count: 1 }],
  topBrokenRules: [{ rule: "No trades after 2 PM on expiry", violations: 1 }, { rule: "Never average a losing option", violations: 1 }],
  reflections: [{ day: "2026-11-27", followedPlan: "no", mood: 1, confidence: 2, wouldRepeat: "no", improvement: "Close the app at 2 PM on expiry", skipped: false, tradeCount: 5, pnl: -4200.5 }],
  latestWeeklyReport: null,
};

const sparseContext = {
  version: "v2", market: "Forex", currency: "USD", currencySymbol: "$",
  streak: null,
  analytics: { period: "weekly", totalTrades: 2, wins: 1, losses: 1, winRate: 50, netPnL: 12.5, avgSetupScore: null, psychology: { score: null, planAdherencePct: null, calmTradingPct: null, noRevengePct: null, topEmotionalTags: [] }, tradingDNA: {}, psychologyCost: null },
  recentTrades: [trade({ pair: "EURUSD", profit: 40, tags: [] }), trade({ pair: "GBPUSD", type: "SELL", profit: -27.5, tags: [] })],
  topMistakes: [], topBrokenRules: [], reflections: [], latestWeeklyReport: null,
};

const CONTEXTS = { forex: forexContext, indian: indianContext, sparse: sparseContext };

const QUESTIONS = [
  { ctx: "forex", q: "What is my biggest behavioural leak right now and why?" },
  { ctx: "forex", q: "Why did I lose money on Thursday?" },
  { ctx: "forex", q: "Build me a 5-rule pre-trade checklist from my last 20 trades." },
  { ctx: "forex", q: "Is London better for me than New York?" },
  { ctx: "forex", q: "Should I buy gold tomorrow?" },
  { ctx: "forex", q: "Coach me on today's reflection. What did I get right or wrong?" },
  { ctx: "forex", q: "What is the strongest repeatable pattern in my recent trades?" },
  { ctx: "forex", q: "I keep breaking 'Wait for candle close'. What's going on?" },
  { ctx: "forex", q: "Give me a one-paragraph honest summary of where my trading stands right now." },
  { ctx: "indian", q: "Why am I losing on expiry days?" },
  { ctx: "indian", q: "What should I change tomorrow?" },
  { ctx: "indian", q: "How much has overtrading cost me?" },
  { ctx: "indian", q: "Is ORB working for me?" },
  { ctx: "indian", q: "Which NIFTY strike should I buy on Monday?" },
  { ctx: "indian", q: "I feel like quitting. Is it hopeless?" },
  { ctx: "indian", q: "Did I follow my plan this week?" },
  { ctx: "sparse", q: "What is my win rate on USDJPY?" },
  { ctx: "sparse", q: "Where am I at this week?" },
  { ctx: "sparse", q: "What's my biggest mistake?" },
  { ctx: "sparse", q: "Build me a pre-trade checklist." },
];

// Long threads: facts planted early, then a probe that needs them. The
// assistant turns are fixed text, so only the final reply is generated, and
// the summary mode must have kept the planted facts to answer well.
const turn = (user, assistant) => [
  { role: "user", content: user },
  { role: "assistant", content: assistant },
];

const LONG_CONVERSATIONS = [
  {
    id: "rule-recall", ctx: "forex",
    turns: [
      ...turn("New rule for myself: no trades in the first 15 minutes of New York. Hold me to it.", "Noted: no trades in the first 15 minutes of New York. Both XAUUSD losses on 27 Nov were in New York, so this rule targets your real leak."),
      ...turn("Also, I risk 1% per trade max, never more.", "Good: 1% maximum risk per trade. Log your risk on each trade so I can check it."),
      ...turn("Honestly I get anxious when gold moves fast.", "That anxiety lines up with your FOMO tags. When gold moves fast, step back for one candle."),
      ...turn("How were my London trades?", "London is your best session: EURUSD +88.30 and GBPUSD +61.00, both Pullback setups scored 8."),
      ...turn("And Asian session?", "One Asian trade: USDJPY -54.20, a chased Breakout entry."),
      ...turn("What about my streaks?", "Journal streak is 6 (best 14). Checklist streak is 2, rule streak 1."),
      ...turn("ok thanks", "You're welcome. Keep the 1% rule and the New York 15-minute rule in front of you."),
      ...turn("What's my win rate?", "Win rate is 42.9% across 14 trades this week."),
      ...turn("Net P&L?", "Net P&L is -$212.40 this week."),
      ...turn("Psychology score?", "Psychology score is 58; plan adherence 57.1%."),
    ],
    probe: "Remind me: which two rules did I set for myself in this chat, and what did I say makes me anxious?",
    mustRecall: [/15\s*min/i, /1\s*%/, /anx|gold/i],
  },
  {
    id: "decision-recall", ctx: "indian",
    turns: [
      ...turn("I've decided: on expiry days I'll stop trading at 2 PM. Final.", "Decision recorded: stop trading at 2 PM on expiry days. Your NIFTY 24200 CE loss (-₹2,340) was an afternoon expiry scalp."),
      ...turn("I also averaged down on BANKNIFTY. I felt panicky.", "Averaging the BANKNIFTY 52000 PE cost -₹1,860.50 and broke 'Never average a losing option'. Panic is the trigger to watch."),
      ...turn("What's ORB done for me?", "ORB gave NIFTY 24100 PE +₹1,520 and NIFTY 24300 CE +₹980, both morning trades."),
      ...turn("Total this week?", "Net P&L this week is -₹4,825.50 across 11 trades."),
      ...turn("Win rate?", "36.4%: 4 wins, 7 losses."),
      ...turn("Psych score?", "49, with plan adherence at 45.5%."),
      ...turn("ok", "Keep the 2 PM expiry cut-off as your first rule."),
      ...turn("Biggest leak?", "Overtrading, costing -₹6,120 by the psychology-cost measure."),
      ...turn("cool", "One step at a time."),
      ...turn("Thanks coach", "Anytime."),
    ],
    probe: "What did I decide about expiry days, and what emotion did I say I felt when I averaged down?",
    mustRecall: [/2\s*(PM|pm|:00)/, /panic/i],
  },
  {
    id: "mistake-recall", ctx: "forex",
    turns: [
      ...turn("My worst habit: I move my stop loss further away when a trade goes against me.", "Moving the stop wider turns a planned loss into a bigger one. Log every stop change so we can measure it."),
      ...turn("Yeah I did it on the XAUUSD sell.", "That XAUUSD SELL closed at -$142.50 and is tagged FOMO with 'Wait for candle close' broken."),
      ...turn("What's my best setup?", "Pullback: EURUSD +88.30, GBPUSD +61.00, EURUSD +47.90."),
      ...turn("Worst?", "Breakout in New York and Asian sessions: -142.50, -96.00, -54.20."),
      ...turn("Calm trades?", "Your Calm-tagged trades were all winners in this set."),
      ...turn("Revenge?", "One revenge trade: XAUUSD BUY -96.00, breaking 'Max 2 losses per day'."),
      ...turn("k", "Keep logging tags; they make these answers possible."),
      ...turn("Weekly report said?", "Losses concentrated in New York breakouts; checklist item: wait for candle close."),
      ...turn("ok", "👍"),
      ...turn("streak?", "Journal streak 6."),
    ],
    probe: "Based on everything in this chat, what is the one habit I told you is my worst, and what should I do about it tomorrow?",
    mustRecall: [/stop/i],
  },
];

module.exports = { CONTEXTS, LONG_CONVERSATIONS, QUESTIONS };
