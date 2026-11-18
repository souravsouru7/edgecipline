// Home "Today's plan": three rows chosen from the trader's own numbers.
//
// Each signal in the dashboard snapshot (leaks, win/loss shape, charges,
// discipline trend, review honesty, missing P&L, setups) becomes a
// *prescription*: the feature that helps most, plus the trader's own number
// as the reason. The rows are:
//   1. Fix your biggest leak   - the highest-scoring prescription
//   2. Protect discipline      - checklist, then today's log state
//   3. Close the loop          - reflect, then coach / lesson / next prescription
// On a closed market day (weekend, exchange holiday) it switches to a review.
//
// Pure and React-free so every rule, and every way the data can be missing or
// malformed, is covered by todayLoop.test.mjs. Anything doubtful drops the
// prescription; a thrown error falls back to the generic loop. The card never
// shows NaN, "$0" or a claim the data can't back.

export const MIN_TRADES_FOR_PLAN = 5;
const MIN_LEAK_TRADES = 3;
const MIN_LEAK_IMPACT_PCT = 5;
const MIN_WINRATE_TRADES = 10;
const MIN_CHARGE_TRADES = 10;
const CHARGES_SHARE = 0.25;
const LOW_WIN_RATE = 40;
const LOW_SELF_AWARENESS = 50;
const MIN_SELF_AWARENESS_REVIEWS = 10;
const FOREX_EVENING_HOUR = 17;
const IST = "Asia/Kolkata";
const NSE_OPEN_MIN = 9 * 60 + 15;
const NSE_CLOSE_MIN = 15 * 60 + 30;
const MAX_LABEL = 40;
const MAX_ASK = 200;

const TRENDS = new Set(["improving", "stable", "declining"]);

// ── Safe readers ────────────────────────────────────────────────────────────

export function num(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function trendOf(value) {
  return TRENDS.has(value) ? value : "stable";
}

// "no_sl" -> "No SL", "revenge trading" -> "Revenge trading". User-entered
// text, so trimmed and capped; React escapes it on render.
export function cleanLabel(raw) {
  let s = String(raw ?? "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "this habit";
  s = s
    .split(" ")
    .map((w) => (/^(sl|tp|rr|r:r|fomo|nse|bse|fno|f&o)$/i.test(w) ? w.toUpperCase() : w))
    .join(" ");
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1).trimEnd()}…` : s;
}

export function makeMoney(currency) {
  const indian = currency === "INR";
  const symbol = indian ? "₹" : "$";
  const fmt = new Intl.NumberFormat(indian ? "en-IN" : "en-US", { maximumFractionDigits: 0 });
  return (value) => `${symbol}${fmt.format(Math.round(Math.abs(num(value))))}`;
}

// ── Clock ───────────────────────────────────────────────────────────────────

function minutesInZone(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const h = num(parts.find((p) => p.type === "hour")?.value);
    const m = num(parts.find((p) => p.type === "minute")?.value);
    return h * 60 + m;
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

// 0 = Sunday. The server's todayKey ("YYYY-MM-DD", user's timezone) wins over
// the device date so the card agrees with the done ticks around midnight.
function dayOfWeek(todayKey, now) {
  if (typeof todayKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(todayKey)) {
    const [y, m, d] = todayKey.split("-").map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (Number.isFinite(day)) return day;
  }
  return now.getDay();
}

// { open, reason: "weekend" | "holiday" | null }. The server's marketDay knows
// exchange holidays; an older server doesn't send it, so fall back to weekday.
function resolveMarketDay(marketDay, todayKey, now) {
  if (marketDay && typeof marketDay.open === "boolean") {
    const reason = String(marketDay.reason || "").toLowerCase();
    return {
      open: marketDay.open,
      reason: marketDay.open ? null : reason.includes("holiday") ? "holiday" : "weekend",
    };
  }
  const day = dayOfWeek(todayKey, now);
  return day === 0 || day === 6 ? { open: false, reason: "weekend" } : { open: true, reason: null };
}

// "pre" | "session" | "after", in the market's own clock: IST for NSE/BSE,
// the device clock for Forex (sessions are global; evening is the user's).
function sessionPhase(indian, now) {
  if (indian) {
    const min = minutesInZone(now, IST);
    if (min < NSE_OPEN_MIN) return "pre";
    if (min < NSE_CLOSE_MIN) return "session";
    return "after";
  }
  return now.getHours() >= FOREX_EVENING_HOUR ? "after" : "session";
}

function coachLink(routes, question) {
  const base = routes?.coach || "/coach";
  const q = String(question || "").trim().slice(0, MAX_ASK);
  return q ? `${base}?ask=${encodeURIComponent(q)}` : base;
}

// ── Prescriptions ───────────────────────────────────────────────────────────
// target: the feature a row opens. Two rows never share a target.
// score: higher wins. Leak-type scores add the share of losses they explain,
// so a bigger money problem always outranks a smaller one.

function leakPrescriptions(ctx) {
  const leaks = Array.isArray(ctx.psychologyCost?.topLeaks) ? ctx.psychologyCost.topLeaks : [];
  const out = [];
  for (const leak of leaks) {
    if (!leak || typeof leak !== "object") continue;
    const cost = num(leak.cost);
    const count = num(leak.count);
    const impact = num(leak.impactPct);
    if (cost >= 0 || count < MIN_LEAK_TRADES || impact < MIN_LEAK_IMPACT_PCT) continue;
    const label = cleanLabel(leak.name);
    const why = `on ${count} trades · ${Math.round(impact)}% of your losses`;
    const score = 50 + Math.min(impact, 100);
    if (leak.type === "emotion") {
      out.push({
        key: "leak-emotion", target: "psychology", score, tone: "loss", icon: "brain",
        title: "Open your psychology guide",
        emph: `${label} cost you ${ctx.money(cost)}`, sub: why,
        action: { kind: "link", href: "/psychology-timeline" },
      });
    } else if (leak.type === "ruleViolation") {
      out.push({
        key: "leak-rule", target: "checklist", score, tone: "loss", icon: "check",
        title: "Run the checklist on every trade",
        emph: `Breaking "${label}" cost ${ctx.money(cost)}`, sub: why,
        action: { kind: "link", href: ctx.routes.checklist },
      });
    } else if (leak.type === "mistake") {
      out.push({
        key: "leak-mistake", target: "coach", score, tone: "loss", icon: "coach",
        title: "Ask the coach how to fix it",
        emph: `${label} cost ${ctx.money(cost)}`, sub: why,
        action: {
          kind: "link",
          href: coachLink(ctx.routes, `${ctx.marketPrefix}"${label}" has cost me ${ctx.money(cost)} over ${count} trades. How do I stop it?`),
        },
      });
    }
  }
  return out;
}

function shapePrescriptions(ctx) {
  const s = ctx.stats || {};
  const out = [];
  const closed = num(s.winningTrades) + num(s.losingTrades);
  const avgWin = Math.abs(num(s.avgWin));
  const avgLoss = Math.abs(num(s.avgLoss));
  const winRate = num(s.winRate);

  // Losers bigger than winners. Needs both sides, so never divides by 0.
  if (avgWin > 0 && avgLoss > 0 && avgLoss > avgWin && num(s.winningTrades) >= 3 && num(s.losingTrades) >= 3) {
    out.push({
      key: "loss-size", target: "checklist", tone: "loss", icon: "check",
      score: 50 + Math.min(50, Math.round((avgLoss / avgWin - 1) * 50)),
      title: "Set your stop before you enter",
      emph: `Losses avg ${ctx.money(avgLoss)} vs wins ${ctx.money(avgWin)}`,
      sub: "cut losers before they outgrow winners",
      action: { kind: "link", href: ctx.routes.checklist },
    });
  }

  // Low win rate on a sound payoff: the edge is fine, entries are loose.
  if (closed >= MIN_WINRATE_TRADES && winRate > 0 && winRate < LOW_WIN_RATE && avgWin > 0 && avgLoss > 0 && avgWin >= avgLoss) {
    out.push({
      key: "win-rate", target: "setups", tone: "warning", icon: "target", score: 45,
      title: "Trade only your A+ setups",
      emph: `${Math.round(winRate * 10) / 10}% win rate`,
      sub: `but wins avg ${ctx.money(avgWin)} vs ${ctx.money(avgLoss)} losses — filter entries`,
      action: { kind: "link", href: ctx.routes.setups },
    });
  }

  // Brokerage, STT and swaps. Indian P&L is gross of charges, so F&O
  // overtrading shows up here first. Skipped when no charges were recorded.
  const costs = Math.abs(num(s.totalCosts));
  const gross = num(s.totalProfit);
  const net = num(s.netPnL ?? s.netProfit);
  const base = gross > 0 ? gross : Math.abs(net);
  if (costs > 0 && base > 0 && num(s.totalTrades) >= MIN_CHARGE_TRADES && costs / base >= CHARGES_SHARE) {
    const pct = Math.round((costs / base) * 100);
    out.push({
      key: "charges", target: "setups", tone: "warning", icon: "target",
      score: 50 + Math.min(50, pct),
      title: "Take fewer, better trades",
      emph: `${ctx.indian ? "Brokerage & taxes" : "Fees"} took ${ctx.money(costs)}`,
      sub: gross > 0 ? `${pct}% of your gross profit` : `${pct}% of what you lost`,
      action: { kind: "link", href: ctx.routes.setups },
    });
  }
  return out;
}

function trendPrescriptions(ctx) {
  const out = [];
  const t = ctx.timeline || {};
  const trends = t.trends || {};
  const buckets = Array.isArray(t.buckets) ? t.buckets : [];
  const last = buckets.length >= 2 ? buckets[buckets.length - 1] : null;
  const lastNet = last ? num(last.net) : 0;

  if (trendOf(trends.discipline) === "declining") {
    out.push({
      key: "discipline", target: "reports", tone: "warning", icon: "report", score: 48,
      title: "Read your weekly feedback",
      emph: "Discipline is slipping", sub: "see where your rules broke this week",
      action: { kind: "link", href: ctx.routes.reports },
    });
  } else if (last && lastNet < 0) {
    out.push({
      key: "losing-period", target: "reports", tone: "warning", icon: "report", score: 46,
      title: "Read your weekly feedback",
      emph: `Last period -${ctx.money(lastNet)}`, sub: "find what changed before it repeats",
      action: { kind: "link", href: ctx.routes.reports },
    });
  }

  const sa = ctx.selfAwareness || {};
  const saScore = sa.score === null || sa.score === undefined ? null : num(sa.score);
  const saLow = saScore !== null && num(sa.trackedCount) >= MIN_SELF_AWARENESS_REVIEWS && saScore < LOW_SELF_AWARENESS;
  if (saLow || trendOf(trends.selfAwareness) === "declining") {
    out.push({
      key: "self-awareness", target: "reflect", tone: "warning", icon: "moon", score: 40,
      title: "Reflect honestly after every session",
      emph: saLow ? `Reviews only ${Math.round(saScore)}% accurate` : "Review honesty is dropping",
      sub: "your rating of a trade should match what happened",
      action: { kind: "reflect" },
    });
  }
  return out;
}

function dataPrescriptions(ctx) {
  const out = [];
  const missing = num(ctx.stats?.tradesMissingPnl);
  if (missing > 0) {
    out.push({
      key: "missing-pnl", target: "journal", tone: "warning", icon: "journal",
      score: 35 + Math.min(20, missing),
      title: "Add the missing P&L",
      emph: `${missing} ${missing === 1 ? "trade has" : "trades have"} no P&L`,
      sub: "insights can't learn from them yet",
      action: { kind: "link", href: ctx.routes.journal },
    });
  }
  return out;
}

function strengthPrescription(ctx) {
  const dna = ctx.tradingDNA || {};
  const candidates = [
    ["session", dna.sessionDNA?.best, (l) => `${l} session`],
    ["instrument", dna.instrumentDNA?.best, (l) => l],
  ];
  let best = null;
  for (const [source, entry, name] of candidates) {
    if (!entry) continue;
    const pnl = num(entry.netPnL ?? entry.netPnl);
    const count = num(entry.count ?? entry.trades ?? entry.total);
    const label = entry.name || entry.label;
    if (pnl <= 0 || count < MIN_LEAK_TRADES || !label) continue;
    if (!best || pnl > best.pnl) best = { source, pnl, count, text: name(cleanLabel(label)) };
  }
  if (!best) return null;
  return {
    key: "strength", target: "insights", tone: "profit", icon: "sparkles", score: 10,
    title: "Lean into your edge today",
    emph: `${best.text} made +${ctx.money(best.pnl)}`,
    sub: `over ${best.count} trades — focus there`,
    action: { kind: "link", href: ctx.routes.insights },
  };
}

// ── Base rows ───────────────────────────────────────────────────────────────

function checklistRow(ctx) {
  const done = ctx.checklistToday;
  let sub = "Before each trade";
  if (done) sub = "Used today";
  else if (ctx.indian && ctx.phase === "pre") sub = "Pre-market: before the 09:15 open";
  return {
    key: "checklist", target: "checklist", tone: null, icon: "check",
    title: "Run the checklist", emph: "", sub, done,
    action: { kind: "link", href: ctx.routes.checklist },
  };
}

function logRow(ctx) {
  const trades = ctx.tradesToday;
  const missing = num(ctx.stats?.tradesMissingPnl);
  if (trades > 0 && missing > 0) {
    return {
      key: "log", target: "journal", tone: "warning", icon: "journal",
      title: "Add P&L to your trades", emph: `${trades} logged today`,
      sub: `${missing} still need P&L`, done: false,
      action: { kind: "link", href: ctx.routes.journal },
    };
  }
  return {
    key: "log", target: "log", tone: null, icon: "plus",
    title: "Log your trades", emph: "",
    sub: trades > 0 ? `${trades} logged today` : "Screenshot or manual",
    done: trades > 0, action: { kind: "logTrade" },
  };
}

function reflectRow(ctx) {
  const today = ctx.reflectionToday;
  let sub = "2 minutes, end of day";
  if (today?.completed) sub = "Done for today";
  else if (today?.skipped) sub = "Skipped";
  else if (ctx.indian) sub = ctx.phase === "after" ? "Market closed — reflect now" : "After the 15:30 close";
  else if (ctx.phase === "after") sub = "Reflect now — 2 minutes";
  return {
    key: "reflect", target: "reflect", tone: null, icon: "moon",
    title: "Reflect", emph: "", sub, done: Boolean(today?.completed),
    action: { kind: "reflect" },
  };
}

// ── Builders ────────────────────────────────────────────────────────────────

function finalize(steps, basis, mode) {
  const clean = steps.slice(0, 3).map((s) => ({
    key: s.key,
    target: s.target,
    icon: s.icon || "check",
    tone: s.tone || null,
    title: String(s.title || "").trim() || "Keep your routine",
    emph: String(s.emph || "").trim(),
    sub: String(s.sub || "").trim() || " ",
    done: Boolean(s.done),
    action: s.action || { kind: "link", href: "/checklist" },
  }));
  return { mode, basis, steps: clean, doneCount: clean.filter((s) => s.done).length };
}

function genericSteps(ctx) {
  return [checklistRow(ctx), logRow(ctx), reflectRow(ctx)];
}

// Adds rows whose feature isn't on the card yet; fills from the generic set.
function assemble(candidates, ctx) {
  const used = new Set();
  const rows = [];
  for (const c of candidates) {
    if (!c || rows.length >= 3 || used.has(c.target)) continue;
    used.add(c.target);
    rows.push(c);
  }
  for (const g of genericSteps(ctx)) {
    if (rows.length >= 3) break;
    if (used.has(g.target) || rows.some((r) => r.key === g.key)) continue;
    used.add(g.target);
    rows.push(g);
  }
  return rows;
}

function reviewMode(ctx, top) {
  const closedLabel = ctx.marketDay.reason === "holiday"
    ? (ctx.indian ? "NSE closed today (holiday)" : "Market holiday")
    : "Markets closed";
  const steps = [
    {
      key: "review-report", target: "reports", icon: "report", tone: null,
      title: "Read your weekly feedback", emph: closedLabel, sub: "start with what the week says",
      action: { kind: "link", href: ctx.routes.reports },
    },
    {
      key: "review-coach", target: "coach", icon: "coach", tone: top ? "loss" : null,
      title: "Ask the coach about your week",
      emph: top?.emph ? `#1 leak: ${top.emph}` : "",
      sub: top ? "plan how to stop it next week" : "what cost you most, and what to change",
      action: {
        kind: "link",
        href: coachLink(ctx.routes, `${ctx.marketPrefix}What cost me the most this week, and what one rule should I add for next week?`),
      },
    },
    {
      key: "review-setups", target: "setups", icon: "target", tone: null,
      title: ctx.marketDay.reason === "holiday" ? "Tune your setups" : "Tune your setups for Monday",
      emph: "", sub: "keep only the ones that pay",
      action: { kind: "link", href: ctx.routes.setups },
    },
  ];
  return finalize(steps, "Review · learn · prepare", "review");
}

function build(input) {
  const ctx = makeContext(input);

  // Data we can't trust → never diagnose from it.
  if (ctx.unreliable) return finalize(genericSteps(ctx), "Plan · trade · review", "generic");

  const prescriptions = [
    ...leakPrescriptions(ctx),
    ...shapePrescriptions(ctx),
    ...trendPrescriptions(ctx),
    ...dataPrescriptions(ctx),
  ];
  if (ctx.setupCount === 0) {
    prescriptions.push({
      key: "no-setups", target: "setups", tone: "warning", icon: "target", score: 90,
      title: "Write your first setup", emph: "No setups yet",
      sub: "the rules your checklist checks against",
      action: { kind: "link", href: ctx.routes.setups },
    });
  }
  prescriptions.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  if (!ctx.marketDay.open) return reviewMode(ctx, prescriptions.find((p) => p.key.startsWith("leak")) || null);

  if (ctx.pnlReady < MIN_TRADES_FOR_PLAN) {
    const need = MIN_TRADES_FOR_PLAN - ctx.pnlReady;
    const steps = ctx.setupCount === 0
      ? [prescriptions.find((p) => p.key === "no-setups"), logRow(ctx), reflectRow(ctx)]
      : genericSteps(ctx);
    return finalize(steps, `Log ${need} more ${need === 1 ? "trade" : "trades"} for a personal plan`, "generic");
  }

  // Row 1: biggest leak, or the edge to lean into when nothing is wrong.
  const first = prescriptions[0] || strengthPrescription(ctx);
  const rest = prescriptions.filter((p) => p !== first);

  // Row 2: discipline today. Checklist until it's used, then today's log.
  const second = first?.target === "checklist" || ctx.checklistToday ? logRow(ctx) : checklistRow(ctx);

  // Row 3: close the day, then turn the reflection into a next step.
  const today = ctx.reflectionToday;
  let third;
  if (!today?.completed) {
    third = reflectRow(ctx);
  } else if (today.followedPlan === "no" || today.followedPlan === "partly") {
    third = {
      key: "broke-plan", target: "coach", tone: "loss", icon: "coach",
      title: "Ask the coach what happened",
      emph: today.followedPlan === "no" ? "You broke your plan today" : "You only partly followed your plan",
      sub: "find the trigger before tomorrow",
      action: {
        kind: "link",
        href: coachLink(ctx.routes, `${ctx.marketPrefix}I didn't follow my plan today. Look at today's trades and tell me what triggered it.`),
      },
    };
  } else {
    third = rest.find((p) => p.score >= 40) || {
      key: "lesson", target: "insights", tone: "profit", icon: "sparkles",
      title: "See today's lesson", emph: "Day closed", sub: "what your trades are teaching you",
      action: { kind: "link", href: ctx.routes.insights },
    };
  }

  // Nothing to diagnose: keep the familiar checklist → log → (reflect | next step).
  const rows = first
    ? assemble([first, second, third, ...rest], ctx)
    : assemble([checklistRow(ctx), logRow(ctx), third, ...rest], ctx);
  const basis = `Built from your ${ctx.pnlReady} ${ctx.marketName} trades`;
  return finalize(rows, basis, "personal");
}

function makeContext(input = {}) {
  const now = input.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date();
  const indian = input.market === "Indian_Market";
  const routes = {
    checklist: "/checklist", setups: "/setups", journal: "/trades", insights: "/intelligence",
    coach: "/coach", reports: "/weekly-reports",
    ...(input.routes || {}),
  };
  const streaks = input.streaks || null;
  const todayKey = streaks?.todayKey || input.reflection?.today?.day || null;
  const reflectionToday = input.reflection?.today || null;
  const stats = input.stats || {};
  return {
    now,
    indian,
    routes,
    stats,
    psychologyCost: input.psychologyCost || null,
    timeline: input.timeline || null,
    selfAwareness: input.selfAwareness || null,
    tradingDNA: input.tradingDNA || null,
    money: makeMoney(indian ? "INR" : "USD"),
    marketName: indian ? "Indian Market" : "Forex",
    marketPrefix: indian ? "In my Indian market trades: " : "",
    marketDay: resolveMarketDay(input.marketDay, todayKey, now),
    phase: sessionPhase(indian, now),
    reflectionToday,
    tradesToday: num(reflectionToday?.tradeCount),
    checklistToday: Boolean(
      streaks?.todayKey && streaks?.checklist?.lastQualifyingDate &&
      streaks.checklist.lastQualifyingDate === streaks.todayKey
    ),
    setupCount: input.onboarding && input.onboarding.setupCount !== undefined ? num(input.onboarding.setupCount) : null,
    pnlReady: num(stats.pnlReadyTrades ?? stats.totalTrades),
    unreliable: Boolean(input.unreliable),
  };
}

/**
 * @returns {{ mode: "personal"|"review"|"generic", basis: string, doneCount: number,
 *   steps: Array<{ key, target, icon, tone, title, emph, sub, done, action }> }}
 *   Always exactly three steps.
 */
export function buildTodayLoop(input = {}) {
  try {
    return build(input);
  } catch (error) {
    try {
      if (typeof input.onError === "function") input.onError(error);
    } catch { /* reporting must never break the card */ }
    try {
      const ctx = makeContext({ ...input, psychologyCost: null, timeline: null, selfAwareness: null, tradingDNA: null });
      return finalize(genericSteps(ctx), "Plan · trade · review", "generic");
    } catch {
      return finalize([
        { key: "checklist", target: "checklist", icon: "check", title: "Run the checklist", sub: "Before each trade", action: { kind: "link", href: "/checklist" } },
        { key: "log", target: "log", icon: "plus", title: "Log your trades", sub: "Screenshot or manual", action: { kind: "logTrade" } },
        { key: "reflect", target: "reflect", icon: "moon", title: "Reflect", sub: "2 minutes, end of day", action: { kind: "reflect" } },
      ], "Plan · trade · review", "generic");
    }
  }
}
