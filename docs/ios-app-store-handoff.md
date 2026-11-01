# iOS / App Store launch — handoff

> **🟢 START HERE (for the next Claude session)**
> 1. Read this whole file. The current state and the to-do list are under **"▶ WHAT IS LEFT"** in §3.3.
> 2. The code lives on branch **`feat/ios-app-store-launch`** (pushed). This file may have newer, uncommitted edits on the owner's Mac.
> 3. Business setup is done: Paid Apps Agreement, bank and tax are all Active.
>    - **Next for the owner:** sandbox tester → note the app's Apple ID → enable Apple in Firebase → server env + deploy → store listing → demo account.
>    - **Next in code:** subscription review screenshots, Apple token revoke on deletion, TestFlight upload, test, submit.
> 4. Ask the owner which item they want to do first, then guide them.
> 5. **How to work with the owner:**
>    - They're not technical. Use very simple English, one screen at a time.
>    - They send screenshots; say exactly which button to click.
>    - Never ask for or print keys, passwords or `.p8` contents.
>    - Don't commit or push without their OK.

_Last updated: 2026-11-01. Branch: `staging`. **Nothing below is committed yet.** Base commit: `19b3db0`._

This file is the full context for continuing the iOS launch, in a new session or by another person. Read it top to bottom before changing anything.

---

## 1. Goal

Ship Edgecipline (Next.js static export inside Capacitor 6) to the **Apple App Store**, with **Apple In-App Purchase** for Pro from v1.0. The Android app is already live on Play Store.

Decisions already made by the owner:
- **Pay with Apple IAP in v1.0** (not "free first").
- **3 plans, same as Android and web:**
  - `com.edgecipline.pro.monthly`
  - `com.edgecipline.pro.3month`
  - `com.edgecipline.pro.6month`
  - All three sit in the subscription group **"Edgecipline Pro"**. These IDs are permanent once created in App Store Connect.
- **The iOS app talks to the real backend:** `https://api.edgecipline.com`.

---

## 2. Status at a glance

| Area | Status |
|---|---|
| Mac toolchain (Xcode 27.2, Homebrew, CocoaPods 1.17) | ✅ Done |
| App builds and runs in Simulator against production API | ✅ Done |
| iOS 27 scene life cycle (app used to crash on launch) | ✅ Fixed |
| Login screen hanging on iOS | ✅ Fixed |
| Real `GoogleService-Info.plist` + Google Sign-In URL scheme | ✅ Done |
| Sign in with Apple entitlement | ✅ Added (testing it in the Simulator failed, see §6) |
| Push notifications (APNs → FCM token) | ✅ Code done. ⏳ Needs APNs key in Firebase |
| Apple IAP backend (verify / restore / webhooks) | ✅ Done + 18 tests |
| Apple IAP iOS native plugin (StoreKit 2) | ✅ Done, builds |
| iPhone paywall + settings + delete-account UI | ✅ Done |
| Build guards (iOS = Apple IAP only; Android has no StoreKit) | ✅ Done |
| End-to-end test purchase | ❌ Not done |
| App Store Connect / Apple Developer setup | 🟡 Mostly done (2026-10-31), see below |
| iPhone-only vs iPad decision | ✅ iPhone only (`TARGETED_DEVICE_FAMILY = 1`, iPad orientations removed) |
| Apple token revoke on account deletion (5.1.1(v)) | ❌ Not done |
| Commit | ✅ Pushed to `feat/ios-app-store-launch` (no PR yet) |

---

## 3. What is left — in order

### 3.1 Commit the work (do first)
Review the diff, then commit on a branch off `staging`. See §7 for the file list.
- **Do not commit** `frontend/android/gradle/wrapper/gradle-wrapper.properties`. That change predates this work and is unrelated.
- `frontend/ios/App/App/GoogleService-Info.plist` is not gitignored. It's client config, not a secret. The owner decides whether to commit it.
- `frontend/.env.production.local` is gitignored and must stay that way.

### 3.2 iPad decision — DONE
The owner chose **iPhone only**. `TARGETED_DEVICE_FAMILY = 1` in Debug and Release, and `UISupportedInterfaceOrientations~ipad` was removed from `Info.plist`. No iPad screenshots are needed. (iPhone apps still run in compatibility mode on iPad, which App Review may check.)

### 3.3 Owner: Apple Developer + App Store Connect

**Progress as of 2026-10-31:**
- ✅ App ID capabilities on (Push, Sign in with Apple as primary, In-App Purchase). No APNs SSL certs; the .p8 key is used instead.
- ✅ APNs key created and uploaded to Firebase Cloud Messaging.
- ✅ In-App Purchase key created. The owner holds the Key ID, Issuer ID and .p8 file privately.
- ✅ App created in App Store Connect ("Edgecipline", SKU `edgecipline-ios`, company "Edgecipline Private Limited").
- ✅ Subscription group "Edgecipline Pro" with the group display name set. Levels: 1 = `com.edgecipline.pro.6month`, 2 = `.3month`, 3 = `.monthly`.
  - Each has prices, availability and an English display name and description.
  - A stray product `om.edgecipline.pro.6month` (typo) was deleted.
  - Still missing: a **review screenshot** for each subscription.
- ✅ App Store Server Notifications (Production + Sandbox) = `https://api.edgecipline.com/api/webhooks/app-store`
- ✅ Updated Developer Program License accepted. Paid Apps Agreement signed, status **Pending User Info**.

**Progress as of 2026-11-01:**
- ✅ Bank account added: Canara Bank, INR, "Checking" (= current account). Status **Processing** at Apple.
- 🟡 Tax forms. The US questionnaire was answered "No" to US business activities. Business → Tax Forms now lists two rows, both **Missing Tax Info**:
  1. "U.S. Substitute Form W-8BEN-E": **the one to complete** (company form).
     - Part I: name, country India and **Corporation** are prefilled.
     - **8. U.S. TIN:** leave empty.
     - **9b. Foreign TIN:** company PAN.
     - **10. Reference:** leave empty.
     - **Part III (treaty):** tick "resident of India". The limitation-on-benefits, treaty article and rate answers are **waiting on the owner's CA**. Leaving Part III empty means 30% withholding on US sales only, and the form can be edited later.
     - **Chapter 4 / FATCA:** likely "Active NFFE" (confirm with the CA).
     - Sign as Director, then Submit.
  2. "U.S. Certificate of Foreign Status of Beneficial Owner": probably a duplicate, or the individual W-8BEN. Delete it via "⋯" if possible; otherwise check whether it says "(Individuals)".
  - The owner is a new company with no GST yet. That's fine: only the company PAN is needed, and Apple handles GST on Indian sales.
- ⏳ **Next for the owner, in order:**
  1. Finish W-8BEN-E (after asking the CA about Part III and FATCA), then remove the extra tax-form row.
  2. Wait for the Paid Apps Agreement to become **Active** (1–2 days after bank and tax).
  3. Create the sandbox tester: Users and Access → Sandbox → Test Accounts → ➕. Use an email never used as an Apple ID (for example `name+sandbox1@gmail.com`), country India.
  4. Note the app's Apple ID number (App Information page, or the number in the URL `/apps/<id>/...`) for `APPLE_APP_APPLE_ID`.
  5. EU DSA trader info (red box on Business) is optional. Skipping it only blocks EU storefronts, and the details become public in the EU.

**Progress as of 2026-11-01 (later the same day) — business setup COMPLETE:**
- ✅ **Paid Apps Agreement: Active.** ✅ Bank (Canara, INR): Active.
- ✅ Tax: "U.S. Substitute Form W-8BEN-E" is **Active**.
  - Corporation, company PAN in 9b, no US TIN.
  - Part III: resident of India; LOB "Company that meets the ownership and base erosion test"; Article **12(2)** at **15%**; "Income from the sale of applications".
  - The owner was told to confirm Part III with their CA. It can be edited later.
- ✅ Tax: the "U.S. Certificate of Foreign Status of Beneficial Owner" (Apple's no-US-business declaration) was submitted as Corporation, signed by Sourav R, Director. The "tax forms needed" banner is gone.
- Only the red EU DSA banner remains. It's optional.

**Progress as of 2026-11-01 (evening):**
- ✅ Sandbox tester created (Test User, India).
- ✅ App Apple ID noted by the owner. ✅ Apple sign-in enabled in Firebase.
- ✅ The iOS work was fast-forwarded into **`staging`** (commit `210905e`). This includes a merge with the team's settings redesign; in `app/settings/page.js` the App Store "Manage subscription" and "Change plan" actions were re-added to the new `st-*` layout.
- ✅ **Production server updated by hand** from `staging`, with the Apple env vars set.
  - Verified: `GET /api/payments/app-store/config` returns 401 (route live).
  - Verified: `POST /api/webhooks/app-store` with a fake payload returns 400 `APP_STORE_ENVIRONMENT_REJECTED` (enabled, rejecting forgeries).
  - Key ID, Issuer ID and private key correctness are unverified until the first sandbox purchase.
- ⚠️ The server runs `staging`, but CI deploys `main` (`git reset --hard origin/main`). Any merge to `main` before `staging` is merged into it will drop the iOS code from production.
- ⚠️ Merging `staging` into `main` will be blocked by 7 test files that already fail: 5 trade-quota/free-tier, plus integration `couponReservation` and `mission`.

## ▶ WHAT IS LEFT (as of 2026-11-01)

**Owner (no code):**
1. **Sandbox tester:** Users and Access → Sandbox → Test Accounts → ➕. Use an email never used as an Apple ID, country India.
2. **The app's Apple ID number:** App Information page, or the number in the URL `/apps/<id>/`. It's needed for `APPLE_APP_APPLE_ID`.
3. **Firebase → Authentication → Sign-in method → enable Apple.** Not confirmed done yet.
4. **Server env + deploy** (production backend), see §3.4:
   - `APPLE_IAP_ENABLED=true`
   - `APPLE_APP_APPLE_ID`
   - `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY` (the In-App Purchase key the owner already holds)
   - `APPLE_IAP_ACCOUNT_SALT` (random, never change it)
   - `APPLE_IAP_ALLOW_SANDBOX=true`
   - The backend must be deployed from branch `feat/ios-app-store-launch`, or after it's merged into staging and then production.
5. **Store listing** in App Store Connect → app → iOS App 1.0:
   - subtitle, description, keywords, category (Finance or Productivity)
   - support URL, privacy policy URL (`https://edgecipline.com/privacy-policy`)
   - age rating questionnaire
   - **App Privacy** questionnaire matching `PrivacyInfo.xcprivacy`
   - iPhone 6.9" screenshots
6. **A demo account for App Review**, already email-verified (reviewers can't get the OTP). The credentials go in App Review Information.
7. **Optional:** EU DSA trader info.

**Claude / developer (code and build):**
8. **A review screenshot for each of the 3 subscriptions** (paywall on iPhone). The paywall only lists plans when the backend `/api/payments/app-store/config` returns `available: true`, so take it after step 4, or temporarily against a local backend.
9. **Apple token revocation on account deletion (Guideline 5.1.1(v)).** This needs the Apple provider in Firebase configured with a Sign in with Apple key, then a revoke call in the delete-account flow.
10. **Archive and upload to TestFlight:**
    - Xcode → Any iOS Device → Product → Archive → Distribute → App Store Connect.
    - The owner's Apple ID must be signed into Xcode → Settings → Accounts.
    - Raise `CURRENT_PROJECT_VERSION` for each upload.
11. **TestFlight tests on a real iPhone:**
    - sandbox purchase of all 3 plans; restore; plan switch
    - cancel/refund webhook
    - push notification
    - Sign in with Apple and Google
    - camera/photo upload
    - account deletion
12. **Submit:** attach the build and the 3 subscriptions to version 1.0 → Add for Review. Apple review takes 1–3 days.

**Rough time to submit:** about 2–4 working days if steps 1–6 are done promptly.

**How the owner likes to be guided (the user, not technical):** very simple English, one screen at a time, reacting to the screenshots they send. Tell them exactly which button to click. Never ask for keys or IDs in chat.

Original checklist:
1. **developer.apple.com → Identifiers → `com.edgecipline`:** enable Push Notifications, Sign in with Apple and In-App Purchase.
2. **Keys:**
   - APNs key (.p8): upload to Firebase → Project settings → Cloud Messaging → Apple app configuration.
   - In-App Purchase key (.p8): App Store Connect → Users and Access → Integrations → In-App Purchase. This one goes to the backend env (§3.4).
3. **App Store Connect → Agreements, Tax and Banking:** sign the **Paid Apps** agreement and add bank and tax details. IAP won't work without this.
4. **My Apps → New App:** bundle ID `com.edgecipline`. Note the numeric **Apple ID**; it becomes `APPLE_APP_APPLE_ID`.
5. **Subscriptions:** create group "Edgecipline Pro" with the 3 product IDs above. Each needs prices, a display name, a description and a review screenshot.
6. **App Information → App Store Server Notifications (V2):** set both Production and Sandbox to
   `https://api.edgecipline.com/api/webhooks/app-store`
   ⚠️ This is **not** `/api/payments/app-store/notifications`. The Razorpay mount owns the `/api/payments/webhook` prefix, so the Apple webhook sits next to the Play one under `/api/webhooks/`.
7. **Users and Access → Sandbox:** create a sandbox tester account.
8. **Firebase → Authentication → Sign-in method:** enable **Apple**.

### 3.4 Backend env (production server)
The names are documented in the root `.env.example` under "Apple In-App Purchase". Never commit the values.
```
APPLE_IAP_ENABLED=true                 # off by default → endpoints return 503
APPLE_BUNDLE_ID=com.edgecipline
APPLE_APP_APPLE_ID=<numeric id from ASC>
APPLE_IAP_ISSUER_ID=...                # optional but recommended
APPLE_IAP_KEY_ID=...
APPLE_IAP_PRIVATE_KEY=...              # the .p8 contents
APPLE_IAP_ALLOW_SANDBOX=true           # keep true: App Review + TestFlight buy in Sandbox
APPLE_IAP_ALLOW_XCODE=false            # never true in production (ignored there anyway)
APPLE_IAP_ACCOUNT_SALT=<random>        # APPEND-ONLY once set; falls back to JWT admin secret
```
Then deploy the backend. `@apple/app-store-server-library@3.1.0` was added to `backend/package.json`, and the Apple root cert lives in `backend/certs/apple/`.

### 3.5 End-to-end purchase test
- **Option A (simplest): TestFlight + sandbox tester on a real iPhone.** Needs everything in 3.3–3.4 done.
- **Option B (local, before ASC is ready):**
  - Run the backend locally with `APPLE_IAP_ENABLED=true` and `APPLE_IAP_ALLOW_XCODE=true` (non-production `NODE_ENV`).
  - Point a dev build of the app at it.
  - Press ▶ in Xcode. The shared scheme uses `App/Edgecipline.storekit`, which has sample prices of ₹299, ₹799 and ₹1,499.
  - Note: `npm run build:mobile:ios` is a production build and refuses non-HTTPS or local API URLs (`config/environment.js`), so Option B needs a dev-mode setup.

**Check all of these:**
- Purchase → Pro unlocks.
- Restore works after reinstalling.
- Switching plans works.
- Cancel or refund webhook removes Pro.
- Settings shows "Renews on…" and Manage subscription.
- Delete-account warning appears for a live Apple subscription.

### 3.6 Remaining code items
1. **Apple token revocation on account deletion (Guideline 5.1.1(v)).** Not implemented. `backend/services/accountDeletionService.js` deletes the Firebase user but doesn't revoke the Sign in with Apple token. It needs a Sign in with Apple key configured in Firebase's Apple provider, then a revoke via Firebase (`revokeAccessToken` with an authorization code) or Apple REST `auth/revoke`.
2. **Push delivery test** on a real device after the APNs key is uploaded. The code path: `AppDelegate.didRegisterForRemoteNotificationsWithDeviceToken` → `Messaging.messaging().apnsToken` → FCM token → Capacitor `registration` event → `services/pushNotifications.js` registers it with `platform: "ios"`.
3. **Optional:** `features/premium/utils/subscriptionCard.mjs` `describePlayLifecycle` only produces notices for Play (grace or on-hold). An App Store equivalent would be nice to have.

### 3.7 App Store listing and review (owner)
- Screenshots: iPhone 6.9" (1320×2868), 3–10 images. Simulator screenshots are fine.
- Description, keywords, category (Finance or Productivity), age rating.
- **App Privacy** questionnaire must match `PrivacyInfo.xcprivacy`: email, name, photos, other user content, **purchase history**, crash and performance data; no tracking.
- **Review notes:**
  - An already-verified **demo account**, because reviewers can't receive the OTP email.
  - Say that Edgecipline is a trading **journal**, not a broker, and gives no financial advice.
  - Explain how to test Pro with Sandbox.

### 3.8 Build, upload, submit
```
cd frontend && npm run ios:sync      # build:mobile:ios + cap sync ios (runs pod install)
open ios/App/App.xcworkspace         # ALWAYS the .xcworkspace, never .xcodeproj
```
In Xcode:
1. Select **Any iOS Device (arm64)**.
2. Product → Archive → Distribute → App Store Connect.
3. Test on TestFlight.
4. Attach the build and the 3 subscriptions to version 1.0 → Submit.
5. Raise `CURRENT_PROJECT_VERSION` for every upload.

---

## 4. Architecture of what was built

### Apple IAP: same design as Google Play Billing (`docs/google-play-billing.md`)
- **Entitlement field:** `User.appStoreEntitlementExpiry`, written only by `appStoreBillingService`. It never touches the Razorpay fields (`subscriptionStatus` / `subscriptionExpiry`).
- **`utils/premium.js`:** `isPremium()` = Razorpay **or** Play **or** App Store **or** trial. `getBillingProvider()` returns `razorpay` | `google_play` | `app_store`, whichever runs longest. The tie-break and old Razorpay-vs-Play behaviour are unchanged.
- **One `AppStoreSubscription` row per Apple subscription chain**, keyed on `originalTransactionId`.
  - A chain binds to one user permanently.
  - On account deletion the row is **detached** (`user: null, detachedAt`), never deleted, so the purchase can't be restored onto a new account.
- **Account binding:** `utils/appStoreAccountIdentity.js` makes a deterministic UUID (`appAccountToken`) per user, HMAC'd with a salt.
  - The app passes it to StoreKit, and Apple signs it into every transaction.
  - The backend refuses transactions that carry another user's token.
- **Verification:** `SignedDataVerifier` checks the chain up to Apple Root CA G3, the bundle ID and the environment.
  - Xcode/LocalTesting environments are **never** accepted in production, because those transactions aren't Apple-signed.
  - Sandbox is accepted, because App Review needs it.
  - If the Server API key is set, `getAllSubscriptionStatuses` gives the authoritative status (grace, billing retry, revoked, auto-renew).
- **Webhook:** every App Store Server Notification V2 re-syncs the chain the same way.
  - A notification that arrives before `/verify` creates an unbound row, and `/verify` binds it later.

### Endpoints
| Method | Path | Auth |
|---|---|---|
| GET | `/api/payments/app-store/config` → productIds + appAccountToken | user |
| GET | `/api/payments/app-store/subscription` | user |
| POST | `/api/payments/app-store/verify` `{ signedTransaction }` | user |
| POST | `/api/payments/app-store/restore` `{ signedTransactions: [] }` | user |
| POST | `/api/webhooks/app-store` `{ signedPayload }` (raw body) | Apple signature |

### iOS side
- **`EdgeStoreKitPlugin.swift`** (StoreKit 2). JS name `EdgeStoreKit`, registered in `MainViewController.capacitorDidLoad()`.
  - Methods: `isAvailable`, `getProducts`, `purchase`, `finishTransaction`, `getCurrentEntitlements`, `restore`, `manageSubscriptions`.
  - Event: `transactionUpdated`.
  - **A transaction is finished only after the backend confirms it**, so StoreKit redelivers anything unfinished.
- **`plugins/EdgeStoreKitPlugin.js`:** JS wrapper; a no-op fallback off iOS.
- **`components/AppStorePaywall.js`:** the iPhone paywall, with the Guideline 3.1.2 items:
  - price and period
  - auto-renew text
  - Restore Purchases
  - Manage subscription link
  - Terms (`/terms`) and Privacy (`/privacy-policy`) links
- **`components/AppStorePaywall.disabled.js`:** a stub aliased in when the flag is off.

### Build flags (`config/payments.js`, `next.config.ts`, `scripts/build-mobile.mjs`)
| Target | PAYMENTS (Razorpay) | PLAY_BILLING | APP_STORE_BILLING |
|---|---|---|---|
| web | true | false | false |
| android | false | true | false |
| ios | false | false | true |

`build-mobile.mjs` pins these values, fails the iOS build if it contains Razorpay or Play strings or is **missing** the App Store paywall, and fails the Android build if it contains the App Store paywall.

### Push fix
- The backend sends via FCM (`admin.messaging().sendEachForMulticast`), but Capacitor on iOS returns a raw APNs token.
- Fix: added `pod 'FirebaseMessaging'`. `AppDelegate` swaps the APNs token for the FCM token before posting to Capacitor, and `UIBackgroundModes: remote-notification` was added.
- The backend needed no changes.

### Other iOS fixes this session
- **Scene life cycle (iOS 27 SDK requirement):** new `SceneDelegate.swift` plus `UIApplicationSceneManifest` in `Info.plist`. It forwards deep links and universal links to Capacitor's `ApplicationDelegateProxy`.
- **Podfile `post_install`:** raises every pod to iOS 15, because Xcode 27 rejects 13.0.
- **`services/firebaseAuth.js`:** `handleFirebaseRedirectResult` returns null on native, because `getRedirectResult()` never settles on the `capacitor://` origin and was hiding the login form.
- **`App.entitlements`:** added `com.apple.developer.applesignin`.
- **`Info.plist`:** real `REVERSED_CLIENT_ID` from the real `GoogleService-Info.plist`.
- **`PrivacyInfo.xcprivacy`:** added PurchaseHistory.
- **Copy:** removed "Open Edgecipline on the web to upgrade" from `TradeLimitDialog` and `LastFreeTradeSheet` (anti-steering, 3.1.1).

---

## 5. Tests

- **Backend:**
  - `cd backend && npx jest __tests__/unit`
  - New: `appStoreBilling.test.js` (18 tests).
  - Updated: the account-deletion coverage and storage tests.
  - ⚠️ **43 tests already fail on the base commit**, before this work: `freeTierFunnel`, `freeTierNudge`, `tradeQuota`, `tradeQuotaEnforcement`, `uploadQuotaGate`. They're unrelated and need separate investigation.
  - `indianTradeBatchCreate` is flaky under full-suite load and passes on its own.
- **Frontend:** `cd frontend && npm test` → 101 pass.
- **Build guards:** `npm run build:mobile:ios` and `npm run build:mobile:android` both pass.
- **Real Apple verifier check:** a forged JWS is rejected with `APP_STORE_VERIFICATION_FAILED`.

---

## 6. Environment notes / gotchas (this Mac)

- MacBook Air M2, macOS 27.2, Xcode 27.2 in `/Applications`.
  - Homebrew is at `/opt/homebrew`, and `~/.zprofile` loads it.
  - CocoaPods comes from Homebrew (its own Ruby). System Ruby 2.6 is untouched.
- **There's no Simulator.app in Xcode 27.** The simulator window is **DeviceHub**: `/Applications/Xcode.app/Contents/Applications/DeviceHub.app`.
- **Simulator UDIDs change.** DeviceHub recreates devices, so look up the current one with `xcrun simctl list devices available | grep iPhone`. iPhone 17 was being used.
- **CLI build/run used during the session:**
  ```
  cd frontend/ios/App
  xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug \
    -destination "id=<UDID>" -derivedDataPath <dir> build
  xcrun simctl install <UDID> <dir>/Build/Products/Debug-iphonesimulator/App.app
  xcrun simctl launch <UDID> com.edgecipline
  ```
- **Env for the iOS build:** `frontend/.env.production.local` (gitignored) holds the production API URL and the Firebase **web** config, with `NEXT_PUBLIC_RAZORPAY_KEY_ID` left empty. `frontend/.env.local` has placeholder and local values that would fail production validation.
- **Sign in with Apple in the Simulator:** signing an Apple ID into the simulator kept failing ("Verification Failed", "Could not sign in") even with the correct password and 2FA code. This is a known simulator problem. **Test Apple login on a real iPhone or TestFlight.** Email/password and Google login work in the Simulator.
- **The "Communication with Apple failed / no devices" signing warning** only matters for real devices. Connect an iPhone, turn on Developer Mode, select it in Xcode, and click Try Again.
- Two test images were added to the iPhone 17 simulator's Photos with `xcrun simctl addmedia`.

---

## 7. Changed files (uncommitted)

**Backend**
- New:
  - `constants/appStore.js`
  - `models/AppStoreSubscription.js`
  - `services/appStoreBillingService.js`
  - `controllers/appStoreBillingController.js`
  - `routes/appStoreBillingRoutes.js`
  - `routes/appStoreNotificationRoutes.js`
  - `utils/appStoreAccountIdentity.js`
  - `certs/apple/AppleRootCA-G3.cer` (SHA-256 `63343abf…3e9179`)
  - `__tests__/unit/appStoreBilling.test.js`
- Modified:
  - `config/index.js` (`appStore` block)
  - `models/Users.js` (`appStoreEntitlementExpiry` + index)
  - `utils/premium.js`
  - `services/accountDeletionService.js`
  - `controllers/authController.js` (`/auth/me` subscription payload)
  - `server.js` (2 mounts)
  - `package.json` and `package-lock.json`
  - 2 deletion tests
- Root: `.env.example` (Apple env names)

**Frontend**
- New:
  - `components/AppStorePaywall.js`
  - `components/AppStorePaywall.disabled.js`
  - `plugins/EdgeStoreKitPlugin.js`
- Modified:
  - `components/PaywallGate.js`
  - `config/payments.js`
  - `next.config.ts`
  - `scripts/build-mobile.mjs`
  - `services/api.js`
  - `services/firebaseAuth.js`
  - `app/settings/page.js`
  - `components/DeleteAccountSection.js`
  - `features/premium/utils/paywallRouting.mjs` (+ test)
  - `features/premium/utils/subscriptionCard.mjs` (+ test)
  - `features/trade/components/TradeLimitDialog.jsx`
  - `features/trade/components/LastFreeTradeSheet.jsx`

**iOS (`frontend/ios/App/`)**
- New:
  - `App/SceneDelegate.swift`
  - `App/EdgeStoreKitPlugin.swift`
  - `App/Edgecipline.storekit`
  - `App/GoogleService-Info.plist`
  - `App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` (Run uses the StoreKit file)
  - `Podfile.lock`
  - `App.xcworkspace/contents.xcworkspacedata`
- Modified:
  - `Podfile` (iOS 15 `post_install`, FirebaseMessaging)
  - `App/AppDelegate.swift`
  - `App/Info.plist`
  - `App/App.entitlements`
  - `App/MainViewController.swift`
  - `App/PrivacyInfo.xcprivacy`
  - `App.xcodeproj/project.pbxproj` (new files; `DEVELOPMENT_TEAM = SAMM4YJPVF`)

**Unrelated, leave out:** `frontend/android/gradle/wrapper/gradle-wrapper.properties`

---

## 8. Rules the owner asked for

- Explain in simple English, one step at a time.
- Don't commit or push without explicit approval.
- Never print or ask for secrets (`.env` values, keys, passwords, `.p8` files).
- No destructive cleanup, and no disabling of security checks.
