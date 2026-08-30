# Phase 0 — Google Play Billing Readiness Audit

**Date:** 2026-08-30 · **Branch audited:** `staging` · **Status:** read-only audit, no code modified.

---

## 1. Current subscription architecture

Edgecipline has **one** subscription system today, and it is a **prepaid-duration**
model rather than a recurring one:

```
Web (Next.js)  →  Razorpay Checkout  →  POST /api/payments/verify
                                     ↘  POST /api/webhooks/razorpay
                                            ↓
                              paymentService.activateRazorpaySubscriptionPayment
                                            ↓
                     Payment doc (immutable receipt)  +  User.subscription* fields
                                            ↓
                              utils/premium.isPremium(user)  ← every PRO gate
```

There is **no** `Subscription` collection. Entitlement lives as four denormalised
fields on the `User` document, and a `Payment` row is the audit trail of each
purchase. Buying a plan does not create a renewing agreement; it pushes
`subscriptionExpiry` forward by `plan.days`.

### Entitlement fields on `User` (`backend/models/Users.js`)

| Field | Type | Notes |
|---|---|---|
| `subscriptionStatus` | `"inactive" \| "active" \| "expired"` | Flipped to `expired` by an hourly cron |
| `subscriptionPlan` | `"free" \| "monthly" \| "yearly" \| "custom"` | **Display label only**, rank-guarded so a lower tier can't downgrade the label |
| `subscriptionExpiry` | `Date` | The real entitlement boundary |
| `totalPaid` | `Number` | Lifetime INR, incremented on capture |
| `trial.*` | subdoc | Currently **disabled** (`TRIAL_ENABLED=false`) |

### The single entitlement function (`backend/utils/premium.js`)

```js
isPremium(user) =  role === "admin"
                || hasActiveSubscription(user)   // status active + plan != free + expiry in future
                || isTrialActive(user)           // currently always false
```

This is already **provider-agnostic** — it reads only the four fields above and never
mentions Razorpay. That is the single most important finding: **the entitlement layer
Phase 1 asks for already exists and does not need to be rebuilt.**

Consumers: `tradeQuotaService`, `coachQuotaService`, `upload.service`, `ocrJob.service`,
`missionService`, `supportTicket.service`, `dashboardController`, `trialController`,
`subscriptionRescueService`, and the admin controllers.

---

## 2. Current Razorpay flow (must keep working — Phase 13)

**Order creation** — `POST /api/payments/order` → `createRazorpayOrder()`
→ promo quote → Razorpay order with trusted `notes` (`planType`, `userId`,
`payablePaise`) → `CheckoutSession` persisted.

**Verification** — `POST /api/payments/verify`:

1. HMAC signature check (`timingSafeEqual`)
2. **Server-side re-fetch** of the order + payment from Razorpay
3. Amount/currency/status re-validated against `PLAN_CONFIG` (with `priorAmounts`
   grandfathering for superseded prices)
4. `planType`/`userId` read from the **order notes**, never from the client
5. Activation inside a Mongo transaction (with a documented non-production fallback)

**Webhook** — `POST /api/webhooks/razorpay`, mounted **before** `express.json()` with
`express.raw()` so the HMAC is computed over the true bytes (`backend/server.js:299-306`).
Events are recorded in `WebhookEvent` with a unique `eventId`, an atomic claim/lock, a
reconciliation cron (`*/15`), a retention cron that prunes payloads but **never** the
document, and a `permanentlyFailed` terminal state.

**This is a well-built payment path.** It already implements most of what Phases 4, 6,
8, 14, 17 and 18 ask for. The Google Play work should mirror its patterns, not invent
new ones.

### Existing indexes / idempotency guarantees

- `Payment.transactionId` — unique
- `Payment.razorpayOrderId` / `razorpayPaymentId` — unique **partial**, scoped to
  `paymentMethod: "razorpay"` → **the partial filter is what leaves room for a
  `google_play` method without collision**
- `CheckoutSession.razorpayOrderId` — unique
- `WebhookEvent.eventId` and `{provider, eventId}` — unique

---

## 3. Existing APIs relevant to billing

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/payments/order` | `protect` + `paymentRateLimiter` | Create Razorpay order |
| `POST /api/payments/verify` | `protect` + `paymentRateLimiter` | Verify + activate |
| `POST /api/webhooks/razorpay` | HMAC only (raw body) | Lifecycle events |
| **`GET /api/trial/status`** | `protect` | **The entitlement API. Already returns `isPremium`, `planSource`, `subscription{status,plan,expiresAt}`.** |
| `GET /api/trial/paywall-context` | `protect` | Personalised paywall copy + plan catalogue |
| `POST /api/promotions/validate-coupon` | `protect` | Coupon quote |

**Phase 12 needs no new endpoint.** `GET /api/trial/status` is already the
backend-authoritative entitlement surface, already consumed by
`frontend/features/shared/hooks/useTrialStatus.js` with 60s polling and
refetch-on-focus.

---

## 4. Android / Capacitor state

| Item | Value |
|---|---|
| Capacitor | **6.2.1** (core/android/cli/ios) |
| Package / `applicationId` | **`com.edgecipline`** |
| `minSdk` / `compileSdk` / `targetSdk` | 24 / 36 / 36 |
| AGP / Gradle | 8.13.0 / 8.14.3 |
| Java | forced to 17 for all submodules |
| Native plugins | `@capacitor-firebase/authentication`, `@capacitor/push-notifications`, `@sentry/capacitor` |
| **Custom** native plugins | `ChecklistNotificationPlugin`, `EdgeAuthStoragePlugin` — registered in `MainActivity.java` |
| Play Billing | **none — clean slate** (`git grep BillingClient/androidpublisher/purchaseToken` → no hits) |
| Release signing | env-var / untracked `keystore.properties`; hard-fails release builds if absent |
| Build output | static export (`webDir: "out"`) via `next build` + `prune-mobile-bundle.mjs` |

### The purchase surface is currently compiled out of the app

`frontend/config/payments.js` and `frontend/components/PaywallGate.js` gate everything on
the **build-time** literal `NEXT_PUBLIC_PAYMENTS_ENABLED`. With it `false`, the
`import("./SmartPaywall")` sits in a dead branch and the bundler never emits the chunk —
no Razorpay URL, no checkout code in the APK at all. `canShowPurchaseUI()` additionally
returns `false` on any native platform.

This is deliberate and correct (Play Payments policy / Apple 3.1.1), and it means:

- **Android users literally cannot pay today.** The free 2-trades-per-market limit is
  currently unenforceable on mobile without a purchase path
  (`FREE_TRADE_LIMIT_ENFORCED` exists as the kill switch for exactly this).
- The Play Billing work must add a **third** branch to this gate: `native + android →
  Play Billing paywall`, while `native → never Razorpay` stays absolute.

---

## 5. Credentials and environment strategy

Backend config is centralised in `backend/config/index.js`: typed readers
(`readBoolean`/`readNumber`/`readList`), `requireEnv`/`requireSecret` for hard
requirements, `normalizePrivateKey()` for `\n`-escaped PEM keys, `maskSecret()` for the
boot snapshot, and `assertXConfig()` fail-fast helpers per subsystem.

**There is already a service-account pattern to copy**: `firebase` and `googleVision`
both use the `PROJECT_ID` / `CLIENT_EMAIL` / `PRIVATE_KEY` triple rather than a JSON
file, with `assertFirebaseAdminConfig()` / `assertGoogleVisionConfig()` throwing a coded
error when incomplete. Google Play Developer API credentials should follow this exact
shape — **no JSON file on disk, nothing in git**.

`.gitignore` already blocks `*.keystore`, `*.jks`, `backend/config/*.json`,
`backend/*firebase-adminsdk*.json`, `*.aab`, `*.apk`. `scripts/security-scan.js`
(`npm run security:scan`) scans tracked files for private-key blocks, Google API keys and
assigned-secret patterns.

Logging redacts by key pattern and value pattern in `backend/utils/logger.js` —
`purchaseToken` will need adding to the sensitive-key pattern.

---

## 6. What can be reused (do **not** rebuild)

1. **`utils/premium.isPremium()`** — already the centralised, provider-agnostic gate
   Phase 1 specifies.
2. **`GET /api/trial/status`** — already the Phase 12 entitlement API.
3. **`WebhookEvent`** — atomic claim, reconciliation cron, retention cron,
   `permanentlyFailed`. Add `"google_play"` to the `provider` enum and RTDN idempotency
   is 90% done.
4. **`Payment`** — add `"google_play"` to `paymentMethod`; the existing unique indexes
   are already partial-filtered to Razorpay so they will not collide.
5. **`runWithOptionalTransaction()`** — the transaction wrapper with the
   production-never-degrades rule.
6. **`invalidateAuthCache()`** — must be called after every entitlement write, or a
   cached `req.user` keeps the old plan for up to 300s.
7. **`subscriptionExpiryCron`** — already expires anything past `subscriptionExpiry`,
   provider-blind.
8. **`paymentRateLimiter`**, `asyncHandler`, `ApiError` + error codes,
   `analyticsEventService`, `captureOperationalError`.

## 7. What must change

| # | Change | Risk |
|---|---|---|
| 1 | `Payment.paymentMethod` enum += `"google_play"` | none (additive) |
| 2 | `WebhookEvent.provider` enum += `"google_play"` | none (additive) |
| 3 | New `PlaySubscription` collection keyed on `purchaseToken` (unique) — Play's renewing state does not fit the prepaid `Payment` row | new collection, no migration of existing data |
| 4 | `User.subscriptionPlan` — reuse `monthly`/`yearly` labels and extend `PLAN_LABEL_RANK` rather than adding enum values | low |
| 5 | `authCacheService.CACHE_PROJECTION` — no change needed *if* Play writes the same four `subscription*` fields | **critical**: any new entitlement field MUST be added here or it vanishes on cache hits |
| 6 | `accountDeletionService.USER_OWNED_COLLECTIONS` — `PlaySubscription` must be added, but as a **detach (null the user)** not a delete, so a purchase token can never be silently re-bound | compliance |
| 7 | Frontend gate — third branch for native Android | must not weaken the Razorpay-never-on-native rule |
| 8 | `logger` sensitive-key pattern += `purchaseToken` | none |
| 9 | New backend dep `googleapis` (Android Publisher v3) + Pub/Sub for RTDN | supply chain review |
| 10 | New Android dep `com.android.billingclient:billing` + a custom `EdgeBillingPlugin` following the existing `ChecklistNotificationPlugin` pattern | — |

---

## 8. Potential conflicts

- **Prepaid vs auto-renewing semantics.** Razorpay purchases *stack days* onto
  `subscriptionExpiry`; Play *owns* an `expiryTime` it moves on every renewal. If Play
  writes `subscriptionExpiry` directly it will **shorten** a user who also holds Razorpay
  time. Resolution: `subscriptionExpiry = max(razorpayExpiry, playExpiry)`, with the Play
  expiry tracked separately on `PlaySubscription` so a Play cancellation can never claw
  back Razorpay-purchased days.
- **`subscriptionExpiryCron`** flips `active → expired` purely on date. Harmless for Play
  (RTDN will re-activate), but during a Play **grace period** the Play expiry has passed
  while entitlement should continue — grace must be represented by pushing the effective
  expiry, not by a separate status the cron does not understand.
- **`PLAN_CONFIG` prices are INR-hardcoded server-side.** Play prices are Console-owned
  and localised. Play plans must **not** be added to `PLAN_CONFIG` (its
  `assertPlanConfigIsSane` invariants are Razorpay-specific); they need a separate
  allowlist carrying product/base-plan IDs and duration, but **no price**.
- **Sandbox mode** (`ALLOW_SANDBOX_PAYMENTS`) grants real premium from a fabricated
  payment ID. It is correctly double-gated, but the Play verify endpoint must have **no
  equivalent bypass whatsoever**.

## 9. Security risks specific to this work

| Risk | Mitigation |
|---|---|
| Client-supplied `productId` / price / expiry | Derive **everything** from the Android Publisher API response; accept only `purchaseToken` + `productId` from the client, and validate `productId` against a server allowlist |
| Purchase-token replay across accounts | `purchaseToken` unique index + explicit "already bound to another user" rejection (never a silent transfer) |
| Token bound to wrong account after logout/login | `obfuscatedAccountId` = HMAC(userId) set at purchase time and re-verified server-side |
| Service-account key leakage | Backend-only env triple, never `NEXT_PUBLIC_*`, never in the APK, `security:scan` in CI |
| RTDN forgery / replay | Verify the Pub/Sub push OIDC token; dedupe on the Play notification's own identifiers via `WebhookEvent` |
| Stale RTDN overwriting newer state | Compare Play's `expiryTime` / event ordering before writing; never let an older event regress state |
| `purchaseToken` in logs / Sentry | Add to logger redaction; log a truncated hash instead |
| Concurrent verify + RTDN | Same `runWithOptionalTransaction` + unique-key idempotency as Razorpay |

---

## 10. Recommended implementation plan

**Guiding principle: extend, never duplicate.** One entitlement function, one entitlement
API, two payment providers.

| Step | Work |
|---|---|
| 1 | Branch `feature/google-play-billing` off `staging` |
| 2 | **Config + docs**: `appConfig.googlePlay` (project / client-email / private-key / package-name / RTDN topic), `assertGooglePlayConfig()`, `.env.example`, Play Console setup doc |
| 3 | **Schema**: `PlaySubscription` model + indexes; enum additions to `Payment` / `WebhookEvent`; logger redaction |
| 4 | **Entitlement core**: `subscriptionEntitlementService` — the one place that computes `max()` across providers and writes `User.subscription*` + `invalidateAuthCache` |
| 5 | **Play verification service**: Android Publisher `purchases.subscriptionsv2.get`, state mapping, idempotent acknowledgement |
| 6 | **API**: `POST /api/payments/google-play/verify`, `POST /api/payments/google-play/restore`, mirroring existing route/controller conventions |
| 7 | **RTDN**: `POST /api/webhooks/google-play` — raw body, OIDC verification, `WebhookEvent` dedupe, reuse the reconciliation cron |
| 8 | **Android**: `EdgeBillingPlugin` (Play Billing 7.x) modelled on `ChecklistNotificationPlugin`, plus a JS bridge in `frontend/plugins/` |
| 9 | **Frontend**: native-Android paywall reading live Play prices, restore flow, all the Phase-12 states |
| 10 | **Tests**: unit + integration mirroring `paymentSecurityMatrix.test.js`, `paymentConcurrency.test.js`, `razorpayWebhookRoute.test.js` |
| 11 | **Audit**: `npm test`, `npm run security:scan`, lint, Play internal-testing track with licence testers |

**No database migration of existing data is required.** Every schema change is additive;
existing Razorpay users keep working because `isPremium()` never learns that providers
exist.
