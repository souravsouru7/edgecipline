# Release Handoff — what's fixed in code, and what only you can do

Companion to [app-store-play-store-readiness-report.md](app-store-play-store-readiness-report.md).
Everything in Part 1 is done and verified in this repo. Part 2 needs a Mac, a
Firebase console, or a store account — I can't reach any of those from here.

**Payments stay deferred**, as agreed. The paywall is compiled out, not deleted;
see "Turning payments back on" at the end.

---

## Part 1 — Done in code

| # | Item | What changed |
| --- | --- | --- |
| — | **App ID typo** | `com.edgecpline` → `com.edgecipline` across Capacitor config, Gradle namespace + applicationId, the Java package directory (11 files), manifest receiver actions, `strings.xml`, and the iOS bundle ID. Verified: debug APK builds and reports `com.edgecipline`. |
| P0-1 | **Account deletion** | `DELETE /api/auth/account` + `services/accountDeletionService.js` purges 24 collections, Cloudinary images and the Firebase Auth user. In-app UI in Profile → Danger Zone (retyped-email confirmation). Public page at `/delete-account`. |
| P0-2 | **Fake payment form** | `utils/mockRazorpay.js` and the whole `SmartPaywall` chunk are aliased out of the build. Verified: **0** occurrences of `checkout.razorpay.com`, `rzp_sandbox_demo`, `mock-rzp-overlay` or `Razorpay` in the shipped bundle. |
| P0-3 | **Dead `/pricing` CTA** | Gated behind `canShowPurchaseUI()` in Profile, PageHeader, upload-trade, and the trial/rescue banners. Reviewers can no longer reach a 404. |
| P0-4 | **Staging API in release** | Split into `.env.development` (staging) / `.env.production` (prod). Staging removed from the production allowlist; overriding it now needs an explicit `NEXT_PUBLIC_ALLOW_STAGING_API=true`. Verified: a staging-pointed production build **fails**. |
| P0-5 | **Placeholder key passed validation** | `hasPlaceholder()` now matches anywhere in the value, not just the start. Verified: `rzp_live_placeholder` now **fails** the build. |
| P0-6 | **Admin console in the app** | `scripts/prune-mobile-bundle.mjs` strips `/admin` after build; `npm run android:*` / `ios:*` all route through it. Verified: 1.29 MB removed, no admin entries in either native bundle, web build untouched. |
| P0-7..10 | **iOS never configured** | Added `PrivacyInfo.xcprivacy`, `App.entitlements` (aps-environment), camera/photo usage strings, `ITSAppUsesNonExemptEncryption`, Google Sign-In URL scheme, `arm64`, `FirebaseApp.configure()` and the two push registration callbacks. All wired into the Xcode target; project file validated. |
| P0-11 | **Broken policy URLs** | `public/_redirects` maps the live `/privacy` → `/privacy-policy` so the existing link survives redeploy. `public/_headers` actually applies the security headers (the `next.config.ts` block never did under `output: "export"`). |
| P1-1 | **Tracked build artifacts** | `android.zip`, `app-debug.apk` and four `tmp-refactor*.js` untracked and deleted. **History still contains them — see 2.6.** |
| P1-3 | **SCHEDULE_EXACT_ALARM** | Removed. `ChecklistScheduler` already falls back to WorkManager when `canScheduleExactAlarms()` is false, so reminders still fire (within WorkManager's batching window rather than to the second). |
| P1-4 | **Photo permissions** | Added `READ_MEDIA_VISUAL_USER_SELECTED` for Android 14 partial access. Play declaration still required — see 2.4. |
| P1-6 | **Static versionCode** | Now `EDGE_VERSION_CODE` / `EDGE_VERSION_NAME` from the environment, defaulting to 1/1.0 locally. |
| P1-7 | **iOS build settings** | Deployment target 13.0 → 15.0 (Podfile too), `armv7` → `arm64`, `iPhone Developer` → `Apple Development`, entitlements path set on both configs. |
| P1-8 | **Cold-start permission prompt** | Removed from `MainActivity.onCreate()`. Push init now waits for a valid auth token, so first-time users aren't asked on the login screen. |
| P2-1 | **Google Fonts from CDN** | 26 woff2 files self-hosted in `public/fonts` with Google's original `unicode-range` subsetting preserved; CDN links stripped from all 29 files. Verified: **0** references in the shipped bundle. Fixes offline typography and the GDPR exposure. |
| P2-3 | **Fake manifest icons** | Real 180/192/256/384/512 icons plus maskable variants, generated from `logo.png`. |
| P2-5 | **44,737 lint problems** | ESLint was linting the copied native bundles. Now ignored — **198 problems**, and every one of my new files lints clean. |
| P2-6/7 | **Policy copy** | 28 "Edge Discipline" → "Edgecipline"; dates refreshed; retention section now discloses the payment-record retention the code actually performs. |

### One correction to the original report

The report said `FOREGROUND_SERVICE` was "declared with no foreground service — delete the line."
**That was wrong.** `ChecklistScheduler` and `ChecklistAlarmReceiver` both call
`setExpedited(...)`, and below API 31 WorkManager runs expedited work *as* a
foreground service — with `minSdk 24`, that permission is genuinely needed.

I removed the redundant explicit declaration, but the permission still appears
in the merged manifest via `androidx.work`, and that is correct. **Do not strip
it with `tools:node="remove"`** — it breaks checklist reminders on Android 7–11.
If Play asks about it during review, that is the justification.

### Verification

```
Android debug APK ........ builds, package com.edgecipline
Production web build ..... passes
Mobile build + prune ..... passes, /admin absent from both native bundles
Payment traces in bundle . 0
Font CDN refs in bundle .. 0
Backend deletion tests ... 27 passed
ESLint on new files ...... 0 problems
Xcode project ............ structurally validated (balance, UUIDs, settings)
```

The 84 remaining ESLint errors are all pre-existing (unescaped apostrophes and
static-component definitions in the policy/streaks pages). I left them alone —
they're cosmetic and outside this scope.

---

## Part 2 — Needs you

### 2.1 Firebase: re-register both apps under the new ID 🔴 blocks Android *and* iOS

The rename invalidated the Firebase client config. I patched
`google-services.json` locally so the build wouldn't break, **but the OAuth
client is still bound to the old package**, so Google Sign-In will fail at
runtime until you do this:

1. Firebase Console → project `aijournal-a6c9e` → Add app → **Android**
   - Package name: `com.edgecipline`
   - Add the SHA-1 of your **upload key** (`keytool -list -v -keystore <keystore> -alias edgecipline`)
   - Download the new `google-services.json` → replace `frontend/android/app/google-services.json`
   - The old file is backed up at `google-services.json.bak-edgecpline`
2. Add app → **iOS**
   - Bundle ID: `com.edgecipline`
   - Download `GoogleService-Info.plist` → drop into `frontend/ios/App/App/`
   - It is already referenced by the Xcode target, so **the iOS build fails until this file exists** — that's deliberate, since `FirebaseApp.configure()` would otherwise crash at launch.
3. Open the new `GoogleService-Info.plist`, copy `REVERSED_CLIENT_ID`, and replace the placeholder in `ios/App/App/Info.plist` → `CFBundleURLTypes`.
   The value currently there is derived from the **web** client and is a
   placeholder — Google Sign-In on iOS will not return to the app until you
   swap in the real iOS one.
4. Upload an **APNs auth key (.p8)** under Project Settings → Cloud Messaging → iOS, or push will register but never deliver.

### 2.2 Play App Signing SHA-1 🔴 breaks Google Sign-In on launch day

Play re-signs your AAB with **its own** key, so the installed app's SHA-1 won't
match anything in Firebase. After your first upload:

Play Console → Setup → App integrity → copy the **App signing key** SHA-1 →
add it in Firebase → re-download `google-services.json` → rebuild.

Test Google Sign-In on a build installed *from Play* (internal testing track),
not a local APK. This is the single most common launch-day breakage.

### 2.3 Rotate the signing key 🔴 treat the old one as compromised

`frontend/android.zip` carried the old plaintext signing properties and is
**still in git history** (commit `6beeccd`). Untracking doesn't remove it.

1. Generate a fresh upload key.
2. Rewrite history from a backup clone:
   ```bash
   git filter-repo --invert-paths \
     --path frontend/android.zip \
     --path frontend/android/app/build/outputs/apk/debug/app-debug.apk
   ```
3. Force-push, and have every clone re-clone.

Do this **before** the repo is shared with anyone.

### 2.4 Play Console declarations

- **Photo & Video Permissions** — required for `READ_MEDIA_IMAGES`. Justification: reading broker screenshots from the gallery is the app's primary trade-import path.
- **Data safety** — declare collection of email, name, photos, user content, crash data. Deletion URL: `https://www.edgecipline.com/delete-account`
- **Content rating** — 18+; expect finance questions.
- **Financial features** — declare "none of these"; the app is a journal, not advisory. The disclaimers in `/terms` §3 and §5 support this.

### 2.5 Deploy the website before submitting

The live site is a stale build: it serves `/privacy` but not `/privacy-policy`,
and `/support` 404s. Redeploy from this tree so all four URLs resolve:

```
/privacy-policy    (canonical)
/privacy           (301 → /privacy-policy, via public/_redirects)
/terms
/support
/delete-account    ← Play requires this one publicly reachable
```

Confirm each returns 200 **before** entering them in either console.

### 2.6 The 14-day clock — start today

New personal Play accounts need **20 testers running a closed test for 14
continuous days** before production access unlocks, plus identity/D-U-N-S
verification which can take 1–2 weeks on its own. Both are pure waiting and
neither depends on any code above. Start them now or they become the
critical path.

### 2.7 On a Mac

```bash
cd frontend
npm install
npm run ios:sync          # build + prune + cap sync
cd ios/App && pod install # never been run — no Podfile.lock exists yet
open App.xcworkspace
```

Then in Xcode: set your Development Team, confirm the Push Notifications
capability picked up `App.entitlements`, and archive. Test on a real device:
sign-in, camera upload, photo picker, push, offline launch, deep links.

### 2.8 Apple submission notes

- **Demo account** is mandatory — `/verify-otp` implies email verification and reviewers can't receive your OTP mail. Supply working credentials in App Review Notes.
- **App Privacy** answers must match `PrivacyInfo.xcprivacy` (email, name, photos, user content, crash + performance data; no tracking). Mismatches get rejected.
- **Guideline 4.8**: Google is the only third-party provider. Email/password signup likely satisfies it, but adding Sign in with Apple removes all doubt.
- **iPad**: `Info.plist` still declares iPad orientations. Either support it properly and supply 12.9" screenshots, or restrict the target to iPhone.

---

## Turning payments back on

When the bank account and live Razorpay keys are ready:

```bash
NEXT_PUBLIC_PAYMENTS_ENABLED=true
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_<real key>   # placeholder values now fail the build
```

That restores the paywall on **web only** — `canShowPurchaseUI()` returns false
on any native platform regardless of the flag.

Two things to do first:

1. **Build the `/pricing` route.** It still doesn't exist. The Profile "Upgrade Plan" link points at it and is only safe today because it's gated.
2. **Leave mobile at `false`.** Shipping Razorpay inside the app is an automatic Apple 3.1.1 rejection and a Play payments violation. Mobile needs Play Billing + StoreKit, or the web-purchase model where the app reads subscription status and contains no purchase UI or link (permitted under Apple 3.1.3(b)).

Verify after any change:

```bash
npm run build:mobile
grep -ro "checkout.razorpay.com" out | wc -l   # must be 0 for mobile
```
