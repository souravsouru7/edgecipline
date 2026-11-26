// AICoachFeedWidget-shaped feed from the Indian intelligence summary. Lives
// outside IndianIntelligenceModule so Home can render the same feed without
// pulling the whole module page (and its inline stylesheet) into its bundle.
import type { IndianIntelligenceSummary } from "./api/indianIntelligenceApi";

function inr(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(value || 0);
}

// Absolute amount for prose ("recover the ₹13,085"); `inr` adds a +/- sign.
function inrAbs(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.abs(value || 0));
}

// The widget keys its badge colours off these exact strings.
const COACH_CATEGORY: Record<string, string> = {
  discipline: "Discipline",
  mindset: "Psychology",
  timing: "Pattern",
  setup: "TradingDNA",
};

function priorityBand(score: number) {
  return score >= 60 ? "high" : score >= 40 ? "medium" : "low";
}

// Maps the Indian intelligence summary onto the shape AICoachFeedWidget wants,
// so the coach page runs the same engine as every other Indian module instead
// of the analytics coachFeed, which reports gross P&L and ranks differently.
export function toIndianCoachFeed(data: IndianIntelligenceSummary) {
  const ranked = [...data.leaks, ...data.strengths].sort((a, b) => b.priority - a.priority);
  const ordered = data.doNow
    ? [data.doNow, ...ranked.filter((item) => item.id !== data.doNow!.id)]
    : ranked;

  const insights = ordered.map((item) => {
    const negative = item.category === "leak";
    return {
      id: item.id,
      category: COACH_CATEGORY[item.theme] || "Pattern",
      type: negative ? "negative" : "positive",
      priority: priorityBand(item.priority),
      title: item.title,
      insight: item.evidence,
      evidence: `${item.sampleSize} trades · Win rate: ${item.stats.winRate}% · Net P&L: ${inr(item.stats.netPnl)} · ${item.confidence.label}`,
      recommendation: item.action,
      whyItMatters: negative
        ? `This condition appears in ${item.sampleSize} of your ${data.sample.totalTrades} tracked trades, so the cost repeats instead of being a one-off.`
        : `This holds across ${item.sampleSize} trades rather than a lucky run, which is what makes it worth protecting.`,
      expectedOutcome: negative
        ? `Removing it should recover most of the ${inrAbs(item.stats.netPnl)} currently tied to this condition.`
        : `Keeping it mandatory should hold the ${inrAbs(item.stats.netPnl)} it has produced so far.`,
    };
  });

  return {
    insights,
    stats: {
      negative: insights.filter((i) => i.type === "negative").length,
      positive: insights.filter((i) => i.type === "positive").length,
    },
    generatedAt: data.generatedAt,
    insufficient: insights.length === 0,
  };
}
