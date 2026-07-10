# Play Store Release Readiness Report

Audit date: 2026-06-20

Status: **NO-GO until Critical items are closed**

## Critical

| File / area | Risk and impact | Fix / required action |
| --- | --- | --- |
| `frontend/config/api.js` | Missing or local API configuration previously fell back to `staging-api.stratedge.live`, allowing a production APK to use staging data. | Fixed. API configuration now has no fallback and is validated at build and startup. |
| `frontend/android/gradle.properties` | Release keystore passwords were committed in plaintext and exist in Git history. The local upload/signing key must be treated as compromised. | Fixed in the current tree. Rotate the key and passwords before release; use Play App Signing and a separate upload key. |
| `frontend/android/app/build/outputs/apk/debug/app-debug.apk` | A debug APK was tracked across multiple commits and could be redistributed or mistaken for a release artifact. | Staged for untracking; local file remains ignored. Purge it from history before making the repository public. |
| `frontend/android.zip` | Tracked archive contains Gradle state, a debug APK, `local.properties`, `google-services.json`, and the old signing properties. | Staged for untracking; local file remains ignored. Purge it from history. |
| Production payment configuration | Frontend has no live Razorpay public key and backend Razorpay key ID/secret are currently empty. Checkout cannot launch successfully. | Provision live frontend/backend keys plus the webhook secret in the production secret manager. Never place the secret key in `NEXT_PUBLIC_*`. |

## High

| File / area | Risk and impact | Fix / required action |
| --- | --- | --- |
| `frontend/android/app/build.gradle` | Release signing previously read secrets from tracked Gradle properties and could be misconfigured silently. | Fixed. Release tasks now require `EDGE_RELEASE_*` variables or untracked `android/keystore.properties`. |
| `frontend/.gitignore` | The entire Android source tree was ignored, hiding new native Java/resources from Git. A clean checkout could omit release-critical code. | Fixed. Review and stage the currently untracked native source files intentionally. |
| `frontend/android/app/build.gradle` and `capacitor.config.ts` | Application ID is `com.edgecpline`. Package IDs cannot be changed after first Play publication without creating a new app. | Confirm the spelling and ownership before the first upload. |
| Git history | Removing files from the current tree does not remove old APKs, archives, or signing passwords from existing commits. | Rotate credentials first, then coordinate a history rewrite and force-push. |

## Medium

| File / area | Risk and impact | Fix / required action |
| --- | --- | --- |
| `frontend/android/app/build.gradle` | `versionCode 1` and `versionName "1.0"` are static. Every Play update requires a higher version code. | Set the release version in CI or update it before each bundle. |
| `frontend/android/app/google-services.json` | Local Firebase client configuration is present. Its API key is public by design but must be restricted to the Android package and signing certificate in Google Cloud/Firebase. | File is now ignored. Inject the production file in CI and verify package/SHA restrictions. |
| `frontend/android/app/src/main/AndroidManifest.xml` | Exact alarm permission is denied by default for most new installs targeting Android 13+. | Current code checks `canScheduleExactAlarms()` and retains a WorkManager fallback. Test reminder timing on Android 14-16. |
| Gradle output | Gradle reports deprecated features and `flatDir` repository warnings. | Capture `--warning-mode all` after credentials are configured and schedule dependency cleanup. |

## Low

| File / area | Risk and impact | Fix / required action |
| --- | --- | --- |
| Frontend lint | Existing unused-variable warnings remain in payment/auth modules. | Clean up before enforcing zero-warning CI. |
| Sentry build metadata | `SENTRY_ORG`, `SENTRY_PROJECT`, and auth token are absent locally, so source-map upload is disabled. | Configure in CI if production crash symbolication is required. |

## Implemented Controls

- Production API host is allowlisted to `api.stratedge.live`.
- Production API requires HTTPS, standard port 443, and no credentials/query/fragment.
- Missing, localhost, private, staging, dev, test, QA, and sandbox API hosts fail validation.
- Production requires complete Firebase public configuration and a `rzp_live_*` Razorpay public key.
- `next build` fails before generating the static Capacitor bundle.
- A visible startup screen blocks all application content and API requests if runtime configuration is invalid.
- Android cleartext traffic remains disabled.
- Release builds retain R8 minification and resource shrinking.
- APK, AAB, keystore, signing-property, local-property, and Android archive paths are ignored and scanned.

## Safe Cleanup Commands

The APK and Android archive are already staged for untracking in this worktree. For another clone:

```powershell
git rm --cached -- frontend/android/app/build/outputs/apk/debug/app-debug.apk frontend/android.zip
git commit -m "Remove Android build artifacts and signing credentials"
```

Rotate the signing/upload key before any release. If the app is already enrolled in Play App Signing, create a new upload key and request an upload-key reset in Play Console. If it has never been published, discard the exposed keystore and create a new upload key.

After rotating all exposed credentials, rewrite history from a fresh backup clone:

```powershell
git filter-repo --invert-paths `
  --path frontend/android.zip `
  --path frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

Purge the old signing password from `frontend/android/gradle.properties` using a local replacement file that is never committed:

```text
literal:<OLD_EXPOSED_PASSWORD>==>***REMOVED***
```

```powershell
git filter-repo --replace-text replacements.txt
git push --force-with-lease --all
git push --force-with-lease --tags
```

Every collaborator must discard old clones after the history rewrite.

## Release Migration

1. Confirm the final application ID before the first Play Console upload.
2. Rotate the exposed keystore/upload key and store it outside the repository.
3. Configure `NEXT_PUBLIC_API_URL=https://api.stratedge.live`, production Firebase public values, and `NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_...` in CI.
4. Configure backend live Razorpay key ID, key secret, and webhook secret in the backend secret manager.
5. Provide signing values through `EDGE_RELEASE_STORE_FILE`, `EDGE_RELEASE_STORE_PASSWORD`, `EDGE_RELEASE_KEY_ALIAS`, and `EDGE_RELEASE_KEY_PASSWORD`.
6. Run `npm.cmd run build`, `npx.cmd cap sync android`, then `android\gradlew.bat bundleRelease`.
7. Test the signed AAB through Play internal testing, including login, payment, push notifications, reminders, offline behavior, and API-host verification.

## Official References

- Target API requirements: https://developer.android.com/google/play/requirements/target-sdk
- App signing and upload-key reset: https://developer.android.com/studio/publish/app-signing
- Exact alarm behavior: https://developer.android.com/about/versions/14/changes/schedule-exact-alarms
