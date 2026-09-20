# Edgecipline Notifications — Complete Reference (Forex & Indian Market)

_Generated from the codebase on 2026-09-20 and updated the same day after the notification audit/fix pass. Every path, schedule, threshold and message below is taken from the source, not from intent docs._

---

## 1. Big picture

Edgecipline has **four independent notification systems** that meet in one place (`NotificationHistory` + FCM push):

| System | Trigger | Runs where | Markets |
|---|---|---|---|
| **Smart Coach (behavioural)** | A trade is created / edited / OCR-confirmed | API request (3 fast checks) + BullMQ worker (5 heavy checks) | Forex **and** Indian, evaluated per market |
| **Scheduled coaching (cron)** | Time of day | `node-cron` inside the API process, Redis-locked so only one instance fans out | Session + weekly reminders are market-gated per user (`userMarketService`) and calendar-gated (`marketCalendar`); mentor/reflection/streak are user-level |
| **Funnels (subscription rescue, free-tier nudge)** | Days relative to expiry / last free trade | Hourly cron → banner + push + email | Market-agnostic (copy uses the user's primary market) |
| **Transactional** | OCR job finished, support ticket events, issue fixed, admin blast | Queue or inline | Deep link chooses `/upload-trade` vs `/indian-market/upload-trade` |

Plus one **device-local** system that never touches the server for delivery:

| System | Trigger | Runs where |
|---|---|---|
| **Pre-trade checklist notification** | User-configured time (`09:00` default) | Android native (`WorkManager` + `RemoteViews`), one instance per market |

### Delivery pipeline (shared by everything server-side)

```
caller ──▶ notificationService.notifyUser(userId, payload)
             │
             ├─ 1. NotificationPreference (auto-created, all ON by default)
             │      • inAppEnabled && pushEnabled both false → drop (return null)
             │      • smart-coach type && smartCoach=false → drop
             │      • per-type flag false (e.g. revengeTrading) → drop
             │
             ├─ 2. NotificationHistory.create  ← unique (user, dedupeKey)
             │      duplicate key → return the existing row (idempotent)
             │
             ├─ 3. pushEnabled=false OR inside quietHours → status "skipped"
             │      (row still exists → shows in in-app inbox)
             │
             ├─ 4. Claim delivery lease (2 min), status "sending"
             │
             ├─ 5. sendPushToUser → FCM sendEachForMulticast to every
             │      DeviceToken { enabled:true, revokedAt:null }
             │      • invalid/unregistered token → disabled + revokedAt
             │      • transient FCM code → throw → BullMQ retry (if queued)
             │
             └─ 6. status: sent | partial | failed | skipped
                    sentAt, delivery.{successCount,failureCount,acceptedTokenIds,...}
```

**Key files**

| Concern | File |
|---|---|
| Core sender, preference gate, quiet hours, channel map | `backend/services/notificationService.js` |
| Behavioural rules | `backend/services/smartNotificationEvaluator.js` |
| Queue + worker | `backend/queues/smartNotificationQueue.js`, `backend/workers/smartNotificationWorker.js` |
| History / prefs / tokens models | `backend/models/NotificationHistory.js`, `NotificationPreference.js`, `DeviceToken.js` |
| Cron jobs | `backend/jobs/*Cron.js` |
| Frontend FCM + routing | `frontend/services/pushNotifications.js`, `components/PushNotificationBootstrap.jsx`, `components/PushNotificationToast.jsx` |
| Checklist native notification | `frontend/plugins/ChecklistNotificationPlugin.js`, `frontend/android/.../Checklist*.java` |

---

## 2. Data model

### `NotificationPreference` (one per user, created on first notification)

| Field | Default | Gates |
|---|---|---|
| `pushEnabled` | true | FCM push (history row still written when false → `skipped`) |
| `inAppEnabled` | true | If **both** this and `pushEnabled` are false nothing is written |
| `smartCoach` | true | Master switch for every behavioural + coaching type |
| `revengeTrading`, `overtrading`, `setupDiscipline`, `repeatedMistakes`, `moodRisk`, `noStopLoss` | true | Individual smart-coach types (`daily_loss_warning` shares `noStopLoss`) |
| `weeklyInsight` | true | `weekly_ai_insight`, `weekly_report_reminder` |
| `sessionReminders` | true | `session_reminder` |
| `morningMentor` | true | `morning_mentor` |
| `streakProtection` | true | `streak_milestone`, `streak_at_risk`, `streak_broken` |
| `eveningReflection` | true | `evening_reflection` |
| `supportUpdates` | true | All customer-facing `support_*` types (deliberately **not** under `smartCoach`) |
| `quietHours.{enabled,start,end,timezone}` | off, 22:00–07:00, Asia/Kolkata | Push suppressed inside the window (overnight windows wrap midnight) |

Edited via `GET/PATCH /api/profile/notification-preferences`.

### `NotificationHistory` (the in-app inbox + delivery audit)

- `type` — **enum-validated**; every producer type must be listed (enforced by `notificationTypeCoverage.test.js`)
- `dedupeKey` — unique per user; this is the idempotency mechanism for every retry
- `status` — `created → sending → sent | partial | failed | skipped`
- Engagement: `deliveredAt`, `openedAt`, `actionClickedAt`, `actionType`, `isRead/readAt`
- `delivery` — per-token outcome, invalid tokens, transient/permanent failure lists

### `DeviceToken`

One row per FCM token; `platform` android/ios/web; auto-expires 90 days after `lastSeenAt` (TTL index). Registering a new token for the same `user+platform+deviceId` disables stale siblings. Invalid FCM responses (`registration-token-not-registered`, `invalid-registration-token`, `invalid-argument`) set `enabled:false, revokedAt`.

### Android channels (must match on both ends)

| Channel id | Name | Importance | Used by |
|---|---|---|---|
| `edgecipline_risk` | Risk Alerts | 5 (heads-up, public on lock screen, 1 h TTL, high priority) | revenge_trading, overtrading, no_stop_loss, daily_loss_warning |
| `edgecipline_discipline` | Discipline Alerts | 4 | setup_discipline, mood_risk |
| `edgecipline_insights` | Performance Insights | 3, silent | repeated_mistake, weekly_ai_insight, weekly_report_reminder, free_tier_* |
| `edgecipline_coaching` | Coaching | 3, silent | confidence_reminder, morning_mentor, streak_*, evening_reflection, mission_update |
| `edgecipline_session` | Session Reminders | 4 | session_reminder |
| `edgecipline_ocr` | OCR Results | 4 | ocr_completed, ocr_failed |
| `edgecipline_support` | Support | 4 | support_* |
| `edgecipline_checklist` | Pre-Trade Checklist | 5 | Native checklist (local only) |

Unknown types fall back to `edgecipline_insights`. Channels are created on the device by `ensureChannelsCreated()` before permission is even requested.

---

## 3. Smart Coach — trade-triggered notifications

### 3.1 Trigger points

| Market | Entry point | Calls |
|---|---|---|
| Forex | `POST /api/trades` (manual or OCR confirm) → `trade.service.createTrade` | `evaluateSmartNotifications({ marketType:"Forex", collection:"forex" })` |
| Forex | `POST /api/trades/batch` | evaluated once on the **last** trade of the batch |
| Forex | `PUT /api/trades/:id` | re-evaluated on edit |
| Forex | OCR worker auto-save (`tradeProcessingService`) | evaluated after `Trade.findByIdAndUpdate` |
| Indian | `POST /api/indian/trades` → `indianTradeController` | `evaluateSmartNotifications({ marketType:"Indian_Market", collection:"indian" })` |
| Indian | `POST /api/indian/trades/batch` | last trade of the batch |
| Indian | `PUT /api/indian/trades/:id` | re-evaluated on edit |

The only difference between markets is `collection` (which Mongo model to query: `Trade` vs `IndianTrade`), the base query (Forex additionally excludes `parsedData.multiTradeGhost` and filters `marketType`), the deep links, and the `marketType` segment inside dedupe keys — so a Forex and an Indian alert can fire on the same day independently.

### 3.2 Two-phase evaluation

```
evaluateSmartNotifications()
  ├─ SYNC (inside the request, Promise.allSettled — never fails the save)
  │     1. checkNoStopLoss
  │     2. checkSetupDisciplineDrop
  │     3. checkMoodBasedRisk
  └─ ASYNC → enqueueSmartNotificationChecks()  (BullMQ "smartNotificationsQueue", jobId = sn-<tradeId>)
        worker re-reads the trade by id, then runs
              4. checkRevengeTrading
              5. checkOvertrading
              6. checkRepeatedMistake
              7. checkDailyLossWarning
              8. checkConfidenceReminder
        any rejection → whole job retried (3 attempts, exponential backoff 3 s);
        already-sent checks are no-ops thanks to dedupeKey.
```

Queue config: `SMART_NOTIFICATION_ATTEMPTS=3`, `SMART_NOTIFICATION_BACKOFF_MS=3000`, worker concurrency 8, lock 60 s, failed jobs kept 7 days (dead-letter visible via `GET /api/admin/notifications/queue-metrics`). Worker process: `node workers/smartNotificationWorker.js`.

All time bucketing uses `SMART_NOTIFICATION_TIMEZONE` (default `Asia/Kolkata`) — "today", "this week", and day windows are IST for **both** markets.

### 3.3 The eight rules

| # | Type | Fires when | Dedupe (once per…) | Deep link (Forex / Indian) | Copy |
|---|---|---|---|---|---|
| 1 | `no_stop_loss` (risk) | `stopLoss` missing, empty, non-numeric or ≤ 0 | trade | `/trades/edit?id=` / `/indian-market/trades/edit?id=` | "Trade entered without a stop loss." |
| 2 | `setup_discipline` | `setupScore < 60` **and** (score < 40 **or** ≥ 2 sub-60 trades today **or** this trade lost) | user+market+day+window | trade view | "Your edge is slipping. Checklist score N% — below your minimum…" |
| 3 | `mood_risk` | `mood` 1–2, or an emotional tag in {fomo, revenge, fear, frustrated, stressed}, or `confidence="Overconfident"` | user+day (**not** per market) | `/checklist/psychology` | "Your mind is your biggest risk right now…" |
| 4 | `revenge_trading` (risk) | this trade lost **and** the last 3 trades today all lost **and** span ≤ 4 h | user+market+day | today's trades list | "Stop. Breathe. Think. 3 consecutive losses (−X)…" |
| 5 | `overtrading` (risk) | ≥ 3 trading days in last 60; today's count > max(ceil(avg×1.5), ceil(avg+2), 5) | user+market+day | today's trades list | "Quality over quantity. N trades today…" |
| 6 | `repeated_mistake` | same `mistakeTag` (case-insensitive) ≥ 3× since Monday | user+market+week+tag | `/analytics?insight=mistakes&tag=` (same for both markets) | "Pattern detected. Time to break it…" |
| 7 | `daily_loss_warning` (risk) | ≥ 2 trades today, ≥ 2 losers, today's net ≤ 2 × average loss | user+market+day | today's trades list | "Capital protection mode. Today's drawdown…" |
| 8 | `confidence_reminder` | this trade won with `setupScore ≥ 70` and it is exactly the **2nd** such win today | user+market+day | `/analytics` / `/indian-market/analytics` | "Discipline is working." |

`setup_discipline` also writes a `NotificationDebugLog` row per user (gates, counts, dedupe result) readable at `GET /api/notifications/debug/setup-discipline/latest`.

### 3.4 Worked example — Indian options trader, 3 losing NIFTY trades before noon

1. 10:05 saves loss #1 with no SL → **sync** `no_stop_loss` (risk channel, heads-up, links to `/indian-market/trades/edit?id=…`). Job `sn-<id1>` queued; async checks run, none fire.
2. 10:40 loss #2 → `no_stop_loss` again (different trade id → new dedupe key). Async: `daily_loss_warning` may fire if net ≤ 2× avg loss.
3. 11:20 loss #3 with mood=2 → sync `mood_risk` (once for the whole day, any market). Async: `revenge_trading` fires (3 losses in 1 h 15 m) → dedupe `revenge-warning:<user>:Indian_Market:2026-09-20`. A Forex loss streak the same afternoon would get its **own** revenge alert.

---

## 4. Scheduled coaching (cron)

All crons: `node-cron` in the API process, wrapped in `withCronLock` (Redis) so a multi-instance deployment sends once; per-run metrics via `runCronWithMetrics`; concurrency from `CRON_CONCURRENCY` / per-job overrides. Recipient set for most is **every user** (`findUsersForWeeklyReports()` = `User.find({})`) — preference gating happens inside `notifyUser`.

| Cron | Schedule (IST unless noted) | Env switch | Type | Who | Dedupe |
|---|---|---|---|---|---|
| Morning Mentor | `0 7 * * *` | `ENABLE_MORNING_MENTOR_CRON` | `morning_mentor` | all users | user+day |
| Session Reminder | `*/15 * * * *` | `ENABLE_SESSION_REMINDERS_CRON` | `session_reminder` | all users | user+market+session+day |
| Evening Reflection | `30 19 * * *` | `ENABLE_REFLECTION_REMINDER_CRON` | `evening_reflection` | users with no `DailyReflection` for today | user+day |
| Streak Protector | `0 21 * * *` | `ENABLE_STREAK_PROTECTOR_CRON` | `streak_at_risk` | `streaks.journal.current ≥ 3` and not logged today | user+day |
| Weekly Report reminder | `0 9 * * *` (server TZ) | `ENABLE_WEEKLY_REPORTS_CRON` | `weekly_report_reminder` ×2 | all users, **one per market** | user+market+ISO-week |

### 4.1 Morning Mentor (`morningMentorService`)

Looks at **yesterday's Forex + Indian trades combined** (fixed offset `MORNING_MENTOR_TIMEZONE_OFFSET_HOURS=5.5`; there is no per-user timezone yet). Picks one message by priority:

1. Weekend → one of 5 rotating "build your edge" messages
2. No trades → one of 5 rotating "no trade is a trade" messages
3. Otherwise, first match wins: ≥ 3 consecutive losses → "Stop. Breathe. Think."; ≥ 50 % trades without SL → "Protect Your Capital First."; > 5 trades → "Quality Over Quantity."; ≥ 2 emotional/impulsive entries → "Rules, Not Emotions."; avg setup < 60 → "Your Edge Is Slipping."; losing day → "Losses Are Part of the Process."; profitable & avg setup ≥ 70 → "Discipline Is Delivering."; profitable → "Stay Consistent."; else → "Reset. Refocus. Execute."

Deep link: `/notifications`.

### 4.2 Session Reminder

Sessions are defined per market in `jobs/sessionReminderCron.js` (`DEFAULT_SESSIONS`). Every 15 minutes the cron:

1. finds sessions whose `reminderTime` equals the current IST wall-clock (`getDueSessions`);
2. asks `utils/marketCalendar.js` whether that session's market is open today (`getEligibleSessions`) — Saturday/Sunday close both markets, NSE exchange holidays (`constants/indianMarketHolidays.js`, overridable via `INDIAN_MARKET_HOLIDAYS`) close the Indian market; closed sessions are logged as `SESSION_REMINDER_DECISION { eligible:false, reason: WEEKEND|HOLIDAY }` and nothing else runs;
3. takes the Redis lock, loads users with `preferredMarket` + streak timezone, and resolves each user's **active markets** (`services/userMarketService.js`: preferredMarket ∪ has a trade in that collection ∪ has a setup strategy for it);
4. sends only `(user, session)` pairs where the user is active in the session's market (`MARKET_NOT_ENABLED` count logged); a user with no market signal receives nothing.

| Session | Market | Reminder (IST) | Open | Deep link | Copy |
|---|---|---|---|---|---|
| London Open | Forex | 12:45 | 13:00 | `/trades?session=London` | "London Open starts soon" |
| New York Open | Forex | 18:15 | 18:30 | `/trades?session=New%20York` | "New York Open starts soon" |
| Indian Market Open | Indian_Market | 09:00 | 09:15 | `/indian-market/trades?session=Morning%20Session` | "Indian Market opens at 9:15 AM — NSE opens in 15 minutes…" |

Dedupe: `session-reminder:<user>:<market>:<session>:<tradingDay>` where `tradingDay` is keyed in the **user's** timezone (`getUserNotificationTimezone`). Payload `data.marketType` identifies the market for the client router.

### 4.3 Evening Reflection

Per user, `dayKey` comes from the user's streak timezone. Variant chosen from today's activity across both markets: `logged_trades` ("Close the day.") or `no_login` ("Did the market move you today?"). Skipped if a `DailyReflection` already exists. Deep link `/reflection`.

### 4.4 Streak Protector

For users with a journal streak ≥ `STREAK_PROTECTOR_MIN_STREAK` (3) whose `lastQualifyingDate` ≠ today → "Don't lose your streak — log today or mark *Sat Out*". Deep link `/streaks`. Streak **milestones** (3/7/14/30/60/100/180/365) and **broken** (≥ 7 days) are sent inline from `streakNotification.service` whenever a trade/checklist recompute produces the event.

### 4.5 Weekly

- **Reminder** (cron): "Weekly review is ready" → `/weekly-reports?marketType=Forex` and a second one for `Indian_Market`, every user, once per ISO week per market.
- **AI insight** (`notifyWeeklyInsight`, called by the weekly-report service after a report is generated): "Your week in numbers." with win-rate delta and the report's `weeklyFocus`; deep link `/weekly-reports?id=<report>`; dedupe user+market+weekStart.

### 4.6 Missions (`missionNotificationService`, type `mission_update`)

Events `completed`, `halfway`, `streak_broken`, `morning_reminder` (the last via `missionProgressCron`). Coaching channel, dedupe per assignment (+day for repeatable ones).

---

## 5. Funnels (banner + push + email)

Both funnels share the same shape: an hourly cron finds users whose anchor date falls inside each touchpoint's window, builds a context (`rescueContextService` / free-tier context — primary market, discipline streak, best setup, etc.), writes a `RescueDispatch` row (idempotent per user+touchpoint), then fans out to the enabled channels. The in-app banner (`RescueBanner`, `useRescueBanner`, `GET /api/rescue/banner`) reads the latest dispatch; `POST /api/rescue/event` records impression/click/dismiss.

### 5.1 Subscription Rescue (`15 * * * *`, batch 200)

Anchor: `User.subscriptionExpiry`.

| Touchpoint | Days vs expiry | Phase / status filter | Banner | Push | Email | Notification type |
|---|---|---|---|---|---|---|
| d_minus_7 | −7 | pre_expiry / active | ✔ | ✖ | ✖ | `renewal_d_minus_7` |
| d_minus_3 | −3 | pre_expiry / active | ✔ | ✔ | ✔ | `renewal_d_minus_3` |
| d_minus_1 | −1 | pre_expiry / active | ✔ | ✔ | ✔ | `renewal_d_minus_1` |
| d_plus_0 | 0 | expiry / expired | ✔ | ✔ | ✔ | `renewal_d_plus_0` |
| d_plus_3 | +3 | win_back / expired | ✔ | ✔ | ✖ | `winback_d_plus_3` |
| d_plus_7 | +7 | win_back / expired | ✔ | ✔ | ✔ | `winback_d_plus_7` |
| d_plus_14 | +14 | win_back / expired | ✔ | ✖ | ✔ | `winback_d_plus_14` |

Copy is personalised with the discipline streak ("celebrate" tone pre-expiry). Separate `subscriptionExpiryCron` (`0 * * * *`) flips `active → expired`.

### 5.2 Free-tier nudge (`35 * * * *`, batch 200)

Anchor: `User.freeTier.lastFreeTradeAt` (the moment the last free trade was logged). Stops as soon as the user pays.

| Touchpoint | Days after last free trade | Banner | Push | Email |
|---|---|---|---|---|
| free_d_plus_1 | 1–2 | ✔ | ✔ | ✖ |
| free_d_plus_3 | 3–6 | ✔ | ✖ | ✔ |
| free_d_plus_7 | 7–13 | ✔ | ✔ | ✔ |
| free_d_plus_14 | 14+ (until funnel end) | ✔ | ✖ | ✔ |

Push channel `edgecipline_insights`; copy references the user's primary market symbol (e.g. "Your NIFTY trade is logged").

---

## 6. Transactional notifications

| Type | Source | Channel | Deep link | Notes |
|---|---|---|---|---|
| `ocr_completed` | `ocrWorker` after `processOcrJob` succeeds | ocr | `/upload-trade` or `/indian-market/upload-trade` by `job.data.marketType` | Enqueued as a `deliverNotification` job on the smart queue (so it survives restarts); dedupe `ocr-completed:<jobId>` |
| `ocr_failed` | `ocrWorker` on non-retryable error or last attempt | ocr | same as above | "We could not process this screenshot…" |
| `support_ticket_created`, `support_agent_reply`, `support_status_changed`, `support_resolved`, `support_reopened`, `support_assigned` | `supportNotification.service` | support | `/support/tickets/detail?id=` | Gated by `supportUpdates`, **not** by `smartCoach` |
| `support_new_ticket_staff`, `support_user_reply_staff` | same | support | admin ticket page | Fan-out to notifiable staff; no preference flag |
| `issue_fixed` | `issueReport.service` when admin resolves | — | issue detail | dedupe `issue_fixed:<issueId>` |
| `admin_issue_report` | `adminPushService` | — | admin issues | new bug report → admins |
| `system` (admin blast) | `POST /api/admin/notifications/custom` | insights (fallback) | `/notifications` by default | `sendToAll` or ≤ cap user ids; queued per user; audit-logged |

---

## 7. Pre-trade checklist notification (device-local, per market)

This one is **not** an FCM push. It is a persistent, interactive Android notification that shows the rules of one setup strategy with tappable checkboxes.

```
Settings  /checklist/notification-settings  (per market)
   │  PUT /api/checklists/notification-settings  → ChecklistNotificationSetting
   │      { enabled, strategyId, strategyName, market, notificationTime "09:00",
   │        repeatMode daily|weekdays|custom, customDays [1..7], persistent,
   │        resetEnabled, resetTime "00:00" }        unique (user, market)
   │
   └─ ChecklistNotificationPlugin.configure(...)  (Capacitor → Java)
          ├─ ChecklistScheduler: WorkManager work
          │     "checklist_notification_forex" | "checklist_notification_indian"
          │     "checklist_reset_forex"        | "checklist_reset_indian"
          ├─ ChecklistNotificationManager: builds RemoteViews on channel
          │     edgecipline_checklist (importance 5, public), items stored in
          │     SharedPreferences keyed by market, up to 8 rules
          ├─ ChecklistActionReceiver: checkbox tap → toggles item, re-renders,
          │     emits "checklistItemToggled" to JS
          ├─ ChecklistResetWorker: at resetTime clears ticks (if resetEnabled)
          └─ ChecklistBootReceiver: re-arms after reboot
```

- The server only stores the *settings*; delivery, ticks and reset are entirely on-device. The web build is a no-op plugin.
- Because Android keeps its own copy of the rules, **every setups save** calls `refreshChecklistNotificationFromSetups({ strategies, market })` to push the edited rules back down; if the bound strategy was deleted the server clears `strategyId` and the client cancels the notification.
- Forex and Indian each have one independent notification (own strategy, time, repeat days, reset).
- Checklist *usage* is tracked separately: `POST /api/checklists/track` (`ChecklistTracking`) from the in-app `/checklist` page and `SetupChecklist` component; this feeds setup-score analytics, not notifications.

---

## 8. Client side (app)

### 8.1 Registration lifecycle (`frontend/services/pushNotifications.js`)

1. `PushNotificationBootstrap` (in `app/providers`) calls `initializePushNotifications()` on native only.
2. `ensureChannelsCreated()` → all 8 channels.
3. Listeners: `registration` (token) / `registrationError` / `pushNotificationReceived` / `pushNotificationActionPerformed`.
4. `requestPermissions()` → `register()` → token stored in localStorage (`edge_fcm_token`, pending flag, retry count).
5. `registerDeviceTokenWithRetry()` → `POST /api/profile/device-tokens { token, platform, deviceId, appVersion }` with retry/backoff; `onUserLoggedIn` re-registers, `onUserLoggedOut` → `DELETE /api/profile/device-tokens`; app-resume recovery re-sends a pending token.

### 8.2 Receiving

- **Foreground** (`pushNotificationReceived`): dispatches `edgecipline:push` → `PushNotificationToast` shows an in-app toast (tap routes), and `POST /api/notifications/:id/delivered` is recorded.
- **Tap from tray** (`pushNotificationActionPerformed`): `getNotificationTarget(data)` → `data.deepLink` if present, else `data.screen` map (`trade`, `trade-edit`, `indian-trade`, `indian-trade-edit`, `indian-trades`, `trades`, `weekly-report`, `analytics`, `psychology`, `notifications`), else `/dashboard`. Dispatches `edgecipline:notification-route` → `PushNotificationBootstrap` does `router.push(target)`; `POST /api/notifications/:id/action` is recorded.

### 8.3 In-app inbox — `/notifications`

`GET /api/notifications?page&limit&unreadOnly` (all statuses, including `skipped` ones blocked by quiet hours / push-off), `PATCH /:id/read`, `PATCH /read-all`, `POST /:id/opened`. Preferences UI lives in `/settings` (toggles + quiet hours).

### 8.4 Admin

`GET /api/admin/notifications/analytics` (funnel: created → sent → delivered → opened → action, per type), `GET /queue-metrics` (BullMQ counts), `POST /custom` (blast), plus admin's own in-app list.

---

## 9. Defects found during documentation — and their status

| # | Finding | Status |
|---|---|---|
| 1 | `NotificationHistory.type` enum lacked `streak_milestone`, `streak_at_risk`, `streak_broken`, `evening_reflection`, `mission_update` → every such push failed validation silently | **Fixed.** Enum extended (+ `sourceType: "mission"`), admin `ALL_TYPES` and inbox `TYPE_META` updated, end-to-end tests in `notificationFixedTypesDelivery.test.js` |
| 2 | No Indian-market session reminder; Forex sessions sent to every user | **Fixed.** Indian Market Open (09:00 → 09:15 IST) added; all sessions gated per user market and per market calendar |
| 3 | Session reminders fired on Saturday/Sunday | **Fixed.** `marketCalendar` + weekend/holiday regression tests |
| 4 | Weekly reminders sent both markets to everyone | **Fixed.** Same per-user market gate |
| 5 | Indian `repeated_mistake` deep-linked to Forex `/analytics` | **Fixed.** Routes to `/indian-market/analytics?insight=mistakes&tag=…` |
| 6 | Client `screen` fallback ignored market (`trades`/`analytics`/`upload-trade` → Forex) | **Fixed.** `services/notificationRoutes.js` is market-aware; matrix test `npm run test:notifications` |
| 7 | `edgecipline_support` channel only created by JS, not by the native initializer | **Fixed.** Added natively |
| 8 | Morning Mentor uses a fixed IST offset for everyone | Open — `getUserNotificationTimezone()` now exists in `utils/timezone.js`; the service still uses `MORNING_MENTOR_TIMEZONE_OFFSET_HOURS` until a profile timezone field lands |
| 9 | Smart-check day/week windows use the global `SMART_NOTIFICATION_TIMEZONE` | Open (India-first by design; same hook as #8 once per-user zones exist) |
| 10 | `mood_risk` dedupes per user+day across markets | Intentional — user-level psychology |
| 11 | NSE holiday list is a static constant | Extension point only: verify `constants/indianMarketHolidays.js` against the NSE circular each December or set `INDIAN_MARKET_HOLIDAYS` |

### Decision logging

Every "not sent" outcome is logged as `NOTIFICATION_SKIPPED { userId, notificationType, marketType, dedupeKey, reason }` with `reason ∈ PREFERENCE_DISABLED | push_disabled | quiet_hours | DUPLICATE | NO_DEVICE_TOKEN`; sessions additionally log `SESSION_REMINDER_DECISION` with `WEEKEND | HOLIDAY | MARKET_NOT_ENABLED`. Per-user audit: `GET /api/admin/notifications/history?userId=&type=&limit=` returns each row with an `outcome` (`SENT | PARTIAL_DELIVERY | QUIET_HOURS | PUSH_DISABLED | NO_DEVICE_TOKEN | FCM_FAILED | FCM_TRANSIENT_FAILURE | IN_FLIGHT | CREATED_NOT_SENT`), dedupe key, and token counts.

## 10. Environment variables (notifications)

| Var | Default | Purpose |
|---|---|---|
| `SMART_NOTIFICATION_QUEUE_NAME` | `smartNotificationsQueue` | BullMQ queue |
| `SMART_NOTIFICATION_ATTEMPTS` / `_BACKOFF_MS` | 3 / 3000 | retry policy |
| `SMART_NOTIFICATION_WORKER_CONCURRENCY` / `_LOCK_DURATION_MS` | 8 / 60000 | worker |
| `SMART_NOTIFICATION_TIMEZONE` | Asia/Kolkata | day/week bucketing for smart checks |
| `ENABLE_MORNING_MENTOR_CRON`, `MORNING_MENTOR_CRON`, `_TIMEZONE`, `_TIMEZONE_OFFSET_HOURS` | true, `0 7 * * *`, Asia/Kolkata, 5.5 | |
| `ENABLE_SESSION_REMINDERS_CRON`, `SESSION_REMINDERS_CRON`, `_TIMEZONE` | true, `*/15 * * * *`, Asia/Kolkata | |
| `INDIAN_MARKET_HOLIDAYS` | built-in list | comma-separated `YYYY-MM-DD`; replaces `constants/indianMarketHolidays.js` |
| `ENABLE_REFLECTION_REMINDER_CRON`, `REFLECTION_REMINDER_CRON`, `_TIMEZONE` | true, `30 19 * * *`, Asia/Kolkata | |
| `ENABLE_STREAK_PROTECTOR_CRON`, `STREAK_PROTECTOR_CRON`, `_TIMEZONE`, `_MIN_STREAK` | true, `0 21 * * *`, Asia/Kolkata, 3 | |
| `ENABLE_WEEKLY_REPORTS_CRON`, `WEEKLY_REPORTS_CRON` | true, `0 9 * * *` | |
| `ENABLE_SUBSCRIPTION_RESCUE_CRON`, `SUBSCRIPTION_RESCUE_CRON`, `_BATCH_SIZE` | true, `15 * * * *`, 200 | |
| `ENABLE_FREE_TIER_NUDGE_CRON`, `FREE_TIER_NUDGE_CRON`, `_BATCH_SIZE` | true, `35 * * * *`, 200 | |
| `ENABLE_SUBSCRIPTION_EXPIRY_CRON`, `SUBSCRIPTION_EXPIRY_CRON`, `_BATCH_SIZE` | true, `0 * * * *`, 500 | |
| `CRON_CONCURRENCY` (+ per-job `*_CONCURRENCY`) | 50 | fan-out parallelism |
| `DEVICE_TOKEN_RATE_LIMIT_MAX_REQUESTS` | 20/min | token register/unregister |
| Firebase Admin credentials | — | `config/firebaseAdmin.js` |

---

## 11. Quick test matrix

| Flow | Forex | Indian |
|---|---|---|
| Save trade with no SL → heads-up push within seconds, deep link opens edit page | `/add-trade` | `/indian-market/add-trade` |
| Three losses inside 4 h → revenge alert (needs worker running) | ✔ | ✔ (separate alert) |
| Setup score < 40 → discipline alert; debug at `/api/notifications/debug/setup-discipline/latest` | ✔ | ✔ |
| Same mistake tag 3× this week → repeated-mistake, deep link to that market's analytics | ✔ | ✔ |
| 07:00 IST → Morning Mentor (combined markets) | shared | shared |
| 12:45 / 18:15 IST → Forex session reminder (weekdays only, Forex-active users) | ✔ | ✖ unless also Forex-active |
| 09:00 IST → Indian Market Open (weekdays, non-holiday, Indian-active users) | ✖ unless also Indian-active | ✔ |
| 19:30 IST, no reflection → evening nudge (also weekends) | ✔ | ✔ |
| 21:00 IST, streak ≥ 3, not logged → at-risk (also weekends) | ✔ | ✔ |
| Checklist notification at configured time; tick persists; reset at resetTime | own instance | own instance |
| OCR upload done → "Trade extraction ready" → correct upload page | ✔ | ✔ |
| Quiet hours on → history row `skipped`, no push, still in inbox | ✔ | ✔ |
| Toggle `smartCoach` off → no behavioural pushes, support pushes still arrive | ✔ | ✔ |
