# End-of-Day Reflection System

Closes Edgecipline's daily habit loop: **Morning prepares, evening reflects.**
The user should be able to finish a reflection in under 30 seconds.

---

## 1. Architecture overview

```
   Evening cron (19:30 IST)
        │  classifies user
        ▼
  edgecipline_coaching channel push  ──▶  /reflection deep-link
        │
        ▼
  ReflectionSheet (30-sec form)  ──POST /api/reflections──▶
        │                                                  │
        │                                          reflectionService.upsertReflection
        │                                                  │
        │                                          DailyReflection (Mongo)
        │                                                  │
        │                       setImmediate ──▶ reflectionInsightService.generateInsight
        │                                                  │
        │                                              attachAiInsight (Gemini ↓ fallback)
        ▼
  React Query invalidation
        │
        ▼
  Dashboard snapshot rebuild  ──▶  ReflectionCard + weekly score ring + AI insight
```

---

## 2. Data model

**Collection: `dailyreflections`**

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | Indexed. Refs `User`. |
| `day` | String `YYYY-MM-DD` | User-local TZ. Unique with `user`. |
| `market` | enum | `Forex` \| `Indian_Market` \| `any` |
| `context.tradeCount` / `hadTrades` / `grossPnL` / `followedChecklist` | snapshot at submit | Frozen so history renders without re-querying Trade. |
| `followedPlan` | enum | `yes` \| `partly` \| `no` \| `no_trades` |
| `mood` / `confidence` | 1–5 sliders | Both optional. |
| `wouldRepeat` | enum | `yes` \| `no` \| `partly` |
| `improvement` | String ≤ 280 | Optional free-form. |
| `skipped` | Boolean | User explicitly skipped today. |
| `aiInsight` / `aiInsightModel` / `aiInsightGeneratedAt` / `aiInsightFallback` | AI coaching line ≤ 280 chars | Populated post-save. |
| `source` | enum | `manual` \| `notification` \| `cron-skip` |
| `createdAt` / `updatedAt` | timestamps | |

Indexes:
- `{ user: 1, day: 1 }` unique — idempotent upserts.
- `{ user: 1, day: -1 }` — calendar reads & weekly window.

---

## 3. API

All routes require `protect`. Responses use the standard envelope; the
frontend's `apiClient` unwraps `.data` automatically.

| Method | Route | Body | Response |
|--------|-------|------|----------|
| GET | `/api/reflections/today` | — | `{ day, context, reflection, completed, skipped, timezone }` |
| GET | `/api/reflections/summary` | — | `{ today, weekly, latestInsight }` |
| GET | `/api/reflections?days=14` | — | `{ items, range, days }` |
| POST | `/api/reflections` | `{ followedPlan?, mood?, confidence?, wouldRepeat?, improvement?, source? }` (≥ 1) | `{ reflection, context, day, insightPending }` |
| POST | `/api/reflections/skip` | `{ market?, source? }` | `{ reflection, context, day }` |

Validation via [`backend/validation/reflectionSchemas.js`](../backend/validation/reflectionSchemas.js).

---

## 4. Backend layout

| File | Purpose |
|------|---------|
| `backend/models/DailyReflection.js` | Mongoose schema + indexes. |
| `backend/services/reflectionService.js` | Upsert/skip/weekly-score/today-context. **Weekly score is a pure function — easy to test.** |
| `backend/services/reflectionInsightService.js` | Gemini call with a deterministic fallback line per scenario. Truncates to 200 chars. |
| `backend/controllers/reflectionController.js` | Thin handlers; `setImmediate` for AI insight (never blocks the response). |
| `backend/routes/reflectionRoutes.js` | Routes mounted at `/api/reflections`. |
| `backend/jobs/reflectionReminderCron.js` | Daily 19:30 local push. Three variants: `logged_trades`, `no_trades`, `no_login`. |
| `backend/controllers/dashboardController.js` | Adds `reflection` block to `/api/dashboard/snapshot`. |
| `backend/services/notificationService.js` | New type `evening_reflection` → channel `edgecipline_coaching` + pref `eveningReflection`. |
| `backend/models/NotificationPreference.js` | New `eveningReflection` toggle (default `true`). |
| `backend/__tests__/unit/reflectionService.test.js` | Weekly score + upsert + skip — 7 tests, all green. |

---

## 5. Smart notification logic

`reflectionReminderCron` fires once per day (Redis distributed lock keyed by
`YYYY-MM-DD` so the cron is multi-instance safe). For each user:

1. **Already reflected or skipped today?** → no push.
2. **Trades today?** → variant `logged_trades` ("You traded today. 30 seconds…").
3. **No trades?** → variant `no_login` ("Did the market move you today?").
   *(`no_trades` variant reserved for a future "user logged in but didn't trade" signal once we add an activity log.)*

Notification properties:

- Type: `evening_reflection`
- Channel: `edgecipline_coaching` (blue, calm)
- Dedupe key: `evening-reflection:{userId}:{dayKey}`
- Deep link: `/reflection`
- Honors user `NotificationPreference.eveningReflection` and `quietHours`.

Cron config (env-tunable):

```
ENABLE_REFLECTION_REMINDER_CRON=true
REFLECTION_REMINDER_CRON="30 19 * * *"
REFLECTION_REMINDER_TIMEZONE="Asia/Kolkata"
REFLECTION_REMINDER_CRON_CONCURRENCY=50
```

---

## 6. Weekly score (0–100)

Composite over the rolling 7-day window:

| Bucket | Weight | Scale |
|--------|--------|-------|
| Plan adherence | 40 | yes=10, partly=5, no=0, no_trades=8 |
| Would-repeat | 20 | yes=10, partly=5, no=0 |
| Mood + confidence avg | 20 | normalised 1–5 → 0–10 |
| Completion | 20 | submitted-not-skipped days / 7 |

We always divide completion by 7 (not "days with data"), so reflecting more
often visibly raises the score. Test coverage in
`backend/__tests__/unit/reflectionService.test.js`.

---

## 7. Frontend layout

| File | Purpose |
|------|---------|
| `frontend/features/reflections/api/reflectionApi.js` | Thin axios wrappers. |
| `frontend/features/reflections/hooks/useReflection.js` | `useTodayReflection`, `useReflectionSummary`, `useReflectionHistory`, `useSubmitReflection`, `useSkipReflection`. All mutations invalidate `["reflection"]` + `["dashboard","snapshot"]`. |
| `frontend/features/reflections/components/ReflectionSheet.jsx` | Bottom-sheet modal. One-tap pills + 1–5 sliders + 280-char textarea. Skip button always available. |
| `frontend/features/reflections/components/ReflectionScoreRing.jsx` | SVG ring used inside the card. |
| `frontend/features/reflections/components/ReflectionCard.jsx` | Dashboard widget. Reads `reflection` block from snapshot — never fetches. Opens the sheet on tap. |
| `frontend/features/reflections/components/ReflectionHistoryList.jsx` | Reflection list with per-row AI insight. |
| `frontend/app/reflection/page.js` | `/reflection` history page with 7d / 14d / 30d toggle. |
| `frontend/app/dashboard/page.js` | Mounts `<ReflectionCard>` directly under the KPI grid. |
| `frontend/features/dashboard/hooks/useDashboard.js` | Exposes the new `reflection` snapshot field. |

The sheet is mounted by both the dashboard card and the history page. The push
notification deep-links to `/reflection`, which auto-shows the card; mobile
nav users can also reach it from there.

---

## 8. Analytics signals (cheap, derived)

The reflection collection alone supports:

- **Compliance rate** — `submittedDays / 7` across users.
- **Plan adherence vs. P&L** — join `DailyReflection.followedPlan` with the
  same day's `Trade.profit` sum to surface "discipline pays" charts.
- **Mood/confidence drift** — rolling average across cohorts.
- **AI insight engagement** — couple `aiInsightGeneratedAt` with notification
  `openedAt` via `NotificationHistory` (already tracked).
- **Skip rate** — `skipped:true` reflections per day; high skip rates flag UX
  friction in the sheet.

The existing admin analytics workspace can layer these onto its dashboards
without schema changes.

---

## 9. Implementation roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Schema + service + Zod + tests | ✅ shipped in this change |
| 0 | Routes + cron + dashboard integration | ✅ shipped |
| 0 | Frontend sheet + card + history page | ✅ shipped |
| 1 | "Last active" signal so the cron can pick `no_trades` vs. `no_login` precisely | TODO — currently both buckets fall through to `no_login` text |
| 1 | Settings toggle UI for `eveningReflection` (preference model already supports it) | TODO — wire into existing notification settings page |
| 2 | Reflection-streak counter — extend `streakService` with `reflection` series alongside `journal`/`checklist`/`rule` | TODO |
| 2 | Cross-trader patterns — weekly admin report aggregating `topImprovement` themes from reflections | TODO |
| 3 | Deep-linked sheet on `/reflection?open=1` from the push so the form opens instantly | TODO — sheet already supports it, just needs a `useEffect` wire |
| 3 | Reflection-conditioned morning mentor — feed yesterday's reflection into `morningMentorService` so the morning push acknowledges last night's check-in | TODO |

---

## 10. Operational notes

- **Privacy**: improvement text is user-only; never shipped to admin
  endpoints unless explicitly aggregated.
- **AI cost**: Gemini call is fire-and-forget after submit; one call per
  reflection per day. Worst-case: 1× active-user × 1 call/day. Skipped/no-AI
  records are zero-cost.
- **Resilience**: every Gemini failure path falls through to
  `buildFallbackInsight`, so the user always sees a coaching line.
- **Determinism in tests**: weekly score is a pure function — easy to assert
  edge cases (all-skip, mixed days, no-trade-day reward).
- **TZ safety**: `day` strings come from `streakService.getStreakSnapshot()`
  so reflection + streak share the same calendar.
