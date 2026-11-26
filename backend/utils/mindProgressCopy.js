/**
 * Mind Score copy — friendly-buddy voice, rendered ONLY from evidence.
 *
 * Every message is a frame with the evidence slots it needs. A frame is
 * eligible only when all of its slots are present, so we never print
 * "your {tag} trades" with a hole in it; when the specific frames don't fit,
 * a more general one does. Among eligible frames the variant is picked by a
 * stable hash of (userId, day, fact type): the same trader sees the same line
 * all day (no flicker on refresh), a different one tomorrow, and two traders
 * with the same facts read different sentences.
 *
 * Tone rules (product decisions):
 *   - Wins lead; a slip is "pattern spotted", never a scolding.
 *   - Every claim carries its number. No praise that the data doesn't back.
 *   - No trade calls, prices or predictions — this is about behaviour.
 */

const { levelInfo } = require("./mindProgress");

// ─── Deterministic variant choice ───────────────────────────────────────────

function hash(str) {
  // FNV-1a, 32-bit. Stable across processes and Node versions.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function has(evidence, key) {
  const v = evidence ? evidence[key] : undefined;
  return v !== undefined && v !== null && v !== "";
}

function pick(frames, evidence, seed) {
  const eligible = frames.filter((f) => (f.needs || []).every((k) => has(evidence, k)) && (!f.when || f.when(evidence)));
  if (!eligible.length) return null;
  const frame = eligible[hash(seed) % eligible.length];
  return frame.text(evidence || {});
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CURRENCY_SYMBOL = { USD: "$", INR: "₹" };
function money(amount, currency) {
  const sym = CURRENCY_SYMBOL[currency] || "";
  const n = Math.round(Math.abs(Number(amount) || 0));
  return `${sym}${n.toLocaleString(currency === "INR" ? "en-IN" : "en-US")}`;
}

// ─── "Why it moved" reasons (short, one line each) ───────────────────────────

const REASON_FRAMES = {
  calm_after_loss: [
    { needs: ["instrument"], when: (e) => e.walkedAway, text: (e) => `Took the ${e.instrument} loss and walked away 💪` },
    { needs: ["instrument"], text: (e) => `Stayed calm after your ${e.instrument} loss 🧊` },
    { needs: ["count"], when: (e) => e.count > 1, text: (e) => `Stayed calm after ${plural(e.count, "loss", "losses")} 💪` },
    { text: () => "Didn't chase that loss 💪" },
  ],
  plan_followed: [{ text: () => "Followed your plan today ✅" }, { text: () => "Stuck to the plan ✅" }],
  sat_out: [{ text: () => "Sat out when there was nothing to take 🧘" }],
  reflection_done: [{ text: () => "Closed the day with a reflection 📓" }],
  clean_entries: [
    { needs: ["count", "total"], when: (e) => e.count === e.total && e.total > 1, text: (e) => `All ${e.total} entries were on-plan 🎯` },
    { needs: ["count"], when: (e) => e.count === 1, text: () => "A clean on-plan entry 🎯" },
    { needs: ["count"], when: (e) => e.count > 1, text: (e) => `${e.count} clean on-plan entries 🎯` },
  ],
  rule_kept: [
    { needs: ["rule", "count"], when: (e) => e.count > 1, text: (e) => `Kept "${e.rule}" on ${plural(e.count, "trade")} 📋` },
    { needs: ["rule"], text: (e) => `Kept "${e.rule}" 📋` },
  ],
  positive_tags: [
    { needs: ["tag", "count"], when: (e) => e.count > 1, text: (e) => `${e.count} trades taken ${String(e.tag).toLowerCase()} 🧘` },
    { needs: ["tag"], text: (e) => `Traded ${String(e.tag).toLowerCase()} today 🧘` },
  ],
  honest_tags: [
    { needs: ["tag"], text: (e) => `Tagged "${e.tag}" honestly 📓` },
    { text: () => "Logged your emotions honestly 📓" },
  ],
  journal_logged: [
    { needs: ["trades"], when: (e) => e.trades > 0, text: (e) => `Journaled ${plural(e.trades, "trade")} 📓` },
    { text: () => "Showed up and journaled 📓" },
  ],
  revenge: [
    { needs: ["instrument"], text: (e) => `Revenge trade on ${e.instrument}` },
    { needs: ["count"], text: (e) => (e.count > 1 ? `${e.count} revenge trades` : "Revenge trade") },
  ],
  tilt_after_loss: [
    { needs: ["minutes", "instrument"], text: (e) => `Jumped back into ${e.instrument} ${e.minutes} min after a loss` },
    { needs: ["count"], text: (e) => (e.count > 1 ? `Tilted after ${e.count} losses` : "Tilted after a loss") },
  ],
  neg_tag: [
    { needs: ["tag", "weekCount"], when: (e) => e.weekCount > e.count, text: (e) => `${e.tag} again (${e.weekCount} this week)` },
    { needs: ["tag", "count"], text: (e) => (e.count > 1 ? `${e.count} ${e.tag} trades` : `${e.tag} trade`) },
  ],
  impulsive: [{ needs: ["count"], text: (e) => (e.count > 1 ? `${e.count} impulsive entries` : "Impulsive entry") }],
  overconfident: [{ text: () => "Overconfident entry" }],
  rule_broken: [{ needs: ["rule"], text: (e) => `Skipped "${e.rule}"` }],
  plan_missed: [{ text: () => "Went off-plan today" }],
  window_shift: [{ text: () => "Strong days from 2 weeks ago rolled off" }],
};

function renderReason(reason, seed) {
  const frames = REASON_FRAMES[reason.type];
  return (frames && pick(frames, reason.evidence, `${seed}:${reason.type}`)) || null;
}

// ─── Headlines (dashboard card, one line, the day's best fact) ───────────────

const TREND_FRAMES = {
  revenge_down: [
    { when: (e) => e.after === 0, text: (e) => `Zero revenge trades this week, down from ${e.before} 🔥 that's huge!` },
    { when: (e) => e.after === 0, text: (e) => `${e.before} revenge trades last week → 0 this week. You're not chasing anymore 💪` },
    { text: (e) => `Revenge trades down from ${e.before} to ${e.after} this week 👊` },
  ],
  tag_down: [
    { needs: ["tag"], when: (e) => e.after === 0, text: (e) => `No ${e.tag} trades this week. Last week: ${e.before} 🔥` },
    { needs: ["tag"], text: (e) => `${e.tag} trades: ${e.before} → ${e.after} this week. You're breaking it 💪` },
  ],
  impulsive_down: [{ text: (e) => `Impulsive entries down from ${e.before} to ${e.after} this week 🎯` }],
  recovery_up: [
    { text: (e) => `Calm after ${e.afterCalm} of ${e.afterLosses} losses this week (last week ${e.beforeCalm}/${e.beforeLosses}) 🧊` },
    { text: (e) => `Your bounce-back game is levelling up: ${e.afterCalm}/${e.afterLosses} calm after losses 💪` },
  ],
  plan_up: [{ text: (e) => `Plan followed ${e.afterPct}% of days, up from ${e.beforePct}% ✅` }],
  tagging_up: [{ text: (e) => `You're tagging ${e.afterPct}% of trades now (was ${e.beforePct}%). Your data's getting sharp 📓` }],
  cost_down: [
    { needs: ["currency"], text: (e) => `Emotional trades cost ${money(e.after, e.currency)} this week vs ${money(e.before, e.currency)} last week 💸` },
  ],
  revenge_up: [{ text: (e) => `Pattern spotted: revenge trades went ${e.before} → ${e.after}. One pause after a loss fixes a lot 👊` }],
  tag_up: [{ needs: ["tag"], text: (e) => `Pattern spotted: ${e.tag} showed up ${e.after} times this week (${e.before} last week) 👀` }],
  impulsive_up: [{ text: (e) => `Pattern spotted: ${e.after} impulsive entries this week. Slow the trigger finger a bit 😅` }],
  recovery_down: [{ text: (e) => `Pattern spotted: losses are getting under your skin (${e.afterCalm}/${e.afterLosses} calm). Breathe first 🧘` }],
  plan_down: [{ text: (e) => `Pattern spotted: plan followed ${e.afterPct}% this week vs ${e.beforePct}% last week 👀` }],
};

const DAY_HEADLINE_FRAMES = {
  calm_after_loss: [
    { needs: ["instrument"], when: (e) => e.walkedAway, text: (e) => `Took the ${e.instrument} loss and walked away. That's pro stuff bro 💪` },
    { needs: ["count"], when: (e) => e.count > 1, text: (e) => `${plural(e.count, "loss", "losses")} today and you stayed calm every time 🧊` },
    { text: () => "Took a loss and didn't chase it 💪 that's growth!" },
  ],
  plan_followed: [{ text: () => "Plan in, plan followed ✅ that's how it compounds" }],
  clean_entries: [
    { needs: ["count"], when: (e) => e.count === 1, text: () => "One clean, on-plan entry today 🎯 quality over quantity" },
    { needs: ["count"], when: (e) => e.count > 1, text: (e) => `${e.count} clean on-plan entries today 🎯 nice and patient` },
  ],
  rule_kept: [{ needs: ["rule"], text: (e) => `You kept "${e.rule}" all day 📋 discipline looks good on you` }],
  positive_tags: [{ needs: ["tag"], text: (e) => `Trading ${String(e.tag).toLowerCase()} today 🧘 keep that energy` }],
  honest_tags: [{ needs: ["tag"], text: (e) => `Tagging "${e.tag}" honestly? Respect. That's what makes your score real 📓` }],
  sat_out: [{ text: () => "Sat out today. Not trading is a position too 🧘" }],
  reflection_done: [{ text: () => "Day closed with a reflection 📓 that's the habit" }],
  journal_logged: [{ text: () => "Showed up and journaled 📓 consistency is the edge" }],
};

/**
 * @param {object} fact  trend fact {type, evidence} or day reason
 */
function renderHeadline(fact, seed) {
  if (!fact) return null;
  const frames = TREND_FRAMES[fact.type] || DAY_HEADLINE_FRAMES[fact.type];
  return (frames && pick(frames, fact.evidence, `${seed}:h:${fact.type}`)) || null;
}

// ─── States ──────────────────────────────────────────────────────────────────

// The unlock counts DAYS, not trades: three trades on one date are still one
// journal day. Say so explicitly, so a second trade today never looks like
// progress that didn't happen.
function renderLocked({ journaledDays, needed, journaledToday = false }, seed) {
  const left = Math.max(1, needed - journaledDays);
  if (journaledDays === 0) return "Journal your first day and your Mind Score starts building 🧠";
  if (journaledToday) {
    if (left === 1) return `Day ${journaledDays} done ✅ One more day (tomorrow) and your Mind Score drops 👀`;
    return pick([
      { text: () => `Today counted ✅ Journal again tomorrow: ${left} more days unlock your Mind Score 🧠` },
      { when: () => journaledDays === 1, text: () => `Day 1 done 🙌 Come back tomorrow: ${left} more days unlock your Mind Score 🧠` },
    ], {}, `${seed}:locked:${journaledDays}`);
  }
  return `Journal today to make it day ${journaledDays + 1} of ${needed} 🧠`;
}

// After a save when today was already counted.
function renderAlreadyCounted({ journaledDays, needed }) {
  const left = Math.max(1, needed - journaledDays);
  return `Already counted today ✅ Come back tomorrow for day ${journaledDays + 1} (${left} to go)`;
}

function renderStale({ daysAway }, seed) {
  return pick([
    { text: () => `Welcome back bro 👋 fresh start. Journal today and your score picks up right here.` },
    { text: () => `${daysAway} days away, no stress 👊 your score held. Let's go again.` },
  ], {}, `${seed}:stale`);
}

function renderEarlyRead(missing) {
  const hints = {
    emotional: "Tag emotions on your trades to unlock Emotional control",
    discipline: "Use your checklist or answer 'followed plan?' to unlock Discipline",
    recovery: "Log a couple more losing days to unlock Recovery",
    selfAwareness: "Rate your trades (Great/Average/Poor) to unlock Self-awareness",
    journaling: "Journal a trade to unlock Journaling",
  };
  const order = ["emotional", "discipline", "selfAwareness", "recovery", "journaling"];
  const first = order.find((k) => missing.includes(k));
  return first ? hints[first] : null;
}

// ─── Micro reward (instant sheet after a save) ───────────────────────────────

function renderMicroLine({ delta, topReason, unlockedToday, seed }) {
  if (unlockedToday) return "Your Mind Score is live 🎉 this is your starting point. Let's watch it climb 🚀";
  const reasonText = topReason ? renderReason(topReason, seed) : null;
  // The specific reason always wins over a generic line when we have one.
  if (delta > 0) {
    return reasonText
      ? pick([
        { text: () => `${reasonText}. That's growth bro!` },
        { text: () => `${reasonText}. Keep stacking days like this 🔥` },
      ], {}, `${seed}:micro:up`)
      : "Logged and counted 🔥 keep stacking days like this";
  }
  if (delta < 0) {
    return reasonText
      ? pick([
        { text: () => `${reasonText} 😅 happens to everyone. One calm day and you're right back 👊` },
        { text: () => `${reasonText}, noted 👀 one calm day and you're right back 👊` },
      ], {}, `${seed}:micro:down`)
      : "Small dip 😅 one calm day and you're right back 👊";
  }
  return reasonText ? `${reasonText}. Logged and counted 📓` : "Logged and counted 📓";
}

// ─── Mind Wins / level-ups ──────────────────────────────────────────────────

const WIN_COPY = {
  first_report: (e) => (Number(e.journaledDays) > 3 && Number.isFinite(e.startingScore) && Number.isFinite(e.score)
    ? {
      title: "Your Mind Score is live 🎉",
      body: `We read your last ${e.journaledDays} journal days. You started at ${Math.round(e.startingScore)} and you're at ${Math.round(e.score)} now. Let's keep climbing 🚀`,
    }
    : { title: "Your Mind Score is live 🎉", body: "3 days of honest journaling. This is your starting point. Let's watch it climb 🚀" }),
  calm_under_pressure: (e) => ({
    title: "Calm Under Pressure 🧊",
    body: `${plural(e.losses, "loss", "losses")} this week and zero revenge. Last week: ${plural(e.beforeSlips, "slip")}. That's a whole new mindset 🔥`,
  }),
  zero_revenge_week: (e) => ({ title: "Revenge-Free Week 🔥", body: `${plural(e.trades, "trade")} this week, not one revenge trade. You've done it before, you didn't this time 💪` }),
  tag_halved: (e) => ({ title: `${e.tag} Tamed 🎯`, body: `${e.tag} trades went ${e.before} → ${e.after} week on week. You're literally breaking the habit.` }),
  cost_halved: (e) => ({ title: "Emotional Cost Halved 💸", body: `Emotional trades cost you ${money(e.after, e.currency)} this week vs ${money(e.before, e.currency)} last week. That's money staying in your account.` }),
  plan_run_best: (e) => ({ title: `${e.days}-Day Plan Run ✅`, body: `Followed your plan ${e.days} days straight, your best yet${e.previousBest ? ` (old best: ${e.previousBest})` : ""}.` }),
  self_awareness_best: (e) => ({ title: "Sharp Self-Read 🪞", body: `Your trade grades match reality ${e.score}% of the time across ${e.reviews} reviews. Personal best.` }),
  honest_journal_20: () => ({ title: "Honest Journal 📓", body: "20 trades in a row with your emotions logged. That's how real change starts." }),
  honest_journal_50: () => ({ title: "Honest Journal ×50 📓", body: "50 trades in a row fully tagged. Your data is gold now." }),
  honest_journal_100: () => ({ title: "Honest Journal ×100 👑", body: "100 trades in a row fully tagged. Most traders never get here." }),
  target_completed: (e) => ({ title: "Target Smashed 🎯", body: `${e.label ? `"${e.label}": ` : ""}${e.cleanDays} clean days this week. You set it, you did it 💪` }),
};

function renderWin(milestone) {
  if (/^level_\d$/.test(milestone.key)) return renderLevelUp(milestone.evidence || {});
  const fn = WIN_COPY[milestone.key];
  return fn ? fn(milestone.evidence || {}) : { title: "Mind Win 🏅", body: "You earned a new Mind Win." };
}

function renderLevelUp({ level, fromLevel, startingScore, score }) {
  const to = levelInfo(level);
  const from = fromLevel ? levelInfo(fromLevel) : null;
  const journey = Number.isFinite(startingScore) && Number.isFinite(score) && score > startingScore
    ? ` Started at ${Math.round(startingScore)}, now ${Math.round(score)}.`
    : "";
  return {
    title: `Level up! ${to.emoji} ${to.name}`,
    body: `${from ? `${from.emoji} ${from.name} → ${to.emoji} ${to.name}.` : `You're now ${to.emoji} ${to.name}.`}${journey} You're becoming a ${to.level >= 4 ? "seriously disciplined" : "calmer, sharper"} trader 🔥`,
  };
}

// Locked teasers on the shelf — shown as "???" with a hint, never the full rule.
const WIN_TEASERS = [
  { key: "calm_under_pressure", hint: "Stay calm through a rough week" },
  { key: "zero_revenge_week", hint: "A week without chasing" },
  { key: "tag_halved", hint: "Cut your top emotion trade in half" },
  { key: "plan_run_best", hint: "Beat your plan-followed run" },
  { key: "self_awareness_best", hint: "Read your own trades sharply" },
  { key: "honest_journal_20", hint: "Tag 20 trades in a row" },
  { key: "cost_halved", hint: "Halve what emotions cost you" },
];

// ─── Targets ─────────────────────────────────────────────────────────────────

function renderTargetLabel(preset, params = {}) {
  switch (preset) {
    case "no_tag": return `No ${params.label || params.tag} trades`;
    case "follow_rule": return `Follow "${params.rule}" every trade`;
    case "stop_after_losses": return `Stop after ${params.n || 2} losses in a day`;
    case "tag_every_trade": return "Tag emotions on every trade";
    case "plan_days": return "Follow my plan 5 of 7 days";
    default: return "Weekly focus";
  }
}

function renderTargetWhy(suggestion) {
  const e = suggestion.evidence || {};
  switch (suggestion.preset) {
    case "no_tag": return `${suggestion.params.label || suggestion.params.tag} showed up ${plural(e.count, "time")} in your last 2 weeks`;
    case "follow_rule": return `You follow it on ${e.followPct}% of ${e.total} trades right now`;
    case "stop_after_losses": return `You kept trading after 2 losses on ${plural(e.days, "day")} recently`;
    case "tag_every_trade": return e.trades ? `${e.taggedPct}% of your recent trades are tagged` : "Tagged trades make your score sharper";
    case "plan_days": return "Answer 'followed plan?' in your evening reflection";
    default: return "";
  }
}

// ─── Push notifications ─────────────────────────────────────────────────────

function renderPush(kind, data = {}, seed = "") {
  switch (kind) {
    case "mind_level_up": {
      const { title, body } = renderLevelUp(data);
      return { title: `🎉 ${title}`, body };
    }
    case "mind_win": {
      const { title, body } = renderWin(data);
      return { title: `🏅 ${title}`, body };
    }
    case "mind_report_ready":
      return { title: "🧠 Your Mind Score is ready", body: "3 days of journaling unlocked it. Come see where you're starting from 👀" };
    case "mind_target":
      return {
        title: "🎯 1 clean day to go",
        body: `${data.label ? `"${data.label}": ` : ""}${data.cleanDays} of ${data.goal} clean days done. One more and you've smashed it 💪`,
      };
    case "mind_fresh_start":
      return {
        title: "🌅 New week, fresh start",
        body: data.suggestion
          ? `Want to work on "${data.suggestion}" this week? Pick your focus and let's climb 👊`
          : pick([
            { text: () => "Pick one focus for the week and let's climb 👊" },
            { text: () => "One focus, seven days. Let's see that Mind Score move 🧠" },
          ], {}, `${seed}:fresh`),
      };
    default:
      return null;
  }
}

module.exports = {
  WIN_TEASERS,
  hash,
  money,
  renderEarlyRead,
  renderHeadline,
  renderLevelUp,
  renderAlreadyCounted,
  renderLocked,
  renderMicroLine,
  renderPush,
  renderReason,
  renderStale,
  renderTargetLabel,
  renderTargetWhy,
  renderWin,
};
