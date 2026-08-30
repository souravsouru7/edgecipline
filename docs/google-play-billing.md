# Google Play Billing — setup, operation, and troubleshooting

Android in-app subscriptions for Edgecipline. **Razorpay remains the web
processor and is unchanged**; Google requires that digital goods sold inside an
Android app go through Play Billing, so the two coexist and feed one shared
entitlement.

> **No secrets in this document.** Every credential below is named, never valued.

---

## 1. Architecture

```
WEB                                  ANDROID
Edgecipline Web                      Capacitor Android app
      ↓                                    ↓
  Razorpay                          Google Play Billing (EdgeBillingPlugin)
      ↓                                    ↓
POST /api/payments/verify           purchase token
POST /api/payments/webhook                 ↓
      ↓                             POST /api/payments/google-play/verify
      ↓                                    ↓
      ↓                             Play Developer API (subscriptionsv2.get)
      ↓                                    ↓
      └──────────────► MongoDB ◄───────────┘
                          ↓
              utils/premium.isPremium()
                          ↓
                    PRO entitlement
```

### The one rule everything else follows

`isPremium()` is the single entitlement function and it reads **two independent
fields**:

| Field | Owner | Semantics |
|---|---|---|
| `User.subscriptionStatus` + `subscriptionPlan` + `subscriptionExpiry` | Razorpay / manual / admin | **Prepaid ledger.** Each purchase pushes the expiry out; nothing ever pulls it back. |
| `User.playEntitlementExpiry` | Google Play only | **Renewing agreement.** Google owns the date and moves it in both directions. |

They are separate because merging them would let a Play cancellation eat days a
user already paid Razorpay for. This is also why **no data migration is
needed**: a pre-existing account has no `playEntitlementExpiry`, and `undefined`
is never in the future.

The Play path **never** writes `subscriptionStatus` or `subscriptionExpiry`.
(`hasActiveSubscription()` treats status `active` with a null expiry as
unlimited access — a Play write that touched status would hand out permanent
free premium.)

---

## 2. Play Console setup

### 2.1 Subscription product

**Monetise → Products → Subscriptions → Create subscription**

| Field | Value |
|---|---|
| Product ID | **`edgecipline_pro`** |
| Name | Edgecipline Premium |

The product ID is **permanent** — Play does not allow renaming or reuse after
deletion. It must match `PRODUCT_ID` in
[backend/constants/googlePlay.js](../backend/constants/googlePlay.js).

### 2.2 Base plans

Three auto-renewing base plans mirroring the web catalogue in
`paymentService.PLAN_CONFIG`, so an Android user and a web user buy the same
thing:

| Base plan ID | Billing period | Type | Mirrors web plan | Reference price (INR) | Effective |
|---|---|---|---|---|---|
| `edgecipline-pro-monthly` | `P1M` (1 month) | Auto-renewing | `monthly` | ₹349 | ₹349/mo |
| `edgecipline-pro-3month` | `P3M` (3 months) | Auto-renewing | `3_months` | ₹899 | ₹300/mo · ₹9.99/day |
| `edgecipline-pro-6month` | `P6M` (6 months) | Auto-renewing | `6_months` | ₹1,499 | ₹250/mo · ₹8.33/day |

For each base plan: **Auto-renewing**, grace period **7 days**, account hold
**30 days**, resubscribe **on**.

- **Prices are set in Play Console only.** They are deliberately absent from the
  codebase — the Android client reads the localised, tax-inclusive price straight
  from the Play Billing library, so what the user sees is always what Google
  charges. The INR figures above are for parity reference when you set them.
- **Play's service fee (15–30%) is not accounted for by the reference prices.**
  Matching web pricing exactly means absorbing it: at 15%, ₹899 nets ~₹764.
  That is a pricing decision, not a code change — set whatever you want in
  Console and the app follows.
- **Changing a price after launch is not the same as setting it.** Google
  requires an explicit price-change flow: existing subscribers stay on their
  old price unless you opt them in, and an opt-in increase triggers a mandatory
  notice period and, in some regions, a re-consent prompt. Nothing in this
  codebase is affected — the client always renders whatever Play reports for
  that user — but the migration has to be driven from Play Console.
- **Offers are not required.** The paywall filters out any offer carrying an
  `offerId` and shows base plans only, so adding a promotional offer later will
  not double-list a tier. Introductory pricing is displayed correctly (the last
  pricing phase is the recurring price).

Base plan IDs must match `BASE_PLANS` in
[backend/constants/googlePlay.js](../backend/constants/googlePlay.js) and
`BASE_PLAN_ORDER` in
[frontend/components/PlayBillingPaywall.js](../frontend/components/PlayBillingPaywall.js).

### 2.3 Activate

Base plans ship as **inactive**. Activate each one, or `getProducts()` returns
an empty list and the paywall renders "No subscription options are available".

---

## 3. Google Cloud setup

### 3.1 Service account for the Developer API

1. **Google Cloud Console → IAM & Admin → Service Accounts → Create.**
   Name it something like `play-developer-api`.
2. Create a **JSON key**. Copy `client_email` and `private_key` out of it into
   the env vars below, then **delete the JSON file**. It must never be committed,
   baked into an image, or placed on an app server's disk — `.gitignore` already
   blocks `backend/config/*.json` and `backend/*firebase-adminsdk*.json`, but the
   only safe copy is no copy.
3. **Play Console → Users and permissions → Invite new users.** Invite the
   service-account email and grant, for the Edgecipline app:
   - View financial data, orders, and cancellation survey responses
   - Manage orders and subscriptions

Permissions can take up to 24 hours to propagate. Until they do, the API
returns 401/403 and the backend surfaces `GOOGLE_PLAY_AUTH_FAILED` (a 502, so it
pages you rather than denying a paying user).

### 3.2 Real-time developer notifications

1. **Cloud Console → Pub/Sub → Create topic**, e.g. `play-rtdn`.
2. Grant `google-play-developer-notifications@system.gserviceaccount.com` the
   **Pub/Sub Publisher** role on that topic. Play Console rejects the topic
   without this.
3. **Create a push subscription** on the topic:
   - Delivery type: **Push**
   - Endpoint: `https://<your-api-host>/api/webhooks/google-play`
   - **Enable authentication**, and select a service account. Google signs each
     push with an OIDC token from this identity — it is the *only* thing
     authenticating the webhook.
   - Audience: the same endpoint URL.
4. **Play Console → Monetise → Monetisation setup → Real-time developer
   notifications**: paste the topic name, then **Send test notification**.

---

## 4. Backend environment variables

All backend-only. **Never** `NEXT_PUBLIC_*`, never in the APK/AAB, never in git.

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_PLAY_BILLING_ENABLED` | yes | Master switch. `false` ⇒ the endpoints 503 and grant nothing. |
| `GOOGLE_PLAY_PACKAGE_NAME` | yes | Must equal the APK `applicationId` (`com.edgecipline`). |
| `GOOGLE_PLAY_CLIENT_EMAIL` | yes | Service-account email from §3.1. |
| `GOOGLE_PLAY_PRIVATE_KEY` | yes | Service-account private key, `\n`-escaped on one line (same form as `FIREBASE_PRIVATE_KEY`). |
| `GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT` | for RTDN | Identity on the Pub/Sub push subscription. |
| `GOOGLE_PLAY_RTDN_AUDIENCE` | for RTDN | The exact push endpoint URL. |
| `GOOGLE_PLAY_ACCOUNT_SALT` | recommended | HMAC key binding a purchase to an account. Falls back to `ADMIN_JWT_SECRET`. **Append-only — see §6.** |
| `GOOGLE_PLAY_API_TIMEOUT_MS` | no | Default 15000. |

Missing credentials **fail closed**: `assertGooglePlayConfig()` throws
`GOOGLE_PLAY_CONFIG_MISSING`, the endpoint returns 503, and no entitlement is
granted. There is no code path where an absent credential is treated as a
successful verification.

## 5. Frontend build flags

| Build | `NEXT_PUBLIC_PAYMENTS_ENABLED` | `NEXT_PUBLIC_PLAY_BILLING_ENABLED` |
|---|---|---|
| Web | `true` | `false` |
| **Android** | **`false`** | **`true`** |
| iOS | `false` | `false` |

Never set both `true` in one build. Next inlines `NEXT_PUBLIC_*` at compile
time, so each flag makes the other paywall **statically dead code that the
bundler drops**. An Android build with `PAYMENTS_ENABLED=true` would ship a
Razorpay checkout inside the AAB — a Play Payments violation even if it is never
displayed.

Verify before uploading an AAB:

```bash
cd frontend && NEXT_PUBLIC_PAYMENTS_ENABLED=false NEXT_PUBLIC_PLAY_BILLING_ENABLED=true npm run build:mobile
grep -ri "razorpay" out/_next/static/ | head    # must return nothing
```

---

## 6. Account association

The attack: user A buys → signs out → user B signs in on the same device → B's
app finds A's purchase in Play and presents it.

**The binding.** `GET /api/payments/google-play/config` returns an
`obfuscatedAccountId` = `HMAC-SHA256(userId, salt)`. The Android client passes it
into the Play billing flow; the Developer API echoes it back on every read. It is
not PII (Google's docs require that) and it discloses nothing about the account.

**The rules**, in `resolvePurchaseOwner()`:

| Situation | Outcome |
|---|---|
| Token already bound to this user | ✅ re-verify, refresh state |
| Token already bound to a **different** user | ❌ `PLAY_PURCHASE_ALREADY_CLAIMED` (409). Never transferred. |
| Token bound to **nobody** (owner deleted their account) | ❌ `PLAY_PURCHASE_DETACHED` (409). Spent forever. |
| New token, echoed id **matches** | ✅ bind |
| New token, echoed id **mismatches** | ❌ `PLAY_PURCHASE_ACCOUNT_MISMATCH` (409) |
| New token, **no** echoed id | ✅ bind + log (pre-dates the feature; the token still came from Play on a device this user is signed into, and refusing would strand a real subscriber) |
| RTDN for an unknown token | recorded, left unbound — the next restore binds it |

Once bound, the unique index on `PlaySubscription.purchaseToken` is the real
guarantee; the HMAC only guards the first binding.

**Account deletion detaches, never deletes.** `detachPlaySubscriptions()` nulls
the user and keeps the row, because the row is what keeps the token spent.
Deleting it would let someone delete their account, sign up again, hit "Restore
purchases", and reclaim the subscription.

**Rotating `GOOGLE_PLAY_ACCOUNT_SALT`** invalidates the binding check for
purchases not yet in the database. Already-bound tokens keep working. Treat it as
append-only key material.

---

## 7. Subscription lifecycle

Google's state → Edgecipline entitlement
([constants/googlePlay.js](../backend/constants/googlePlay.js)):

| Play state | Internal | PRO? | Why |
|---|---|---|---|
| `ACTIVE` | `active` | ✅ | Paid and renewing |
| `CANCELED` | `cancelled` | ✅ **until expiry** | Auto-renew off, but the remaining period is already paid for |
| `IN_GRACE_PERIOD` | `grace_period` | ✅ | Google is retrying payment; locking a paying customer out over an expired card is the failure this prevents |
| `ON_HOLD` | `on_hold` | ❌ | Grace elapsed without payment |
| `PAUSED` | `paused` | ❌ | User-initiated, no charge |
| `PENDING` | `pending` | ❌ | Google has **not** taken the money |
| `EXPIRED` | `expired` | ❌ | Over |
| revoked / voided | `revoked` | ❌ | Refund or chargeback, immediately |
| unknown / `UNSPECIFIED` | `pending` | ❌ | Fails closed |

Both the state **and** a future expiry must hold — a stale `ACTIVE` snapshot
whose expiry has passed grants nothing, and `ON_HOLD` grants nothing even when
Play still reports a future expiry.

**Every RTDN is handled identically**: re-read the authoritative state from the
Play API and recompute. Branching per notification type is how these
integrations end up handling most cases and silently mishandling the rest.

**Out-of-order protection.** `PlaySubscription.lastSyncedAt` is stamped when the
Play response *lands*, and every write is conditional on it not going backwards
— so the last write is the freshest fetch, not merely the latest arrival.

---

## 8. Acknowledgement

Google **auto-refunds and revokes** any subscription purchase left
unacknowledged for **three days**.

- Acknowledged **server-side only**, after verification. A client-side
  acknowledge would confirm a purchase nobody validated, and a patched APK could
  acknowledge anything.
- Never acknowledges a non-entitling purchase (that would confirm a transaction
  Google has not completed).
- Idempotent — Google's "already acknowledged" 400 is treated as success, which
  is routine when a verify request races the `SUBSCRIPTION_PURCHASED` RTDN.
- A failure does **not** fail the request: the user has paid and Google
  confirmed it, so entitlement is granted, the error is recorded on the row, and
  the `play_unacknowledged` partial index exists to find it.

Find at-risk purchases:

```js
db.playsubscriptions.find({ acknowledged: false, createdAt: { $lt: new Date(Date.now() - 864e5) } })
```

---

## 9. Restore purchases

Runs automatically on **launch and every resume** (`PlayBillingBootstrap` →
`usePlayBillingReconcile`, 60s cooldown), and manually from the paywall button.

The client sends whatever Play's `queryPurchases` returned; **each token is
re-verified server-side from scratch**. A locally cached purchase grants
nothing. Results are per-token so one conflicting purchase does not fail the
batch, and only a 16-char irreversible fingerprint is returned — never a token.

This is what recovers: a dropped network after payment, the app killed
mid-purchase, a backend blip, a reinstall, a new phone, cleared app data, and
signing back in.

---

## 10. Android build

```bash
cd frontend
NEXT_PUBLIC_PAYMENTS_ENABLED=false NEXT_PUBLIC_PLAY_BILLING_ENABLED=true npm run android:build
```

- Play Billing Library is pinned by `playBillingVersion` in
  [frontend/android/variables.gradle](../frontend/android/variables.gradle)
  (currently `7.1.1`). **Play enforces a minimum version for new uploads and
  raises it roughly annually — check the current floor in Play Console before
  each release rather than assuming the pin still qualifies.**
- `EdgeBillingPlugin` is registered in `MainActivity.onCreate()`.
- `com.android.vending.BILLING` is declared in the manifest.
- The billing library ships its own ProGuard rules, so `minifyEnabled true`
  needs no additions.

---

## 11. Testing

**Never use production payments during development.**

1. **Licence testers** — Play Console → Setup → Licence testing. Add the tester
   Google accounts; their purchases are real flows with no charge and renew on
   an accelerated schedule (a monthly plan renews every ~5 minutes).
2. **Internal testing track** — upload the AAB, add the same accounts as
   testers, and install *via the opt-in link*. Play Billing does not work on a
   sideloaded APK: the app must be installed by the Play Store.
3. **Backend** — point at staging with `GOOGLE_PLAY_BILLING_ENABLED=true` and
   the service account configured. Test purchases arrive with `testPurchase:
   true` on the `PlaySubscription` row, so they never look like revenue.

Automated coverage:

```bash
cd backend && npx jest googlePlay     # 81 tests
```

- `googlePlayEntitlement.test.js` — the state machine, the allowlist, and proof
  that Razorpay behaviour is unchanged
- `googlePlaySecurityMatrix.test.js` — forged product IDs, tampered expiry,
  account-transfer attempts, replay, out-of-order writes, restore
- `googlePlayNotifications.test.js` — OIDC forgery, wrong principal, duplicate
  delivery, lock release on failure

Manual matrix worth walking before release: monthly/3-month/6-month purchase,
cancel, restore, reinstall, log out → log in as another account (must refuse),
airplane mode mid-purchase, and Play Console's "Send test notification".

---

## 12. Monitoring

Structured log events, all safe to ship to Sentry:

`PLAY_VERIFICATION_STARTED` · `PLAY_VERIFICATION_SUCCEEDED` ·
`PLAY_PRODUCT_NOT_ALLOWED` · `PLAY_PURCHASE_OWNERSHIP_CONFLICT` ·
`PLAY_PURCHASE_ACCOUNT_MISMATCH` · `PLAY_ACKNOWLEDGEMENT_OK` ·
`PLAY_ACKNOWLEDGEMENT_FAILED` · `PLAY_SYNC_SKIPPED_STALE` ·
`PLAY_RTDN_RECEIVED` · `PLAY_RTDN_PROCESSED` · `PLAY_RTDN_DUPLICATE_IGNORED` ·
`PLAY_RTDN_UNAUTHORIZED` · `PLAY_RTDN_WRONG_PRINCIPAL`

**Never logged:** purchase tokens, the service-account private key, the
obfuscated account id. Logs carry `purchaseRef` — a 16-char truncated SHA-256 of
the token — which correlates a purchase across verify → acknowledge → RTDN
without being reversible.

Alert on: `PLAY_ACKNOWLEDGEMENT_FAILED` (3-day refund clock),
`PLAY_RTDN_WRONG_PRINCIPAL` (someone is probing the webhook), and
`GOOGLE_PLAY_AUTH_FAILED` (service-account permissions lost — every purchase is
failing verification).

---

## 13. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Paywall: "No subscription options are available" | Base plans inactive, or IDs differ from `BASE_PLANS` | Activate in Console; check the IDs match exactly |
| Paywall: "Google Play billing isn't available" | Sideloaded APK, Play Store missing/updating, or emulator without Play Services | Install via the internal-testing opt-in link |
| `GOOGLE_PLAY_AUTH_FAILED` (502) | Service account lacks Play Console permission, or permissions not yet propagated | Re-check §3.1; wait up to 24h |
| `GOOGLE_PLAY_PURCHASE_NOT_FOUND` (400) | Token from another app/product, or long expired | Confirm `GOOGLE_PLAY_PACKAGE_NAME` matches the APK |
| `PLAY_PRODUCT_NOT_ALLOWED` | Console product ID ≠ `PRODUCT_ID` | Align them; the Console ID cannot be renamed |
| `PLAY_PURCHASE_ALREADY_CLAIMED` (409) | Purchase belongs to another Edgecipline account | Working as designed — sign in with that account |
| RTDN 401s | Push subscription auth off, or `RTDN_AUDIENCE` ≠ endpoint URL | Re-check §3.2 |
| No RTDNs at all | `google-play-developer-notifications@system.gserviceaccount.com` lacks Publisher on the topic | Grant it, re-send a test notification |
| User paid but is still free | Verify call never landed | Reopen the app — reconcile-on-resume restores it. Check `PLAY_VERIFICATION_SUCCEEDED` for their `purchaseRef`. |
| Android subscriber shows "Active until —" | A caller reading `subscriptionExpiry` instead of `getEffectiveExpiry()` | Use `getEffectiveExpiry()` |

---

## 14. Rollback

The integration is **entirely additive** — no existing column changed meaning,
no data migrated.

1. **Disable** — set `GOOGLE_PLAY_BILLING_ENABLED=false`. Endpoints 503,
   RTDNs stop being processed, `PlaySubscription` rows are untouched. Users with
   a live `playEntitlementExpiry` **keep** PRO until it lapses; Razorpay is
   entirely unaffected.
2. **Revert the app** — rebuild with `NEXT_PUBLIC_PLAY_BILLING_ENABLED=false`
   and roll back the release track. Existing subscriptions keep renewing at
   Google and keep being honoured, because RTDNs are what maintain them.
3. **Revert the code** — `git revert` the branch. Every schema change is
   additive (`playEntitlementExpiry`, the `PlaySubscription` collection, two
   enum values), so nothing needs undoing in MongoDB. Leaving the collection in
   place preserves the purchase-token uniqueness guarantee.

**Do not drop `PlaySubscription`.** Its rows are the record of which purchase
tokens are spent; losing them would let old tokens be re-bound to new accounts
if billing is ever re-enabled.
