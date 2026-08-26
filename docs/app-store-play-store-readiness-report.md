# Edgecipline — App Store & Play Store Readiness Report

**Audit date:** 2026-08-04
**Branch:** `staging` @ `ebef14b`
**App:** Edgecipline (`com.edgecpline`) — Next.js 16 static export wrapped in Capacitor 6
**Scope:** Android (Google Play) + iOS (Apple App Store) release readiness

---

## Verdict

| Store | Status | Reason |
| --- | --- | --- |
| **Google Play** | 🔴 **NOT READY — will be rejected** | 6 policy/completeness blockers. A fake payment form ships inside the release APK, there is no account-deletion path, and the bundle points at the staging API. |
| **Apple App Store** | 🔴 **NOT READY — cannot even be submitted** | Everything above, plus the iOS target has never been configured: no Firebase config, no privacy manifest, no usage-description strings, no push entitlement. Sign-in, camera and push are all broken on iOS today. |

**Blockers found: 11 P0 · 10 P1 · 8 P2**

Realistic effort to a submittable build: **Android ~1 week**, **iOS ~2–3 weeks** (iOS also needs a Mac + Apple Developer account before anything can be built at all).

---

## What is already right

Credit where it is due — a lot of the hard release engineering is done:

- ✅ Release signing is env/`keystore.properties`-driven and **fails the build** if unconfigured ([build.gradle](frontend/android/app/build.gradle))
- ✅ R8 minification + resource shrinking enabled on release
- ✅ `targetSdk 36` / `compileSdk 36` — meets Play's 2026 target-API requirement
- ✅ Cleartext traffic disabled via [network_security_config.xml](frontend/android/app/src/main/res/xml/network_security_config.xml)
- ✅ `android:allowBackup="false"`
- ✅ Release output is an **AAB** (`bundleRelease`), not an APK ([run-gradle-release.mjs](frontend/scripts/run-gradle-release.mjs))
- ✅ Sentry wired for crash reporting, with `send-default-pii=false`
- ✅ Build-time env validation that hard-fails on bad config ([environment.js](frontend/config/environment.js))
- ✅ Genuine in-app Privacy Policy and Terms with proper **trading + AI disclaimers** ([terms/page.js:257-295](frontend/app/terms/page.js#L257))
- ✅ Adaptive launcher icons at all densities, splash at all densities, notification icon + channels
- ✅ Secrets (`.env`, `keystore.properties`, `*.keystore`) are correctly git-ignored

The problems below are almost all *product/compliance* gaps, not architecture gaps.

---

# P0 — Blockers (guaranteed rejection or broken app)

### P0-1 · No way to delete an account — violates BOTH stores

There is **no account-deletion feature anywhere** in the product. Verified: zero matches in `frontend/app`, `frontend/components`, `frontend/services`, and zero delete-account routes in `backend/routes` (the only `router.delete` handlers are for individual trades).

- **Google Play** — *User Data policy*: any app that lets users create an account must offer in-app account deletion **and** a publicly reachable web deletion URL, which you declare in Play Console → Data safety. `https://www.edgecipline.com/delete-account` currently returns **404**.
- **Apple** — *Guideline 5.1.1(v)*: apps supporting account creation must let users initiate deletion **from within the app**.

**Fix:** Add `DELETE /api/profile/account` (hard-delete or anonymise User + Trades + Reflections + Checklists + device tokens + Cloudinary uploads + Firebase Auth user), a confirm-flow entry in [profile/page.js](frontend/app/profile/page.js), and a public `/delete-account` web page describing the process.

---

### P0-2 · A **fake payment form** ships inside the release build

[components/SmartPaywall.js](frontend/components/SmartPaywall.js) is live and mounted in [upload-trade/page.js:317](frontend/app/upload-trade/page.js#L317). Its checkout loader branches like this:

```js
// SmartPaywall.js:26
function isSandboxCheckout() {
  return isNativeAndroidApp() || !String(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "").trim();
}
```

Two separate failures fall out of that one line:

**On Android** — `isNativeAndroidApp()` is `true`, so the app injects [utils/mockRazorpay.js](frontend/utils/mockRazorpay.js): a full-screen **imitation Razorpay checkout** with card-number / expiry / CVV inputs, a "Pay" button, and a "simulate failure" button. Confirmed present in the shipped bundle (`checkout.razorpay.com` and the mock both appear in `android/app/src/main/assets/public`). This is a payment UI that collects card-shaped input and grants a paid subscription without a transaction.
→ Google Play **Deceptive Behavior** + **Payments** policy. Rejection, with app-suspension risk.

**On iOS** — `isNativeAndroidApp()` is `false` and `NEXT_PUBLIC_RAZORPAY_KEY_ID` is non-empty, so the sandbox branch is skipped and the app loads the **real** `https://checkout.razorpay.com/v1/checkout.js`.
→ Apple **Guideline 3.1.1**: digital subscriptions must use In-App Purchase. A third-party processor inside the app is an automatic rejection. (It would also fail at runtime — the key is a placeholder.)

**Fix — pick one strategy, do not ship the current hybrid:**
- **(a) Recommended for v1:** remove the paywall from both mobile builds. Sell on the web only, and have the app read subscription status. Apple's *Guideline 3.1.3(b) Multiplatform* permits honouring a subscription bought elsewhere — but the app must contain **no purchase UI and no link to buy**.
- **(b)** Implement Google Play Billing + StoreKit properly. This is weeks of work, not days.
- Either way, **delete `utils/mockRazorpay.js` from production builds entirely.** A fake payment screen must never be in a store artifact.

---

### P0-3 · "Upgrade Plan" button leads to a 404 inside the app

[profile/page.js:349](frontend/app/profile/page.js#L349) renders a prominent gradient CTA:

```jsx
{profile?.subscriptionStatus !== "active" && (
  <Link href="/pricing">Upgrade Plan →</Link>
)}
```

There is **no `/pricing` route** — not in `frontend/app/`, and no `out/pricing*` in the export. Every user whose subscription is not active — which includes **every fresh reviewer account** — sees this button and gets a 404 screen.

→ Apple **Guideline 2.1 App Completeness**. Play "broken core functionality". Near-certain rejection on first review.

**Fix:** Remove the CTA (per P0-2a) or build the route. Then sweep for other dead links — `admin/users/page.js:49` also deep-links to `/pricing`.

---

### P0-4 · The release bundle is baked against the **staging** API

[frontend/.env.local:1](frontend/.env.local) →
```
NEXT_PUBLIC_API_URL=https://staging-api.stratedge.live/api
```

`output: "export"` compiles this string into the JS chunks — verified present in `out/`, `android/app/src/main/assets/public`, **and** `ios/App/App/public`. `npm run android:build` reads this same file, so today's release AAB ships pointing at staging.

The guard that was supposed to catch this has been widened to let it through:

```js
// config/environment.js:5
const PRODUCTION_API_HOSTS = new Set(["api.stratedge.live", "staging-api.stratedge.live"]);
```

The comment three lines above literally says *"Never point a release build here"* — but nothing enforces it.

**Fix:** Add a `.env.production` with `api.stratedge.live`, and gate the staging host on a non-production mode so a production build physically cannot resolve it.

---

### P0-5 · Placeholder Razorpay key passes production validation

`.env.local` sets `NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_placeholder`. The validator at [environment.js:127](frontend/config/environment.js#L127) only checks `startsWith("rzp_live_")`, and `hasPlaceholder()` at line 44 only matches `^(your_|replace_|example|changeme|<)`. `rzp_live_placeholder` sails through both.

So the "production requires a live key" control is defeated, and — combined with P0-2 — the iOS build would load a real Razorpay SDK with a dead key.

**Fix:** Add `placeholder|dummy|test|sample` to `hasPlaceholder()` and require a minimum key length.

---

### P0-6 · The full **admin console** ships inside the consumer app

Both mobile bundles contain the complete internal back-office:

```
android/app/src/main/assets/public/admin/{login,dashboard,users,payments,
                                          trades,monitoring,feedback,issues,expired-users}
ios/App/App/public/admin/...          (identical)
```

A reviewer — or any user — can navigate to `/admin/login` inside the app. `admin/users/page.js` exposes subscription activation/deactivation; `admin/payments` exposes revenue.

→ Apple **Guideline 2.3.1** (hidden/undocumented features) — Apple explicitly rejects for this. It is also an unnecessary attack surface: the auth check lives in `admin/layout.js`, which is client-side.

**Fix:** Exclude `app/admin/**` from the Capacitor export (separate build target, or a build-time route filter), and ship admin as a web-only deployment.

---

### P0-7 · iOS: Firebase is not configured — Google Sign-In is dead

- `ios/App/App/GoogleService-Info.plist` — **missing**
- [AppDelegate.swift](frontend/ios/App/App/AppDelegate.swift) — never calls `FirebaseApp.configure()`
- `Info.plist` has no `CFBundleURLTypes` with the `REVERSED_CLIENT_ID` scheme

`@capacitor-firebase/authentication` is the only sign-in path with a provider (`google.com`). On iOS it will fail or crash on first tap.

**Fix:** Add the iOS app in the Firebase console, download `GoogleService-Info.plist` into the Xcode target, add `FirebaseApp.configure()`, and add the reversed-client-ID URL scheme.

---

### P0-8 · iOS: no privacy manifest (`PrivacyInfo.xcprivacy`)

Required by Apple since May 2024 for apps using "required reason" APIs. Capacitor core uses `UserDefaults`; the app also touches file timestamps and disk space. Submitting without it produces **ITMS-91053: Missing API declaration** and the build is rejected at upload.

**Fix:** Add `PrivacyInfo.xcprivacy` to the App target declaring at minimum `NSPrivacyAccessedAPICategoryUserDefaults` (reason `CA92.1`), plus your data-collection types (email, name, user content, crash data, device ID).

---

### P0-9 · iOS: missing camera / photo usage descriptions → guaranteed crash

The app uploads trade screenshots — Android declares `CAMERA` and `READ_MEDIA_IMAGES` ([AndroidManifest.xml:91-97](frontend/android/app/src/main/AndroidManifest.xml#L91)). In a `WKWebView`, `<input type="file" accept="image/*">` triggers the iOS camera/photo picker.

[Info.plist](frontend/ios/App/App/Info.plist) contains **no** `NSCameraUsageDescription` and **no** `NSPhotoLibraryUsageDescription`. iOS terminates the app immediately when a permission is requested without its string, and the binary is rejected at upload (**ITMS-90683**).

**Fix:** Add both keys with honest, specific copy, e.g.
> "Edgecipline uses your camera to capture broker screenshots so trades can be logged automatically."

---

### P0-10 · iOS: push notifications cannot work

`@capacitor/push-notifications` is a dependency and is in `packageClassList`, but:
- there is **no `App.entitlements`** file → no `aps-environment` key → APNs registration fails and Xcode blocks the upload
- `AppDelegate.swift` does **not** forward the registration callbacks the Capacitor plugin requires:
  ```swift
  func application(_ application: UIApplication,
      didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
      NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
  }
  func application(_ application: UIApplication,
      didFailToRegisterForRemoteNotificationsWithError error: Error) {
      NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
  }
  ```
- no APNs auth key uploaded to Firebase (required for FCM→APNs)

---

### P0-11 · The public Privacy Policy URL is broken

Both consoles require a **live, publicly reachable** privacy policy URL, and Play will flag the listing if it ever stops resolving.

| URL | Status |
| --- | --- |
| `https://www.edgecipline.com/privacy-policy` | **404** |
| `https://www.edgecipline.com/privacy` | 200 |
| `https://www.edgecipline.com/terms` | 200 |
| `https://www.edgecipline.com/support` | **404** |

The repo defines `app/privacy-policy/` and has **no** `app/privacy/` — so the live site is a **stale deploy**. The moment you redeploy the current tree, `/privacy` starts 404-ing and the URL you registered with Google/Apple dies.

**Fix:** Redeploy the site from this tree, settle on one canonical path, add a redirect from the other, and ship `/support` and `/delete-account` publicly before submitting.

---

# P1 — High (rejection risk, or breaks on launch day)

### P1-1 · Signing key must be treated as compromised, and the artifacts are *still* tracked
The June report claimed these were "staged for untracking." They are still tracked today:
```
frontend/android.zip                                   (21 MB)
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```
`android.zip` contains `google-services.json`, `local.properties`, a debug APK and the **old plaintext signing properties**, and remains in git history (`git log -- frontend/android.zip` → commit `6beeccd`).
**Fix:** `git rm --cached` both, rotate the upload key, then `git filter-repo` before the repo is ever shared.

### P1-2 · Google Sign-In will break the day you publish
[google-services.json](frontend/android/app/google-services.json) registers exactly **one** Android OAuth client (cert hash `2c2e3202…`). Play App Signing **re-signs your AAB with Google's key**, so the installed app's SHA-1 will not match anything in Firebase.
**Fix:** After the first upload, copy the *App signing key certificate* SHA-1 from Play Console → Setup → App integrity into Firebase, re-download `google-services.json`, and rebuild. Add the upload-key SHA-1 too.

### P1-3 · `SCHEDULE_EXACT_ALARM` needs a Play Console declaration
[AndroidManifest.xml:108](frontend/android/app/src/main/AndroidManifest.xml#L108). On API 34+ this is revoked by default, and Play restricts it to alarm-clock/calendar apps via a sensitive-permission declaration form. A trading-checklist reminder is unlikely to qualify.
**Fix:** Drop it and rely on the existing WorkManager fallback (already implemented), or file the declaration and expect pushback.

### P1-4 · `READ_MEDIA_IMAGES` needs the Photo & Video Permissions declaration
[AndroidManifest.xml:95](frontend/android/app/src/main/AndroidManifest.xml#L95). Play requires broad photo access to be core functionality, otherwise you must use the Android Photo Picker. Also missing `READ_MEDIA_VISUAL_USER_SELECTED` for Android 14 partial access.

### P1-5 · `FOREGROUND_SERVICE` declared with no foreground service
[AndroidManifest.xml:112](frontend/android/app/src/main/AndroidManifest.xml#L112) — no `<service>` in the manifest. On API 34+ every FGS needs a `foregroundServiceType` and a matching granular permission. Unused sensitive permissions attract Play review questions.
**Fix:** Delete the line.

### P1-6 · `versionCode 1` is hard-coded
[build.gradle:44](frontend/android/app/build.gradle#L44). Every Play upload needs a strictly higher code; you will hit "version code already used" on the second submission.
**Fix:** Drive `versionCode`/`versionName` from CI or an env var.

### P1-7 · iOS project is unbuilt and misconfigured
- `IPHONEOS_DEPLOYMENT_TARGET = 13.0` — below Xcode 16's supported floor; raise to **15.0+**
- `CODE_SIGN_IDENTITY = "iPhone Developer"` — deprecated; release needs *Apple Distribution*
- `DEVELOPMENT_TEAM` — unset
- No `Podfile.lock`, no `Pods/` → **`pod install` has never been run**; the project has never compiled
- `UIRequiredDeviceCapabilities = [armv7]` in [Info.plist:29-31](frontend/ios/App/App/Info.plist#L29) — 32-bit, unsupported since iOS 11. Change to `arm64`.
- No `ITSAppUsesNonExemptEncryption` key → App Store Connect will block every submission on the export-compliance question. Add `<key>ITSAppUsesNonExemptEncryption</key><false/>`.

### P1-8 · Notification permission requested cold, at first launch
[MainActivity.java:37](frontend/android/app/src/main/java/com/edgecpline/MainActivity.java#L37) calls `requestNotificationPermissionIfNeeded()` inside `onCreate()`, before the user has seen anything. Not a hard rejection, but it tanks opt-in rates and Apple reviewers dislike it.
**Fix:** Ask after onboarding, with a rationale screen.

### P1-9 · Verify Apple Guideline 4.8 (Sign in with Apple)
Google is the only third-party provider ([firebaseAuth.js](frontend/services/firebaseAuth.js)). Because email/password registration also exists, 4.8 is *likely* satisfied — but only if that path collects nothing beyond name + email and does no tracking. Confirm before submitting; adding Sign in with Apple removes all doubt.

### P1-10 · App renders the reviewer straight into a broken state
A brand-new reviewer account has `subscriptionStatus !== "active"` → sees the dead "Upgrade Plan" button (P0-3) and, on upload, the mock paywall (P0-2). You must also supply Apple with a **demo account** in App Review notes (`app/verify-otp/` implies email verification — reviewers cannot receive your OTP emails).

---

# P2 — Medium (quality, polish, long-term cost)

| # | Issue | Detail |
| --- | --- | --- |
| P2-1 | **Google Fonts loaded from CDN in 29 files** | [layout.tsx:45-49](frontend/app/layout.tsx#L45) + 28 pages fetch `fonts.googleapis.com` at runtime. In a packaged app this means visible FOUT, a broken look offline, and a GDPR exposure (German courts have ruled CDN font loading transmits IP without consent). **Self-host via `next/font/local`.** |
| P2-2 | **App ID typo is permanent** | `com.edgecpline` vs the brand "Edgecipline" ([capacitor.config.ts:4](frontend/capacitor.config.ts#L4)). Cannot be changed after first publication on either store. It is also only two segments — Apple convention is reverse-DNS (`com.edgecipline.app`). **Last chance to fix is before the first upload.** |
| P2-3 | **PWA manifest icons are fake** | [manifest.webmanifest](frontend/public/manifest.webmanifest) declares one `logo.png` as 192×192, 512×512 *and* 180×180. Generate real sizes. |
| P2-4 | **Dev leftovers committed** | `tmp-refactor.js`, `tmp-refactor-add.js`, `tmp-refactor-login.js`, `tmp-refactor-register.js`, `frontend/image.png`, root `image.png`. |
| P2-5 | **ESLint config lints the build output** | `globalIgnores` in [eslint.config.mjs](frontend/eslint.config.mjs) overrides the defaults and drops `ios/App/App/public/**` and `android/**/assets/public/**`, so lint reports **44,737 problems** — ~44,300 of them from minified bundles. Real source issues are buried. Add those paths to the ignore list. |
| P2-6 | **Privacy policy names the wrong product** | `privacy-policy/page.js:352` says "Edge Discipline", not "Edgecipline". Reviewers do read these. |
| P2-7 | **`Last Updated: April 17, 2026`** | Refresh before submission; both stores check that the policy covers what the app actually collects (screenshots, trade data, Firebase auth, Sentry, FCM tokens, Cloudinary uploads). |
| P2-8 | **Debug logging in shipped native code** | `MainActivity.java` logs cookie/permission state via `Log.d`. Harmless but noisy; gate on `BuildConfig.DEBUG`. |

---

# Store console work still outstanding

None of this exists yet and none of it is code:

**Google Play Console**
- [ ] Developer account ($25) + **D-U-N-S / identity verification** (mandatory since 2023; can take 1–2 weeks)
- [ ] **20 testers for 14 continuous days** on closed testing before production access is granted for new personal accounts — *this alone is a 2-week calendar dependency, start it now*
- [ ] Data safety form (collection, sharing, encryption in transit, deletion URL)
- [ ] Content rating questionnaire — expect finance/simulated-gambling probes for a trading app
- [ ] Target audience & content (must be 18+; the policy already states this)
- [ ] Ads declaration (none), News declaration (no)
- [ ] Financial features declaration — for a trading journal, declare "none of these"; be ready to argue it is a journal, not advisory
- [ ] Store listing: 2–8 phone screenshots, 1024×500 feature graphic, 512×512 icon, short + full description
- [ ] Privacy policy URL (see P0-11)

**App Store Connect**
- [ ] Apple Developer Program ($99/yr) + **a Mac** — the iOS app cannot be built or uploaded from Windows
- [ ] App Privacy "nutrition label" questionnaire
- [ ] Age rating (17+ recommended for financial content)
- [ ] Screenshots: 6.9" and 6.5" iPhone required; 12.9" iPad if you claim iPad support (`Info.plist` currently declares iPad orientations — either support it properly or restrict to iPhone)
- [ ] **Demo account credentials** in App Review notes
- [ ] Support URL (currently 404) and marketing URL
- [ ] Export compliance answer (see P1-7)

---

# Recommended order of work

**Week 1 — unblock Android**
1. Delete `mockRazorpay.js`; strip the paywall + `/pricing` CTA from mobile builds *(P0-2, P0-3)*
2. Build account deletion end-to-end: API, profile UI, public web page *(P0-1)*
3. `.env.production` with the prod API; remove staging from the prod allowlist; tighten `hasPlaceholder()` *(P0-4, P0-5)*
4. Exclude `app/admin/**` from the Capacitor export *(P0-6)*
5. Redeploy the website; fix `/privacy-policy`, `/support`, `/delete-account` *(P0-11)*
6. Untrack `android.zip` + `app-debug.apk`, rotate the upload key *(P1-1)*
7. Drop `SCHEDULE_EXACT_ALARM` and `FOREGROUND_SERVICE`; wire `versionCode` to CI *(P1-3, P1-5, P1-6)*

**In parallel, starting today:** open the Play Console account, complete identity verification, and start the 14-day / 20-tester closed test. It is the longest pole and it is pure waiting.

**Week 2 — Android submission + iOS setup**
8. Add the Play App Signing SHA-1 to Firebase and verify Google Sign-In on a Play-signed internal build *(P1-2)*
9. Self-host fonts *(P2-1)*
10. Decide the `com.edgecpline` question — **now or never** *(P2-2)*
11. On a Mac: `pod install`, Firebase iOS config, `PrivacyInfo.xcprivacy`, usage-description strings, push entitlement + AppDelegate callbacks, deployment target, `arm64`, signing *(P0-7 → P0-10, P1-7)*

**Week 3 — iOS QA and submission**
12. Full device pass on iOS: sign-in, camera upload, push, offline, deep links
13. Screenshots, listing copy, demo account, App Privacy label

---

## One-line summary

The engineering foundation is solid, but the app is **not shippable in its current state** — a mock payment screen and a dead upgrade button would fail review on their own, account deletion is legally mandatory and entirely absent, the bundle points at staging, and the iOS target has never been configured or compiled. Fix the eleven P0s and Android is a realistic one-week submission; iOS needs a Mac and roughly three.
