# Onboarding — 5-Minute Activation

A linear, resumable, low-friction first-run flow built to maximise:

- **First trade logged** (manual or screenshot)
- **First screenshot upload** (broker UI → AI fill)
- **First AI insight** (grounded in real data, not generic)
- **D1 retention** (dashboard never feels empty)

---

## 1. UX flow

```
  ┌────────────┐   ┌──────────┐   ┌──────────────┐   ┌────────────────┐
  │ 1. Welcome │──▶│ 2. Market│──▶│ 3. Style     │──▶│ 4. Setup       │
  └────────────┘   └──────────┘   └──────────────┘   └────────┬───────┘
                                                              │
                                                     auto-seed template
                                                              │
                                                              ▼
                                  ┌──────────────────────────────────────┐
                                  │ 5. First Trade                       │
                                  │    [Upload screenshot] [Manual entry]│
                                  │    Skip → continues with no-trade    │
                                  │    insight path                      │
                                  └──────────────────┬───────────────────┘
                                                     │
                                  trade save fires markTradeLogged() →
                                  funnel.tradeAdded=true, firstTradeAt set
                                                     │
                                                     ▼
                                  ┌──────────────────────────────────────┐
                                  │ 6. First AI Insight                  │
                                  │    POST /onboarding/insight          │
                                  │    Personalised by style + trade     │
                                  │    Fallback to no-trade welcome      │
                                  └──────────────────┬───────────────────┘
                                                     │
                                          completeOnboarding()
                                                     │
                                                     ▼
                                  ┌──────────────────────────────────────┐
                                  │ /dashboard?onboarded=1               │
                                  │   • GettingStartedCard celebrates    │
                                  │   • Empty-state overlays still show  │
                                  │     where the user hasn't logged data│
                                  └──────────────────────────────────────┘
```

**Resume:** every step writes server-side state, so a user closing the tab
mid-flow can return via `/onboarding` (auto-resumes at first incomplete
step) **or** tap any item in the dashboard's GettingStartedCard, which
deep-links to `/onboarding?step=<key>`.

**Skip:** every step has a "Skip onboarding" affordance. Skipping marks
`welcomeSeen=true` and lands the user on the dashboard, where the
GettingStartedCard continues to nudge them through the remaining steps.

---

## 2. Wireframes (shell anatomy)

Every step renders inside the shared `OnboardingShell`:

```
┌───────────────────────────────────────────────────────────┐
│  ✦  Onboarding · 5-minute setup                  [Skip]   │  ← header
├───────────────────────────────────────────────────────────┤
│  ● Welcome  ● Market  ○ Trading Style  ○ Default Setup    │  ← funnel trail
│  ○ First Trade  ○ First AI Insight                         │
├───────────────────────────────────────────────────────────┤
│  {title}                                                  │
│  {subtitle}                                               │
│                                                           │
│  {step content}                                           │
│                                                           │
│  [← Back]   [Primary CTA →]                               │  ← actions
└───────────────────────────────────────────────────────────┘
```

Step-specific content:

| Step | Body | Primary action |
|------|------|----------------|
| **Welcome** | 3-bullet pitch (pick your edge, screenshot in, real insight out) | "Start" |
| **Market** | 2 large radio cards (Forex / Indian) | "Continue →" |
| **Style** | 5 radio cards (Scalper / Intraday / Swing / Position / Investor) with style badge | "Continue →" |
| **Setup** | Style-matched seed setup (name + rules) with optional inline edit | "Use this setup" / "Save my setup" |
| **First Trade** | Two CTAs (Upload screenshot, Manual entry) + skip-with-no-trade fallback | "I'll do this later — see my dashboard" |
| **First Insight** | Personal coaching line built from style + (if logged) latest trade | "Open my dashboard →" |

---

## 3. Database

**Schema changes — `backend/models/Users.js`** (additive only; existing fields
preserved so the legacy GettingStartedCard keeps working):

```js
tradingStyle: { type: String, enum: ["scalper","intraday","swing","position","investor", null], default: null },

onboarding: {
  welcomeSeen:        Boolean (existing),
  marketSelected:     Boolean (new),
  styleSelected:      Boolean (new),
  setupAdded:         Boolean (existing),
  tradeAdded:         Boolean (existing),
  firstInsightSeen:   Boolean (new),
  journalSeen:        Boolean (existing),
  analyticsSeen:      Boolean (existing),
  notificationsSeen:  Boolean (existing),
  tourCompleted:      Boolean (existing),
  checklistDismissed: Boolean (existing),

  // Funnel timestamps used by analytics (time-to-value)
  startedAt:               Date (new),
  firstTradeAt:            Date (new),
  firstScreenshotUploadAt: Date (new),
  firstInsightAt:          Date (new),
  completedAt:             Date (existing),
}
```

No new collections — extending the User document keeps reads cheap (single
query for the whole funnel state) and matches the existing convention.

---

## 4. API

All routes require `protect`. Mounted at `/api/onboarding/*`.

| Method | Route | Body | Response |
|--------|-------|------|----------|
| GET    | `/api/onboarding`           | – | `{ preferredMarket, tradingStyle, onboarding, funnel, styles }` |
| POST   | `/api/onboarding/market`    | `{ market }` | Same shape as GET |
| POST   | `/api/onboarding/style`     | `{ style }` | Same |
| POST   | `/api/onboarding/setup`     | `{ style?, market?, custom?: { name, rules[] } }` | `{ …, seeded: { name, rules } }` |
| POST   | `/api/onboarding/insight`   | – | `{ insight: { title, body, evidence, action }, …state }` |
| POST   | `/api/onboarding/complete`  | – | Same as GET (with `completedAt`) |

**Implicit step writes** (no client work required):

- `trade.service.createTrade` and `…createTradesBatch` now fire-and-forget
  `onboardingService.markTradeLogged({ userId, fromScreenshot })`. The user
  can't get to step 5 "completed" without it firing.
- `indianTradeController` create + batch paths do the same for the Indian
  market.
- `auth/me/preferences` continues to expose the funnel via `onboarding` for
  the GettingStartedCard and the post-login redirect.

The legacy `PATCH /api/auth/me/onboarding` endpoint still accepts the same
step list — and now also accepts the three new keys (`marketSelected`,
`styleSelected`, `firstInsightSeen`), so any client that already speaks the
old API can drive the new funnel.

---

## 5. Frontend

| File | Role |
|------|------|
| `frontend/features/onboarding/api/onboardingApi.js` | Axios wrappers. |
| `frontend/features/onboarding/hooks/useOnboarding.js` | `useOnboardingState`, `useSelectMarket`, `useSelectStyle`, `useSeedSetup`, `useGenerateFirstInsight`, `useCompleteOnboarding`. All mutations invalidate `["onboarding"]`, `["dashboard","snapshot"]`, and `["auth","preferences"]`. |
| `frontend/features/onboarding/components/OnboardingShell.jsx` | Shared chrome: header, funnel trail, action bar. |
| `…/components/WelcomeStep.jsx` `MarketStep.jsx` `StyleStep.jsx` `SetupStep.jsx` `TradeStep.jsx` `InsightStep.jsx` | One self-contained component per step. |
| `frontend/app/onboarding/page.js` | Stepper orchestrator. Auto-resumes from `funnel.nextStepKey`. Accepts `?step=` to jump. Auto-fires `generateInsight` when the user lands on step 6. |
| `frontend/features/dashboard/components/GettingStartedCard.jsx` | Rewritten to the 6-step model with reward state. Each row deep-links into `/onboarding?step=<key>` so abandoned flows are easy to resume. |
| `frontend/features/dashboard/components/EmptyStateOverlay.jsx` | Reusable overlay that sits on top of dashboard panels when the user has no trades yet. Always offers a CTA. |
| `frontend/app/dashboard/page.js` | Mounts the overlay on the KPI grid + the equity curve. Stays populated otherwise. |
| `frontend/features/auth/hooks/useLogin.js` | `resolveLandingPath()` reads the user's onboarding state after sign-in. Returns `/onboarding` for new users, `/dashboard` for activated users. Falls back to `/dashboard` on any error. |

---

## 6. Routing rules

| Trigger | Destination |
|---------|-------------|
| Fresh register (no trades, no funnel progress) | `/onboarding` |
| Login of a user with funnel incomplete | `/onboarding` (resumes at first incomplete step) |
| Login of an activated user | `/dashboard` |
| `auth_redirect` set in `sessionStorage` (e.g. notification deep link) | The saved path — `/onboarding` is skipped because the user came back for a specific reason |
| Terms acceptance required | `/accept-terms` always wins |

The redirect is opportunistic — if `/auth/me/preferences` fails for any
reason, the user still lands on `/dashboard` so they're never locked out by
an onboarding error.

---

## 7. Progress tracking + reward

- **Backend computeFunnel()** returns the weighted percent. First-trade and
  first-insight are worth 2 weight units each (vs. 1 for the earlier
  selection steps) so the progress bar visibly accelerates near the end.
- **Frontend funnel trail** in OnboardingShell renders the labels from the
  server response — change the order or copy without redeploying the UI.
- **GettingStartedCard** flips its gradient + headline when every step is
  complete: "You're activated. 🎉 Edgecipline is fully tuned to you." It
  does not auto-dismiss; the user gets the satisfaction of tapping "Done".

---

## 8. Edge-case matrix

We split edges into three buckets: **user state**, **content/data**, and
**failure modes**. Every row below is exercised either by a unit test or by a
deliberate UI affordance — none of them are left to "it'll be fine".

### 8a. User state

| Case | Behaviour | Where it lives |
|------|-----------|----------------|
| Fresh signup, no trades yet | Lands on `/onboarding`. Welcome → Market → Style → Setup → Trade choice. | `useLogin.resolveLandingPath` |
| User explicitly hasn't traded yet (paper / demo / "just exploring") | Tap **"I haven't traded yet"** on the trade step. We fire `POST /api/onboarding/skip-trade` (`reason="not_traded_yet"`), set `onboarding.tradeSkipped = true`, leave `tradeAdded = false`, and advance to the insight step. The insight uses the **explorer variant** (no-pressure copy). | `TradeStep.jsx`, `markTradeSkipped`, `buildFirstInsight` `variant: "explorer"` |
| User has no broker screenshot (only chart memory) | The trade step's **"Log manually"** CTA links to `/add-trade?onboarding=1`. Same data target as the upload path; just a different entry. | `TradeStep.jsx` |
| User tries upload but OCR fails | Two safety nets: (1) the trade step shows a static "Screenshot didn't parse? switch to manual entry" link with `?fromUploadFailure=1`. (2) the trade step never blocks — `tradeAdded` only flips when a real save lands, so an OCR error doesn't fake progress. | `TradeStep.jsx` |
| User taps "Skip onboarding" at any step | Marks `welcomeSeen=true` and lands them on `/dashboard?onboarding=skipped`. Funnel state is preserved — GettingStartedCard continues to nudge. | `/onboarding/page.js` `handleSkip` |
| User closes the tab mid-flow | Every step is server-persisted before the next renders. `useOnboardingState` re-hydrates on revisit; the orchestrator resumes at `funnel.nextStepKey`. | `useOnboardingState`, `computeFunnel` |
| User registered before this code shipped | First `/api/onboarding` call triggers the lazy **backfill** ([`onboardingBackfillService`](../backend/services/onboardingBackfillService.js)) which mirrors their trades / setups / preferredMarket onto the new flags and returns `isPreActivated: true`. The login redirect + orchestrator route them to `/dashboard?onboarded=existing`. Bulk script available for cold migration. See [docs/existing-users.md](existing-users.md). | `onboardingService.getState`, `useLogin.resolveLandingPath`, `/onboarding/page.js` |
| User finished activation, returns to `/onboarding` | `funnel.isComplete = true`. The orchestrator short-circuits to `/dashboard?onboarded=1`. | `/onboarding/page.js` `done` branch |
| User who skipped then later logs a real trade | `markTradeLogged` fires inside `trade.service.createTrade` regardless of where the trade came from. `tradeAdded=true` joins `tradeSkipped=true`; the row in GettingStartedCard switches from "Log a trade when you have one · explorer mode" to plain done. | `trade.service.js`, `indianTradeController.js` |
| User logs in on a second device | Server is the source of truth. They pick up at the same step. | – |
| Free-tier user hits the upload quota during onboarding | Upload page surfaces the existing paywall; the user can still pick **"Log manually"** or **"I haven't traded yet"** to advance. | `freeUploadUsed` (existing) |

### 8b. Content / data edges

| Case | Behaviour |
|------|-----------|
| User customises the seed setup and clears all rules | Primary CTA disables — the validator requires ≥ 1 rule (`reflectionSchemas.seedSetup`). |
| User customises with a name that collides with an existing SetupStrategy of the same `{user, market, name}` | `findOneAndUpdate` is an upsert — no duplicate is created and no error surfaces. Unit-tested: "upserts so a second call with the same name does not throw (collision-safe)". |
| User picks Indian Market but uploads a Forex screenshot (or vice versa) | Out of scope for onboarding — the existing upload flow handles market mismatches. Onboarding just marks `tradeAdded` from whichever `createTrade` path fires. |
| Trading style ID changes between releases | Zod enum gates the input; an old client passing a retired ID gets a 400 with `VALIDATION_ERROR` and stays on the style step. |
| User on a tiny viewport | The shell is mobile-first (max-width 520, single column). Long step labels wrap in the funnel trail. |

### 8c. Failure modes

| Case | Behaviour |
|------|-----------|
| Gemini outage during step 6 | `buildFirstInsight` has three local, deterministic branches (logged / explorer / waiting). The user always sees an insight. |
| `POST /onboarding/market` (or any other mutation) fails | The step's `<OnboardingError>` banner renders with the server message + an inline **Retry** button. The user can also tap "Skip onboarding" — funnel state isn't required to be perfect, just consistent. |
| Network drops mid-flow | React Query keeps the last good snapshot in `STATE_KEY`; the orchestrator renders the step from `data` and the failed mutation surfaces in the banner. |
| Redis cache miss for auth | `invalidateAuthCache` is best-effort; the next read rebuilds from Mongo. Nothing in onboarding depends on Redis being up. |
| Trade-create side-effect (`markTradeLogged`) throws | Wrapped in `.catch(logger.warn)` so the trade save itself never fails. The dashboard derivation (`onboardingProgress.tradeCount > 0`) still flips `tradeAdded` in the snapshot. |
| Race: user submits a step while a previous mutation is still in flight | React Query mutations are serialized per hook instance; the orchestrator awaits each `mutateAsync` before calling `gotoNext()`. |
| User loses session (token expires) mid-step | `apiClient` silently refreshes; if that fails, they bounce to `/login` and on re-entry the funnel resumes at the same step. |

---

## 9. Analytics signals

All emitted via `logger.info(…)` so they end up in the same Winston log
aggregator as every other backend event (no new event sink required):

| Event | Fields |
|-------|--------|
| `ONBOARDING_MARKET_SELECTED` | userId, market |
| `ONBOARDING_STYLE_SELECTED` | userId, style |
| `ONBOARDING_SETUP_SEEDED` | userId, market, name |
| `ONBOARDING_COMPLETED` | userId |

Derived metrics (cheap, computed from User.onboarding directly):

- **Time-to-first-trade**: `firstTradeAt − createdAt`
- **Time-to-first-insight**: `firstInsightAt − createdAt`
- **Funnel drop-off**: count of users with each step false grouped by
  `startedAt` cohort
- **Screenshot uptake**: count of users with `firstScreenshotUploadAt`
  non-null / count of users with `firstTradeAt` non-null

A future `OnboardingEvent` collection is intentionally out of scope for
this phase — the four log lines + the five timestamps cover every funnel
question we currently have.

---

## 10. Tests + smoke checks

`backend/__tests__/unit/onboardingService.test.js` — 17 tests covering both
the happy path and the edge matrix above:

**Funnel math**
- Fresh user → 0% progress
- All flow steps done → `isComplete:true`, `nextStepKey:null`
- `tradeSkipped:true` counts the trade step as done (explorer mode)
- Explorer who skipped trade but hasn't seen insight is still not complete
- First-trade + first-insight weighted heavier than earlier steps
- `nextStepKey` follows flow order

**`isStepDone` helper**
- Direct flag set → true
- `tradeAdded` true via `tradeSkipped` → true
- Unrelated step does not inherit `tradeSkipped`

**Setup seed**
- Seeds style-specific default + flips `setupAdded`
- Unknown style ID falls back to a sane default
- Custom name + rules override the seed
- Upsert is collision-safe across repeated calls

**Skip trade**
- Flips `tradeSkipped` without touching `tradeAdded`
- Idempotent — repeat calls don't throw

**First insight**
- Returns `variant:"waiting"` when no trades and no skip
- Returns `variant:"explorer"` for `tradeSkipped:true` users (no-pressure copy)

Combined with the existing reflection + coach suites: **33/33 tests pass**.
`node -e "require('./server.js')"` boots without error.

---

## 11. Implementation roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Schema + service + controller + routes + tests + auto-mark wiring | ✅ shipped |
| 0 | Frontend stepper + step components + resume from incomplete + skip everywhere | ✅ shipped |
| 0 | GettingStartedCard rewrite (6-step model + reward) + Dashboard empty-state overlays | ✅ shipped |
| 0 | Login/register redirect to `/onboarding` for inactivated users | ✅ shipped |
| 0 | docs/onboarding.md (this file) | ✅ shipped |
| 0 | Edge cases — explorer / paper-trader path (`tradeSkipped`), explorer variant of first insight, inline `<OnboardingError>` retry banner on every mutation, OCR-failure manual-entry escape, adaptive empty-state copy for explorers, explorer-mode row in GettingStartedCard | ✅ shipped |
| 1 | `OnboardingEvent` collection for per-step timestamps + funnel admin dashboard | TODO |
| 1 | Trade page deep-link back to `/onboarding?step=firstInsightSeen` after first save | TODO — currently the user navigates manually; the side effect already marks the step done |
| 1 | "Onboarding gamification" — show the activation badge in PageHeader once `completedAt` is set | TODO |
| 2 | A/B harness for trading-style labels and seed setups (`appConfig.onboarding.experiments`) | TODO |
| 2 | Empty-state overlays for the rest of the dashboard panels (Today's Intelligence, AI Coach Snapshot, Recent Progress) when respective data sources are insufficient | TODO |
| 2 | Mobile-only "vertical card" stepper variant for very small viewports | TODO |
| 3 | Drip welcome push notifications (Day 1, Day 3, Day 7) tuned by which step the user dropped at | TODO |

---

## 12. Operational notes

- **Idempotency**: every mutation is idempotent (upserts, `$set`). Refreshing
  a step page never produces duplicate state.
- **Privacy**: nothing leaves the user's own document. Setup templates live
  in `onboardingService.TRADING_STYLES` (in code, not Mongo).
- **Failure**: every onboarding mark and the AI insight call have a
  fallback. The user always reaches `/dashboard`; the worst case is they
  see the no-trade welcome insight.
- **Backwards compat**: legacy `FirstLoginWelcome` modal still ships but is
  no longer the first thing a new user sees — `/onboarding` is. Existing
  users who already passed it keep their `welcomeSeen` flag and never see
  it again. The GettingStartedCard remains the recovery path for anyone
  who skipped.
