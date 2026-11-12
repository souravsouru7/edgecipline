// The 10 trading-psychology patterns shown in the Psychology guide.
// Copy unchanged from the original page; `icon` is a lucide icon name.

export const PSYCHOLOGY_PATTERNS = [
  { id: 1, icon: "Zap", title: "Impulse Control", tag: "Impulsive",
    desc: "You act before thinking — enter without any plan",
    symptoms: ["Random urge to enter trades", "Click buy/sell before confirmation", '"Just one quick trade" mindset'],
    solutions: ["5-Minute Delay before every entry", "Full checklist before entering", "Step away, reset, then decide", "Hard max trades per day"] },
  { id: 2, icon: "ShieldAlert", title: "Fear", tag: "Fearful",
    desc: "Loss aversion, FOMO and hesitation stop you cold",
    symptoms: ["Skipping valid confirmed setups", "Exiting winners way too early", "Watching setups pass — never entering"],
    solutions: ["Backtest your strategy — trust the data", "Fixed risk % per trade, always", "Treat missed trades as normal", "Log missed setups to see the real cost"] },
  { id: 3, icon: "Flame", title: "Revenge Trading", tag: "Revenge",
    desc: "You trade immediately after a loss to recover it",
    symptoms: ["New trade placed right after a loss", "Doubling lot size to 'make it back'"],
    solutions: ["Mandatory 15–30 min break after loss", "Fixed lot size — no exceptions", "Hard daily loss limit — stop when hit"] },
  { id: 4, icon: "Crown", title: "Overconfidence", tag: "Ego",
    desc: "A win streak inflates your ego and kills discipline",
    symptoms: ["Ignoring your own rules after wins", "Skipping the pre-trade checklist"],
    solutions: ["Fixed position size every trade", "Track behaviour, not just P&L", "Long-term consistency over short wins"] },
  { id: 5, icon: "BarChart3", title: "Overtrading", tag: "Overtrading",
    desc: "You always need to be in a position",
    symptoms: ["Trading every small candle move", "Staying in market during off-hours"],
    solutions: ["Hard max trades per day — stick to it", "Fixed trading window only — log out after"] },
  { id: 6, icon: "OctagonX", title: "Loss Aversion", tag: "Avoidance",
    desc: "You cannot accept small losses — so they grow big",
    symptoms: ["Moving stop-loss to avoid being stopped", "Holding losing trades far too long"],
    solutions: ["Set stop-loss before entry — never move it", "Accept small losses as cost of trading"] },
  { id: 7, icon: "Brain", title: "Decision Paralysis", tag: "Frozen",
    desc: "Overthinking causes you to miss every entry",
    symptoms: ["Staring at the same chart for hours", "Stuck in an endless confirmation loop"],
    solutions: ["Trade 1–2 setups only — master them", "Written rules: if A → then B, no thinking"] },
  { id: 8, icon: "HeartCrack", title: "Emotional Dependency", tag: "Emotional",
    desc: "Your mood and identity are controlled by P&L",
    symptoms: ["One losing trade ruins the entire day", "Self-worth completely tied to trade outcome"],
    solutions: ["Grade yourself on execution quality", "Daily reflection log — separate you from results"] },
  { id: 9, icon: "Timer", title: "Lack of Patience", tag: "Impatient",
    desc: "You force trades before the setup is fully ready",
    symptoms: ["Entry before all conditions confirmed", "Creating setups that simply aren't there"],
    solutions: ["Wait for EVERY condition — zero exceptions", "Cut screen time — less watching = less forcing"] },
  { id: 10, icon: "Shuffle", title: "Inconsistency", tag: "Chaotic",
    desc: "You use different rules every single session",
    symptoms: ["Breaking your own rules 'just this once'", "Applying different criteria every day"],
    solutions: ["Written trading plan — print and pin it", "Trade log — fill every session", "Weekly review to catch pattern breaks"] },
];

export function findPattern(id) {
  const n = Number(id);
  return PSYCHOLOGY_PATTERNS.find((p) => p.id === n) || null;
}
