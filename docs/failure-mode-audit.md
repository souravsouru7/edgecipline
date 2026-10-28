# Failure-mode audit

Audited 2026-10-14 against branch `staging` (HEAD `4392b5d`). Every claim below is
read from source and cited as `file:line`. Config keys are named with the default
that applies when the env var is unset.

**Headline:** the failure paths are, on the whole, deliberately built — atomic
status-guarded writes, dedupe keys with unique indexes, delivery leases,
distributed cron locks, token pruning, acknowledgement sweeps. The gaps that
remain are concentrated in four places:

1. a screenshot job can poll forever on the client when no OCR worker is running;
2. the client HTTP deadline is shorter than the server's, and trade creation has
   no idempotency key, so a slow network can produce a phantom write;
3. a Google Play renewal RTDN that is never delivered is never recovered, and the
   paying user loses access;
4. `/health` reports 503 for conditions the app actually survives.

Section 1 of the brief asked specifically about quota refunds on extraction
failure. That is handled — see 1.9. It asked whether partial extraction is
pre-filled on the failure screen. It is not — see 1.7.

---

## 1. Screenshot extraction

| Scenario | Current behaviour | User-visible result | Sev | Gap |
|---|---|---|---|---|
| 1.1 No OCR worker process running (crashed, not deployed, PM2 app stopped) | Job enqueues fine; the BullMQ job sits in `waiting` indefinitely. `getOcrJobStatus` only reaches the stale-recovery branch when `!queueState` (`backend/services/ocrJob.service.js:409`), and here `queueState` is present and `waiting`, so nothing ever reconciles. `OCRJob.status` stays `PENDING`. | Spinner forever. `refetchInterval` returns `4000` for any non-terminal status (`frontend/features/trade/hooks/useUploadTrade.js:1053-1060`) with no elapsed-time ceiling; `loading` is `!!jobId` (line 1166). No timeout copy, no retry button. Closing and reopening the app restores the job and resumes polling for up to 12h (`ACTIVE_UPLOAD_JOB_MAX_AGE_MS`, line 73). The row is reaped only by the 24h TTL (`OCR_JOB_TTL_HOURS`, default 24, line 16). | **P0** | No reaper for a job whose queue entry exists but is never consumed, and no client-side polling deadline. |
| 1.2 Gemini 403 from a project whose Billing Tier reads "Unavailable" | Classified neither 429 nor timeout, so `getFriendlyProcessingError` falls through to `return error?.message` (`backend/services/tradeProcessingService.js:1476`). Stored verbatim in `OCRJob.error` (`backend/services/ocrJob.service.js:659`). The client's `FAILED` branch likewise falls through to `normalizedRawError` (`useUploadTrade.js:1124`) and calls `setError(userMessage)` directly. | Raw Google API text rendered on screen. `utils/userMessage.js` is bypassed entirely on this path — `setError` takes the string as-is. | **P0** | No `PERMISSION_DENIED`/403 branch in the friendly-error mapper, and the OCR failure screen does not route through `getUserMessage`. |
| 1.3 Gemini 429 / RESOURCE_EXHAUSTED | Mapped to "Our AI is currently busy due to high demand…" (`tradeProcessingService.js:1467-1469`); retried per `OCR_JOB_ATTEMPTS` (default 3) with exponential backoff from `OCR_JOB_BACKOFF_MS` (default 5000). | Correct, actionable copy. | — | Handled well. |
| 1.4 Vision OCR timeout or outage | Call sites wrap it in `withTimeout` (`tradeProcessingService.js:359`, `963`), so it cannot hang. But `extractTextWithVision` swallows every error and returns `null` (`backend/services/visionOcrService.js:148-151`), using `console.error`, not `logger`. | Pipeline silently proceeds to the Tesseract/AI path; usually degrades to a weaker extraction rather than a hard failure. | P2 | A Vision outage is indistinguishable from "no text in image", and `console.error` reaches neither the structured logs nor Sentry — a sustained Vision outage is invisible. |
| 1.5 Partial extraction (symbol present, P&L missing) | `hasUsableTradeData` accepts a row with a symbol *or* any one present number (`ocrJob.service.js:81-97`), so the job completes and the review screen opens with what was read. | Correct — the review screen is the right place for this. | — | Handled well, and deliberately (see the comment at `ocrJob.service.js:74-80`). |
| 1.6 Nothing extracted at all | `OCR_EMPTY_RESULT`, non-retryable, with specific copy naming the fields needed (`ocrJob.service.js:596-600`). | Actionable. | — | Handled well. |
| 1.7 Terminal failure of any kind | `clearOcrSession(...)` runs before `setError` (`useUploadTrade.js:1128`), discarding the session including anything partially extracted. | The user lands on an empty form. The screenshot is still in Cloudinary for ~22h, and there is no endpoint to reuse it — `uploadRoutes.js` exposes status and cancel but no retry. Re-uploading is the only path. | P2 | The brief asked for partial pre-fill on the failure screen; it is not implemented. No retry-from-stored-image endpoint. |
| 1.8 Wrong-broker / wrong-market screenshot | `WRONG_MARKET_TYPE` is non-retryable (`ocrJob.service.js:64`) and its message passes through unmodified by design (`tradeProcessingService.js:1464-1466`); the client shows it verbatim (`useUploadTrade.js:1112`). | Correct. | — | Handled well. |
| 1.9 Quota on failure | Trade quota is a **lifetime count of Trade documents** (`backend/services/tradeQuotaService.js:48-61`) and the OCR path runs with `persistTrade: false` (`ocrJob.service.js:580`), so a failed extraction cannot consume trade quota. The separate free-tier single-upload claim *is* refunded on terminal failure, guarded on the account never having succeeded (`restoreFreeUploadAfterFailure`, `ocrJob.service.js:220-252`, called at line 668). | Nothing is burned for nothing. | — | Handled well — the equivalent of what `cc6bbc8` did for `coachQuotaService.refundUsage` (`backend/services/coachQuotaService.js:120`) is already in place here. |
| 1.10 BullMQ attempts exhausted | The worker enqueues an `ocr_failed` push, reports to Sentry, records in `jobFailureTracker` (`backend/workers/ocrWorker.js:140-186`); the service writes `FAILED` + friendly error (`ocrJob.service.js:655-666`). | Terminal state the UI reads, plus a push. | — | Handled well. |
| 1.11 Worker killed mid-job (SIGKILL / OOM restart) | The BullMQ lock expires after `OCR_WORKER_LOCK_DURATION_MS` (default 300000), the job is marked stalled and redelivered up to `OCR_WORKER_MAX_STALLED_COUNT` (default 2). | Recovers. | P2 | `PROCESSING_TIMEOUT_MS` (default 300000, `backend/config/index.js:472`) **equals** the lock duration (`config/index.js:120`). A job that runs to its own deadline expires its lock at the same instant, so a second worker can pick it up while the first is still unwinding. The lock should exceed the pipeline deadline with margin. |
| 1.12 Redis down at enqueue time | `createOcrJob` catches, writes `FAILED` with a retryable message, and returns 503 `OCR_QUEUE_UNAVAILABLE` without leaking the Lua/OOM text (`ocrJob.service.js:178-195`). Covered by `backend/__tests__/unit/ocrJobWorkflow.test.js:79`. | "The extraction queue is temporarily unavailable. Please upload the screenshot again in a moment." | — | Handled well. |
| 1.13 Queue entry vanishes after enqueue (Redis flush / eviction) | After `OCR_STALE_PENDING_MS` (default 300000) or `OCR_STALE_PROCESSING_MS` (default 720000), re-enqueued up to `OCR_QUEUE_RECOVERY_ATTEMPTS` (default 2), then `FAILED` (`ocrJob.service.js:330-422`). Covered by `ocrJobWorkflow.test.js:377`. | Recovers, or fails cleanly after ~36 min worst case. | P3 | Recovery is driven **only** by a client poll. A user who closes the app during processing leaves the row `PROCESSING` until the 24h TTL, with the `ocr_failed` push never sent. |
| 1.14 Trade creation fails after the confirm claim | `claimOcrJobForConfirmation` is a single-writer `COMPLETED → CONFIRMED` gate (`ocrJob.service.js:262-306`); `releaseOcrJobClaim` returns it to `COMPLETED` on failure (lines 313-327). Covered by `ocrJobWorkflow.test.js:810`. | Retryable, no orphan. | — | Handled well. |

### Stuck-job reaper: no

There is no background sweep over `OCRJob` rows in `PENDING`/`PROCESSING`. Every
recovery branch lives inside `getOcrJobStatus`, i.e. it fires only when a client
polls. `ocrScreenshotRetentionCron` deletes Cloudinary assets but never touches
job status (`backend/jobs/ocrScreenshotRetentionCron.js:41-85`).

---

## 2. Notifications

| Scenario | Current behaviour | User-visible result | Sev | Gap |
|---|---|---|---|---|
| 2.1 Token expired / unregistered / malformed | Three FCM codes classified as permanent; `disableInvalidTokens` sets `enabled: false, revokedAt` (`backend/services/notificationService.js:109-115`, `291-297`). Rows also TTL out after 90 days idle (`backend/models/DeviceToken.js:62`). | Silent, correct. | — | Handled well. Dead tokens are pruned. |
| 2.2 Duplicate send on BullMQ retry | Two layers. `NotificationHistory` has `{user, dedupeKey}` unique (`backend/models/NotificationHistory.js:194`); an E11000 resumes rather than re-sends, and returns early if already `sent` (`notificationService.js:456-470`). Per-device, `sendPushToUser` excludes `acceptedTokenIds` from the retry (`notificationService.js:327-329`, `508-513`), so a partial success never re-notifies an already-reached device. | No duplicates. | — | Handled well — the strongest part of this audit. |
| 2.3 Send-once per (user, type, day) | Not a generic mechanism; it depends on each caller's `dedupeKey`. The OCR path uses `ocr-completed:<jobId>` (`backend/workers/ocrWorker.js:120`), which is per-job, not per-day. | — | P3 | Per-day idempotency exists only where a caller encodes a date in its own `dedupeKey`. There is no enforced convention, so a new notification type can ship without one. |
| 2.4 Transient FCM failure | `messaging/internal-error`, `server-unavailable`, `quota-exceeded` and the rate-limit codes are classified transient (`notificationService.js:116-123`); `notifyUser` deliberately throws `FCM_TRANSIENT_FAILURE` to trigger a BullMQ retry (`notificationService.js:555-560`), `SMART_NOTIFICATION_ATTEMPTS` default 3. | Retried, then dead-lettered to Sentry with a `dead_letter` tag (`backend/workers/smartNotificationWorker.js:124-137`). | — | Handled well. |
| 2.5 Device offline when the push is sent | FCM TTL: 1h for the `edgecipline_risk` channel, 24h otherwise (`notificationService.js:307`). The in-app inbox row persists regardless. | Push may be dropped by FCM; the inbox row survives. | — | Correct design. |
| 2.6 OS permission revoked after being granted | Not detected server-side. The token stays `enabled` and FCM keeps accepting sends against it, so `successCount` is non-zero and nothing is ever delivered. | Silent non-delivery. The inbox row says `sent`. | P2 | `failureCount` is incremented but never acted on (`notificationService.js:386-390`) — no threshold disables a token. The client should re-check permission on resume and revoke its own token. |
| 2.7 Cron overlapping itself | 12 of 15 crons take a distributed lock with a tick key. Three do not: `dataCleanupCron`, `ocrScreenshotRetentionCron`, `missionProgressCron`. | Safe today — `instances: 1` for `edgecipline-api` (`backend/ecosystem.config.js:6`). | P3 | Latent: the moment the API scales past one instance, those three double-run. |
| 2.8 Cron skipping a run (process restart over the window) | `node-cron` has no catch-up. Most senders are idempotent via `dedupeKey`, so a late run is safe, but a missed window is simply not sent. | Missed nudge or reminder for that day. | P3 | No missed-run detection. `cronMetrics` records runs that happen (`backend/utils/cronMetrics.js`) but nothing alerts on a run that did not. |
| 2.9 Quiet hours / timezone | Per-user timezone validated through `Intl`, falling back to `Asia/Kolkata` with a warning (`notificationService.js:187-209`); midnight-crossing windows handled (`isTimeWithinQuietHours`, lines 213-221). An unparseable quiet-hours config fails **closed** — it blocks the send (line 231). Covered by `notification-quiet-hours.test.js` and `smartNotificationTimezone.test.js`. | Correct for users whose local day differs from the server's. | — | Handled well. |
| 2.10 Notification fires for a stale condition | The smart-check job carries only `tradeId` and the worker re-reads the trade (`backend/queues/smartNotificationQueue.js:16-19`), returning `{skipped: true}` if it was deleted (`smartNotificationWorker.js:76-80`). | Correct. | — | Handled well. |
| 2.11 Observability | Every outcome has a stable log id (`NOTIFICATION_CREATED/QUEUED/SENT/SKIPPED/FAILED`, `SMART_WORKER_DEAD_LETTER`) and skip reasons are a frozen enum (`notificationService.js:402-408`). | — | — | Handled well. |

---

## 3. Slow network / flaky mobile connection

| Scenario | Current behaviour | User-visible result | Sev | Gap |
|---|---|---|---|---|
| 3.1 Retried POST creating a duplicate trade | **No automatic POST retry exists**, which is what currently prevents duplicates: `apiClient` retries only 429 (up to 3, `frontend/services/apiClient.js:487-499`) and 401-once (lines 522-527) — there is no 5xx or network-error retry — and React Query's `retry: 1` applies to queries only; mutations keep the library default of 0 (`frontend/app/providers.tsx:55`). | Safe today by omission. | **P0** | `POST /trades` carries **no idempotency key** — nothing in `frontend/services/tradeApi.js:14` or the backend accepts or enforces one. The protection is "we never retry", which any future retry policy, a user double-tap on a slow link, or an OS-level request replay silently removes. `smartNotificationQueue`'s `jobId` idempotency (lines 52-56) protects the *notification*, not the trade. |
| 3.2 Client vs server deadline | Client default `timeout: 10000` (`apiClient.js:121`). Server `API_REQUEST_TIMEOUT_MS` default 15000 (`backend/config/index.js:467`). **The client gives up 5s before the server does.** | On a slow link the user sees "Request timed out. Please try again." while the server runs to completion and commits the write. Combined with 3.1 and a user retap, this is the concrete duplicate-trade path. | **P0** | The client deadline must exceed the server's, or the server's must be cut below the client's. Only the upload routes get this right — they extend the server to `UPLOAD_REQUEST_TIMEOUT_MS` (default 60000, `backend/routes/uploadRoutes.js:25`) under a 120–180s client budget (`frontend/services/uploadApi.js:14`, `30`, `52`). |
| 3.3 Image upload on a slow link | Server deadline extended per-route; client waits 120s (single) / 180s (batch). | Completes on slow links. | P2 | No `onUploadProgress` and no `AbortController` on any upload call — a grep over `frontend/services` and `frontend/utils/imageUpload.js` finds neither. A 180s batch upload is an unquantified wait the user cannot cancel. No resume. |
| 3.4 Stale cached data | React Query persisted to storage with `staleTime` 2 min and `gcTime = PERSISTED_CACHE_MAX_AGE_MS` (`providers.tsx:51-54`, `frontend/utils/persistedQueryCache.js`). | Instant paint from the last session. | P2 | Stale data is **not labelled** anywhere. The only signal is `OfflineBanner`'s "showing saved data", which appears only while offline — a server outage with the device online shows stale numbers with no indication of age. |
| 3.5 Reconnect behaviour | `refetchOnReconnect: false` (`providers.tsx:56`), but `OfflineBanner` compensates by calling `invalidateQueries({refetchType: "active"})` on the offline→online edge (`frontend/components/OfflineBanner.jsx:31`). | The active screen refreshes. | P3 | Only the *active* query refetches, and only on a transition the banner observed. A screen mounted after reconnect, or data that went stale during a server outage with no offline transition, is not refreshed. |
| 3.6 `OfflineBanner` accuracy | Not `navigator.onLine` alone: native uses `@capacitor/network`'s connectivity manager, web falls back to browser events, and React Query's `onlineManager` is fed from the same store (`frontend/utils/networkStatus.js:40-52`). | Better than the usual default. | P3 | `@capacitor/network`'s `connected` means "an interface exists", not "the server is reachable". The comment at `networkStatus.js:4-6` claims this fixes captive portals; it does not — a captive portal still reads online. There is no reachability probe. |
| 3.7 Offline writes | Rejected at the request interceptor before leaving the device, unless `allowOffline` (`apiClient.js:173-175`). | Immediate, honest failure. | P2 | Nothing is buffered. An offline trade submission is lost — the user must re-enter it. No mutation queue or replay. |
| 3.8 Infinite spinners | One confirmed: the OCR polling loop, 1.1 above. | — | **P0** | See 1.1. |
| 3.9 Client rate limiting | A sliding-window limiter mirrors the server's buckets so the UI cannot trigger server-side 429s (`apiClient.js:27-61`). | — | — | Handled well. |

---

## 4. Server and dependency failure

| Scenario | Current behaviour | User-visible result | Sev | Gap |
|---|---|---|---|---|
| 4.1 MongoDB unreachable at boot | 5 attempts, exponential 2s→32s (~62s total), then `process.exit(1)` (`backend/config/db.js:5-6`, `44-48`). PM2 `autorestart: true` → crash-loop until Mongo returns. | API down. | P3 | Correct for a hard dependency, but `connectDB()` is **not awaited** (`backend/server.js:92`) and `app.listen` runs regardless, so the process serves traffic before Mongo is up — `/health` reports 503 in that window, which is the right answer. |
| 4.2 MongoDB unreachable at runtime | `serverSelectionTimeoutMS: 10000`, `socketTimeoutMS: 30000` (`db.js:21-25`). | A 30s socket timeout exceeds the 15s request deadline, so the client sees a 408 before Mongo gives up. | P3 | `socketTimeoutMS` should sit below the request deadline so the error surfaced is the real one. |
| 4.3 Redis unreachable | **Graceful.** `cacheMiddleware` falls straight through to `next()` on `!isRedisReady()` and on any throw (`backend/middleware/cacheMiddleware.js:24-25`, `52-53`); `rateLimiter` switches to in-memory buckets with a bounded key count and a tracked `degraded` flag (`backend/middleware/rateLimiter.js:22-30`, `151-180`). Queue enqueues fail cleanly per 1.12. Covered by `rateLimiterFailure.test.js`. | Requests that only needed the cache still succeed. | — | Handled well. |
| 4.4 `/health` semantics | One snapshot serves `/` and `/health`. Mongo down → 503. **Redis down or rate limiter degraded → also 503** (`backend/server.js:516`). | A Redis blip returns 503 for a process that is serving requests correctly, per 4.3. | **P1** | "Alive" and "dependencies healthy" are conflated into one 503. If an ALB or uptime check targets `/health`, a Redis blip pulls a working instance out of rotation. Needs a `/live` (process up) separate from a `/ready`/`/health` that may report `degraded` with a 200. |
| 4.5 Boot-time env validation | Real enforcement is `requireEnv` in `backend/config/index.js:40-43` (throws on missing `MONGO_URI`, `CLOUD_NAME`, `CLOUD_API_KEY`, `CLOUD_API_SECRET`, and JWT secrets with a 32-char minimum), plus `parseTrustProxy` throwing in production when `TRUST_PROXY` is unset (`backend/config/trustProxy.js:25-30`). | PM2 crash-loop with a clear message — the documented `TRUST_PROXY` drift. | P2 | `backend/checkEnv.js` is a 9-line debug print, **not** a validator — it checks the SRV prefix and nothing else. There is no pre-deploy command that diffs the server `.env` against `.env.example`, which is the actual recurring failure. |
| 4.6 Gemini / Cloudinary / Vision / FCM down | Boot proceeds; each is checked at use. Vision degrades silently (1.4); Gemini surfaces per 1.2/1.3; a Cloudinary destroy failure is caught and logged (`ocrJob.service.js:707-709`). | Feature-local degradation. | — | Correct: these are not boot blockers. |
| 4.7 Razorpay misconfigured while the free limit is enforced | Warned loudly at boot — a user who hits the limit with no checkout available is called out explicitly (`backend/services/tradeQuotaService.js:20-27`). | — | — | Handled well. |
| 4.8 Google Play credentials unusable | `assertCredentialsUsable` at boot, `process.exit(1)` on failure, with the comment "a half-working billing path costs customers money" (`backend/server.js:164-177`). | Refuses to boot. | — | Correct call. |
| 4.9 Client error discrimination | `getUserMessage` checks `isConnectivityError` **first** (`frontend/utils/userMessage.js:126`), and that predicate returns true for `ETIMEDOUT`, the word `timeout`, the whole `ERR_CONNECTION_*` family, and `status === 0` (lines 92-108). | A request that times out against a *reachable but slow* server tells the user "You appear to be offline." A real 502 from nginx has `status: 502` and an empty body, so it misses every branch and lands on the caller's generic fallback. | **P1** | 5xx, 502-from-proxy, DNS failure and timeout are collapsed into two buckets, and timeout lands in the wrong one. The comment at `userMessage.js:103` says "The API layer surfaces an upstream outage as a 5xx with no body" but the code then tests `status === 0` — the stated intent and the check disagree. |
| 4.10 Error-message centralisation | `userMessage.js` is well designed — technical-string detection, Sentry capture paired with the user sentence in `reportUserError`. But it is used in only **6** files across `frontend/app`, `frontend/features` and `frontend/components`, while **15** put a raw `err.message` into component state. | Inconsistent copy; the 1.2 leak is one instance. | **P1** | Adoption, not design. The OCR failure screen is the highest-traffic bypass. |
| 4.11 Worker crash resilience | `ocrWorker` deliberately suppresses `unhandledRejection`/`uncaughtException` and reports to Sentry instead of exiting, with the reasoning written out (`backend/workers/ocrWorker.js:22-59`); `withTimeout` attaches a no-op catch to the losing promise for the same reason (`backend/utils/withTimeout.js:46`). | In-flight jobs are not orphaned by a PM2 restart. | — | Handled well. |

---

## 5. Payments and webhooks

| Scenario | Current behaviour | User-visible result | Sev | Gap |
|---|---|---|---|---|
| 5.1 Webhook delivered twice (Razorpay) | Unique `eventId` plus a processing lock with stale takeover; a duplicate returns `{locked: false, processed: true}` (`backend/services/razorpayWebhookService.js:204-252`). HMAC verified before the upsert (lines 268-269). Covered by `razorpayWebhook.test.js` and `razorpayWebhookRoute.test.js`. | No double fulfilment. | — | Handled well. |
| 5.2 Webhook delivered twice (Play RTDN) | Same shape, keyed on Google's own notification id with a token+time composite fallback (`backend/services/googlePlayNotificationService.js:192-243`). OIDC verified before the upsert (line 457). Covered by `googlePlayNotifications.test.js`. | No double fulfilment. | — | Handled well. |
| 5.3 Webhooks arriving out of order | The `PlaySubscription` upsert filter carries an ordering clause; losing the race adopts the fresher winner's snapshot via `settleStaleSync` rather than overwriting it (`backend/services/googlePlayBillingService.js:477-495`). An upgrade or downgrade retires the predecessor through `linkedPurchaseToken` so a user never appears to hold two live subscriptions (lines 497-515). Covered by `googlePlayLifecycle.test.js`. | Correct entitlement. | — | Handled well. |
| 5.4 Webhook received but processing fails | Left `processed: false` deliberately (`googlePlayNotificationService.js:444`); `webhookReconciliationCron` reprocesses every unprocessed event older than 10 min, routed by `provider` so a Play payload is never handed to the Razorpay reprocessor (`backend/jobs/webhookReconciliationCron.js:33-48`), and raises an operational alert on permanent failure with the money consequence spelled out (lines 51-60). Covered by `webhookReconciliation.test.js`. | Recovers. | — | Handled well. |
| 5.5 Renewal or cancellation RTDN **never arrives** | Nothing recovers it. `webhookReconciliationCron` reprocesses only events already **stored** in `WebhookEvent`; an undelivered notification has no row. `subscriptionExpiryCron` only downgrades users whose stored `subscriptionExpiry` has passed (`backend/jobs/subscriptionExpiryCron.js:23-39`) — it never re-reads Google. No cron calls `getSubscriptionPurchase`; the only callers are the live verify path and `playAcknowledgementSweepCron`. | **A paying subscriber whose renewal RTDN is lost is silently downgraded at expiry.** Mitigated only by the client re-verifying its held purchases on launch (`frontend/components/PlayBillingBootstrap.js:9`) — so recovery depends on the user opening the app, and a user locked out may well not. The mirror case is worse: a lost cancellation or refund RTDN leaves access granted indefinitely. | **P1** | No periodic pull-based reconciliation of active `PlaySubscription` rows against `purchases.subscriptionsv2.get`. |
| 5.6 Purchase succeeds client-side, server call fails | `PlayBillingBootstrap` re-reads device purchases on launch and has the backend re-verify (`PlayBillingBootstrap.js:9-15`), and `playAcknowledgementSweepCron` pushes unacknowledged rows back through `syncPurchase`. | Self-heals on the next launch or within the sweep window. | P3 | Both recovery paths need the purchase to have reached a `PlaySubscription` row. If the verify call never landed, only the client-side restore recovers it. |
| 5.7 Entitlement granted but Play acknowledgement fails | Explicitly solved. Acknowledge-before-grant ordering (`googlePlayBillingService.js:517-519`), and `playAcknowledgementSweepCron` exists precisely because Google auto-refunds unacknowledged purchases after three days — it re-pushes every unacknowledged row through `syncPurchase` and alerts past `alertAfterHours` (`backend/jobs/playAcknowledgementSweepCron.js:5-18`). Covered by `playAcknowledgementSweep.test.js`. | Money is not clawed back. | — | Handled well, and the best-documented failure path in the codebase. |

---

## Prioritised fix list

### P0

**1. Bound the OCR polling loop on the client.**
`frontend/features/trade/hooks/useUploadTrade.js:1053-1060` — track the poll start
(there is already `ocrStartedAtRef`) and return `false` from `refetchInterval`
once elapsed time passes a ceiling (10 min covers `PROCESSING_TIMEOUT_MS` of
300000 plus queue wait), then set an error with a retry affordance. Smallest
change that removes the forever-spinner.

**2. Add a server-side reaper for non-terminal OCR jobs.**
A new cron, or an extension of `ocrScreenshotRetentionCron`: find `OCRJob` rows in
`PENDING`/`PROCESSING` older than `OCR_STALE_PROCESSING_MS` and run the same
reconciliation `getOcrJobStatus` already performs at
`backend/services/ocrJob.service.js:385-422`, including the `ocr_failed` push. This
is what makes recovery work for a user who closed the app, and it is the only fix
for 1.1 where the queue entry exists but no worker consumes it. Take a distributed
lock, as the other 12 crons do.

**3. Map 403/`PERMISSION_DENIED` in the friendly-error mapper, and stop raw
upstream text reaching the UI.**
`backend/services/tradeProcessingService.js:1460-1477` — add a branch for 403 /
`PERMISSION_DENIED` / "billing" returning the same "temporarily unavailable, try
again" copy as the 429 branch, and change the final `return error?.message` to a
fixed generic sentence. Then route the client's `FAILED` branch
(`useUploadTrade.js:1097-1127`) through `getUserMessage(error, fallback)` instead
of passing the server string to `setError` unfiltered.

**4. Make the client HTTP deadline longer than the server's, and add an
idempotency key to trade creation.**
Two parts, both small, and they must ship together:

- `frontend/services/apiClient.js:121` — raise the default `timeout` above
  `API_REQUEST_TIMEOUT_MS` (15000), e.g. 20000; or cut the server's below 10000.
  Right now the client abandons a request the server will still commit.
- `frontend/services/tradeApi.js:14` and `:19` — generate a client-side key
  (`frontend/utils/genId.js` already exists) and send it as a header; on the
  backend, store it with a unique index and return the existing trade on a
  repeat. This is what makes the current "safe because we never retry" posture
  durable.

### P1

**5. Split liveness from readiness.**
`backend/server.js:495-540` — keep `/health` as the dependency report but return
200 with `status: "degraded"` when only Redis or the rate limiter is unhealthy
(the app demonstrably survives both, per 4.3), reserving 503 for
`dbState !== 1`. Add a trivial `/live` for the load balancer.

**6. Reconcile active Play subscriptions against Google on a schedule.**
A new cron modelled on `playAcknowledgementSweepCron`: for every
`PlaySubscription` that is entitling and not superseded, whose `expiryTime` falls
inside the next ~48h, call `syncPurchase`. This closes the lost-RTDN hole in both
directions — the downgraded payer and the refunded user who keeps access — and
reuses the existing, already-tested sync path.

**7. Fix the timeout misclassification, then widen `userMessage` adoption.**
`frontend/utils/userMessage.js:92-108` — move `ETIMEDOUT`/`timeout` out of
`isConnectivityError` into its own branch ("The server is taking too long — try
again"), and add a `status >= 500` branch so a 502 is not left to a generic
fallback. Then convert the 15 files that put `err.message` into state over to
`reportUserError`, starting with the OCR failure screen from fix 3.

### P2

8. `backend/config/index.js:120` — raise `OCR_WORKER_LOCK_DURATION_MS` above
   `PROCESSING_TIMEOUT_MS` (e.g. 360000 against 300000) so a job that runs to its
   own deadline cannot have its lock expire underneath it.
9. `backend/services/visionOcrService.js:148-151` — swap `console.error` for
   `logger.error` plus `captureOperationalError`, and distinguish a thrown error
   from a genuinely empty result so a Vision outage is visible.
10. `frontend/features/trade/hooks/useUploadTrade.js:1128` — carry whatever
    partial fields were extracted into the form before `clearOcrSession`, so a
    failure leaves the user editing rather than starting over.
11. `frontend/services/uploadApi.js` — add `onUploadProgress` and an
    `AbortController` to the three upload calls; a 180s uncancellable wait is the
    worst remaining slow-network experience.
12. `backend/services/notificationService.js:386-390` — act on `failureCount`:
    disable a token past a threshold, which is the only server-side signal
    available for 2.6 (permission revoked after grant).
13. Replace `backend/checkEnv.js` with a real pre-deploy validator that diffs the
    server `.env` against `.env.example` and exits non-zero on a missing required
    key — the recurring EC2 drift this file is named after.
14. Label stale data in the UI when a cached query is being shown and its refetch
    is failing, not only while offline.

### P3

15. Add distributed locks to `dataCleanupCron`, `ocrScreenshotRetentionCron` and
    `missionProgressCron` before the API scales past `instances: 1`.
16. `backend/config/db.js:25` — drop `socketTimeoutMS` below the 15000 request
    deadline so the client sees the real error rather than a 408.
17. Add a reachability probe behind `networkStatus.isOnline()` so a captive portal
    is not reported as online, and correct the comment at
    `frontend/utils/networkStatus.js:4-6`.
18. Alert on crons that did **not** run — `cronMetrics` records only runs that
    happened.
19. Establish a `dedupeKey` convention that includes a date component for any
    recurring notification type, so per-day send-once is structural rather than
    per-caller.
20. Add a mutation queue for offline writes, or tell the user plainly that an
    offline submission was not saved.

---

## Needs a running server to confirm

These could not be settled statically:

- **1.1 end to end.** That a job sits in `waiting` forever with no worker is read
  from the code path; reproducing it means stopping `edgecipline-ocr-worker` and
  watching a real upload. There is no test for it —
  `backend/__tests__/unit/ocrJobWorkflow.test.js` covers 16 cases including the
  missing-queue-record recovery at line 377, but not "queue record present, no
  consumer".
- **3.2 phantom write.** Whether a `POST /trades` abandoned at the client's 10s
  deadline actually commits depends on where in the handler the 15s socket destroy
  lands (`backend/middleware/timeout.js:52`). Needs a throttled-link test.
- **4.4 blast radius.** Whether anything external polls `/health` (ALB target
  group, uptime monitor) determines whether that finding is P1 or cosmetic. Check
  the deployment config on EC2.
- **2.6.** FCM's exact response for a token whose OS-level notification permission
  was revoked post-grant is not documented reliably enough to assert from source;
  needs a device test.
- **Which crons are actually enabled in production.** Several read an
  `appConfig.*.enabled` flag (e.g. `subscriptionExpiry.enabled`,
  `backend/jobs/subscriptionExpiryCron.js:156`); the server `.env` decides, and it
  is known to drift from `.env.example`.
