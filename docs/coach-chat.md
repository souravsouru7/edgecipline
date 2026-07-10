# AI Coach Chat — Conversational Coaching

Transforms the existing static Coach Feed into a real, evidence-only chat.
Every reply is grounded in the user's actual trades, reflections, streaks,
psychology, and weekly report — no generic advice.

---

## 1. Architecture overview

```
                       ┌──────────────────────────────┐
        AskCoachButton │  anchor:                     │
        on Insight ────▶  { kind:"insight", refId,    │
        on Reflection  │    label }                   │
        on Dashboard   │                              │
        /coach page    │                              │
                       └──────────────┬───────────────┘
                                      │
                       POST /api/coach/conversations
                                      │
                                      ▼
                       ┌──────────────────────────────┐
                       │  CoachConversation (Mongo)   │
                       └──────────────┬───────────────┘
                                      │
              POST /api/coach/conversations/:id/messages  (SSE)
                                      │
                                      ▼
      ┌────────────────────── coachChatService ──────────────────────┐
      │  1. enforceAndCountQuota(user)   ── free 5/wk, premium ∞     │
      │  2. persistUserMessage           ── CoachMessage role=user   │
      │  3. coachContextService.getContext(userId)                   │
      │       └─ Redis cache (5 min) over a digested snapshot of:    │
      │          recent trades · streak · reflections · weekly       │
      │          report · analytics + psychology + DNA + cost        │
      │  4. coachPromptService.buildModelInput(context, history, q)  │
      │  5. Gemini 2.5-flash generateContentStream() ──▶ for await   │
      │       └─ onChunk → SSE delta event                           │
      │  6. persistAssistantMessage      ── CoachMessage role=assist │
      └──────────────────────────────────────────────────────────────┘
                                      │
              SSE: meta · context · delta × N · done | error
                                      ▼
                       useCoachStream (React Query + fetch)
                                      │
                                      ▼
                       CoachChat ── streams into bubble in real time
```

---

## 2. Data model

**Collection: `coachconversations`**

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | Indexed. |
| `title` | String ≤ 200 | Auto-derived from anchor or first message. |
| `anchor.kind` | enum | `insight` \| `trade` \| `reflection` \| `weekly-report` \| `dashboard` \| `freeform` |
| `anchor.refId` / `label` | String | Soft references — context is always rebuilt fresh. |
| `market` | enum | `Forex` \| `Indian_Market` \| `any` |
| `messageCount` / `lastMessageAt` / `lastMessagePreview` | denormalised | Powers the list view cheaply. |
| `deletedAt` | Date | Soft delete. |

Index: `{ user, deletedAt, lastMessageAt:-1, _id:-1 }`.

**Collection: `coachmessages`**

| Field | Type | Notes |
|-------|------|-------|
| `conversation` / `user` | ObjectId | Indexed. |
| `role` | enum | `user` \| `assistant` \| `system` |
| `content` | String ≤ 16 KB | The actual text the user saw. |
| `status` | enum | `pending` \| `streaming` \| `complete` \| `error` |
| `error` | String | Populated on failure for thread visibility. |
| `model` / `tokensIn` / `tokensOut` / `latencyMs` / `streamed` | metadata | |
| `contextDigest` | object | `{ contextVersion, tradeCount, reflectionDays, hasWeeklyReport, sourceHash }` — debug "why did the AI say X". |

Indexes: `{ conversation, createdAt, _id }`, `{ user, createdAt:-1 }`.

---

## 3. API

All routes require `protect`. SSE is **only** used by `POST .../messages` — every other route is plain JSON.

| Method | Route | Notes |
|--------|-------|-------|
| GET | `/api/coach/quota` | `{ quota: { premium, used, limit, remaining, weekKey, resetsAt } }` |
| GET | `/api/coach/quick-prompts?anchor=insight` | `{ prompts: [{ id, label, prompt }] }` |
| GET | `/api/coach/conversations?limit=20&anchorKind=` | `{ conversations: [...] }` |
| POST | `/api/coach/conversations` | `{ anchor?, market?, initialMessage? }` → `{ conversation }` |
| GET | `/api/coach/conversations/:id` | `{ conversation, messages: [...] }` |
| DELETE | `/api/coach/conversations/:id` | Soft delete. |
| POST | `/api/coach/refresh-context` | Manually bust the Redis context cache. |
| **POST** | **`/api/coach/conversations/:id/messages`** | **SSE stream** (or JSON if `stream:false`). Body: `{ content, anchor?, stream? }`. Events: `meta`, `context`, `delta`, `done`, `error`. |

Validation via [`backend/validation/coachSchemas.js`](../backend/validation/coachSchemas.js).

### SSE wire format

```
event: meta
data: {"conversationId":"...","userMessageId":"...","quota":{...}}

event: context
data: {"cached":true,"tradeCount":18,"reflectionDays":5,"hasWeeklyReport":true,"sourceHash":"..."}

event: delta
data: {"text":"Looking at"}

event: delta
data: {"text":" the last 18 trades"}

event: done
data: {"ok":true}
```

Heartbeats (`:\n\n`) every 15 s keep proxies from closing the pipe. Quota
exhaustion responds with HTTP **402** as JSON instead of opening the stream.

---

## 4. Context assembly (`coachContextService`)

A single Redis-cached digest of everything the LLM needs:

```js
{
  version: "v1",
  market: "Forex",
  streak: { journal, checklist, rule, today, timezone },
  analytics: { totalTrades, wins, losses, winRate, netPnL, avgSetupScore,
               psychology: { score, planAdherencePct, calmTradingPct,
                             noRevengePct, topEmotionalTags },
               tradingDNA:  { bestSession, bestStrategy, mostExpensiveEmotion,
                              mostProfitableEmotion, identity },
               psychologyCost: { score, biggestLeak } },
  recentTrades: [/* last 20 trades, projected to ~15 fields each */],
  topMistakes: [/* tally of mistakeTag over the recent window */],
  reflections: [/* last 7 reflections including improvement notes */],
  latestWeeklyReport: { weekStart, weekEnd, summary, mistakes, improvements,
                        nextWeekChecklist, psychologyFeedback, dataQualityScore },
}
```

- Cache key: `coach:ctx:v1:{userId}` · TTL **5 min** · invalidated on
  `POST /api/coach/refresh-context`.
- Hard cap **60 KB** — drops oldest trades, then oldest reflections, before
  it ever reaches Gemini's prompt-byte limit.
- Each chat turn carries a SHA-1 `sourceHash` so support can replay "what
  did the AI see when it told the user X".

---

## 5. Prompt engineering (`coachPromptService`)

System prompt enforces 7 non-negotiable rules: only use the JSON context,
never invent numbers, no signals/predictions, end with one concrete action,
≤ 6 short paragraphs, etc. See [`backend/services/coachPromptService.js`](../backend/services/coachPromptService.js)
for the full prompt.

**Quick prompts per anchor kind** (powers the chip row above the input):

| Anchor | Chips |
|--------|-------|
| `insight` | Why? · How can I improve? · Show me examples. · Compare to last week. |
| `trade` | Explain this trade. · What did I do wrong? · Have I done this before? · What next time? |
| `reflection` | Coach me on today. · How can I improve tomorrow? · Pattern over the week? |
| `weekly-report` | Biggest leak this week? · What worked? · Plan for next week. |
| `dashboard` | Summarise where I'm at. · What's my next focus? · Biggest leak? · Biggest strength? |
| `freeform` | Where am I at? · Biggest leak? · Pre-trade checklist? |

---

## 6. Premium gating + quota

[`backend/utils/premium.js`](../backend/utils/premium.js) — single
`isPremium(user)` source of truth: `subscriptionStatus === "active"` and
`subscriptionPlan !== "free"` (admins are always premium; expired subscriptions
are not).

[`backend/services/coachQuotaService.js`](../backend/services/coachQuotaService.js):

- Free: **5 user-authored messages per ISO week** (`isoWeekKey`).
- Premium: unlimited (still tracked for analytics).
- Atomic Redis `INCR` enforces the cap under concurrent sends; falls back
  to Mongo recount when Redis is down so the limit cannot be bypassed.
- Reset is shared across all users (Monday 00:00 UTC) — simpler support
  conversations.

402 `COACH_QUOTA_EXHAUSTED` returns the quota object so the UI can render
the upgrade banner with the next reset time.

---

## 7. Rate limiting + abuse

- Per-user, per-minute SSE rate limiter: `coachChatRateLimiter` (default 20
  messages/min) — added to [`backend/middleware/rateLimiter.js`](../backend/middleware/rateLimiter.js).
- Global API limiter still applies upstream.
- A 15-second SSE heartbeat keeps proxies honest. The controller listens
  for `req.on("close")` to abort the in-flight Gemini stream when the
  client navigates away.

---

## 8. Frontend

| File | Purpose |
|------|---------|
| [`frontend/features/coach-chat/api/coachApi.js`](../frontend/features/coach-chat/api/coachApi.js) | Axios wrappers (everything except `messages`). |
| [`frontend/features/coach-chat/lib/streamCoach.js`](../frontend/features/coach-chat/lib/streamCoach.js) | `fetch` + `ReadableStream` SSE parser with auth header injection (`EventSource` can't send POST + Bearer). |
| [`frontend/features/coach-chat/hooks/useCoach.js`](../frontend/features/coach-chat/hooks/useCoach.js) | `useCoachQuota`, `useQuickPrompts`, `useCoachConversations`, `useCoachConversation`, `useCreateConversation`, `useDeleteConversation`, `useRefreshCoachContext`, and the streaming `useCoachStream`. |
| [`frontend/features/coach-chat/components/CoachChat.jsx`](../frontend/features/coach-chat/components/CoachChat.jsx) | Main panel — `mode="modal"` (anchored) or `mode="inline"` (full-page). Header, scrolling message list, quick-prompt chips, textarea + send, quota banner. |
| `CoachMessage.jsx` | Single bubble with paragraph-aware rendering + a blinking cursor while streaming. |
| `CoachQuickPrompts.jsx` | Chip row sourced from `/quick-prompts`. |
| `CoachQuotaPill.jsx` | Compact pill showing "Unlimited" / "3/5 this week". Links to billing when low. |
| `AskCoachButton.jsx` | Drop-in trigger used wherever a coach hand-off makes sense. |
| `app/coach/page.js` | Two-pane conversation list + active chat. |

### Where the "Ask Coach" buttons live

- **Every insight card** in `AICoachFeedWidget.jsx` — anchored to the
  insight's id + title.
- **Reflection dashboard widget** — anchored to the day's reflection;
  default prompt quotes the latest AI insight.
- **/coach** — full conversation manager.

The chat is mounted lazily per anchor so React Query can deduplicate the
quota / quick-prompts requests across multiple open buttons.

---

## 9. Implementation roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Models, services, controller, SSE route, prompts, quota, rate limit, tests | ✅ shipped |
| 0 | Frontend chat + streaming + AskCoach on insights & reflections + `/coach` page | ✅ shipped |
| 1 | "Ask Coach" buttons on individual trade rows + weekly report cards | TODO — `AskCoachButton anchor={{kind:"trade", refId, label}}` |
| 1 | Settings UI toggle to disable AI Coach Chat | TODO (preference flag) |
| 2 | Token accounting — emit Gemini's `usageMetadata` into `CoachMessage.tokensIn/tokensOut` for cost dashboards | TODO |
| 2 | Server-side regeneration ("retry last reply") when the user is unhappy | TODO |
| 2 | Cross-conversation memory — summarise stale conversations into a `coachPreferences` doc the system prompt can reference | TODO |
| 3 | Voice input on mobile (Capacitor Speech plugin) | TODO |
| 3 | Coach-suggested trade tags ("I noticed FOMO in 3 of your last 5 trades — tag them?") with one-tap accept | TODO |
| 3 | Notification: weekly "Coach digest" push summarising the user's most-asked themes | TODO |

---

## 10. Operational notes

- **Cost**: 1 Gemini stream call per user message. Free users capped at 5/wk
  → worst-case 5 × MAU. Premium users uncapped but bounded by rate limit
  (20/min) and prompt size (60 KB context + bounded history).
- **Privacy**: nothing in the context block leaves the user's own data set.
  Conversations are scoped by `user` in every query. Soft-delete on
  conversations keeps audit trails available without surfacing to the user.
- **Failure modes**: every Gemini stream failure persists an `assistant`
  message with `status:"error"`; the next thread fetch shows the user what
  happened instead of dropping the turn silently.
- **TZ safety**: quota week and reflection day both derive from the same
  helpers (`isoWeekKey`, `streakService.getStreakSnapshot`).
- **Testing**: 9 new unit tests in
  [`backend/__tests__/unit/coachQuota.test.js`](../backend/__tests__/unit/coachQuota.test.js)
  and
  [`backend/__tests__/unit/coachContext.test.js`](../backend/__tests__/unit/coachContext.test.js)
  cover quota math, premium detection, and context assembly. Combined with the
  reflection suite, all 16 tests pass.
