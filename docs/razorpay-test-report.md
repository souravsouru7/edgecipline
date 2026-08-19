# Razorpay Test Mode — Payment Security & Edge Case QA Report

| | |
|---|---|
| **Branch** | `feature/razorpay-test-hardening` |
| **Base commit** | `ebef14b2e6f7a00ec9743d439d1fb42812ed7611` (`ebef14b` — *Serve psychology timeline from the engine that computes its scores*) |
| **Branched from** | `auth-session-p0-testing` |
| **Test date** | 2026-08-19 |
| **Environment** | Local development. `NODE_ENV=test` for the suite. MongoDB **standalone** at `localhost:27017` (no replica set). |
| **Razorpay Test Mode** | 🟡 **PARTIALLY CONFIGURED** — API keys set and verified against the live Razorpay API. `RAZORPAY_WEBHOOK_SECRET` still missing. See §2. |
| **Final verdict** | 🔴 **NO-GO for production** / 🔴 **BLOCKED for Test Mode** — see §2.1, MongoDB transactions unavailable |

---

## 1. Executive Summary

All hardening work requested in Phases 5, 11, 24 and 25 is implemented and covered by tests. The automated security matrix (Phases 6–9, 15–23, 28) is complete and passing: **141 new tests across 6 new suites, 0 failures, 0 regressions**.

The blocking issue is not code. It is that **Phases 4, 10, 12–14 (partially), 22 (live DB) and 26 could not be executed** because they require a real Razorpay Test Mode account, a browser, and a replica-set MongoDB — none of which this session had access to. Those phases are reported as **NOT EXECUTED**, not as passed.

Two findings surfaced during the work that were not in the original audit and that materially affect production readiness:

- 🔴 **`activateRazorpaySubscriptionPayment` requires MongoDB transactions**, and therefore a replica set. The local Mongo is standalone, where the entire real payment path would throw. Production must be verified as a replica set / Atlas before go-live.
- 🟠 **`frontend/config/payments.js` is untracked in git.** It is the build-time payment kill switch. A fresh clone does not build.

---

## 2. Razorpay Test Mode Status — PARTIALLY CONFIGURED

Test-mode API keys were supplied by the owner and written to `backend/.env` and
`frontend/.env.development` (both gitignored). **Connectivity verified against the
live Razorpay API** — a real test order was created successfully:

```
POST orders.create -> order_TRY3yp6rpvndI4  amount=15000  currency=INR  status=created
AUTH OK
```

That probe order is unpaid and expires on its own; it has no effect on the database.

| Variable | Location | State | Effect |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | `backend/.env` | ✅ `rzp_test_TRY1kdKakXfbBa` | real order creation works |
| `RAZORPAY_KEY_SECRET` | `backend/.env` | ✅ set, **authenticates** | signature verification works |
| `RAZORPAY_WEBHOOK_SECRET` | `backend/.env` | 🔴 **empty** | every webhook 503s |
| `ALLOW_SANDBOX_PAYMENTS` | `backend/.env` | ✅ `false` | sandbox unreachable |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `frontend/.env.development` | ✅ set | checkout loads real SDK |
| `NEXT_PUBLIC_PAYMENTS_ENABLED` | `frontend/.env.development` | ✅ `true` | purchase UI enabled **for `next dev` only** |

**Placement note.** The frontend flags are in `.env.development`, not `.env`.
`next dev` reads that file; `next build` — which `npm run build:mobile` invokes —
does not. Enabling the purchase UI for local browser testing is therefore
structurally incapable of leaking into an Android/iOS bundle. Do not copy those
two lines into `.env`, `.env.local`, or `.env.production`.

### 2.1 🔴 BLOCKER — MongoDB transactions unavailable

The active `MONGO_URI` is a **standalone** local instance. Empirically confirmed:

```
URI target  : mongodb://127.0.0.1:27017/trading_latest
replicaSet  : NONE (standalone)
TRANSACTION : FAILED -> Transaction numbers are only allowed on a replica set member or mongos
```

`activateRazorpaySubscriptionPayment` opens a transaction. Against this database
it throws **after Razorpay has already captured the money** — the payment
succeeds at the provider and the user gets nothing. End-to-end testing (Phase 10)
cannot begin until this is resolved.

Two ways forward:

1. **Use the Atlas cluster already present (commented) in `backend/.env` line 14** —
   it carries `replicaSet=atlas-mquonf-shard-0`, so transactions work. Note it
   targets database `trading_db`, whereas the active local URI targets
   `trading_latest`; switching changes which dataset you are working against.
2. **Convert the local instance to a single-node replica set** — keeps the
   `trading_latest` data. Restart `mongod` with `--replSet rs0`, then run
   `rs.initiate()` once in `mongosh`.

This was not changed automatically: option 1 silently swaps the working dataset,
and option 2 restarts a service outside this repo. Both are the owner's call.

### 2.2 Still required

```bash
# backend/.env — generate in Razorpay Dashboard > Settings > Webhooks
RAZORPAY_WEBHOOK_SECRET=<a DIFFERENT secret from RAZORPAY_KEY_SECRET>
```

Then register the webhook at `https://<api-host>/api/payments/webhook` with events
`payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, `payment.refunded`.
Razorpay must be able to reach the host — for local testing that means a tunnel
(`ngrok http 5000` or similar), since `localhost` is not routable from Razorpay.

**No secret was committed, logged, hardcoded, or exposed to a production bundle** — verified in §9.

---

## 3. Test Suite Results

### Baseline (before any change)

```
Test Suites: 3 failed, 77 passed, 80 total
Tests:      10 failed, 1044 passed, 1054 total
```

Pre-existing failures (all unrelated to payments, **not introduced by this work**):
- `__tests__/unit/notification-quiet-hours.test.js`
- `__tests__/integration/mission.test.js` — `app.address is not a function` (`server.js` exports no app)
- `__tests__/integration/auth.test.js` — same cause

### After hardening

```
Test Suites: 3 failed, 83 passed, 86 total
Tests:      10 failed, 1185 passed, 1195 total
```

**Delta: +6 suites, +141 tests, all passing. Same 3 pre-existing failures, same 10 failing tests. No new regressions.**

### Payment-scoped suites

```
Test Suites: 13 passed, 13 total
Tests:      198 passed, 198 total
```

### Frontend

```
next build ......................... PASS (all routes prerendered static)
checkout.razorpay.com in bundle .... 0
rzp_sandbox_demo in bundle ......... 0
mock-rzp-overlay in bundle ......... 0
RAZORPAY_KEY_SECRET in bundle ...... 0
RAZORPAY_WEBHOOK_SECRET in bundle .. 0
```

---

## 4. New Test Suites

| Suite | Tests | Phases |
|---|---:|---|
| `__tests__/unit/paymentSecurityMatrix.test.js` | 58 | 6, 7, 8, 9, 28 |
| `__tests__/unit/paymentLifecycle.test.js` | 31 | 20, 21, 22, 23 |
| `__tests__/unit/webhookReconciliation.test.js` | 16 | 24, 25 |
| `__tests__/unit/paymentConcurrency.test.js` | 14 | 11, 16, 17, 18, 19 |
| `__tests__/integration/razorpayWebhookRoute.test.js` | 14 | 15 |
| `__tests__/unit/sandboxIsolation.test.js` | 8 | 5 |
| **Total** | **141** | |

`paymentConcurrency.test.js` does not use shallow mocks. It builds in-memory `Payment` and `WebhookEvent` collections that **enforce the real production unique indexes** and throw `code: 11000` exactly as MongoDB does, so the idempotency guarantees are genuinely exercised rather than assumed.

---

## 5. Detailed Test Results

### Phase 5 — Sandbox self-grant (HIGH PRIORITY)

| | |
|---|---|
| **TEST-ID** | P5-SANDBOX |
| **Scenario** | Missing Razorpay credentials outside production; authenticated user posts fabricated ids to `/payments/verify` |
| **Expected** | Fail closed. Never treat missing credentials as a successful payment. |
| **Actual (before)** | 🔴 Sandbox activated a **real 90-day subscription** from a fabricated payment id. Gate was `NODE_ENV === "production"` only — a staging box that forgot to set `NODE_ENV` was a free-premium faucet against a real database. |
| **Actual (after)** | ✅ 503 `RAZORPAY_CONFIG_MISSING`. Sandbox now requires **both** a missing key **and** `ALLOW_SANDBOX_PAYMENTS=true` **and** a non-production `NODE_ENV`. Production cannot opt in even by setting the flag — `config/index.js` strips it. |
| **DB before** | `subscriptionStatus: inactive`, `totalPaid: 0` |
| **DB after** | unchanged — no `Payment`, no `User` write |
| **Result** | ✅ **PASS** (8/8) |

Fix: [`backend/config/index.js`](../backend/config/index.js) `razorpay.allowSandboxPayments`, [`backend/controllers/paymentController.js`](../backend/controllers/paymentController.js) `isSandboxMode()`.

### Phase 6 — Server-side price integrity

| TEST-ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| P6-A1..A9 | `amount` = `1`, `0`, `999999`, `-100`, `"1"`, `null`, `undefined`, `NaN`, `{}` in order body | Ignored; order created at ₹150 | Every order created at `amount: 15000` paise | ✅ PASS |
| P6-C1..C3 | `currency` = `USD`, `EUR`, `inr` | Ignored; INR forced | All orders `currency: "INR"` | ✅ PASS |
| P6-P1..P6 | `planType` = unknown / `monthly` / `yearly` / `custom` / numeric | Rejected | `VALIDATION_ERROR`, no order created | ✅ PASS |
| P6-P7 | `planType` = `""` | Falls back to default orderable plan | ₹150 order created (documented behaviour) | ✅ PASS |
| P6-O1..O3 | Razorpay order under/overpaid or USD | Rejected | `PAYMENT_INTEGRITY_CHECK_FAILED`, DB untouched | ✅ PASS |
| P6-V1 | `amount: 999999, currency: USD, subscriptionDays: 36500` in verify body | All ignored | `Payment` persisted with `amount: 150, currency: INR, subscriptionDays: 90` | ✅ PASS |

### Phase 7 — Cross-user protection

| TEST-ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| P7-1 | User B verifies an order whose notes name User A | Rejected | `PAYMENT_INTEGRITY_CHECK_FAILED` | ✅ PASS |
| P7-2 | Forged `userId` in request body | Ignored — order notes win | Rejected, DB untouched | ✅ PASS |
| P7-3 | **Genuinely valid signature** + User B's session | Rejected — signature binds order+payment, not identity | Rejected, no activation for B, `totalPaid` unchanged | ✅ PASS |
| P7-4 | Order with no user metadata | Rejected | `PAYMENT_INTEGRITY_CHECK_FAILED` | ✅ PASS |

### Phase 8 — Signature verification

| TEST-ID | Scenario | Result |
|---|---|---|
| P8-1 | Valid signature | ✅ accepted |
| P8-2..12 | Invalid / empty / missing / malformed non-hex / truncated / over-long / wrong secret / signed over a different order id / different payment id / `null` / numeric | ✅ all rejected `PAYMENT_SIGNATURE_INVALID`, DB untouched, **and rejected before any Razorpay API call** |
| P8-13 | Order and payment ids swapped | ✅ rejected |
| P8-14 | Signature echoed in response | ✅ never present |

Timing-safe comparison (`crypto.timingSafeEqual`) preserved — not weakened.

### Phase 9 — Provider re-fetch is authoritative

| TEST-ID | Scenario | Result |
|---|---|---|
| P9-1..3 | Order status `created` / `attempted`, order id mismatch | ✅ rejected |
| P9-4..8 | Payment `authorized` not captured / `captured:false` / `failed` / belongs to another order / id mismatch | ✅ rejected |
| P9-9 | Order notes carry a non-orderable plan (`yearly`) | ✅ rejected |
| P9-10 | Fabricated payment id unknown to Razorpay | ✅ 502 `RAZORPAY_VERIFICATION_FAILED` |
| P9-11 | Fabricated order id unknown to Razorpay | ✅ 502 |
| P9-12 | Razorpay API outage (`ETIMEDOUT`) | ✅ **fails closed**, never open |
| P9-13 | Incomplete provider response (`null`) | ✅ rejected |
| P9-14 | `planType` disagrees with order notes | ✅ rejected |
| P9-15..16 | Missing order id / payment id | ✅ rejected |

A valid frontend request alone never activates premium. Confirmed.

### Phase 11 — `payment.failed` (IMPLEMENTED — was missing)

| TEST-ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| P11-1 | `payment.failed` received | Recorded, no entitlement | `activated: false`, 0 `Payment` rows, `subscriptionStatus: inactive`, `totalPaid: 0` | ✅ PASS |
| P11-2 | **`payment.failed` → `payment.captured` for the same payment id** | Final state = SUCCESSFUL | 1 `Payment`, `active`, `totalPaid: 150` | ✅ **PASS** |
| P11-3 | `payment.captured` → `payment.failed` (late failure) | Success not revoked | Still `active`, `totalPaid: 150` | ✅ PASS |

**Design note.** `recordFailedPayment` deliberately writes **no** `Payment` document. `transactionId` and the partial unique index on `razorpayPaymentId` would both collide with the later capture, and the activation path treats an existing `Payment` row as "already processed" — so persisting a failure row would have permanently swallowed the subsequent success and charged the user without granting a subscription. The full payload is already retained on the `WebhookEvent`, so nothing is lost.

### Phase 15 — Webhook raw body (HTTP integration)

| TEST-ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| P15-1 | Correctly signed raw `Buffer` through `POST /api/payments/webhook` | Accepted, subscription activated | 200, activation called | ✅ PASS |
| P15-2 | Body modified after signing (`amount` 15000 → 100) | Rejected | 400, no activation | ✅ PASS |
| P15-3 | Signature modified over a valid body | Rejected | 400 | ✅ PASS |
| P15-4..8 | Missing / empty / malformed / truncated signature, wrong secret | Rejected | 400 | ✅ PASS |
| P15-9 | **Regression probe: `express.json()` mounted first** | Must never activate | Hard failure, no activation | ✅ PASS |
| P15-10 | Response body leakage | No internal detail | Only `{received:true}`; no `eventId`, no `processingResult` | ✅ PASS |
| P15-11..14 | **Static guard on real `server.js`**: webhook mount precedes `express.json()`, `sanitizeInput`, `globalRateLimiter` | Ordering enforced | All assertions pass | ✅ PASS |

The test body uses padded whitespace and a non-ASCII value (`café ₹150`) precisely because both are destroyed by a parse/re-serialise round trip — making it a real detector rather than a formality.

**Ordering verified intact after all edits:** webhook mount L295 → `express.json()` L301 → `sanitizeInput` L338 → `globalRateLimiter` L341.

### Phase 16 — Duplicate webhook delivery

| TEST-ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| P16-1 | Same event delivered 4× sequentially | 1 activation | 1 `Payment`, `totalPaid: 150`, redeliveries acknowledged `idempotent` | ✅ PASS |
| P16-2 | Redelivery after activation | No second extension | `subscriptionExpiry` byte-identical, `totalPaid: 150` | ✅ PASS |

### Phase 17 — Concurrent webhook race

| TEST-ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| P17-1 | `Promise.all([evt, evt])` | 1 activation | 1 `Payment`, `totalPaid: 150` | ✅ PASS |
| P17-2 | 5 simultaneous deliveries | 1 activation | 1 `Payment`, `totalPaid: 150`, `active` | ✅ PASS |

### Phase 18 — Verify / webhook race (most important)

| TEST-ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| P18-1 | `POST /verify` **concurrent with** webhook | Exactly 1 activation | 1 `Payment`, `totalPaid: 150`, verify surfaced **no error to the paying user** | ✅ **PASS** |
| P18-2 | Webhook first, then verify | Verify reports idempotent | `idempotent: true`, 1 `Payment`, expiry unchanged | ✅ PASS |
| P18-3 | Verify first, then webhook | Webhook is a no-op | 1 `Payment`, expiry unchanged | ✅ PASS |

### Phase 19 — Out-of-order webhooks

| TEST-ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| P19-1 | `payment.captured` → `order.paid` | 1 activation | 1 `Payment` | ✅ PASS |
| P19-2 | `order.paid` → `payment.captured` | Identical final state | Identical `Payment` count, `totalPaid`, status, expiry | ✅ PASS |
| P19-3 | Both orderings compared directly | Converge | `toEqual` on final state passes | ✅ PASS |
| P19-4 | 4 interleaved duplicates across both types | 1 activation | 1 `Payment`, `totalPaid: 150` | ✅ PASS |

### Phase 20 — Two checkout requests (documented, not blocked)

Per instruction, **no blocking mechanism was introduced.** Behaviour documented:

| TEST-ID | Finding |
|---|---|
| P20-1 | A double-clicked Subscribe creates **two independent Razorpay orders** with distinct ids and distinct receipts. |
| P20-2 | Every concurrent order carries the identical server-derived ₹150 price. |
| P20-3 | Each order is bound to the authenticated user via trusted `notes`. |

**Assessment:**
- Duplicate *orders* are acceptable — an unpaid order costs nothing and expires at Razorpay.
- Duplicate *payments* **are possible** if the user completes both checkouts. Each order can back at most one `Payment` (unique partial index on `razorpayOrderId`), so data integrity holds and both payments stack correctly onto `subscriptionExpiry`. The user is not corrupted — they are simply charged twice for time.
- **A pending-order guard is a product decision, not a correctness fix.** Recommendation: a short-TTL (≈10 min) advisory lock keyed on user id, allowing abandoned-checkout recovery and legitimate retry. Deliberately not implemented here — the instruction was to evaluate, and a careless guard risks blocking valid payments.

### Phase 21 — Renewal and stacking

| TEST-ID | User state | Expected | Actual | Result |
|---|---|---|---|---|
| P21-1 | Free | 90 days from now | ✅ | PASS |
| P21-2 | Active (30 days left) | Stacks on existing expiry | Expiry ≥ existing + 89d | ✅ PASS |
| P21-3 | Expired (60 days ago) | Fresh 90 days from now, not from old expiry | ✅ | PASS |
| P21-4 | In trial (4 days left) | Paid window starts **after** trial ends | Expiry ≥ trialEnd + 89d | ✅ PASS |
| P21-5 | Active sub **and** active trial | Longest live benefit wins | Expiry ≥ subEnd + 89d | ✅ PASS |
| P21-6 | Replayed payment | Idempotent, no revenue | `idempotent: true`, no writes | ✅ PASS |
| P21-7 | Plan label ranking | `yearly` never downgraded by a later `monthly` | ✅ | PASS |

No second entitlement calculation was introduced — all tests drive the existing `activateRazorpaySubscriptionPayment`.

### Phase 22 — Database integrity

| TEST-ID | Assertion | Result |
|---|---|---|
| P22-1 | `Payment` records user, amount 150, INR, `completed`, `razorpay`, transactionId, orderId, paymentId, planType, 90 days | ✅ PASS |
| P22-2 | `transactionId === razorpayPaymentId` so the unique index catches replays | ✅ PASS |
| P22-3 | `User` update = exactly one activation + one `$inc: {totalPaid: 150}` | ✅ PASS |
| P22-4 | `subscriptionDays` snapshotted (survives a later `PLAN_CONFIG` change) | ✅ PASS |
| P22-5 | Payment + user writes share **one** transaction, committed once, never aborted | ✅ PASS |
| P22-6 | Duplicate-key error → abort + idempotent success, **no** user write | ✅ PASS |
| P22-7 | Non-duplicate failure → abort + propagate, no half-applied state | ✅ PASS |
| P22-8 | Non-INR currency refused before any write | ✅ PASS |
| P22-9 | Non-orderable plan refused before any write | ✅ PASS |

`WebhookEvent` fields (`eventId`, `eventType`, `processed`, `processing`, `deliveryAttempts`, `processingAttempts`, `processingError`) are asserted in Phases 16–19 and 24.

### Phase 23 — Refunds

| TEST-ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| P23-1 | Full refund | Status `refunded`, revenue + duration reversed | ✅ (pre-existing test) | PASS |
| P23-2 | Partial refund | `partially_refunded`, revenue only, **entitlement kept** | `refundedAmount: 50`, no `subscriptionExpiry` change | ✅ PASS |
| P23-3 | Partial then balance | Escalates to `refunded`, only the **incremental** 100 reversed | `razorpayRefundIds: [rfnd-partial, rfnd-balance]`, expiry cut once | ✅ PASS |
| P23-4 | Duplicate refund event (same key) | Idempotent | No save, no user write | ✅ (pre-existing test) | PASS |
| P23-5 | Refund > payment amount | Rejected | `PAYMENT_INTEGRITY_CHECK_FAILED`, no writes | ✅ PASS |
| P23-6 | Unknown payment | Rejected | `PAYMENT_NOT_FOUND` | ✅ PASS |
| P23-7 | Zero / negative / non-numeric / missing amount | Rejected before lookup | `RAZORPAY_REFUND_INVALID`, `Payment.findOne` never called | ✅ PASS |
| P23-8 | Missing refund key | Rejected | `RAZORPAY_REFUND_INVALID` | ✅ PASS |
| P23-9 | New refund key on already fully-refunded payment | No double reversal | `refundedAmount` stays 150, no second duration cut | ✅ PASS |
| P23-10 | Revenue floor | Never negative | `$max: [0, ...]` present in pipeline | ✅ PASS |

### Phase 24 — Webhook reconciliation (IMPLEMENTED — was missing)

New: [`backend/jobs/webhookReconciliationCron.js`](../backend/jobs/webhookReconciliationCron.js) + `reprocessStoredWebhookEvent()` in `razorpayWebhookService.js`.

| TEST-ID | Assertion | Result |
|---|---|---|
| P24-1 | Replays a stalled event through the **real** activation path (no second implementation) | ✅ PASS |
| P24-2 | Claims the event **atomically** before any work; filter pins `processed:false`, `permanentlyFailed:{$ne:true}`, `processingAttempts:{$lt:6}` | ✅ PASS |
| P24-3 | Returns `null` without processing when the event cannot be claimed (live delivery or peer holds it) | ✅ PASS |
| P24-4 | Does not re-verify the signature — provenance established at ingest, and re-validated against Razorpay anyway | ✅ PASS |
| P24-5 | Below the cap: records error, stays retryable | ✅ PASS |
| P24-6 | At the cap: `permanentlyFailed: true` + `permanentlyFailedAt` | ✅ PASS |
| P24-7 | Recovered event reports `idempotent` — no double charge | ✅ PASS |
| P24-8 | Sweep only touches events older than 10 min (Razorpay's own retries get first shot) | ✅ PASS |
| P24-9 | Counts recovered / skipped / exhausted correctly | ✅ PASS |
| P24-10 | **Sentry alert on permanent failure** — money possibly taken, not fulfilled | ✅ PASS |
| P24-11 | Empty sweep is a no-op | ✅ PASS |

Uses existing infrastructure: `withCronLock`, `recordCronRun`, `captureOperationalError`. Bounded at 6 attempts. Sequential processing on purpose — parallel retries would hammer the provider and widen lock contention.

### Phase 25 — Webhook retention (IMPLEMENTED — was missing)

New: [`backend/jobs/webhookRetentionCron.js`](../backend/jobs/webhookRetentionCron.js). 90-day default.

| TEST-ID | Assertion | Result |
|---|---|---|
| P25-1 | Prunes only `processed:true`, not `permanentlyFailed`, not already pruned, past the window | ✅ PASS |
| P25-2 | Replaces `payload` with a tombstone + `payloadPrunedAt` | ✅ PASS |
| P25-3 | **Never deletes the event document** — `eventId` idempotency must survive retention | ✅ PASS |
| P25-4 | Does not prune unprocessed events — reconciliation still needs their payload | ✅ PASS |
| P25-5 | Empty window is a no-op | ✅ PASS |

Deleting events would let a replayed webhook re-activate a subscription months later. Only the bulky, PII-bearing payload is dropped.

### Phase 27 — Mobile safety

| Check | State | Result |
|---|---|---|
| `NEXT_PUBLIC_PAYMENTS_ENABLED` | `false` | ✅ unchanged |
| `canShowPurchaseUI()` native guard | present | ✅ unchanged |
| `next.config.ts` → `SmartPaywall.disabled.js` alias | present | ✅ unchanged |
| Razorpay traces in built bundle | 0 | ✅ verified |

**No change was made to any mobile payment path.** Web Test Mode only, as instructed.

---

## 6. Phases NOT EXECUTED

These require infrastructure unavailable to this session. **They are not passes.**

| Phase | Why not executed | What is still needed |
|---|---|---|
| **4** — Test Mode config | No access to the project's Razorpay dashboard | Owner sets the 3 backend + 2 frontend vars |
| **10** — Real test checkout | Needs live test credentials + browser | Full checkout with test card, verified in **both** Razorpay Dashboard and MongoDB |
| **12** — Close checkout / back / tab switch / timeout | Browser-driven | Manual QA |
| **13** — Refresh after payment | Logic proven (webhook activates independently, Phase 18); **browser behaviour not** | Manual QA. ⚠️ Also see §7 — frontend has no "confirming payment" state |
| **14** — Internet failure | Cases A–D proven at the logic layer; real network loss not | Manual QA with devtools throttling |
| **22** — Live DB before/after | Local Mongo is standalone; **transactions unsupported** | Re-run against a replica set |
| **26** — Frontend E2E | No frontend test runner committed (Playwright is a devDependency with no specs) | Playwright specs or manual QA |

---

## 7. Discovered Issues

### 🔴 NEW — MongoDB transactions unavailable on the active database (CONFIRMED)

`activateRazorpaySubscriptionPayment` ([`paymentService.js:328`](../backend/services/paymentService.js)) opens `mongoose.startSession()` and `session.startTransaction()`. **Transactions require a replica set.** This is exactly why the sandbox path carries the comment *"Bypass transactions — standalone MongoDB doesn't support them."*

Confirmed empirically against the active `MONGO_URI` — not a theoretical risk:

```
replicaSet  : NONE (standalone)
TRANSACTION : FAILED -> Transaction numbers are only allowed on a replica set member or mongos
```

**Every real Razorpay payment against this database fails after the money is taken.** See §2.1 for the two resolution paths. Production must also be verified: `db.hello().setName` must be non-null.

### 🟠 NEW — `frontend/config/payments.js` is untracked in git

It is the build-time payment kill switch that `next.config.ts`, `PaywallGate`, `SmartPaywall`, `PageHeader`, `RescueBanner`, `TrialCountdownBanner`, `profile/page.js` and `upload-trade/page.js` all import. A fresh clone does not build. **Not staged by this work — committing is the owner's call.**

### 🟠 Pre-existing — `RAZORPAY_WEBHOOK_SECRET` absent

Every webhook returns 503 `RAZORPAY_WEBHOOK_CONFIG_MISSING`. The async safety net — the thing that saves a payment when the user refreshes or loses connectivity — is entirely dark. Now documented in `.env.example`.

### 🟡 Pre-existing — no post-refresh recovery in the UI

`SmartPaywall`'s `handler` never fires if the tab is closed. The webhook covers it server-side, but the user sees no "confirming your payment" state. `useTrialStatus` polls every 60s so it self-heals — the gap is UX, not correctness.

### 🟡 Pre-existing — `payment.authorized` unhandled

If auto-capture is ever disabled, `/verify` hard-rejects an authorized-but-uncaptured payment with 400 while `payment.captured` fixes it minutes later. Wrong UX for a payment that will succeed. Not a risk under auto-capture.

### 🟡 Pre-existing — price duplicated in 4 places

`PLAN_CONFIG` (authoritative), `trialController.js:66-67`, `trialController.js:158-161`, `SmartPaywall.js:340-347`. Consistent today; display-drift risk only, not exploitable.

---

## 8. Fixes Applied

| # | Fix | Files |
|---|---|---|
| 1 | Sandbox fails closed; requires explicit `ALLOW_SANDBOX_PAYMENTS` **and** non-production env | `config/index.js`, `controllers/paymentController.js` |
| 2 | `payment.failed` recorded without poisoning a later capture | `services/razorpayWebhookService.js` |
| 3 | Webhook reconciliation cron (bounded retry, atomic claim, Sentry alert) | `jobs/webhookReconciliationCron.js`, `services/razorpayWebhookService.js`, `server.js`, `config/index.js` |
| 4 | Webhook payload retention (90d, tombstone, never deletes) | `jobs/webhookRetentionCron.js`, `models/WebhookEvent.js`, `server.js`, `config/index.js` |
| 5 | Reconciliation/retention support fields + indexes | `models/WebhookEvent.js` |
| 6 | Env template documents all payment vars incl. the webhook secret | `.env.example` |
| 7 | Existing sandbox tests updated to the new explicit-opt-in contract | `__tests__/unit/payment.test.js` |

**Untouched, as instructed:** `paymentService.js` (provider re-fetch, transactional activation, HMAC, plan config), `Payment.js` indexes, webhook HMAC + atomic locking, `utils/premium.js`, `adminPaymentController.js` security, and the `server.js` raw-body ordering.

> `git diff --stat` on `server.js` shows ~64 changed lines. Only **5** are from this work (2 requires + 2 calls + a blank line). The rest is pre-existing uncommitted health-endpoint refactoring inherited from `auth-session-p0-testing`.

---

## 9. Secret Protection Verification

| Check | Result |
|---|---|
| `.gitignore` covers `.env`, `.env.*`, `backend/.env*`, `frontend/.env*` | ✅ |
| Tracked env files | Only `.env.example` (placeholders) |
| Real secrets committed | ❌ none |
| Secrets in frontend bundle | ❌ none (grep = 0) |
| Secrets logged | ❌ none — signature verification logs only `error.code`, never the signature or expected value |
| `Payment.razorpaySignature` | `select: false` |
| Webhook secret separate from API key secret | ✅ enforced by documentation and separate env var |
| Frontend-exposed value | Only `NEXT_PUBLIC_RAZORPAY_KEY_ID` (publishable) |

---

## 10. GO / NO-GO

### 🔴 NO-GO for production

Blocking on the Phase 31 criteria:

| Criterion | Status |
|---|---|
| Payment amount integrity | ✅ PASS |
| Signature verification | ✅ PASS |
| Cross-user protection | ✅ PASS |
| Webhook signature | ✅ PASS |
| Webhook idempotency | ✅ PASS |
| Verify/webhook race | ✅ PASS |
| Concurrent webhook | ✅ PASS |
| Subscription activation | ✅ PASS |
| Duplicate payment protection | ✅ PASS |
| Refund integrity | ✅ PASS |
| Database consistency | ⚠️ **UNVERIFIED against a replica set** |
| Sandbox isolation | ✅ PASS |
| Secret protection | ✅ PASS |

Every logic criterion passes. Production is blocked on three items that are **configuration and infrastructure, not code**:

1. 🔴 Confirm production MongoDB is a **replica set** (transactions).
2. 🔴 Set `RAZORPAY_WEBHOOK_SECRET` and register the webhook.
3. 🔴 Execute Phases 10, 12–14, 22, 26 against real Razorpay Test Mode.

### 🔴 BLOCKED for Test Mode

API keys are set and verified, but end-to-end testing cannot start: the active
MongoDB is standalone, so the activation transaction throws after Razorpay
captures the payment (§2.1). Two further gaps — the missing webhook secret and
the lack of a public tunnel — mean webhook delivery would also not reach the
backend.

### Ordered next steps

1. 🔴 **Fix MongoDB transactions** — Atlas URI or single-node replica set (§2.1). Gates everything.
2. 🔴 **Generate `RAZORPAY_WEBHOOK_SECRET`** in the Razorpay dashboard and set it.
3. 🔴 **Expose the backend publicly** (`ngrok http 5000`) and register the webhook against that URL with the five events.
4. 🟠 `git add frontend/config/payments.js` — currently untracked; a fresh clone does not build.
5. 🟡 Execute Phases 10, 12, 13, 14, 22, 26 in the browser; append results to §5.
6. 🟡 Decide on the Phase 20 pending-order guard.
7. Only then consider live keys — and rotate the test secret, which was shared in a screenshot.

---

*All work is on `feature/razorpay-test-hardening`. Nothing was merged to `main`, `master`, `production`, or `staging`. No commits were made — every change is in the working tree for review.*
