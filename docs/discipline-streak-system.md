# Discipline Streak System

A behavior-anchored streak system that reinforces consistent execution, not
profit. Replaces the previous outcome-based "Win Streak" on the dashboard.

## Goals

- Anchor the user's identity as a *disciplined* trader.
- Give the user something to **protect** every day → highest-leverage
  retention lever (D7 / D30).
- Never reward winning trades. Never shame a broken streak.
- Survive crashes, time zones, OCR-uploaded back-dated trades, and offline
  Capacitor clients without corruption.

---

## Three streak types

| Type | Qualifying event | Indexed by | UI surface |
|---|---|---|---|
| **Journal** | ≥1 trade logged OR "No Trade Today" marked | Calendar day, user TZ | Hero chip + KPI |
| **Checklist** | ≥1 trade on a day where setupRules was used | Trading days only | Detail page metric |
| **Rule discipline** | Per-trade: `setupScore ≥ threshold` (default 70) | Consecutive trades | Detail page metric |

---

## Architecture

```
            ┌── Trade save (manual / OCR confirm) ──┐
            │   Checklist log                       │
            │   POST /streaks/no-trade-today        │
            ▼                                       ▼
       streakService.recordQualifyingEvent(...)
            │
            ▼
   ┌────────────────────────────┐
   │ DailyDisciplineEntry       │  upsert (user, day, market)
   └────────────┬───────────────┘
                ▼
   streakService.recomputeStreaks(userId)
                ▼
   User.streaks (denormalized)  +  events { broken, recovered, newMilestone }
                ▼
   streakNotification.handleStreakEvents(...)
```

### Source of truth

`DailyDisciplineEntry` (one document per `(user, day, market)`). Denormalized
counters on `User.streaks.*` are read-side cache; rebuild them anytime via
`POST /streaks/recompute`.

### Timezone strategy

Day boundaries use the user's preferred timezone (sourced from
`NotificationPreference.quietHours.timezone`, falling back to
`User.streaks.timezone`, falling back to `Asia/Kolkata`). The `day` field is
stored as a `'YYYY-MM-DD'` string anchored to that timezone — no Date math at
read time, no drift when the user travels.

### Grace recovery

A streak of `≥7` days that breaks by exactly one missed day is restored if
the user logs a qualifying event the next day. Capped at one recovery per
30 days per user.

Why: a single missed day is overwhelmingly an off-product reality, not a
discipline failure. We absorb it once a month. This is the difference
between an app that punishes humans and one that supports them.

---

## Database

### User schema additions (`backend/models/Users.js`)

```js
streaks: {
  journal: {
    current, longest, lastQualifyingDate,
    lastBrokenAt, recoveredCount, lastRecoveryAt
  },
  checklist: { current, longest, lastQualifyingDate },
  rule:      { current, longest, threshold (default 70), lastTradeAt },
  lastMilestoneNotified: Number,
  timezone: String,
}
```

### New collection — `DailyDisciplineEntry`

```js
{
  user: ObjectId,
  day: 'YYYY-MM-DD',         // in user TZ
  market: 'Forex'|'Indian_Market'|'any',
  tradeCount,
  noTradeToday,
  checklistUsed,
  ruleHit,
  meta: { setupScores: [Number], firstTradeAt, lastTradeAt, note }
}
// unique: { user, day, market }
// index : { user, day desc }
```

### Notification preference

```js
streakProtection: Boolean (default true)
```

---

## API

| Method | Path | Notes |
|---|---|---|
| `GET`  | `/api/streaks?days=90` | Detail view: streaks + 90-day calendar + milestones |
| `POST` | `/api/streaks/no-trade-today` | Body: `{ market?, note? }`. Idempotent. |
| `POST` | `/api/streaks/recompute` | Rebuild from `DailyDisciplineEntry`. Self-service. |
| `PUT`  | `/api/streaks/threshold` | Body: `{ threshold: 0..100 }`. Updates rule streak threshold. |

All routes are gated by the `protect` middleware.

The dashboard snapshot at `GET /api/dashboard/snapshot` now includes
`snapshot.streaks` — populated by `streakService.getStreakSnapshot`.

---

## Frontend

| File | Role |
|---|---|
| `frontend/features/dashboard/components/StreakHeroChip.jsx` | Pill in dashboard hero: 🔥 N day discipline streak |
| `frontend/features/streaks/api/streaksApi.js` | `getStreaks`, `markNoTradeToday`, `recomputeStreaks`, `updateRuleThreshold` |
| `frontend/features/streaks/hooks/useStreaks.js` | React Query hooks |
| `frontend/features/streaks/components/StreakCalendar.jsx` | 12-week heatmap |
| `frontend/features/streaks/components/StreakMilestones.jsx` | Goal-gradient strip |
| `frontend/app/streaks/page.js` | Detail page |
| `frontend/app/dashboard/page.js` | KPI swap (Win Streak → Discipline Streak), chip injection |

### Dashboard changes

- "Win Streak" KPI card replaced with "Discipline Streak" card (links to `/streaks`).
- New chip in the greeting hero — visual states: alive / at-risk / dormant.
- `useDashboard` exposes `streaks` from the snapshot.

### Mobile (Capacitor)

No mobile-specific code required — all the new UI uses the existing Next.js
runtime which already ships inside the Android wrapper. The streak push
notification routes through the existing FCM pipeline and uses the
`edgecipline_coaching` channel that's already registered native-side.

---

## Notifications

| Type | Trigger | Copy (sample) | Channel | Pref key |
|---|---|---|---|---|
| `streak_milestone` | crossing 3/7/14/30/60/100/180/365 day journal | "🔥 One full week — You've protected your discipline for 7 days." | coaching | streakProtection |
| `streak_at_risk` | daily 21:00 user TZ, `current ≥ 3` AND today not logged | "Don't lose your streak — log today or mark Sat Out in 30 seconds." | coaching | streakProtection |
| `streak_broken` | recompute detects break of `≥7` day streak (no recovery) | "Your 14-day streak ended. Most disciplined traders rebuild within 2 days." | coaching | streakProtection |

- All respect quiet hours via the existing notification gate.
- All capped to one per (user, type, day) via `dedupeKey`.
- Copy is **anti-shame by contract**: no "you failed", no rankings, no
  comparison to other users.

### Cron

`backend/jobs/streakProtectorCron.js`
- Schedule: `0 21 * * *` (configurable via `STREAK_PROTECTOR_CRON`).
- Lock: per-day key via `withCronLock` so only one fleet node fires.
- Concurrency: per `STREAK_PROTECTOR_CRON_CONCURRENCY` (defaults to 50).

---

## Environment variables

```bash
ENABLE_STREAK_PROTECTOR_CRON=true
STREAK_PROTECTOR_CRON="0 21 * * *"
STREAK_PROTECTOR_TIMEZONE="Asia/Kolkata"
STREAK_PROTECTOR_MIN_STREAK=3
STREAK_PROTECTOR_CRON_CONCURRENCY=50
```

---

## Analytics events

Recommended emit points (add to your existing analytics pipeline):

| Event | When | Properties |
|---|---|---|
| `streak.qualified_day` | on `recordTradeEvent` upsert | `day, market, tradeCount, checklistUsed, ruleHit` |
| `streak.no_trade_today_marked` | on POST `/streaks/no-trade-today` | `day, note_length, alreadyTraded` |
| `streak.recomputed` | on `recomputeStreaks` finish | `journal.current, journal.longest, checklist.current, rule.current` |
| `streak.broken` | when `events.broken === true` | `brokenLength` |
| `streak.recovered` | when `events.recovered === true` | `restoredLength` |
| `streak.milestone_hit` | when `events.newMilestone` set | `days` |
| `streak.at_risk_push_sent` | from cron | `currentStreak, dayKey` |
| `streak.detail_viewed` | client-side, `/streaks` page mount | `journal.current` |
| `streak.chip_clicked` | client-side, hero chip tap | `state: alive|at-risk|dormant` |

---

## Acceptance criteria

### Journal streak

1. **Given** a brand-new user **when** they log their first trade **then**
   `journal.current === 1` and the dashboard chip shows "1-day discipline
   streak".
2. **Given** a user with `journal.current === 3` **when** they trade on the
   next calendar day (per their TZ) **then** `journal.current === 4` and a
   3-day milestone push has fired exactly once.
3. **Given** a user with `journal.current === 5` and no trade today **when**
   they call `POST /streaks/no-trade-today` **then** `journal.current === 6`.
4. **Given** a user who already has a trade today **when** they call
   `POST /streaks/no-trade-today` **then** the response is
   `{ alreadyTraded: true }` and no entry is changed.
5. **Given** a user with `journal.current === 8` who misses one day **when**
   they trade the day after the gap **then** the recovery fires:
   `journal.current === 9`, `events.recovered === true`, and
   `lastRecoveryAt` is set to now.
6. **Given** a user who recovered once in the last 30 days **when** they
   miss a day and try to recover again **then** the streak resets to `1`,
   `events.broken === true`, and a `streak_broken` push fires.

### Checklist streak

7. **Given** a trade with `setupRules.length >= 1` **when** it saves **then**
   the day entry has `checklistUsed: true`.
8. **Given** consecutive trading days with checklist usage and a non-
   trading day in between (marked `noTradeToday: true`) **then** the
   checklist streak does **not** reset (non-trading days are skipped, not
   counted as breaks).

### Rule streak

9. **Given** a user with `rule.threshold === 70` and trades with setupScores
   `[80, 60, 90, 75, 82]` **then** `rule.current === 3`.
10. **Given** the same trades but `rule.threshold === 80` **then**
    `rule.current === 0`.

### Push notifications

11. The "at risk" cron fires at most one push per user per day (`dedupeKey`).
12. A user with `streakProtection: false` receives no streak pushes.
13. A user whose local quiet-hours window covers 21:00 receives no at-risk
    push that night.

### UI

14. Dashboard hero shows the streak chip in three visual states based on
    `streaks.journal.current` and `atRisk`.
15. The Win Streak KPI is replaced; the new card links to `/streaks`.
16. The `/streaks` page renders the calendar, milestones, and per-streak
    metrics. The "Sat Out" CTA is hidden when today is already logged.

### Cross-cutting

17. A failure inside `recordTradeAndRecompute` never throws out of
    `createTrade` — streak math is logged at WARN and the trade still
    saves.
18. `POST /streaks/recompute` is idempotent and produces stable output for
    the same `DailyDisciplineEntry` rows.

---

## Edge cases handled

- **Out-of-order trade writes** (OCR-uploaded back-dated trades): `day` is
  computed from `tradeDate`, not `now`. The corresponding day's entry is
  upserted in place; subsequent `recomputeStreaks` returns correct math.
- **Same trade saved twice** (idempotent retry): the day entry's
  `tradeCount` is bumped via `$inc`, but the streak math only requires
  `tradeCount > 0` — so the duplicate is harmless to streak length.
- **Crash mid-recompute**: `User.updateOne` is atomic. Either the new
  counters land or the previous ones remain. Source of truth survives.
- **Timezone change mid-session**: user can travel; `dayKeyInTz` uses the
  current preference. Past entries keep their `day` string. New entries
  pick up the new TZ.
- **Multiple devices / web + Capacitor**: streak reads come from the
  dashboard snapshot (with React Query freshness); writes invalidate both
  dashboard and streak queries.
- **Bulk trade import**: the controller indexes every trade individually
  before recomputing once. Multi-day imports build accurate per-day
  history.

---

## Files touched / added

```
backend/
  models/
    Users.js                                 (modified — streaks subdoc)
    DailyDisciplineEntry.js                  (new)
    NotificationPreference.js                (modified — streakProtection)
  services/
    streak.service.js                        (new — core logic)
    streakNotification.service.js            (new — push copy + handler)
    notificationService.js                   (modified — type maps)
    trade.service.js                         (modified — wire updateStreaksForTrade)
  controllers/
    streakController.js                      (new)
    indianTradeController.js                 (modified — wire updateStreaksForIndianTrade)
    checklistController.js                   (modified — wire recordChecklistEvent)
    dashboardController.js                   (modified — load streak snapshot)
  routes/
    streakRoutes.js                          (new)
  jobs/
    streakProtectorCron.js                   (new)
  repositories/
    user.repository.js                       (modified — findUsersWithActiveJournalStreak)
  config/
    index.js                                 (modified — streakProtector block)
  server.js                                  (modified — mount route + cron)
  __tests__/unit/
    streakService.test.js                    (new — 18 tests, all passing)

frontend/
  app/
    streaks/layout.tsx                       (new)
    streaks/page.js                          (new)
    dashboard/page.js                        (modified — KPI swap, chip)
  features/
    dashboard/components/StreakHeroChip.jsx  (new)
    dashboard/components/StatCard.jsx        (modified — href support)
    dashboard/hooks/useDashboard.js          (modified — return streaks)
    streaks/api/streaksApi.js                (new)
    streaks/hooks/useStreaks.js              (new)
    streaks/components/StreakCalendar.jsx    (new)
    streaks/components/StreakMilestones.jsx  (new)

docs/
  discipline-streak-system.md                (this file)
```
