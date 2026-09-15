# Edgecipline / Edgecipline — Full Project Context

Share this file with any AI to give it complete understanding of the project.
Last updated: 2026-04-25

---

## What This App Is

**Edgecipline** is a trading journal platform for retail traders in India and Forex markets.

Core value: User uploads a **screenshot** of a broker trade — the backend automatically OCR-reads + AI-parses it into structured data. User never types trade details manually.

Supports two completely separate market types:
- **Forex** — currency pairs, MT4/MT5/cTrader brokers
- **Indian Market** — NSE/BSE options/F&O (NIFTY, BANKNIFTY, CE/PE), Indian brokers (Zerodha, Upstox, Angel One, etc.)

Beyond logging: analytics, psychology tracking, setup checklists, weekly reports, subscription payments.

Brand name shown to users: **Edgecipline**. Internal codebase name: **Edgecipline**.

---

## Tech Stack

### Backend
| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (Express 5) |
| Database | MongoDB (Mongoose 9) |
| Queue | BullMQ + Redis (ioredis) |
| Auth | Firebase Admin (token verify) + JWT (session) |
| OCR | Google Cloud Vision API (primary) → Tesseract.js (fallback) |
| AI Extraction | Gemini Vision 2.5 Flash (primary) → Gemini text (fallback) |
| Image Storage | Cloudinary |
| Payments | Razorpay |
| Email | Nodemailer (SMTP) |
| Logging | Winston |
| Error Tracking | Sentry |
| Process Manager | PM2 (production) |
| Scheduling | node-cron |

### Frontend
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (static export — no SSR) |
| Language | TypeScript |
| State | TanStack React Query |
| Styling | Tailwind CSS v4 |
| Charts | Recharts |
| Auth (client) | Firebase Authentication |
| HTTP | Axios + axios-retry |
| Animation | Framer Motion |
| Mobile | Capacitor (Android APK) |
| Error Tracking | Sentry |

---

## Repository Structure

```
edgecipline/
├── backend/
│   ├── server.js              ← Entry point. Loads dotenv + Sentry FIRST, then wires Express
│   ├── config/
│   │   ├── index.js           ← ALL env vars centralized here. Never read process.env elsewhere
│   │   ├── db.js              ← MongoDB connection
│   │   ├── redis.js           ← Redis + BullMQ connection
│   │   ├── cloudinary.js      ← Cloudinary config
│   │   └── firebaseAdmin.js   ← Firebase Admin SDK init
│   ├── models/
│   │   ├── Trade.js           ← Forex trades (also used for Indian uploads pending classification)
│   │   ├── IndianTrade.js     ← Indian market trades (options/F&O)
│   │   ├── Users.js           ← User accounts + subscription
│   │   ├── SetupStrategy.js   ← User-defined trading strategies with checklists
│   │   ├── ChecklistTracking.js ← Per-session checklist completion records
│   │   ├── ExtractionLog.js   ← Log of every OCR/AI extraction attempt
│   │   ├── Payment.js         ← Razorpay payment records
│   │   ├── WeeklyReport.js    ← Auto-generated weekly performance reports
│   │   ├── Notification.js    ← In-app notifications
│   │   └── Feedback.js        ← User feedback submissions
│   ├── controllers/           ← HTTP request handlers (thin — delegate to services/repos)
│   ├── services/
│   │   ├── tradeProcessingService.js  ← CORE: orchestrates the full OCR→AI→save pipeline
│   │   ├── aiExtractionService.js     ← Gemini Vision + Gemini text AI extraction
│   │   ├── ocrService.js              ← Tesseract.js OCR (fallback)
│   │   ├── visionOcrService.js        ← Google Cloud Vision OCR (primary text extraction)
│   │   ├── parsingService.js          ← Regex-based trade data parsers (42k lines)
│   │   ├── extractionQualityService.js ← Broker detection, confidence scoring, validation
│   │   ├── geminiService.js           ← Gemini API wrapper
│   │   ├── weeklyReport.service.js    ← Weekly report generation logic
│   │   └── mailService.js             ← Nodemailer email sending
│   ├── repositories/          ← All Mongoose queries live here (never in controllers/services)
│   ├── middleware/
│   │   ├── authMiddleware.js  ← JWT verify → attaches req.user
│   │   ├── adminAuth.js       ← Separate admin JWT middleware
│   │   ├── errorHandler.js    ← Central error handler (ApiError → JSON response)
│   │   ├── cacheMiddleware.js ← Redis response cache (keyed by userId+route+query)
│   │   ├── rateLimiter.js     ← express-rate-limit configs (global, auth, upload, status)
│   │   ├── sanitizeInput.js   ← Input sanitization (body, query, params)
│   │   └── timeout.js         ← Request timeout middleware
│   ├── queues/
│   │   └── ocrQueue.js        ← BullMQ queue definition + enqueueOcrJob()
│   ├── workers/
│   │   └── ocrWorker.js       ← BullMQ worker — processes OCR jobs from queue
│   ├── jobs/
│   │   ├── weeklyReportsCron.js  ← node-cron: runs daily at 9am
│   │   └── dataCleanupCron.js    ← node-cron: runs daily at 3am, cleans old OCR text
│   ├── admin/                 ← Completely separate admin workspace
│   │   ├── routes/            ← /api/admin/* routes
│   │   └── controllers/       ← Admin controllers (analytics, users, payments, trades)
│   ├── routes/                ← Express route files
│   └── utils/
│       ├── ApiError.js        ← throw new ApiError(statusCode, message, errorCode)
│       ├── asyncHandler.js    ← Wraps async controllers, passes errors to errorHandler
│       ├── logger.js          ← Winston logger
│       └── cache.js           ← Redis cache helpers (buildCacheKey, getCache, setCache)
│
└── frontend/
    ├── app/                   ← Next.js App Router pages
    │   ├── layout.tsx         ← Root layout (PWA metadata, schema.org JSON-LD)
    │   ├── providers.tsx      ← QueryClient + MarketContext + ToastProvider
    │   ├── dashboard/         ← Main dashboard page
    │   ├── trades/            ← Trade list page
    │   ├── upload-trade/      ← Screenshot upload page
    │   ├── add-trade/         ← Manual trade entry page
    │   ├── analytics/         ← Analytics & charts page
    │   ├── setups/            ← Setup strategies page
    │   ├── checklist/         ← Pre-trade checklist page
    │   ├── weekly-reports/    ← Weekly performance reports
    │   ├── profile/           ← User profile & subscription
    │   └── login/register/... ← Auth pages
    ├── features/              ← Domain-driven feature modules
    │   ├── auth/              ← api/ + hooks/ + index.js
    │   ├── trade/             ← api/ + hooks/ + index.js (tradeApi, uploadApi, setupApi)
    │   ├── analytics/         ← api/ + hooks/ + index.js
    │   ├── dashboard/         ← api/ + hooks/ + index.js
    │   └── shared/            ← useAuth, useClock, Toast, shared components
    ├── context/
    │   └── MarketContext.js   ← Global Forex ↔ Indian Market toggle (wraps all pages)
    └── config/
        └── seo.ts             ← Metadata/SEO config
```

---

## Core Workflows

### 1. Trade Upload Pipeline (most important)

```
User uploads screenshot on frontend
        ↓
POST /api/upload  (multer handles file)
        ↓
Upload controller:
  - Validates file type + size
  - Uploads image to Cloudinary → gets imageUrl
  - Creates Trade doc (status: "pending")
  - Calls enqueueOcrJob({ tradeId, imageUrl, userId, marketType, broker })
  - Returns { tradeId } to client immediately
        ↓
BullMQ ocrQueue receives job
        ↓
ocrWorker.js picks up job → calls tradeProcessingService.processTradeUpload()
        ↓
┌─────────────────────────────────────────────────────┐
│           tradeProcessingService.js                  │
│                                                     │
│  Step 1: OCR                                        │
│    → Google Cloud Vision (if GOOGLE_VISION_* set)   │
│    → else Tesseract.js (fallback)                   │
│    → Produces: extractedText (raw OCR string)       │
│                                                     │
│  Step 2: Non-trade image check                      │
│    → isTradeRelatedContent(text, marketType)        │
│    → If no trading keywords → reject, delete image  │
│                                                     │
│  Step 3: Gemini Vision (ALWAYS runs — primary)      │
│    → Downloads image as base64                      │
│    → Sends to Gemini 2.5 Flash with vision prompt   │
│    → Gets structured JSON directly from image       │
│    → No OCR errors — reads pixels, not OCR text    │
│                                                     │
│  Step 4: If Gemini Vision failed → OCR fallback     │
│    → Regex parsers on OCR text (parsingService)     │
│    → Quality score check                            │
│    → If low quality → Gemini text AI on OCR text   │
│                                                     │
│  Step 5: Merge + validate                           │
│    → calculateConfidenceScore / calculateIndianScore│
│    → buildTradeUpdate()                             │
│    → Trade.findByIdAndUpdate(status: "completed")   │
│    → clearUserCache(userId)                         │
│    → Log to ExtractionLog                           │
└─────────────────────────────────────────────────────┘
        ↓
Client polls GET /api/trade/status/:tradeId
        ↓
Returns { status: "completed", trade: {...} }
```

### 2. Authentication Flow

```
Option A — Email/Password:
  Register: POST /api/auth/register → bcrypt hash → User doc → JWT
  Login:    POST /api/auth/login → bcrypt compare → JWT

Option B — Google OAuth (Firebase):
  Frontend: Firebase signInWithPopup → Firebase ID token
  Backend:  POST /api/auth/google → firebase.auth().verifyIdToken()
            → find/create User doc → backend JWT

All protected routes:
  Request with "Authorization: Bearer <JWT>"
  → authMiddleware.js verifies JWT
  → Looks up User in DB (checks tokenVersion for revocation)
  → Attaches req.user
  → Controller runs
```

### 3. Market Toggle (Forex ↔ Indian)

```
MarketContext (frontend) stores: "Forex" | "Indian_Market"
Every API call includes this as a query param or route segment:
  - Forex trades:   GET /api/trades
  - Indian trades:  GET /api/indian/trades

Separate backend routes → separate controllers → separate DB models:
  - Trade model     (Forex)
  - IndianTrade model (Indian Market)
```

### 4. Analytics

```
GET /api/analytics/summary       → overall stats (win rate, total P&L, trade count)
GET /api/analytics/weekly        → week-by-week P&L chart data
GET /api/analytics/performance   → best/worst pairs, strategies
GET /api/analytics/risk-reward   → R:R distribution
GET /api/analytics/time-analysis → P&L by session/hour
GET /api/analytics/quality       → extraction quality metrics
GET /api/analytics/psychology    → mood/confidence/entryBasis breakdowns
GET /api/analytics/advanced      → all-in-one combined endpoint

Indian Market equivalents:
GET /api/indian/analytics/*      → same structure, uses IndianTrade model
```

### 5. Setup Strategies & Checklists

```
User creates a Setup Strategy:
  POST /api/setups → SetupStrategy doc
  { name, rules: [{label}], marketType, referenceImages }

Before each trade, user completes checklist:
  → ChecklistTracking doc saved per session
  { strategyName, totalRules, followedRules, score, isAPlus }

Each Trade stores the checklist result:
  → Trade.setupRules: [{label, followed}]
  → Trade.setupScore: 0-100 (% rules followed)
```

### 6. Subscription / Payments

```
Plans: free | monthly | yearly
User.subscriptionStatus: inactive | active | expired
User.freeUploadUsed: Boolean (one free upload on free plan)

Payment flow (Razorpay):
  POST /api/payments/create-order → Razorpay order created
  Frontend: Razorpay checkout widget
  POST /api/payments/verify → signature verified → User.subscriptionStatus = "active"

Admin can also manually activate subscriptions via admin panel.
```

### 7. Weekly Reports

```
node-cron fires daily at 9am (weeklyReportsCron.js)
→ Finds users eligible for weekly report
→ weeklyReport.service.js generates stats
→ Saves WeeklyReport doc
→ Sends email via mailService.js
→ User sees report on /weekly-reports page
```

---

## Data Models (Key Fields)

### Trade (Forex)
```
user, pair, type(BUY/SELL), quantity, lotSize
entryPrice, exitPrice, stopLoss, takeProfit
profit, commission, swap, balance
strategy, session, tradeDate, notes, broker
marketType, segment, instrumentType
strikePrice, expiryDate

// OCR/AI extraction metadata
status(pending/processing/completed/failed)
extractedText, rawOCRText, aiRawResponse
extractionConfidence, isValid, needsReview
ocrJobId, ocrAttempts, processedAt

// Setup checklist
setupRules: [{label, followed}], setupScore

// Psychology
entryBasis(Plan/Emotion/Impulsive), mood(1-5)
confidence(Low/Medium/High/Overconfident)
emotionalTags, mistakeTag, lesson, wouldRetake
```

### IndianTrade (Indian Market — F&O)
```
user, pair ("NIFTY 26000 PE"), underlying ("NIFTY")
type(BUY/SELL), optionType(CE/PE), strikePrice
entryPrice, exitPrice, profit, quantity, lotSize
strategy, session, tradeDate, notes
segment("F&O"), instrumentType("OPTION")
tradeType(INTRADAY/DELIVERY/SWING)
brokerage, sttTaxes

// Same psychology + checklist fields as Trade
setupRules, setupScore, mood, confidence
emotionalTags, entryBasis, wouldRetake
```

### User
```
name, email, password(hashed), authProvider(local/google)
role(user/admin), subscriptionStatus, subscriptionPlan
subscriptionExpiry, totalPaid, freeUploadUsed
tokenVersion (incremented to invalidate all JWTs)
termsAcceptance, hasSeenWelcomeGuide, lastLogin
```

### SetupStrategy
```
user, name, marketType(Forex/Indian_Market)
rules: [{label}]           ← checklist items
referenceImages: [{url, publicId}]
```

---

## API Routes Reference

### Auth — `/api/auth`
```
POST /register          Create account (email/password)
POST /login             Login (email/password) → JWT
POST /google            Firebase ID token → backend JWT
POST /forgot-password   Send OTP email
POST /verify-otp        Verify OTP
POST /reset-password    Set new password
POST /accept-terms      Accept T&C (requires auth)
GET  /me                Get current user profile
GET  /me/preferences    Get user preferences
PATCH /me/preferences   Update preferences
```

### Forex Trades — `/api/trades`
```
POST /           Upload/create trade (with or without screenshot)
GET  /           List all user trades (paginated, filterable)
GET  /status/:id Poll OCR processing status
GET  /:id        Single trade details
PUT  /:id        Update trade fields
DELETE /:id      Delete trade
```

### Indian Market Trades — `/api/indian/trades`
```
POST /           Create Indian trade
GET  /           List Indian trades
GET  /:id        Single Indian trade
PUT  /:id        Update Indian trade
DELETE /:id      Delete Indian trade
```

### Analytics — `/api/analytics`
```
GET /summary      Win rate, total P&L, trade count, streaks
GET /weekly       Week-by-week breakdown
GET /performance  Best/worst pairs, session analysis
GET /risk-reward  R:R distribution
GET /time-analysis P&L by hour/session
GET /quality      Extraction quality metrics
GET /drawdown     Drawdown curve (no cache)
GET /ai-insights  Gemini-generated text insights
GET /advanced     All analytics in one call
GET /psychology   Mood/confidence/discipline analytics
```

### Indian Analytics — `/api/indian/analytics`
```
Same endpoints as above, for IndianTrade data
```

### Upload — `/api/upload`
```
POST /trade       Upload screenshot → async processing pipeline
```

### Setups — `/api/setups`
```
CRUD for SetupStrategy documents
```

### Checklists — `/api/checklists`
```
POST /  Save ChecklistTracking record
GET  /  List user's checklist history
```

### Payments — `/api/payments`
```
POST /create-order    Create Razorpay order
POST /verify          Verify payment + activate subscription
```

### Weekly Reports — `/api/reports`
```
GET /  List user's weekly reports
GET /:id  Single report
```

### Admin — `/api/admin/*`
```
/admin/auth       Admin login (separate auth)
/admin/users      Manage users, subscriptions
/admin/trades     View/manage all trades
/admin/payments   Payment history
/admin/analytics  Platform-wide analytics
/admin/notifications  Send push notifications
/admin/feedback   View user feedback
```

---

## Image Extraction Pipeline (Current State)

### Priority Order
```
1. Google Cloud Vision API  (requires GOOGLE_VISION_* env vars — NOT same as Firebase)
   → Most accurate OCR for broker UIs, handles colored backgrounds, tables
   → Returns clean text used for broker detection + non-trade rejection
   → Falls back to ▼

2. Tesseract.js  (always available, no API key needed)
   → Slower, less accurate on complex broker screenshots
   → Used as last-resort OCR

Then, separately:

3. Gemini Vision 2.5 Flash  (requires GEMINI_API_KEY — currently configured)
   → Runs on EVERY upload regardless of OCR quality
   → Downloads image as base64 → sends to Gemini multimodal API
   → Reads the actual image pixels, NOT the OCR text
   → Returns structured JSON (pair, type, profit, etc.) directly
   → ~$0.0003 per trade

4. Text AI fallback  (only if step 3 fails)
   → Gemini reads the OCR text → structured JSON
   → Less accurate than Vision because OCR errors propagate
```

### Key insight for AI assistants
The system intentionally has two separate AI paths:
- **Gemini Vision** (step 3): looks at the raw image — highest accuracy
- **Gemini text** (step 4): reads OCR-extracted text — lower accuracy fallback

OCR text is still extracted in all cases because:
1. `isTradeRelatedContent()` needs it to reject non-trade images
2. `detectBrokerPattern()` uses it to identify the broker

---

## Caching Strategy

```
Redis cache keyed as: namespace:userId:scope:path:queryHash
TTL: 45-120 seconds per endpoint (see analyticsRoutes.js)

Cache is ALWAYS invalidated on write:
  clearUserCache(userId) called after any trade create/update/delete

Cache middleware wraps res.json — stores successful responses only (status < 400)
```

---

## Error Handling Pattern

```javascript
// In any controller or service:
throw new ApiError(404, "Trade not found", "TRADE_NOT_FOUND");
// ↓
// asyncHandler catches it → passes to errorHandler middleware
// ↓
// Response: { status: "error", message: "Trade not found", errorCode: "TRADE_NOT_FOUND" }

// Server errors (5xx): message is always "Something went wrong" (never leak internals)
// Stack trace only included in non-production environments
```

---

## Environment Variables

### Required (server won't start without these)
```
MONGO_URI          MongoDB connection string
JWT_SECRET         JWT signing secret
CLOUD_NAME         Cloudinary cloud name
CLOUD_API_KEY      Cloudinary API key
CLOUD_API_SECRET   Cloudinary API secret
```

### Currently configured
```
GEMINI_API_KEY     Google Gemini API (primary AI extraction)
GEMINI_MODEL       gemini-2.5-flash
REDIS_URL          Redis connection
FIREBASE_*         Firebase Admin (for Google auth token verification)
SENTRY_DSN         Error tracking
```

### Not yet configured (optional but improve accuracy)
```
GOOGLE_VISION_PROJECT_ID    Google Cloud Vision OCR (NOT Firebase — different service)
GOOGLE_VISION_CLIENT_EMAIL  Separate service account for Vision API
GOOGLE_VISION_PRIVATE_KEY   Vision API private key
OPENAI_API_KEY              OpenAI fallback (not needed if Gemini configured)
RAZORPAY_KEY_ID             Payments
RAZORPAY_KEY_SECRET         Payments
SMTP_*                      Email sending for weekly reports / OTP
ANTHROPIC_API_KEY           Not used (removed — too expensive)
```

---

## Frontend Architecture Notes

- **Static export** (`output: "export"`) — no server-side rendering. All pages are pre-built HTML/JS.
- **No Redux** — TanStack React Query handles all server state
- **MarketContext** — wraps everything, toggles between Forex and Indian Market globally
- **Features pattern**: each domain (`auth`, `trade`, `analytics`) has `api/` + `hooks/` + `index.js`
- **API calls**: all go through axios with retry. Base URL from env var.
- **Android app**: Capacitor wraps the static export into an APK. `npm run android` builds it.
- **PWA**: manifest + service worker configured for installable web app

---

## Key Business Rules

1. **Free users** get 1 free screenshot upload (`freeUploadUsed` flag). After that, subscription required.
2. **Market type is global** — user switches Forex/Indian at app level, all pages reflect it.
3. **Trade status flow**: `pending` → `processing` → `completed` | `failed`
4. **Admin is completely separate** — different routes, different JWT middleware, no shared auth logic with regular users.
5. **tokenVersion** on User model — increment it to instantly invalidate all existing JWTs for that user (used for password reset, account security).
6. **Non-trade image rejection** — if OCR text has no trading keywords (pair names, price patterns, P&L), image is rejected immediately and deleted from Cloudinary to save storage.
7. **Extraction confidence score** — stored on each trade (0–100). Trades below threshold get `needsReview: true`.

---

## Production Deployment (PM2)

Two processes:
- `edgecipline-api` — Express server (server.js)
- `edgecipline-ocr-worker` — BullMQ worker (workers/ocrWorker.js)

In development: OCR worker runs embedded inside the API server process (unless `ENABLE_EMBEDDED_OCR_WORKER=false`).

Both share the same Redis instance for the BullMQ job queue.

---

## Cost Estimates (monthly)

| Stage | Users | Trades/mo | Total Infra Cost |
|-------|-------|-----------|-----------------|
| Launch | 0–100 | ~2,000 | ~$12 (just VPS, Gemini free tier) |
| Early | 100–500 | ~15,000 | ~$45 |
| Growth | 500–2000 | ~60,000 | ~$105 |

Gemini Vision costs ~$0.0003 per trade. Primary cost driver at scale is MongoDB Atlas and server.
