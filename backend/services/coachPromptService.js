"use strict";

const SYSTEM_PROMPT = `You are Edgecipline Coach, a calm, evidence-only trading coach.

NON-NEGOTIABLE RULES — break any of these and the response is wrong:
1. Use ONLY the data in the "Trader Context" JSON below. Never invent trades,
   numbers, sessions, strategies, or feelings.
2. Never give buy/sell signals, price predictions, or financial advice.
3. Every numeric claim must quote the exact figure from the context (e.g.
   "win rate 46.2%", "net P&L $-138.50").
4. If the user asks about something not in the context, say so explicitly —
   "I don't see that in your last 20 trades" — and suggest what they could
   log to make the answer possible.
5. Keep responses tight: ≤ 6 short paragraphs, ≤ 220 words unless the user
   explicitly asks for a longer breakdown. Use lists only when comparing.
6. Tone: direct, warm, and specific. No motivational fluff, no generic
   wisdom, no "as an AI" disclaimers.
7. End with ONE concrete suggested action the user can apply tomorrow.

Speak as a coach who has read every trade, every reflection, every streak.`;

const QUICK_PROMPTS_BY_ANCHOR = {
  insight: [
    { id: "why",           label: "Why?",                       prompt: "Why is this insight true? Walk me through the trades behind it." },
    { id: "improve",       label: "How can I improve?",         prompt: "Give me one concrete change I can make tomorrow." },
    { id: "examples",      label: "Show me examples.",          prompt: "Show me the three most recent trades where this showed up." },
    { id: "compare-week",  label: "Compare to last week.",      prompt: "How does this compare to my previous week of trades?" },
  ],
  trade: [
    { id: "explain-trade", label: "Explain this trade.",        prompt: "What does this trade tell me about my edge today?" },
    { id: "what-mistake",  label: "What did I do wrong?",       prompt: "Was there a mistake here? Compare it against my plan." },
    { id: "similar-past",  label: "Have I done this before?",   prompt: "Show me previous trades with the same setup or mistake." },
    { id: "next-time",     label: "What should I do next time?",prompt: "What is one rule I should add to my checklist after this?" },
  ],
  reflection: [
    { id: "coach-back",    label: "Coach me on today.",         prompt: "Coach me on today's reflection. What did I get right or wrong?" },
    { id: "improve",       label: "How can I improve tomorrow?", prompt: "Given today's reflection, what is the single highest-leverage change for tomorrow?" },
    { id: "pattern",       label: "Pattern over the week?",     prompt: "Is there a pattern across my last 7 reflections?" },
  ],
  "weekly-report": [
    { id: "biggest-leak",  label: "Biggest leak this week?",    prompt: "What was the single biggest leak in this week's report?" },
    { id: "what-worked",   label: "What worked?",               prompt: "Which trades or setups drove the wins this week?" },
    { id: "next-week",     label: "Plan for next week.",        prompt: "Build a 3-point checklist for next week based on this report." },
  ],
  dashboard: [
    { id: "summary",       label: "Summarise where I'm at.",    prompt: "Give me a one-paragraph honest summary of where my trading stands right now." },
    { id: "next-focus",    label: "What's my next focus?",      prompt: "What is the single most important thing for me to work on this week?" },
    { id: "leak",          label: "Biggest leak?",              prompt: "What is my biggest behavioural leak right now and why?" },
    { id: "strength",      label: "Biggest strength?",          prompt: "What is the strongest repeatable pattern in my recent trades?" },
  ],
  freeform: [
    { id: "summary",       label: "Where am I at?",             prompt: "Where am I at this week?" },
    { id: "leak",          label: "Biggest leak?",              prompt: "What is my biggest behavioural leak right now?" },
    { id: "checklist",     label: "Pre-trade checklist?",       prompt: "Build me a 5-rule pre-trade checklist from my last 20 trades." },
  ],
};

function getQuickPrompts(anchorKind = "freeform") {
  return QUICK_PROMPTS_BY_ANCHOR[anchorKind] || QUICK_PROMPTS_BY_ANCHOR.freeform;
}

// Builds the full prompt sent to Gemini. We use a system-style preamble (Gemini
// uses the `systemInstruction` field), then format the user/assistant history
// into Gemini's `contents` shape.
function buildModelInput({ systemPrompt = SYSTEM_PROMPT, context, anchor, history, nextUserMessage }) {
  const contextBlock = `Trader Context (JSON):
${JSON.stringify(context)}

Anchor:
${JSON.stringify(anchor || { kind: "freeform" })}`;

  const contents = [];
  // Seed the conversation with the context block as a user turn so models that
  // ignore systemInstruction (proxies, mock providers) still see it.
  contents.push({ role: "user", parts: [{ text: contextBlock }] });
  contents.push({
    role: "model",
    parts: [{ text: "Got it. I have your latest trades, reflections, streaks, and weekly report. I will only coach from this data." }],
  });

  for (const msg of history || []) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: String(msg.content || "").slice(0, 4000) }],
    });
  }

  if (nextUserMessage) {
    contents.push({ role: "user", parts: [{ text: String(nextUserMessage).slice(0, 4000) }] });
  }

  return { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }, contents };
}

module.exports = {
  SYSTEM_PROMPT,
  buildModelInput,
  getQuickPrompts,
};
