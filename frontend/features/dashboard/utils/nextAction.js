// The dashboard's "Do next" banner: exactly one sentence and one action,
// chosen from data already in the dashboard snapshot. Pure, so it is unit
// tested (nextAction.test.mjs).
//
// Priority:
//   0. this market has no trades yet (user trades the other one) → first trade here
//   1. streak at risk and nothing logged today → protect the streak
//   2. evening (≥17:00) and no reflection yet  → close the day
//   3. otherwise                               → run the pre-trade checklist
//
// action.kind: "logTrade" | "reflect" | "link" (with href)

export const EVENING_HOUR = 17;

export function getNextAction({
  streaks, reflection, now = new Date(), checklistHref = "/checklist", emptyMarketLabel = null,
} = {}) {
  // Onboarding progress is account-wide (both markets), so a user with Forex
  // trades who switches to Indian Market lands on an empty market. Point them
  // at its first trade instead of a finished setup checklist.
  if (emptyMarketLabel) {
    return {
      id: "first-trade-in-market",
      tone: "accent",
      title: `Log your first ${emptyMarketLabel} trade`,
      body: `${emptyMarketLabel} has its own journal, stats and insights. They start with its first trade.`,
      cta: "Log trade",
      action: { kind: "logTrade" },
    };
  }

  const journal = streaks?.journal;
  const streak = Number(journal?.current || 0);
  const today = reflection?.today;
  const tradedToday = Number(today?.tradeCount || 0) > 0 || Boolean(today?.hadTrades);
  const reflected = Boolean(today?.completed || today?.skipped);
  const hour = now.getHours();

  if (journal?.atRisk && streak > 0 && !tradedToday) {
    return {
      id: "protect-streak",
      tone: "warning",
      title: `Your ${streak}-day streak ends tonight`,
      body: "Log a trade, or mark today as Sat Out if you didn't trade.",
      cta: "Log trade",
      action: { kind: "logTrade" },
    };
  }

  if (hour >= EVENING_HOUR && !reflected) {
    return {
      id: "reflect",
      tone: "accent",
      title: "Close the day",
      body: tradedToday
        ? "A 2-minute reflection on today's trades. It's what makes the AI coach useful."
        : "No trades today? A 30-second check-in still keeps your discipline record honest.",
      cta: "Reflect now",
      action: { kind: "reflect" },
    };
  }

  return {
    id: "checklist",
    tone: "accent",
    title: "Before your next trade, run the checklist",
    body: "Check the setup against your rules first. Disciplined entries are what this app measures.",
    cta: "Open checklist",
    action: { kind: "link", href: checklistHref },
  };
}
