# Existing-User Migration — Reflection, Coach Chat, Onboarding

This is the single source of truth for how accounts that existed **before**
the Reflection, AI Coach Chat, and Redesigned Onboarding shipped are treated.
The whole strategy is **opportunistic, idempotent, non-blocking**: a stale
account is never bounced into a wizard it doesn't need, and a single API
read self-heals its onboarding state.

---

## 1. What "existing user" means here

An account that was created before any of the new features deployed has:

- `preferredMarket` possibly set (from the legacy `FirstLoginWelcome` modal)
- 0+ `SetupStrategy` documents
- 0+ `Trade` / `IndianTrade` documents
- `onboarding.welcomeSeen` likely `true` (legacy 3-slide welcome)
- **None** of the new flags: `marketSelected`, `styleSelected`,
  `firstInsightSeen`, `tradeSkipped`, the timestamp fields
- **No** `tradingStyle`
- **No** `DailyReflection` documents
- **No** `CoachConversation` / `CoachMessage` documents

Left untouched, this user would be redirected to `/onboarding` on next login
and shown a 0/6 activation bar despite being a long-time real trader.

---

## 2. The migration strategy — two paths, same code

### 2a. Lazy (default)

`backend/services/onboardingBackfillService.js` runs every time
`GET /api/onboarding` is hit (which is the first call the login redirect
makes). It:

1. Reads the existing User document (1 query)
2. If the user already looks consistent (every flow flag true + a stamped
   `firstTradeAt`), exits in O(1) — no further reads.
3. Otherwise loads cheap signals:
   - `Trade.countDocuments({ user, deletedAt: null })`
   - `IndianTrade.countDocuments(...)`
   - `SetupStrategy.countDocuments(...)`
   - The earliest trade (one indexed `findOne` per market)
4. Computes a `$set` (booleans) + `$min` (timestamps) update that **only
   writes true / earliest values** — it never overwrites a flag the user
   set explicitly, and timestamps never move forward.
5. Writes once, invalidates the auth cache.

The mapping:

| Signal | Mirror onto |
|--------|-------------|
| `preferredMarket` is set | `onboarding.marketSelected = true` |
| `setupCount > 0` | `onboarding.setupAdded = true` |
| `tradeCount > 0` | `onboarding.tradeAdded = true`, `welcomeSeen = true`, `firstInsightSeen = true` |
| Earliest trade | `$min: onboarding.firstTradeAt` |
| Earliest trade had `ocrJobId` | `$min: onboarding.firstScreenshotUploadAt` |
| All four core flags now true | `isOnboardingCompleted = true`, `hasSeenWelcomeGuide = true`, `onboarding.completedAt = now` |

The response then includes `isPreActivated: true`, which both the login
redirect and `/onboarding/page.js` use to short-circuit straight to
`/dashboard?onboarded=existing`.

### 2b. Bulk (one-off)

`backend/scripts/backfillOnboarding.js` cursors through every user and calls
the same service with `force: true`. Two modes:

```bash
# Dry-run summary (no writes)
node backend/scripts/backfillOnboarding.js

# Commit the migration
node backend/scripts/backfillOnboarding.js --apply

# Tune throughput
node backend/scripts/backfillOnboarding.js --apply --concurrency=50 --batchSize=1000
```

The script prints:

- `processed / total` progress every ~200 users
- final summary: `changed`, `skipped`, top reasons for skipping
  (`already_consistent`, `no_signals`, `no_changes`)
- one structured log line (`ONBOARDING_BACKFILLED`) per changed user with
  the keys it wrote, which feeds the existing Winston pipeline.

Idempotent — run twice and the second run reports 100% `already_consistent`.

---

## 3. Login redirect

[`frontend/features/auth/hooks/useLogin.js`](../frontend/features/auth/hooks/useLogin.js):

```
resolveLandingPath()
  ├─ GET /api/onboarding   ← triggers the lazy backfill
  │     ├─ isPreActivated  → /dashboard
  │     └─ funnel.isComplete → /dashboard
  ├─ on /onboarding 5xx, fall back to /auth/me/preferences
  │     ├─ isOnboardingCompleted → /dashboard
  │     └─ all six core flags + (tradeAdded || tradeSkipped) → /dashboard
  └─ on any failure                → /dashboard
```

**Failure mode**: a failing backend never bounces a returning user into the
wizard. The worst case is they land on `/dashboard` and the dashboard's
existing `setupAdded / tradeAdded` derivation (from trade counts) still
renders a correct getting-started card.

---

## 4. Per-feature edge cases for existing users

### 4a. Onboarding

| Case | Behaviour |
|------|-----------|
| Existing trader, never seen new onboarding | Backfill flips every applicable flag on first `GET /onboarding`. They never see the wizard. |
| Existing user opens `/onboarding` directly (e.g. from a bookmark or a tour invite) | `state.isPreActivated` flips the page into "you're already activated" mode and replaces to `/dashboard?onboarded=existing`. |
| Existing user with setups but zero trades | Backfill marks `setupAdded`, `marketSelected`. The trade step + insight step still need walking — they take ≤ 60s combined. |
| Existing user with trades but no setups (rare) | Backfill marks `tradeAdded`, `welcomeSeen`, `firstInsightSeen`. The setup step still needs walking. The seed setup (style template) is the path of least resistance. |
| Existing user manually backfills their `tradingStyle` later via profile/settings | `tradingStyle` is independent of the funnel — coach + insights pick it up automatically next read. |
| Existing user's earliest trade is from before user creation (timestamp drift) | `$min` ensures `firstTradeAt` clamps to the earliest evidence. |
| Two devices hit the backfill simultaneously | `User.updateOne` with `$set` / `$min` is atomic; both writes converge. |
| Account that never logged in after the deploy | Stays at "0/6" until the bulk script is run (or the next login). Doesn't break — the dashboard derives trade/setup state directly from counts. |

### 4b. Reflection

| Case | Behaviour |
|------|-----------|
| Existing user has zero reflections | Dashboard card shows the **first-time** copy ("30-second daily check-in. Builds the weekly score.") and the CTA reads "Try your first reflection". |
| Existing user already has hundreds of trades | The reflection's trade-context query is timezone-bucketed for one day, so the count of historical trades doesn't affect cost. |
| Existing user lives in a non-IST timezone | Day key derives from `streakService.getStreakSnapshot` → `notificationPreference.quietHours.timezone` → `streaks.timezone` → fallback `Asia/Kolkata`. Reflection day always matches the user-local calendar day. |
| Existing user never reflects, sees push | The reflection-reminder cron fires the variant based on whether the user traded today; the "no login yet" variant is the fallback if we can't prove activity. |
| Existing user submits a reflection from a notification | `source: "notification"` is stamped on the row so analytics can distinguish push-driven from organic. |

### 4c. AI Coach Chat

| Case | Behaviour |
|------|-----------|
| Existing user opens the coach with no conversations | Sidebar shows "No conversations yet"; the inline state in `<CoachChat>` displays the anchor-aware empty state. First message creates a conversation server-side. |
| Existing user is on the free plan | Quota counter shows `5/5 this week`. The `Crown` badge appears for premium. Free quota resets Monday 00:00 UTC. |
| Existing user is a returning premium user | `isPremium(user)` short-circuits the quota cap entirely; the quota object returns `limit: null`. |
| Coach context for a user with hundreds of trades | `coachContextService` only loads the last 20 trades, trims to 60 KB total, and caches per-user for 5 min. No degradation regardless of total history size. |
| Gemini outage during the first ever message | The stream emits an `error` event with code `COACH_STREAM_ERROR`. A failure marker is persisted as an assistant message with `status:"error"` so the thread is honest. The chat panel renders the inline error and the user can retry. |
| Existing user with no trades opens the coach | `coachContextService.buildContext` returns `recentTrades: []`. The system prompt instructs the model to say so explicitly ("I don't see any trades in your last 20 trades") rather than invent. |
| Premium subscription expires mid-week | `isPremium` re-checks `subscriptionExpiry`; the next message hits the free-tier check. If they've already used >5 questions this week, the next send returns `COACH_QUOTA_EXHAUSTED` (402). |

---

## 5. Operational runbook

### Deploy day

1. Deploy the backend + frontend together. (Lazy backfill activates the
   moment `GET /onboarding` starts being served.)
2. **Optional but recommended:** run the bulk backfill once after deploy:
   ```bash
   node backend/scripts/backfillOnboarding.js --apply --concurrency=50
   ```
   Tail `ONBOARDING_BACKFILLED` log lines to verify writes. Existing users
   who don't log in for weeks get migrated immediately instead of on their
   next visit.
3. Watch `ONBOARDING_BACKFILL_LAZY_FAILED` (logger.warn) for any user the
   lazy path can't migrate — every failure is non-blocking, but a sustained
   stream means the script should be run for the affected cohort.

### Rollback

The migration only writes additive truthy flags + `$min` timestamps + the
legacy `isOnboardingCompleted` bit (which the old code already understood).
**Nothing is destroyed.** If we ever need to roll back the onboarding flow:

- Disable `/api/onboarding` route in `server.js` (one-line change).
- The old `FirstLoginWelcome` modal + GettingStartedCard already gate
  themselves on the legacy `welcomeSeen` flag — they keep working.
- No data migration needed in reverse.

### Monitoring

| Metric | Signal |
|--------|--------|
| `ONBOARDING_BACKFILLED` (info) | One per migrated user; expect a spike right after the bulk script, then steady state ≈ daily-active-existing-users. |
| `ONBOARDING_BACKFILL_LAZY_FAILED` (warn) | Should be ~0. Investigate if > 0.1% of daily logins. |
| `ONBOARDING_COMPLETED` (info) | New funnel completions. Existing users contribute the moment the backfill flips them. |
| `ONBOARDING_STYLE_SELECTED` / `MARKET_SELECTED` / `SETUP_SEEDED` | Per-step funnel events for users actually walking the wizard. |
| `REFLECTION_SUBMITTED` / `REFLECTION_SKIPPED` | First-time vs. recurring reflection adoption. |
| `COACH_STREAM_FAILED` | Watch for spikes — usually Gemini outage. |

---

## 6. Tests

`backend/__tests__/unit/onboardingBackfill.test.js` — 9 cases covering the
backfill computation and the service entry point:

**`buildBackfillUpdate`**
- Flips every flag for an existing trader with trades + setups + market
- Doesn't mark `firstScreenshotUploadAt` when the earliest trade was manual
- Never overwrites a flag the user already set
- Only marks `isOnboardingCompleted` when all four core flags line up

**`backfillUserOnboarding`**
- Short-circuits for a truly new user (no signals)
- Writes the migration update for a pre-existing trader
- Idempotent — re-running produces zero writes
- `dryRun: true` computes the update but never writes
- `force: true` re-evaluates even when the user looks consistent

Combined with the existing reflection + coach + onboarding suites:
**42/42 tests pass.**

---

## 7. Summary table

| Scenario | Before this change | After this change |
|----------|--------------------|-------------------|
| Existing trader logs in | Bounced into `/onboarding`, told they're 0/6 | Backfill runs on first `GET /onboarding`; they land on `/dashboard?onboarded=existing` instantly |
| Existing trader opens `/onboarding` from a link | Same as login bounce | Server returns `isPreActivated:true`; page replaces to `/dashboard` |
| Existing user with no reflections sees the dashboard card | Generic "Quiet day. Worth a check-in?" | "30-second daily check-in. Builds the weekly score." with CTA "Try your first reflection" |
| Existing user opens coach for the first time | Worked already (additive feature) | Same — but the context now includes their first-time-fresh trade history with no migration needed |
| Brand-new account, no signals at all | Goes through the new 6-step wizard | Unchanged |
| `/onboarding` GET fails after login | Fallback to `/auth/me/preferences`; still respects legacy `isOnboardingCompleted` | (Same logic, expanded to include `tradeSkipped` so explorer-mode users aren't bounced either) |
