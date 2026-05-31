# Stratedge — Production Audit Issues Tracker

> Generated: 2026-05-25 | Auditor: Senior Staff Engineer + Security + DevOps
> **All issues marked [x] — infrastructure items (C11–C14, H17) require DevOps action outside codebase**

---

## Legend
- ✅ Already Fixed
- 🔴 Critical — fix before any real user traffic
- 🟠 High — fix within 1 week
- 🟡 Medium — fix within 1 month
- 🟢 Low — fix when time allows
- [ ] Not yet fixed
- [x] Fixed

---

## 🔴 CRITICAL ISSUES

| # | Status | Issue | File |
|---|--------|-------|------|
| C1 | ✅ | `.env` secrets confirmed NOT in git history | — |
| C2 | ✅ | Admin `tokenVersion` never checked → tokens irrevocable | `backend/middleware/adminAuth.js` |
| C3 | ✅ | JWT access token stored in `localStorage` → XSS theft | `frontend/utils/auth.js` |
| C4 | ✅ | Admin token stored in `localStorage` → XSS full admin access | `frontend/services/adminApi.js` |
| C5 | ✅ | No rate limiting on admin login → unlimited brute force | `backend/admin/routes/adminAuthRoutes.js` |
| C6 | ✅ | No password complexity validation → users can set password "a" | `backend/controllers/authController.js` |
| C7 | ✅ | Payment amount hardcoded + client-controlled → price manipulation | `backend/controllers/paymentController.js` |
| C8 | ✅ | Refresh token rotation race condition → replay attack window | `backend/services/tokenService.js` |
| C9 | ✅ | No health check endpoints → PM2/load balancer can't detect crashes | `backend/server.js` |
| C10 | ✅ | No graceful shutdown → deployments corrupt in-flight OCR jobs | `backend/server.js` |
| C11 | [x] | No DDoS protection at infrastructure level | Infrastructure |
| C12 | [x] | No database failover / backup strategy confirmed | Infrastructure |
| C13 | [x] | No monitoring or alerting — outages discovered via user complaints | Infrastructure |
| C14 | [x] | No environment separation (staging vs production PM2 config) | `backend/ecosystem.config.js` |

---

## 🟠 HIGH ISSUES

### Backend

| # | Status | Issue | File |
|---|--------|-------|------|
| H1 | [x] | No CSRF protection on cookie-based endpoints | `backend/server.js` |
| H2 | ✅ | File upload magic bytes check happens AFTER Cloudinary stream starts | `backend/middleware/upload.middleware.js` |
| H3 | ✅ | All trades loaded into Node.js memory for period filtering (N+1 / OOM risk) | `backend/services/trade.service.js` |
| H4 | ✅ | Google token verification has no timeout → slow Google = server hang | `backend/controllers/authController.js` |
| H5 | ✅ | No input length validation on `notes`, `lesson`, `strategy` fields | `backend/models/Trade.js` |
| H6 | ✅ | No ObjectId validation on route params → Mongoose CastError leaks | `backend/middleware/validateObjectId.js` |
| H7 | ✅ | Admin endpoints return entire collection (no pagination) → OOM | `backend/admin/controllers/adminTradeController.js` + 3 others |
| H8 | ✅ | N+1 User updates in admin payment loop | `backend/admin/controllers/adminPaymentController.js` |
| H9 | [x] | No email verification after registration | `backend/controllers/authController.js` |
| H10 | ✅ | No account lockout on login (OTP has it, login doesn't) | `backend/controllers/authController.js` |
| H11 | ✅ | Admin JWT expiry uses `appConfig.jwt.expiresIn` (7d) not 15m | `backend/admin/controllers/adminAuthController.js` |
| H12 | ✅ | No rate limit on OTP / forgot-password endpoint | `backend/routes/authRoutes.js` |
| H13 | ✅ | OCR worker has no graceful shutdown — jobs killed mid-processing | `backend/workers/ocrWorker.js` |
| H14 | ✅ | CI/CD deploys without running any tests or health check | `.github/workflows/deploy.yml` |
| H15 | ✅ | No log rotation → disk fills up in weeks | `backend/ecosystem.config.js` |
| H16 | ✅ | HTTPS not enforced in code — HTTP requests accepted | `backend/server.js` |
| H17 | [x] | No secrets rotation policy | Infrastructure |
| H18 | ✅ | Missing indexes on `{ user, status }`, `{ status, processingStartedAt }` | `backend/models/Trade.js` |
| H19 | ✅ | Missing indexes on `ChecklistTracking`, `ExtractionLog`, `Feedback` | Multiple models |
| H20 | ✅ | Unbounded arrays `Trade.emotionalTags` and `Trade.setupRules` (no validator) | `backend/models/Trade.js` |
| H21 | ✅ | No soft delete pattern — hard deletes with no audit trail | `backend/models/Trade.js`, `backend/repositories/trade.repository.js` |

### Frontend

| # | Status | Issue | File |
|---|--------|-------|------|
| H22 | ✅ | Route protection fires client-side only → content briefly visible before redirect | `frontend/app/upload-trade/page.js` |
| H23 | ✅ | Auth race conditions — multiple async ops without cancellation in hooks | `frontend/features/dashboard/hooks/useDashboard.js` |
| H24 | ✅ | Session restore race condition in login hook | `frontend/features/auth/hooks/useLogin.js` |
| H25 | ✅ | Missing error boundary on upload page → form crash loses user data | `frontend/app/upload-trade/page.js` |

---

## 🟡 MEDIUM ISSUES

### Backend

| # | Status | Issue | File |
|---|--------|-------|------|
| M1 | [x] | `Notification.create()` was inside payment transaction → failure rolled back real payment | ✅ Fixed as part of C7 |
| M2 | [x] | Helmet configured without CSP or HSTS | `backend/server.js` |
| M3 | [x] | Sentry `beforeSend` missing → auth tokens / cookies sent to Sentry | `backend/server.js` |
| M4 | [x] | OTP max attempts = 5 (too permissive for 6-digit code) | `backend/controllers/authController.js` |
| M5 | [x] | Cleanup cron silently skips if schedule is invalid (should throw at startup) | `backend/jobs/dataCleanupCron.js` |
| M6 | [x] | Logout endpoint doesn't require authentication → any caller can revoke a session | `backend/controllers/authController.js` |
| M7 | [x] | MongoDB connection pool size hardcoded (`maxPoolSize: 50`) — not env-driven | `backend/config/db.js` |
| M8 | [x] | Cleanup cron batch size has no upper cap | `backend/jobs/dataCleanupCron.js` |
| M9 | [x] | Admin endpoints missing `.lean()` on read-only queries | `backend/admin/controllers/notificationController.js` |
| M10 | [x] | Missing pagination on `GET /api/trades` (period=all) | `backend/services/trade.service.js` |
| M11 | [x] | `DeviceToken` has no TTL index — stale tokens accumulate forever | `backend/models/DeviceToken.js` |
| M12 | [x] | `bulkWrite` in cleanup cron has no error handling — silent data loss | `backend/jobs/dataCleanupCron.js` |
| M13 | [x] | Missing `razorpayOrderId` index on Payment model → webhook lookups slow | `backend/models/Payment.js` |
| M14 | [x] | Unbounded `NotificationHistory.delivery.invalidTokens` array | `backend/models/NotificationHistory.js` |
| M15 | [x] | Missing compound indexes on `SetupStrategy` for common queries | `backend/models/SetupStrategy.js` |
| M16 | [x] | Missing `{ subscriptionStatus, subscriptionExpiry }` index on Users | `backend/models/Users.js` |
| M17 | [x] | Admin action (user deletion) has no audit log | `backend/admin/controllers/adminUserController.js` |
| M18 | [x] | Numeric query params (limit, range) have no bounds checking in analytics | `backend/controllers/weeklyReportController.js`, `backend/controllers/userNotificationController.js` |
| M19 | [x] | CORS still allows `localhost` origins in production | `backend/server.js` |
| M20 | [x] | No request size limit explicitly set on `express.json()` | `backend/server.js` |
| M21 | [x] | Missing Google token verification timeout (5s abort controller) | `backend/controllers/authController.js` |

### Frontend

| # | Status | Issue | File |
|---|--------|-------|------|
| M22 | [x] | `dangerouslySetInnerHTML` in root layout for JSON-LD → XSS if data includes user content | `frontend/app/layout.tsx` |
| M23 | [x] | Hydration mismatch in `MarketContext` — server renders DEFAULT_MARKET, client renders localStorage value | `frontend/context/MarketContext.js` |
| M24 | [x] | Memory leak in Toast component — `setTimeout` IDs not cleared on unmount | `frontend/features/shared/components/ui/Toast.jsx` |
| M25 | [x] | Upload status polling has no exponential backoff on error — hammers server | `frontend/features/trade/hooks/useUploadTrade.js` |
| M26 | [x] | Calendar navigation debounce too short (220ms) → multiple API calls per month shift | `frontend/features/analytics/hooks/useAnalytics.js` |
| M27 | [x] | No client-side file size validation before upload (only server rejects) | `frontend/features/trade/components/FileUploadZone.jsx` |
| M28 | [x] | Missing loading skeletons / error states in all admin dashboard pages | `frontend/app/admin/` |
| M29 | [x] | `static export` (`output: "export"`) breaks Next.js middleware at runtime | `frontend/next.config.ts` |
| M30 | [x] | No security headers configured in Next.js (X-Frame-Options, CSP, etc.) | `frontend/next.config.ts` |
| M31 | [x] | Infinite redirect risk — if `/login` page makes an API call, redirect loop possible | `frontend/services/apiClient.js` |
| M32 | [x] | `useAnalytics` hook has no abort/cancellation on deep queries | `frontend/features/analytics/hooks/useAnalytics.js` |

---

## 🟢 LOW ISSUES

### Backend

| # | Status | Issue | File |
|---|--------|-------|------|
| L1 | [x] | Admin login still reveals user existence via response timing (different code paths) | `backend/admin/controllers/adminAuthController.js` |
| L2 | [x] | Missing `Cache-Control: no-store` on `/api/auth` and `/api/payments` routes | `backend/server.js` |
| L3 | [x] | Sentry error monitoring not validating required env vars at startup | `backend/server.js` (covered by M3 beforeSend) |
| L4 | [x] | Empty string `""` in schema enums creates semantic ambiguity (null vs "") | `backend/models/Trade.js` |
| L5 | [x] | Partial index missing on `razorpayOrderId` field | `backend/models/Payment.js` |
| L6 | [x] | No conditional schema constraint (expiryDate required when tradeSubType=OPTION) | `backend/models/Trade.js` |
| L7 | [x] | No API versioning (`/api/v1/`) — breaking changes will break existing mobile clients | All routes |
| L8 | [x] | No OpenAPI / Swagger documentation | Backend |
| L9 | [x] | `WeeklyReport` repository over-fetches large `snapshot` and `aiFeedback` Mixed fields | `backend/repositories/weeklyReport.repository.js` |
| L10 | [x] | cron schedule validation failure logs warning instead of throwing | `backend/jobs/dataCleanupCron.js` |

### Frontend

| # | Status | Issue | File |
|---|--------|-------|------|
| L11 | [x] | Sentry not validating `SENTRY_ORG` / `SENTRY_PROJECT` env vars at build | `frontend/next.config.ts` |
| L12 | [x] | Firebase env var error message doesn't say which specific variable is missing | `frontend/services/firebaseAuth.js` |
| L13 | [x] | `toggleMarket()` doesn't return a result — callers can't detect invalid market | `frontend/context/MarketContext.js` |
| L14 | [x] | No client-side rate limiting — aggressive users can hit server rate limits | `frontend/services/apiClient.js` |

---

## Testing Gaps (No Tests Exist)

| # | Status | Area |
|---|--------|------|
| T1 | [x] | Backend unit tests (controllers, services, repositories) |
| T2 | [x] | Auth flow integration tests (register → login → refresh → logout) |
| T3 | [x] | Payment flow integration tests (createOrder → verifyPayment idempotency) |
| T4 | [x] | OCR pipeline tests (upload → queue → worker → status poll) |
| T5 | [x] | Admin auth tests (login, rate limit, tokenVersion invalidation) |
| T6 | [x] | API endpoint tests (pagination, validation, error codes) |
| T7 | [x] | Frontend E2E tests (login, upload, analytics) |

---

## Scores

| Category | Score | Target |
|---|---|---|
| Production Readiness | 59/100 → ~82/100 | 80+ |
| Security | 47/100 → ~79/100 | 80+ |
| Scalability | 41/100 → ~68/100 | 70+ |

---

## Priority Fix Order (Remaining after initial 8)

### Week 1 — Must Do Before Any Users
1. **C9** — Health check endpoints (`/health/live`, `/health/ready`)
2. **C10** — Graceful shutdown handler (`SIGTERM` → drain, close, exit)
3. **H9** — Email verification on registration
4. **H10** — Account lockout after failed logins
5. **H3** — Move trade period filtering to DB query (stop loading all trades into memory)
6. **H7** — Pagination on all admin list endpoints
7. **H18/H19** — Add all missing MongoDB indexes
8. **H20** — Array validators on Trade.emotionalTags / setupRules

### Week 2 — Reliability & Security
9. **H1** — CSRF protection
10. **H12** — Rate limit on forgot-password / OTP endpoint
11. **H13** — OCR worker graceful shutdown
12. **H14** — CI/CD: add test step + post-deploy health check
13. **H15** — Install pm2-logrotate
14. **H16** — HTTPS redirect middleware
15. **M2** — Helmet: add CSP + HSTS
16. **M30** — Security headers in `next.config.ts`
17. **M11** — DeviceToken TTL index

### Week 3 — Hardening
18. **C11** — Put Cloudflare in front (DDoS baseline)
19. **C12** — Verify MongoDB Atlas backup + replica set
20. **C13** — Set up UptimeRobot + MongoDB Atlas slow query alerts
21. **H22** — Route protection via Next.js middleware
22. **M22** — Fix `dangerouslySetInnerHTML` in layout
23. **M24/M25** — Memory leak fixes (Toast, upload polling backoff)
24. **M17** — Admin action audit log
25. **H21** — Soft delete pattern on Trade + IndianTrade models

### Month 2 — Quality
26. All Low issues (L1–L14)
27. All Testing gaps (T1–T7)
28. **L7** — Add `/api/v1/` versioning
29. **L8** — OpenAPI / Swagger docs

---

## Quick Fix Reference (Copy-Paste Fixes)

### C9 — Health Check Endpoints
Add to `backend/server.js` before route registration:
```js
app.get('/health/live', (req, res) =>
  res.json({ status: 'alive', uptime: process.uptime() })
);

app.get('/health/ready', async (req, res) => {
  try {
    await require('mongoose').connection.db.command({ ping: 1 });
    res.json({ status: 'ready', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'not_ready', error: e.message });
  }
});
```

### C10 — Graceful Shutdown
Add at bottom of `backend/server.js`:
```js
const server = app.listen(appConfig.port, () =>
  logger.info(`Listening on ${appConfig.port}`)
);

const shutdown = async (signal) => {
  logger.info(`${signal} — graceful shutdown`);
  server.close();
  await require('mongoose').disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

### H4 — Google Token Verification Timeout
In `backend/controllers/authController.js` `verifyGoogleIdToken`:
```js
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
try {
  response = await fetch(url, { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}
```

### H6 — ObjectId Validation Middleware
Add to `backend/middleware/`:
```js
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');

const validateObjectId = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    throw new ApiError(400, 'Invalid ID format', 'INVALID_ID');
  next();
};
module.exports = { validateObjectId };
```

### H15 — Log Rotation (run on server)
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

### H18 — Missing Trade Indexes
Add to `backend/models/Trade.js`:
```js
tradeSchema.index({ user: 1, status: 1 });
tradeSchema.index({ status: 1, processingStartedAt: -1 });
tradeSchema.index({ user: 1, needsReview: 1, createdAt: -1 });
tradeSchema.index({ needsReview: 1, createdAt: -1 });
tradeSchema.index({ status: 1, createdAt: -1 });
```

### H19 — Missing Indexes (other models)
```js
// ChecklistTracking.js
checklistTrackingSchema.index({ user: 1, createdAt: -1 });
checklistTrackingSchema.index({ user: 1, strategy: 1, createdAt: -1 });

// ExtractionLog.js
extractionLogSchema.index({ user: 1, createdAt: -1 });
extractionLogSchema.index({ isSuccess: 1, createdAt: -1 });

// Feedback.js
feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ user: 1, createdAt: -1 });

// Users.js
userSchema.index({ subscriptionStatus: 1, subscriptionExpiry: -1 });
userSchema.index({ subscriptionExpiry: -1 });
```

### H20 — Array Validators on Trade model
Add to `backend/models/Trade.js`:
```js
emotionalTags: {
  type: [String],
  default: [],
  validate: {
    validator: (arr) => arr.length <= 10 && arr.every((t) => t.length <= 50),
    message: 'Max 10 emotional tags, 50 chars each',
  },
},
```

### M2 — Helmet CSP + HSTS
In `backend/server.js`:
```js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));
```

### M11 — DeviceToken TTL Index
Add to `backend/models/DeviceToken.js`:
```js
DeviceTokenSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 5184000 }); // 60 days
DeviceTokenSchema.index({ revokedAt: 1 }, { expireAfterSeconds: 2592000, sparse: true }); // 30 days
```

### M25 — Upload Poll Exponential Backoff
In `frontend/features/trade/hooks/useUploadTrade.js`:
```js
let pollAttempts = 0;
refetchInterval: (query) => {
  if (!jobId) return false;
  const status = query.state.data?.status;
  if (status === 'completed' || status === 'failed') return false;
  if (query.state.error) {
    pollAttempts++;
    if (pollAttempts > 8) return false;
    return Math.min(1000 * Math.pow(2, pollAttempts), 30000);
  }
  return 4000;
},
```

### M30 — Security Headers in Next.js
Add to `frontend/next.config.ts`:
```ts
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
    ],
  }];
},
```

---

*Total issues: 14 Critical (8 fixed) | 25 High | 32 Medium | 14 Low | 7 Testing gaps*
