# Edgecipline Pre-Launch War Room Audit

Audit date: 2026-06-09

Scope: local static/source audit of frontend, backend, OCR upload, auth, analytics, weekly reports, security, performance, and Capacitor readiness. I did not run full browser/device/manual flows, so findings are evidence-based from code, config, logs, and app structure.

## Readiness Scores

- Production Readiness Score: 42/100
- Security Score: 31/100
- Mobile Readiness Score: 45/100
- UX Readiness Score: 52/100
- Performance Score: 38/100

## Launch Decision

Would I launch Edgecipline today?

NO.

The product has useful structure, but it is not launch-ready. The biggest blockers are committed secrets/logs, OCR reliability and data leakage risk, inconsistent/duplicated analytics calculations, frontend mojibake, expensive analytics reads, brittle mobile auth persistence, and missing evidence of full lifecycle QA. Shipping now would risk user data exposure, broken trust, stale dashboard numbers, failed uploads, and unexpected logouts.

## Top 20 Launch Blockers

1. CRITICAL - Committed production-like secrets
   - Description: `backend/.env` contains Gemini, Cloudinary, JWT, and Mongo credential material.
   - Root Cause: Real environment file committed into the repo.
   - Impact: Account takeover, Cloudinary abuse, JWT forgery, database exposure.
   - Reproduction Steps: Open `backend/.env`; see `GEMINI_API_KEY`, `JWT_SECRET`, `CLOUD_API_SECRET`, Mongo URI comments.
   - Fix Recommendation: Rotate all exposed secrets, purge from git history, commit only `.env.example`, add secret scanning to CI.

2. CRITICAL - Committed backend logs expose user/trade data and Cloudinary image URLs
   - Description: `backend/logs/combined.log` contains user IDs, trade IDs, OCR payloads, image URLs, extracted trade details, quota errors, and auth errors.
   - Root Cause: Runtime logs are checked into source control and contain high-detail debug payloads.
   - Impact: Sensitive trading screenshots and user activity can leak to anyone with repo access.
   - Reproduction Steps: Search `backend/logs/combined.log` for `imageUrl`, `userId`, `tradeId`, or `Gemini Vision extraction`.
   - Fix Recommendation: Remove logs from repo/history, add `backend/logs/` to `.gitignore`, redact OCR/trade payloads in logger calls.

3. CRITICAL - Auth refresh replay still appears in real logs
   - Description: Logs show `TOKEN_REPLAY_DETECTED` on `/api/auth/refresh` despite frontend singleton refresh code.
   - Root Cause: Multi-tab/app startup refresh race is not fully controlled across browser tabs or app processes.
   - Impact: Legit users can be logged out unexpectedly; refresh family revocation can kill sessions.
   - Reproduction Steps: Expire access token, open multiple tabs or reload routes in parallel; observe `/api/auth/refresh` races.
   - Fix Recommendation: Add cross-tab refresh lock with `BroadcastChannel`/storage lock, server-side grace for immediately repeated same-token rotations, and automated multi-tab tests.

4. CRITICAL - OCR upload creates durable draft trades before extraction succeeds
   - Description: `backend/services/upload.service.js` creates a trade row before OCR completes, then frontend tries to clean drafts by calling delete.
   - Root Cause: Upload job persistence and final trade persistence are coupled.
   - Impact: Ghost trades, failed/pending rows, stale OCR state, wrong analytics if visibility filters miss an edge case.
   - Reproduction Steps: Upload, navigate away or logout mid-process, then inspect trade collection/status endpoints.
   - Fix Recommendation: Store OCR jobs in a separate collection until user confirms save, or mark drafts with strict TTL and exclude everywhere by a shared query helper.

5. CRITICAL - Source contains widespread mojibake/encoding corruption
   - Description: Files show `-`, `->`, `-`, replacement characters, and previous `??` icon replacements.
   - Root Cause: Mixed encodings or bad copy/paste conversion.
   - Impact: Broken UI text/icons, unprofessional launch feel, possible JSX/string rendering defects.
   - Reproduction Steps: Search source for mojibake lead bytes and replacement characters such as U+00E2, U+00C3, U+FFFD; examples include `frontend/services/api.js`, `frontend/utils/auth.js`, `backend/models/Trade.js`.
   - Fix Recommendation: Normalize all source to UTF-8, replace corrupted text, add CI grep for mojibake patterns.

6. CRITICAL - Analytics endpoints load full trade sets repeatedly
   - Description: `backend/controllers/analyticsController.js` and `indianAnalyticsController.js` use repeated `Trade.find(query).lean()` for many endpoints.
   - Root Cause: Metric computation is request-time in JS across full user history.
   - Impact: 10k-50k trade users will trigger slow responses, memory pressure, and rate-limit retries.
   - Reproduction Steps: Seed 50k trades, open analytics page; observe 10+ full reads.
   - Fix Recommendation: Build aggregate pipelines, cached snapshots, pagination, and reuse shared analytics snapshot service.

7. CRITICAL - Frontend analytics fires many parallel deep requests
   - Description: `frontend/features/analytics/hooks/useAnalytics.js` launches 11 analytics queries after core data.
   - Root Cause: Dashboard-style page decomposes every card into a separate API request.
   - Impact: 429s, slow mobile load, inconsistent partial states.
   - Reproduction Steps: Open `/analytics` on fresh login and inspect network panel.
   - Fix Recommendation: Use one `advanced`/snapshot endpoint for the page or batch with server-side fanout and cache.

8. CRITICAL - Analytics formulas are duplicated across Forex, Indian, timeline, discipline, weekly reports
   - Description: Controllers contain separate calculations for win rate, PnL, psychology score, discipline, DNA, patterns, and reports.
   - Root Cause: No single metric contract/shared calculation module.
   - Impact: Dashboard, analytics, weekly reports, timeline, and coach can disagree.
   - Reproduction Steps: Compare PnL/win-rate calculations in `analyticsController.js`, `indianAnalyticsController.js`, `weeklyReport.service.js`, and timeline utilities.
   - Fix Recommendation: Centralize metric primitives and snapshot schema, then make all surfaces consume the same result.

9. CRITICAL - AI/OCR provider quota and timeout failures are visible in logs
   - Description: Logs show 503 high demand, daily quota failures, JSON parsing failures, and 90s timeouts.
   - Root Cause: Launch depends on a fragile/free-tier or under-provisioned AI extraction path.
   - Impact: Core OCR import can fail during onboarding; first impression breaks.
   - Reproduction Steps: Upload several screenshots; inspect logs for `Gemini Vision extraction failed`, quota, timeout.
   - Fix Recommendation: Provision paid quota, add provider fallback/circuit breaker, surface retryable failures clearly, queue/backoff by provider limits.

10. CRITICAL - Access token is persisted in Android localStorage
    - Description: `frontend/utils/auth.js` intentionally stores access token in `localStorage` on Capacitor.
    - Root Cause: App restart persistence is handled with web storage instead of secure native storage.
    - Impact: Token theft risk on compromised WebView/device backup/debug contexts.
    - Reproduction Steps: On Android, login and inspect WebView localStorage for key `token`.
    - Fix Recommendation: Use Capacitor Preferences/Secure Storage or native credential storage; keep access token memory-only where possible.

11. CRITICAL - Admin token secret falls back to user JWT secret
    - Description: `backend/config/index.js` allows `ADMIN_JWT_SECRET` to be null and fallback behavior exists in admin auth.
    - Root Cause: Secret separation is optional.
    - Impact: User/admin token domain separation is not guaranteed in production.
    - Reproduction Steps: Start without `ADMIN_JWT_SECRET`; inspect admin auth token signing.
    - Fix Recommendation: Require `ADMIN_JWT_SECRET` in production and fail startup when missing.

12. CRITICAL - Indian trade delete hard-deletes while Forex soft-deletes
    - Description: `backend/controllers/indianTradeController.js` uses `findOneAndDelete`; Forex uses soft delete.
    - Root Cause: Lifecycle semantics differ by market.
    - Impact: Restore, audit trail, reports, and support recovery are inconsistent.
    - Reproduction Steps: Delete a Forex trade and an Indian trade; only Forex can be recovered from `deletedAt`.
    - Fix Recommendation: Implement soft delete for Indian trades and shared lifecycle helpers.

13. CRITICAL - Global rate limiter fails open
    - Description: `backend/middleware/rateLimiter.js` allows requests if Redis is unavailable.
    - Root Cause: Availability prioritized over abuse protection.
    - Impact: Login/upload endpoints lose rate limiting during Redis outage.
    - Reproduction Steps: Stop Redis and attempt repeated auth/upload requests.
    - Fix Recommendation: Use in-memory fallback limiter for auth/upload/admin destructive routes; alert on Redis outage.

14. CRITICAL - Query debug counts run in normal trade listing
    - Description: `backend/repositories/trade.repository.js` runs several `countDocuments` and `distinct` calls alongside every forex trade list.
    - Root Cause: Debug instrumentation left in hot path.
    - Impact: Extra DB load and slower dashboard/trade journal under scale.
    - Reproduction Steps: Hit `/api/trades`; inspect DB operations: list plus five debug counts.
    - Fix Recommendation: Remove debug counts or guard behind explicit debug endpoint/env flag.

15. CRITICAL - Upload cancellation does not cancel backend jobs
    - Description: Frontend clears state and deletes draft best-effort, but queued BullMQ job may continue.
    - Root Cause: No cancel API/job ownership cancellation flow.
    - Impact: Deleted/cancelled uploads can still process, write logs, or fail noisily.
    - Reproduction Steps: Upload then immediately clear/navigate away; inspect queue/job logs.
    - Fix Recommendation: Add cancel endpoint that removes/deduces job and tombstones draft before worker processes it.

16. CRITICAL - OCR draft cleanup hardcodes Forex delete from frontend
    - Description: `useUploadTrade.js` calls `deleteTrade(draftId, "Forex")` during cleanup.
    - Root Cause: Cleanup path does not respect actual market/draft collection.
    - Impact: Indian uploads can leave orphan draft records or fail cleanup.
    - Reproduction Steps: Start Indian OCR upload and switch file/navigate away; inspect failed delete or orphan row.
    - Fix Recommendation: Backend-owned draft cleanup by job ID; frontend should not guess market collection.

17. CRITICAL - Full raw OCR/AI text is stored on trade documents
    - Description: `Trade` model has `rawOCRText`, `aiRawResponse`, `parsedData`, `extractedText`.
    - Root Cause: Debug/inspection data stored beside user trade records.
    - Impact: PII/screenshot-derived content persists and can be overexposed.
    - Reproduction Steps: Inspect a completed OCR trade document.
    - Fix Recommendation: Store minimal safe extraction metadata; move raw payloads to short-retention encrypted store with strict access.

18. CRITICAL - No evidence of automated lifecycle consistency tests
    - Description: Trade create/edit/delete/import/restore consistency across dashboard, analytics, timeline, DNA, reports is not covered in visible test scripts.
    - Root Cause: Product-critical invariants are not encoded as tests.
    - Impact: Stale cache and metric drift can ship silently.
    - Reproduction Steps: Search backend/frontend tests for lifecycle assertions across surfaces.
    - Fix Recommendation: Add integration tests around shared seeded datasets and expected metrics per surface.

19. CRITICAL - Mobile build config is incomplete for production verification
    - Description: Capacitor config exists, but no evidence of deep links, secure storage, network/offline handling, or Android release QA.
    - Root Cause: Mobile-specific launch checklist is not encoded.
    - Impact: Users may be logged out, stuck offline, or blocked by keyboard/viewport issues.
    - Reproduction Steps: Build Android, cold start after process kill/offline, verify auth and routes.
    - Fix Recommendation: Add Capacitor QA matrix, secure storage, app lifecycle hooks, and automated smoke tests.

20. CRITICAL - Production artifact and backup files are committed under frontend
    - Description: `frontend/android.zip`, `.bak` icon/favicon files, and generated artifacts exist under source.
    - Root Cause: Generated/binary files not excluded.
    - Impact: Bloated repo, noisy scans, accidental stale mobile artifacts.
    - Reproduction Steps: List `frontend`; see `android.zip`, `favicon.ico.bak`, `icon.png.bak`.
    - Fix Recommendation: Remove generated artifacts, update `.gitignore`, rebuild artifacts only in CI.

## Top 20 High Priority Issues

1. HIGH - `analyticsApi.js` uses raw `fetch`, bypassing central axios refresh/retry behavior. Repro: expire token then call analytics endpoint. Fix: route analytics through `apiClient`.
2. HIGH - `analyticsApi.js` logs non-JSON server responses to console. Repro: force 500 HTML response. Fix: remove response body logging or redact.
3. HIGH - OCR frontend swallows some backend cleanup errors. Repro: delete draft with bad ID, see silent catch. Fix: surface cleanup telemetry.
4. HIGH - Multi-trade screenshot path uses ghost trade logic. Repro: inspect `parsedData.multiTradeGhost`. Fix: model multi-trade extraction as job result, not hidden trade rows.
5. HIGH - Indian analytics repeatedly loads full collection with `.lean().sort()`. Repro: seed 10k Indian trades, open analytics. Fix: aggregate/index.
6. HIGH - Timeline/discipline endpoints cap with `limit(50000)` and compute in memory. Repro: seed over 50k trades; results truncate. Fix: aggregate by date/period in DB.
7. HIGH - Weekly reports can inherit AI/metric inconsistencies. Repro: compare weekly report numbers with analytics same date window. Fix: consume metric snapshot.
8. HIGH - Refresh tokens are httpOnly cookies, but access tokens in JS remain XSS-sensitive. Repro: XSS can call `getValidToken`. Fix: strict CSP and reduce token exposure.
9. HIGH - CSP allows broad remote images if configured too widely in Next config (needs verification). Repro: inspect `next.config`. Fix: restrict image domains.
10. HIGH - CORS origin list depends on env; missing production fail-fast for empty allowed origins. Repro: start production without `ALLOWED_ORIGINS`. Fix: fail startup.
11. HIGH - Rate-limit keys verify JWT before auth middleware, adding crypto work to unauthenticated hot path. Repro: spam invalid bearer tokens. Fix: parse untrusted payload without verify or use IP until auth.
12. HIGH - File upload streams to Cloudinary after only header validation. Repro: polyglot image payload. Fix: re-encode images with Sharp before storage.
13. HIGH - Cloudinary cleanup is best-effort and can leak images. Repro: force DB failure after upload. Fix: durable cleanup queue.
14. HIGH - Upload job status returns trade `createdAt`/`tradeDate` but not enough stale-session guard. Repro: poll old job after new upload. Fix: include upload session token/version.
15. HIGH - User subscription free upload flag is marked after queue, not atomically with upload allowance. Repro: concurrent two uploads on free account. Fix: atomic user update/reservation.
16. HIGH - Dashboard and analytics cache invalidation depends on manual `clearUserCache`. Repro: update trade through any path that misses cache clear. Fix: central repository lifecycle hooks/events.
17. HIGH - Admin dashboard reads large global collections with pagination but no scoped projections in all places. Repro: inspect admin controllers. Fix: projection and indexes.
18. HIGH - Login lockout only increments for existing users. Repro: brute force unknown emails. Fix: add IP/email hash limiter.
19. HIGH - Password reset token is stored raw. Repro: inspect `resetPasswordToken`. Fix: hash reset token like OTP/refresh token.
20. HIGH - App has visible disabled/dead UI blocks in dashboard diff (`false &&`, `display: none`). Repro: inspect `frontend/app/dashboard/page.js`. Fix: remove dead UI or feature flag intentionally.

## Top 20 Medium Priority Issues

1. MEDIUM - Comments and UI strings mix British/US spellings and corrupted punctuation. Fix: copy audit.
2. MEDIUM - Inline style-heavy pages are hard to enforce responsive consistency. Fix: move recurring layout primitives to shared components.
3. MEDIUM - Analytics empty states can hide errors because optional query errors return `null`. Fix: separate empty vs failed state.
4. MEDIUM - `useAnalytics` imports `useRouter` but does not use it. Fix: remove unused imports.
5. MEDIUM - Client-side rate limiter is per module instance and not cross-tab. Fix: shared storage/BroadcastChannel bucket.
6. MEDIUM - API timeout is 10s frontend while OCR/status workflows can run much longer. Fix: tailor timeout per endpoint.
7. MEDIUM - Status polling rate limit is 30/min, easy to hit with multiple tabs/uploads. Fix: server push or exponential polling.
8. MEDIUM - `Trade` model allows many optional numeric fields without business-level validation. Fix: validate price/quantity/PnL by market type.
9. MEDIUM - Emotion/tag insights use low samples in places. Fix: minimum sample thresholds everywhere.
10. MEDIUM - Psychology/DNA copy can sound conclusive on small datasets. Fix: confidence labels and suppress under threshold.
11. MEDIUM - Backup files under app folder confuse asset ownership. Fix: delete backups.
12. MEDIUM - `favicon.ico.bak` binary was scanned as text. Fix: exclude binaries from source scans/linters.
13. MEDIUM - Indian market and Forex API naming is inconsistent (`/indian`, `/indian-market`, marketType). Fix: document and normalize.
14. MEDIUM - Upload date clamp is frontend-only in places; backend normalizes but should reject impossible dates consistently. Fix: shared validation response.
15. MEDIUM - Logs include stack traces in responses/logs that may reveal paths. Fix: production error serializer.
16. MEDIUM - Sentry config should be verified for PII scrubbing beyond headers/cookies. Fix: add tests for event scrubber.
17. MEDIUM - Admin destructive operations have rate limiter but should require re-auth for dangerous changes. Fix: step-up auth for delete/user changes.
18. MEDIUM - Push notification bootstrap runs globally. Fix: ensure no prompts before user intent/permission flow.
19. MEDIUM - Weekly reports have cron enabled by default. Fix: production opt-in and idempotency locks.
20. MEDIUM - No visible load-test baseline artifacts for 1k/10k/50k trades. Fix: add repeatable seed/load scripts and thresholds.

## Top 20 Low Priority Issues

1. LOW - Repo/package typo: backend package name is `tradeing-ai-platform`. Fix package metadata.
2. LOW - App id typo-like value `com.edgecpline` may be accidental. Fix before Play Store registration.
3. LOW - Some source comments use decorative separators that became mojibake. Fix to plain ASCII.
4. LOW - Console warnings remain in hot code paths. Fix with structured logger/gated debug.
5. LOW - Some UI cards use 10-14px radii while design guidance prefers 8px or system standard. Fix during polish.
6. LOW - Analytics page has multiple similarly named routes (`/trading-dna` and `/analytics/trading-dna`). Fix navigation clarity.
7. LOW - First-time trader may not understand setup score vs discipline score. Fix microcopy after metric correctness is solved.
8. LOW - Admin and user routes use different auth storage patterns. Fix docs and naming.
9. LOW - Some text uses "AI" prominently where data confidence may be low. Fix trust language.
10. LOW - Empty state copy should tell users whether sample size is insufficient vs no trades. Fix copy.
11. LOW - Several files mix `.js`, `.tsx`, and inline styles. Fix gradually.
12. LOW - No visible storybook/component snapshots. Fix for design regression prevention.
13. LOW - Query keys are string arrays but not centralized. Fix key factory later.
14. LOW - Multiple API wrappers exist (`apiClient`, `analyticsApi`). Fix consolidation.
15. LOW - Some routes have duplicate layout files with little content. Fix after launch blockers.
16. LOW - Build artifacts make repo search slower. Fix ignore cleanup.
17. LOW - Payment copy/price should be audited for trust after security blockers. Fix product QA.
18. LOW - Support/feedback upload needs same re-encode policy as trade screenshots. Fix with shared upload sanitizer.
19. LOW - Dashboard hidden feature grid should be cleaned up to reduce maintenance confusion. Fix dead code.
20. LOW - The old `AUDIT_ISSUES.md` should be reconciled with this report. Fix by merging into one launch tracker.

## Immediate Fix Order

1. Rotate and purge secrets/logs.
2. Remove generated/binary artifacts and add ignore rules.
3. Fix mojibake across source and add CI guard.
4. Harden auth refresh across tabs/mobile and require admin secret separation.
5. Redesign OCR persistence around jobs/drafts, not visible trade rows.
6. Centralize metric calculations and analytics snapshots.
7. Replace full-scan analytics endpoints with aggregate/cached endpoints.
8. Run browser + Android QA matrix for auth, OCR, trade lifecycle, and analytics consistency.
