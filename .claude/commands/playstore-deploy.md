# Google Play Store — Deployment Checklist & Fixer

Audit and fix everything needed to ship **Edgecipline** (`com.edgecipline`) to Google Play.

Usage: `/playstore-deploy [check|fix|all]`
- `check` — audit only, no edits
- `fix`   — apply all code/config fixes
- `all`   — audit + fix + print the remaining manual steps (default)

## Instructions

The user provided: `$ARGUMENTS`

Parse the mode from `$ARGUMENTS` (default `all`).

---

## PHASE 1 — Audit (always run first)

Read these files and report what you find:

1. **`frontend/android/app/build.gradle`** — check:
   - `versionCode` (must be ≥ 1, must be incremented each release)
   - `versionName` (semver string)
   - `signingConfigs` block present? (needed for release signing)
   - `minSdkVersion` / `targetSdkVersion` (Play requires targetSdk ≥ 34)
   - `minifyEnabled` / `shrinkResources` (currently both false — ok for now, note it)
   - build script uses `assembleRelease` or `bundleRelease`? (Play needs AAB = `bundleRelease`)

2. **`frontend/capacitor.config.ts`** — confirm:
   - `appId` = `com.edgecipline`
   - `appName` = `Edgecipline`
   - `webDir` = `out`

3. **`frontend/android/app/google-services.json`** — exists?
   - If missing → flag as BLOCKER (Firebase / Google Sign-In will crash on release)

4. **`frontend/android/app/src/main/AndroidManifest.xml`** — check:
   - `android:debuggable` not set to `true` in release
   - `INTERNET` permission present
   - `uses-feature` for camera/mic only if actually used

5. **`frontend/android/app/src/main/res/`** — check adaptive icons exist:
   - `mipmap-*/ic_launcher.png` and `ic_launcher_round.png` (all densities: mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi)
   - `mipmap-anydpi-v26/ic_launcher.xml` (adaptive icon XML)

6. **`frontend/package.json`** — `android:build` script:
   - Should use `bundleRelease` not `assembleRelease` for Play Store

7. **Keystore file** — check if `frontend/android/app/release.keystore` (or similar) exists.

Print an audit table:

```
## Audit Results

| # | Check                        | Status   | Detail                        |
|---|------------------------------|----------|-------------------------------|
| 1 | versionCode                  | ✅/⚠️/❌ | current value                 |
| 2 | targetSdkVersion ≥ 34        | ✅/⚠️/❌ | current value                 |
| 3 | signingConfigs in build.gradle | ✅/❌   |                               |
| 4 | Build script uses bundleRelease | ✅/❌  |                               |
| 5 | google-services.json present | ✅/❌    |                               |
| 6 | Keystore file present        | ✅/❌    | path if found                 |
| 7 | Adaptive icons present       | ✅/⚠️/❌ |                               |
| 8 | AndroidManifest clean        | ✅/⚠️/❌ |                               |
```

---

## PHASE 2 — Fix (run when mode is `fix` or `all`)

Apply every fix below **only if the audit shows it is needed**. Skip items that already pass.

### Fix 1 — `targetSdkVersion` to 34

In `frontend/android/variables.gradle` (or wherever `targetSdkVersion` is defined, check `frontend/android/variables.gradle` and `frontend/android/build.gradle`), set:
```
targetSdkVersion = 34
compileSdkVersion = 34
```

### Fix 2 — Signing config in `build.gradle`

Add a `signingConfigs` block and wire it to the `release` buildType in `frontend/android/app/build.gradle`.

The keystore path should read from `local.properties` (never hardcode passwords in git).

Add this pattern **inside the `android { }` block, before `buildTypes`**:

```groovy
signingConfigs {
    release {
        if (project.hasProperty('MYAPP_RELEASE_STORE_FILE')) {
            storeFile file(MYAPP_RELEASE_STORE_FILE)
            storePassword MYAPP_RELEASE_STORE_PASSWORD
            keyAlias MYAPP_RELEASE_KEY_ALIAS
            keyPassword MYAPP_RELEASE_KEY_PASSWORD
        }
    }
}
```

And update the `release` buildType to use it:

```groovy
release {
    signingConfig signingConfigs.release
    minifyEnabled false
    shrinkResources false
    proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
}
```

### Fix 3 — `android:build` script → AAB (bundleRelease)

In `frontend/package.json`, update `android:build` to produce an **App Bundle** (required by Play Store for new apps since Aug 2021):

```json
"android:build": "npm run build && npx cap sync android && cd android && ./gradlew bundleRelease"
```

### Fix 4 — Verify `local.properties` is git-ignored

Check `.gitignore` in `frontend/android/` — `local.properties` and `*.keystore` / `*.jks` must be listed. Add them if missing.

In `frontend/android/.gitignore` (create if not present), ensure these lines exist:
```
local.properties
*.keystore
*.jks
release.keystore
```

### Fix 5 — `versionCode` / `versionName` note

If `versionCode` is still `1` and `versionName` is `"1.0"`, leave them but print a reminder that **every Play Store upload requires a unique, incrementing `versionCode`**.

---

## PHASE 3 — Manual Steps Checklist (always print at end)

After running fixes, print this checklist for the user to complete manually. Do NOT skip items — every one is required by Google Play.

```
## Manual Steps Before Submitting to Play Store

### 🔑 KEYSTORE (one-time, keep safe forever)
[ ] Generate a release keystore (run once, store the file + passwords somewhere safe):
    keytool -genkeypair -v -keystore release.keystore -alias edgecipline \
      -keyalg RSA -keysize 2048 -validity 10000
[ ] Place it at: frontend/android/app/release.keystore (never commit to git)
[ ] Add to frontend/android/local.properties:
      MYAPP_RELEASE_STORE_FILE=release.keystore
      MYAPP_RELEASE_STORE_PASSWORD=<your-password>
      MYAPP_RELEASE_KEY_ALIAS=edgecipline
      MYAPP_RELEASE_KEY_PASSWORD=<your-password>

### 🔥 FIREBASE (critical for Google Sign-In on release builds)
[ ] In Firebase Console → Project Settings → Android app (com.edgecipline)
[ ] Add the SHA-1 fingerprint of your RELEASE keystore:
      keytool -list -v -keystore android/app/release.keystore -alias edgecipline
    Copy the SHA-1 and add it in Firebase Console
[ ] Download the updated google-services.json and replace android/app/google-services.json
[ ] Re-run: npm run android:sync

### 🖼️ APP ICONS (check before building)
[ ] Replace placeholder icons in android/app/src/main/res/mipmap-*/
    Sizes needed:
      mdpi:    48×48
      hdpi:    72×72
      xhdpi:   96×96
      xxhdpi:  144×144
      xxxhdpi: 192×192
[ ] Add adaptive icon XML at mipmap-anydpi-v26/ic_launcher.xml
    (foreground + background layers)
[ ] Use Android Studio → Image Asset Studio for easy generation

### 📸 PLAY STORE LISTING (required before publishing)
[ ] App name: Edgecipline
[ ] Short description (80 chars max)
[ ] Full description (4000 chars max)
[ ] At least 2 screenshots per form factor (phone, 7" tablet)
[ ] Feature graphic: 1024×500 px
[ ] App icon: 512×512 px PNG (high-res, no alpha)
[ ] Privacy Policy URL (required — host a simple page)
[ ] App category: Finance

### 📋 GOOGLE PLAY CONSOLE SETUP
[ ] Create a Google Play Developer account ($25 one-time fee)
[ ] Create new app → set package name: com.edgecipline
[ ] Fill in Content Rating questionnaire (Finance app = likely Everyone)
[ ] Fill in Data Safety section:
      - Firebase Auth collects: Email, User ID
      - No financial data stored on device
[ ] Set up a Closed Testing track first (recommended before Production)

### 🏗️ BUILD & UPLOAD
[ ] Run the release build:
      cd frontend
      npm run android:build
[ ] AAB output will be at:
      frontend/android/app/build/outputs/bundle/release/app-release.aab
[ ] Upload the .aab to Play Console → Testing → select track → Create new release
[ ] After testing passes, promote to Production

### ⚠️ EACH NEW RELEASE
[ ] Increment versionCode in frontend/android/app/build.gradle (must be unique)
[ ] Update versionName to match your release version
[ ] Re-run: npm run android:build
```

---

Print a final summary of what was fixed vs. what still needs manual action.
