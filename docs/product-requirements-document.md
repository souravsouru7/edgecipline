# Edgecipline Product Requirements Document (v3 - App DNA)

Version: 3.0
Last updated: 2026-11-08
Owner: Edgecipline Private Limited
Status: Living document. This file is the single source of truth for what Edgecipline is, how it makes money, what every feature does, how it is built, and what is still open.

## 0. Document Info

### 0.1 How To Use This Document

- Sections 1-7 explain the product and the business: who it is for, why it exists, how it earns.
- Sections 8-11 describe every feature, screen, flow, and scoring formula.
- Sections 12-16 describe the system: architecture, API, data, security, reliability.
- Sections 17-24 cover metrics, scope limits, risks, roadmap, known gaps, open questions, and a glossary.
- Platform columns: **Web** = browser app. **Android** = Google Play app. **iOS** = App Store app (iPhone only). **Yes** = available, **No** = not available, **Native** = uses the phone's own system features.
- All money values are in Indian Rupees and written as INR.

### 0.2 What Changed Since v2 (2026-09-18)

- iOS app 1.0 (build 7, iPhone only) submitted to App Review on 2026-11-01, with Apple In-App Purchase, Sign in with Apple, push, and checklist reminders.
- Three billing systems now feed one Pro status: Razorpay (web), Google Play Billing (Android), Apple In-App Purchase (iOS).
- The 7-day signup trial is retired. The free tier is 2 trades per market, lifetime, shared between screenshot uploads and manual entry.
- AI coach chat launched with a weekly free quota (5 questions), streaming answers, specific error messages, automatic refund of a question when the answer fails, and in-place retry.
- Discipline streak system (journal, checklist, rule streaks) replaced the dashboard win-streak KPI.
- Trades list rebuilt: keyset paging, server-side search and filters, virtualised rows, whole-period header totals.
- Reliability: OCR stalled-job reaper, bounded client polling (10 minutes), idempotency keys on trade creation, client timeout above server deadline.
- Settings page redesigned; setups pages share one SetupBuilder; app tutorial can be replayed.
- RescueBanner close button now dismisses per touchpoint and stacks on small phones.
- Default AI model is now gemini-3.5-flash (gemini-2.5-flash is closed to new API projects).

### 0.3 Documents This Replaces Or Supplements

- Replaces: the previous version of this file, docs/edgecipline-prd-v2.html (kept as a historical snapshot, dated 2026-07-11), and the product parts of AI_CONTEXT.md (dated 2026-04-25, out of date on plans and payments).
- Deep-dive companions (still valid, this PRD summarises them): docs/coach-chat.md, docs/notifications-workflow.md, docs/discipline-streak-system.md, docs/reflections.md, docs/onboarding.md, docs/google-play-billing.md, docs/ios-app-store-handoff.md, docs/security-and-access-document.md, docs/failure-mode-audit.md, docs/discipline-ranking-spec.md (proposal), tests/performance/CAPACITY-REPORT.md.

## 1. Identity

### 1.1 One-Line Definition

Edgecipline is an AI discipline coach for retail traders. It builds your trading journal from broker screenshots, then shows you - with your own data - what makes you money, what costs you money, and what to do next.

### 1.2 Mission

Help retail traders become consistent by making journaling effortless and turning the journal into honest, specific coaching about behaviour, not predictions about the market.

### 1.3 Positioning

| Element | Wording |
|---|---|
| Category | AI Discipline Coach for retail traders |
| Wedge (acquisition hook) | The trading journal that fills itself from your broker screenshots. |
| Vision | A discipline operating system for retail traders. |
| Sign-off | Edgecipline. Trade with discipline. |
| App store name | Edgecipline - AI Discipline Coach |
| SEO description | The AI Discipline Coach for retail traders - auto-logs your trades via screenshot OCR, then coaches you toward consistency with psychology analytics, missions, and streaks. |
| Promo lines | Every trade tells a story - most traders never read it. / Just screenshot your broker. Our AI reads it and logs the whole trade. Instantly. / Zero typing. / Forex. Indian F and O. One disciplined journal. |

Messaging order (from strongest to supporting): screenshot-to-journal hook -> Indian broker support -> psychology cost ("what your emotions cost you") -> coaching layer (coach chat, missions, streaks, morning mentor) -> Trading DNA.

### 1.4 Voice Rules

- Never give signals, predictions, price targets, or financial advice.
- Speak from the user's data: "this is what your data shows", never "the market will".
- Never invent numbers. If there is not enough data, say so (locked states).
- End coaching with one concrete action.
- No shaming. Broken streaks and losses are framed as information, not failure.
- Plain, short English. Indian traders are a primary audience; use their terms (F&O, CE/PE, lot, expiry, NIFTY, BANKNIFTY).

### 1.5 Brand

| Element | Value |
|---|---|
| Brand green (marketing) | #16C784 on #070B0F |
| App primary green | #0D9E6E |
| Error red | #D63B3B |
| Gold accent | #B8860B |
| Navy text | #0F1923 |
| App background | #F0EEE9 (theme colour #F4F2EE) |
| Theme | Light only (no dark mode today) |
| Fonts | Plus Jakarta Sans (UI), JetBrains Mono (numbers, data), self-hosted |
| Icons | lucide-react |
| Market palettes | Separate accent palettes for Forex and Indian mode (frontend/config/marketThemes.js) |

## 2. Problem Statement

Retail traders know they should journal, but most do not do it consistently. Manual journaling is slow, repetitive, and emotionally uncomfortable after losses. When traders do journal, the records are incomplete and do not connect execution, psychology, setup rules, and P&L.

So traders cannot answer the questions that matter:

- Which market, session, setup, or instrument actually makes me money?
- Am I following my plan or trading emotionally?
- How much do FOMO, revenge trading, overconfidence, and broken rules cost me?
- Which mistakes repeat most often?
- What should I change next week?

Edgecipline removes the journaling friction (screenshot -> structured trade) and turns the journal into coaching.

## 3. Target Users

### 3.1 Primary

- Retail Forex traders on MT4, MT5, cTrader, or any broker that shows trade history screenshots.
- Indian retail traders, especially NSE/BSE options and F&O traders using Zerodha, Upstox, Angel One, Dhan, Groww, Fyers, 5paisa, ICICI Direct, Kotak Securities, or Paytm Money.

### 3.2 Secondary

- Serious early-stage traders who are not yet profitable but will review their behaviour.
- Small trading communities, mentors, and educators who want students to journal.
- Trading coaches (future: mentor dashboards).

### 3.3 Not For (v1)

- Institutional desks.
- High-frequency or fully automated traders.
- Users who will only accept direct broker sync.
- Users looking for signals, copy trading, or financial advice.

## 4. Personas

### Persona 1: The Inconsistent Retail Trader

Trades often, no reliable journal, remembers big wins and losses emotionally. Needs fast logging, clear P&L and win rate, simple feedback on repeated mistakes, and a low-friction mobile experience.

### Persona 2: The Discipline-Focused Trader

Has a strategy and rules but breaks them. Cares about process over outcome. Needs setup checklists, plan-adherence analytics, psychology tags, streaks, and a weekly review.

### Persona 3: The Indian Options Trader

Trades NIFTY, BANKNIFTY, CE/PE options, or intraday stocks. Needs Indian market mode, broker-aware extraction, option fields (strike, expiry, option type, lot size), rupee P&L with brokerage and taxes, and analytics kept separate from Forex.

### Persona 4: The Mobile-First Trader

Trades and reviews from a phone. Needs gallery upload, fast navigation, push reminders, and a checklist that lives in the notification shade.

### Persona 5: The iPhone Trader (new in v3)

Same needs as Persona 4 on iOS. Expects Sign in with Apple, App Store subscriptions managed from iOS settings, and native-quality reminders.

## 5. Value Proposition

Edgecipline saves time by turning screenshots into structured trades, then uses the journal to reveal behavioural and strategic patterns.

- Less manual journaling (screenshot in, journal out, zero typing).
- Better self-awareness (psychology cost, self-awareness score, Trading DNA).
- Clear discipline feedback (setup score, streaks, missions, discipline score).
- Market-specific support for Forex and Indian traders.
- An AI coach that answers questions using the user's own trades.
- A daily and weekly review loop (morning mentor, evening reflection, weekly report).

## 6. Goals And Principles

### 6.1 Business Goals

- Acquire early retail traders in India and in Forex communities.
- Convert free users to Pro after they experience screenshot extraction and their first insights.
- Build a defensible data layer on trade behaviour, psychology, setups, and outcomes.
- Own the "discipline-first journal" position, clearly distinct from signal apps.

### 6.2 User Goals

- Log trades quickly.
- Understand what works and what does not.
- Follow rules more consistently and reduce impulsive trades.
- Review each week with specific actions.

### 6.3 Product Principles

- Reduce journaling friction first.
- Show insights only when enough data exists; otherwise show a locked state that says what is needed.
- Keep Forex and Indian data fully separate.
- Coach discipline; never predict the market.
- Every insight ends in an action.
- Failures must be honest and recoverable: say what failed, never charge the user for our failure, always offer a retry.

## 7. Platforms And Release Status

| Platform | Status (2026-11-08) | Details |
|---|---|---|
| Web | Live | Next.js static export. Payments via Razorpay. Admin console lives here only. |
| Android | Live on Google Play; 1.1.2 submitted for production review 2026-09-23 | Capacitor 6, appId com.edgecipline, minSdk 24, targetSdk 36. Version set by EDGE_VERSION_CODE / EDGE_VERSION_NAME at build time. Next versionCode is 18. Google Play Billing. |
| iOS | 1.0 (build 7) in App Review since 2026-11-01 | iPhone only, rated 18+, free download, 175 countries, category Finance / Productivity. Apple In-App Purchase, Sign in with Apple, push via APNs -> FCM, checklist reminders. |

Company: Edgecipline Private Limited. Production API: api.edgecipline.com. Website: edgecipline.com. App Review demo account is on the Free plan (2 trades per market).

## 8. Business Model And Entitlement

### 8.1 Plans

| Plan | Price | Days | Per month | Struck-through "was" price | Notes |
|---|---|---|---|---|---|
| Free | INR 0 | Lifetime | - | - | 2 trades per market, 5 coach questions per week |
| Pro 1 month | INR 349 | 30 | INR 349 | none (reference rate) | Previously INR 199 |
| Pro 3 months | INR 899 | 90 | about INR 300 | INR 1047 (349 x 3) | |
| Pro 6 months | INR 1499 | 180 | about INR 250 | INR 2094 (349 x 6) | |
| Yearly | - | - | - | - | Legacy plan type, not orderable |

- Web prices live in backend/services/paymentService.js (PLAN_CONFIG). Old prices are kept in priorAmounts so in-flight orders and webhook retries still validate. Never remove entries.
- Struck-through prices must be a real purchasable price (the monthly rate times the months). Invented "was" prices are rejected by a sanity check.
- Store prices are set in Play Console and App Store Connect, not in code. Store fees (15-30%) are absorbed.

### 8.2 Store Products

| Store | Product | Plans |
|---|---|---|
| Google Play | edgecipline_pro (auto-renewing) | edgecipline-pro-monthly, edgecipline-pro-3month, edgecipline-pro-6month |
| Apple App Store | Subscription group "Edgecipline Pro" | com.edgecipline.pro.monthly, com.edgecipline.pro.3month, com.edgecipline.pro.6month |

Google Play: 7-day grace period, 30-day account hold, Billing Library 8.0.0. Upgrades charge full price immediately; downgrades are prorated by time.

### 8.3 Which Payment System Each Build Shows

| Build | Razorpay | Google Play Billing | Apple IAP |
|---|---|---|---|
| Web | On | Off | Off |
| Android | Off | On | Off |
| iOS | Off | Off | On |

- Controlled by NEXT_PUBLIC_PAYMENTS_ENABLED, NEXT_PUBLIC_PLAY_BILLING_ENABLED, and NEXT_PUBLIC_APP_STORE_BILLING_ENABLED. scripts/build-mobile.mjs pins these per target and fails the build on a conflict; disabled paywalls are replaced with empty stubs.
- Every upgrade button checks canShowPurchaseUI(). The paywall router picks SmartPaywall (web), PlayBillingPaywall (Android), or AppStorePaywall (iOS).
- CI runs check-payment-isolation to make sure no build ships the wrong payment code.

### 8.4 Who Is Pro

A user is Pro (isPremium in backend/utils/premium.js) if any of these is true:

- The user is an admin.
- Razorpay subscription is active and subscriptionExpiry is in the future.
- playEntitlementExpiry is in the future (Google Play).
- appStoreEntitlementExpiry is in the future (Apple).
- An active trial, only when TRIAL_ENABLED is on (it is off; the trial is retired).

The three provider expiries are stored separately on purpose. The effective expiry shown to the user is the latest of them. Razorpay purchases stack: each one extends subscriptionExpiry by the plan's days.

### 8.5 Free Tier Limits

| Limit | Value | Where |
|---|---|---|
| Trades per market | 2 Forex + 2 Indian, lifetime | FREE_TRADE_LIMIT=2 |
| Enforcement switch | On by default | FREE_TRADE_LIMIT_ENFORCED=true |
| What counts | Saved trades, including soft-deleted ones; multi-trade placeholder rows do not count | tradeQuotaService |
| Shared quota | Screenshot uploads and manual entries use the same quota | Checked before spending any OCR/AI call; charged at trade insert |
| Failed extraction | Never uses up quota | |
| Over the limit | HTTP 402 TRADE_LIMIT_REACHED | UI: TradeLimitDialog, LastFreeTradeSheet, TradeQuotaPill |
| Coach questions | 5 per ISO week (resets Monday 00:00 UTC) | coachQuotaService FREE_WEEKLY_LIMIT=5 |
| Pro-only missions | Missions whose template requiredPlan is premium | missionService |

Not gated: full analytics on the user's own trades, manual journal viewing, weekly reports, and Trading DNA (these are throttled instead - see section 9).

### 8.6 Promotions And Referrals

- Coupons: percent or flat discount, total caps, per-user caps, first-time-payer rules, atomic capacity reservation at checkout (web only).
- Campaigns and influencers with attribution tracking (AttributionTouch).
- Referral short links: edgecipline.com/r/<slug> -> /register?ref=<slug>. No user-to-user referral reward exists yet.
- Admin can activate or extend a plan manually.

### 8.7 Lifecycle Funnels

| Funnel | Touchpoints | Channels |
|---|---|---|
| Subscription rescue | 7, 3, 1 days before expiry; expiry day; 3, 7, 14 days after | In-app RescueBanner, push, email |
| Free-tier nudge | 1, 3, 7, 14 days after the last free trade; ends at day 21; max 3 pushes per day | In-app banner, push |

The RescueBanner (frontend/components/RescueBanner.js) polls GET /rescue/banner every 5 minutes and on focus, has 7 tones, remembers dismissal per touchpoint, and only shows a buy button where purchase UI is allowed.

## 9. Feature Catalog

### 9.1 Account And Authentication

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| Email registration | Sign up with email and password (8+ chars, upper, lower, number, symbol). Picks up ?ref= referral. | Yes | Yes | Yes |
| Email login | 5 failed attempts lock the account for 15 minutes. | Yes | Yes | Yes |
| Google sign-in | One tap. Native plugin on mobile, popup then redirect on web. Cannot take over an existing password account. | Yes | Yes | Yes |
| Sign in with Apple | Supports Apple private relay emails. | No | No | Yes |
| Forgot / reset password | Emailed one-time code (hashed, 10-minute expiry, attempt lockout). Reset revokes all sessions. | Yes | Yes | Yes |
| Terms gate | Must accept the current Terms and Privacy version before using the app. | Yes | Yes | Yes |
| Secure session | 15-minute access token plus rotating refresh token. Web: memory + httpOnly cookie. Mobile: Android Keystore / iOS Keychain (this device only). | Yes | Native | Native |
| Log out / log out everywhere | Revokes the current or all sessions. | Yes | Yes | Yes |
| Delete account | In-app permanent deletion of all user data. On iOS, Apple-linked accounts re-confirm with Apple so the Apple authorisation is revoked first (best effort, never blocks deletion). | Yes | Yes | Yes |
| Public deletion page | /delete-account explains deletion (Play requirement). | Yes | Yes | Yes |
| In-app browser warning | Warns when Google sign-in is blocked inside another app's browser. | Yes | - | - |

### 9.2 Onboarding

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| First-login welcome | Full-screen 3-slide intro: what Edgecipline is, market picker, what a setup is. | Yes | Yes | Yes |
| Guided onboarding | Resumable, skippable steps: welcome -> market -> trading style (Scalper, Intraday, Swing, Position, Investor) -> seeded first setup -> first trade (upload, manual, or "I haven't traded yet") -> first AI insight (with a fallback if AI is down). Ends on /dashboard?onboarded=1. | Yes | Yes | Yes |
| Getting started card | Dashboard checklist: start onboarding, create first setup, import first trade. | Yes | Yes | Yes |
| Replay tutorial | Settings -> "Replay app tutorial" opens the dashboard with ?tour=1 and replays the welcome. | Yes | Yes | Yes |
| Existing users | Older accounts are migrated quietly and skip straight to the dashboard. | Yes | Yes | Yes |

### 9.3 Market Modes

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| Forex mode | Journal, analytics, setups, dashboard for Forex. | Yes | Yes | Yes |
| Indian Market mode | Same, for Indian stocks and options, under /indian-market/*. | Yes | Yes | Yes |
| Market switcher | One switch in the header or drawer. Each market keeps its own data and quota. | Yes | Yes | Yes |
| Indian fields | Segment, instrument type, underlying, option type (CE/PE), strike, expiry, lot size, quantity, exchange, sector, brokerage, STT and taxes. | Yes | Yes | Yes |
| Currency and labels | Money, symbols, and field names follow the active market. | Yes | Yes | Yes |

### 9.4 Logging A Trade

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| Screenshot upload | Upload a broker screenshot; OCR + AI extract the trade. | Yes | Yes | Yes |
| Confirm before extraction | Preview the image and confirm it is a trade screenshot. | Yes | Yes | Yes |
| Broker choice | Indian mode asks for the broker so extraction reads the right layout. | Yes | Yes | Yes |
| Processing states | Uploading, queued, processing, completed, failed. | Yes | Yes | Yes |
| Bounded waiting | Client polls every 4 seconds and stops after 10 minutes with a "taking longer than expected" message and retry. A job in progress is remembered for up to 12 hours. Server reaps stalled jobs after 8 minutes. | Yes | Yes | Yes |
| Friendly errors | Upstream AI errors are translated into plain messages, never raw provider text. | Yes | Yes | Yes |
| Non-trade rejection | Non-trade images are rejected without saving anything or using quota. | Yes | Yes | Yes |
| Multi-trade extraction | One screenshot with several trades becomes several entries. | Yes | Yes | Yes |
| Review before save | Correct extracted fields before saving; confidence score shown. | Yes | Yes | Yes |
| Manual entry | Type a trade in when there is no screenshot. | Yes | Yes | Yes |
| Trade fields | Instrument, buy/sell, size, entry, exit, stop loss, take profit, P&L, commission, swap, date, session, strategy, notes, risk:reward. | Yes | Yes | Yes |
| Psychology fields | Entry basis (plan / emotion / impulsive), mood 1-5, confidence 1-5, emotion tags, mistake tag, lesson, would-retake, self-rated quality. | Yes | Yes | Yes |
| Setup checklist in the form | Pick a saved setup, tick the rules followed, get a setup score. | Yes | Yes | Yes |
| No duplicates on retry | Each create sends an Idempotency-Key; a retried request returns the original result. Client timeout (20s) is above the server deadline. | Yes | Yes | Yes |
| Quota display | TradeQuotaPill shows free trades left; last free trade shows a sheet. | Yes | Yes | Yes |

### 9.5 Trade Journal

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| Trade log | All trades, newest first, with keyset ("load more") paging and virtualised rows for long histories. | Yes | Yes | Yes |
| Search and filters | Server-side: symbol prefix search, LONG/SHORT, date (an ISO date in search acts as a date filter), result, strategy, session. | Yes | Yes | Yes |
| Period totals | Header totals cover the whole filtered period, not only loaded rows. | Yes | Yes | Yes |
| Trade detail | Every field, the screenshot, psychology, checklist. | Yes | Yes | Yes |
| Edit trade | Fix anything after saving. | Yes | Yes | Yes |
| Delete and restore | Soft delete with restore. Analytics update right away. | Yes | Yes | Yes |
| Status badge | Processing, completed, or needs review. | Yes | Yes | Yes |
| Separate journals | Forex and Indian trades are separate. | Yes | Yes | Yes |

### 9.6 Setups And Checklists

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| Setup builder | One shared builder for both markets. Starter templates: Breakout, Pullback, Reversal. Up to 50 setups per market, 20 rules each. | Yes | Yes | Yes |
| Reference images | Attach example chart images to a setup. | Yes | Yes | Yes |
| Setup score | Percentage of the setup's rules followed on a trade. | Yes | Yes | Yes |
| Safe history | Editing or deleting a setup never changes old trades; each trade keeps a copy of the rules it was scored on. | Yes | Yes | Yes |
| Pre-trade checklist | Tick rules before trading; gives a confidence grade (A+, Moderate, Low). | Yes | Yes | Yes |
| Psychology checklist | Flowchart and problem grid for Impulse, Fear, Revenge, Overconfidence, Overtrading, Loss Aversion. | Yes | Yes | Yes |
| Live checklist notification | A notification with up to 8 rules you can tick from the shade; survives reboot. | No | Native | No |
| Checklist reminder | Reminder at a chosen time, every day or weekdays. Web saves the setting only. | Settings only | Native | Native |
| Checklist history | Every completed checklist is stored to show the habit over time. | Yes | Yes | Yes |

### 9.7 Dashboard

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| KPI cards | Total trades, win rate, net P&L, and the journal streak. | Yes | Yes | Yes |
| Equity curve | Account growth over time. | Yes | Yes | Yes |
| Streak chip | Current streak; opens /streaks. | Yes | Yes | Yes |
| Reflection card | Opens the evening reflection. | Yes | Yes | Yes |
| Today's intelligence | Short summary of what the data says today. | Yes | Yes | Yes |
| AI coach snapshot | Biggest Leak, Biggest Edge, Blind Spot, Priority Action. | Yes | Yes | Yes |
| Quick actions | Log trade, upload screenshot, run checklist, open report. | Yes | Yes | Yes |
| Recent progress | Recent movement in key numbers. | Yes | Yes | Yes |
| Banners | RescueBanner and (inactive) trial countdown in the header. | Yes | Yes | Yes |
| Indian dashboard | Same page, Indian data. | Yes | Yes | Yes |

### 9.8 Analytics

Overview plus nine sections. All are cached server-side (45-120 seconds) and refreshed when trades change.

| Section | Route | What it shows |
|---|---|---|
| Overview | /analytics | Wins, losses, profit, average trade, weekly P&L, best/worst pairs, strategy league, session/time, risk:reward, distribution, calendar P&L, drawdown |
| Psychology | /analytics/psychology | How mood, confidence, emotions affect results |
| Self-awareness | /analytics/self-awareness | Self-rated vs system-rated trade quality |
| Psychology cost | /analytics/psychology-cost | Money lost to emotions, mistakes, broken rules |
| Trading DNA | /analytics/trading-dna | Strengths, weaknesses, best setup/session, risk style |
| Patterns | /analytics/patterns | Streak, session, day, mood, setup-score patterns |
| AI coach feed | /analytics/ai-coach | Ranked coaching insights |
| Mistakes | /analytics/mistakes | Most repeated mistakes and their cost |
| Discipline | /analytics/discipline | Discipline trend and modules |
| AI insights | /analytics/ai-insights | Plain-English insights from the journal |
| Indian analytics | /indian-market/analytics | Same, plus a P&L breakdown (brokerage, taxes) |

All sections are available on Web, Android, and iOS.

### 9.9 Psychology And Discipline

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| Discipline page | Discipline score, trend, strongest habit (both markets). | Yes | Yes | Yes |
| Psychology timeline | Day-by-day and week-by-week mindset with a growth summary. | Yes | Yes | Yes |
| Revenge and tilt detection | Flags revenge trading and tilt patterns. | Yes | Yes | Yes |
| Self-awareness score | How honestly the user rates their own trades. | Yes | Yes | Yes |
| Psychology cost | Cost of FOMO, revenge, fear, greed, and broken rules. | Yes | Yes | Yes |

### 9.10 Streaks

| Streak | Counts | Rule |
|---|---|---|
| Journal | Calendar days | A day counts if you log a trade or tap "No Trade Today" |
| Checklist | Trading days | A day counts if you used the checklist |
| Rule | Consecutive trades | Trade's setup score is at or above the threshold (default 70, user can change) |

- Grace: a streak of 7 or more that misses exactly one day can be recovered, at most once every 30 days.
- Milestones: 3, 7, 14, 30, 60, 100, 180, 365.
- Push: "streak at risk" at 21:00 IST for streaks of 3 or more; "streak broken" for streaks of 7 or more. Copy never shames.
- Days use IST day keys.
- Page /streaks shows milestones, a 12-week calendar, and the checklist streak. Available on all platforms.

### 9.11 Intelligence Hub, Trading DNA, And AI Coach

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| Intelligence Hub (/intelligence) | Five questions: What makes me money? What costs me money? What should I improve? How am I evolving? What should I do now? | Yes | Yes | Yes |
| Trading DNA report (/trading-dna) | AI report for 30, 90, or 365 days. Generated in the background; can be regenerated once every 24 hours. Quarterly comparison. | Yes | Yes | Yes |
| Share Trading DNA | Public share card at /trading-dna/share?token=. | Yes | Yes | Yes |
| AI coach feed | 5-15 ranked insights from 5 rule-based generators. | Yes | Yes | Yes |
| Locked states | Each module says how much more data it needs instead of guessing. | Yes | Yes | Yes |
| Indian intelligence | Six modules: Trading DNA, Patterns, Risk Patterns, Psychology Cost, Self-Awareness, AI Coach. | Yes | Yes | Yes |

Unlock thresholds and formulas are in section 11.

### 9.12 AI Coach Chat (/coach)

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| Chat | Streaming answers grounded in the user's last 20 trades, streaks, last 7 reflections, latest weekly report, analytics, psychology, and DNA. | Yes | Yes | Yes |
| Conversations | List, new session, rename, delete. | Yes | Yes | Yes |
| Anchored chats | Start from an insight, a trade, a reflection, a weekly report, the dashboard, or freeform. "Ask coach" buttons open the chat with that context. | Yes | Yes | Yes |
| Quick prompts | Suggested questions. | Yes | Yes | Yes |
| Quota pill | Free: 5 questions per ISO week. Pro: unlimited (20 per minute rate limit). Out of quota -> upgrade message (HTTP 402). | Yes | Yes | Yes |
| Honest failures | Each failure has a specific message (bad request, blocked, busy, empty response, unavailable, stream errors). | Yes | Yes | Yes |
| Automatic refund | If the AI fails to answer, the question is not counted. Blocked and invalid questions are not refunded. | Yes | Yes | Yes |
| Retry in place | Retry re-asks the same question; the failed pair is marked superseded and never counts. Hidden when out of quota or blocked. | Yes | Yes | Yes |

Coach rules: never invent numbers, no signals, end with one action, at most 6 paragraphs. Question length up to 1,200 characters; last 10 turns of history; context snapshot up to 60 KB, cached 5 minutes.

### 9.13 Missions (/missions)

| Feature | What it does |
|---|---|
| Categories | Risk, Discipline, Psychology, Journal, Strategy |
| Examples | 1% Risk Discipline, Stop Loss on Every Trade, Protect Your Daily Limit, Risk:Reward Discipline, No Revenge Trades (14 and 30 days), No FOMO Trades, Calm Mindset, Checklist Every Trade, Rule Adherence Streak, A+ Setups Only, 14/30-Day Journal Streak, Daily Reflection Streak, Lesson in Every Loss, 4 Weekly Reviews |
| Limits | At most 3 active missions |
| Progress | Updated automatically by trades, reflections, and weekly reports; evaluated nightly at 21:30 IST with reminders at 07:30 IST |
| Recommendations | Rule-based picks for the user's weakest area, with optional AI-written copy |
| Free vs Pro | Some templates require Pro |
| History | Completed and archived missions |

Available on Web, Android, and iOS. Note: today the page is reached only from a push notification (the dashboard mission widget is not shown) - see section 22.

### 9.14 Reflection And Reviews

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| Evening reflection | 30-second check-in: followed plan (yes / partly / no / no trades), mood 1-5, confidence 1-5, would repeat, a 280-character improvement note. An AI line responds (with a fixed fallback). Can be skipped. | Yes | Yes | Yes |
| Weekly report (/weekly-reports) | Performance breakdown, psychology read, next-week checklist. Placeholder AI output is visibly labelled. Can be generated on demand (throttled). | Yes | Yes | Yes |
| Weekly report reminder | 09:00 IST reminder (never calls AI by itself). | Yes | Yes | Yes |
| Morning mentor | 07:00 IST message setting the focus for the day; also shown in the inbox. | Yes | Yes | Yes |

### 9.15 Notifications

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| Inbox (/notifications) | All messages sent to the user, including Morning Mentor. | Yes | Yes | Yes |
| Push | Alerts when the app is closed (FCM; iOS via APNs). Taps open the right screen. | No | Native | Native |
| Smart coach alerts | 8 rules (see 11.8). Deduplicated, respect quiet hours. | Yes | Yes | Yes |
| Scheduled reminders | Sessions, reflection, streak, weekly, mentor, missions. | Yes | Yes | Yes |
| Quiet hours | Default 22:00-07:00 Asia/Kolkata, user-adjustable. | Yes | Yes | Yes |
| Preferences | Turn each category on or off. | Yes | Yes | Yes |
| Android channels | 8 notification channels. | - | Native | - |

### 9.16 Settings (/settings, /profile redirects here)

Sections, top to bottom:

- Profile card with plan and admin pills.
- Account: name, email, sign-in method, member since, last login.
- Subscription: plan, status, expiry, lifecycle notice. Buttons: Upgrade plan, Manage subscription (Google Play page on Android, Apple sheet on iOS), Change plan.
- Shortcuts: Analytics, Upload a trade, Weekly reports, switch market.
- Help: Replay app tutorial, Help and support.
- Delete account.

Plan labels: Free, Monthly Pro, Annual Pro, Premium Trial. Statuses: Active, Inactive, Expired, Trial.

### 9.17 Support And Feedback

| Feature | What it does | Web | Android | iOS |
|---|---|---|---|---|
| Help center (/support) | Public, works when logged out. Articles at /support/article?slug=. | Yes | Yes | Yes |
| Support assistant | Retrieval only: suggests help articles, never writes its own answers. | Yes | Yes | Yes |
| Tickets | Create, reply, attach screenshots, reopen, rate satisfaction; duplicate suggestions. Resolved tickets auto-close after 7 days. | Yes | Yes | Yes |
| Floating support widget | On every screen except auth, admin, onboarding, support. | Yes | Yes | Yes |
| WhatsApp contact | Tap to chat with the team. | Yes | Yes | Yes |
| Issue reports | Legacy bug reports (redirect to tickets), with OCR snapshot and fix notification. | Yes | Yes | Yes |
| Feedback | Suggestions and ratings. | Yes | Yes | Yes |

### 9.18 Admin Console (Internal, Web Only, Removed From Mobile Builds)

| Area | What it does |
|---|---|
| Login | Separate admin login with its own secret and session cookie |
| Dashboard | Users, trades, revenue, growth, platform health |
| Users | Search, plan, status, extend subscription or trial, remind, delete |
| Expired users | Follow-up list |
| Trades | Any user's trades, extraction logs, debug |
| Payments | Razorpay, Play, Apple payments; status; manual activation |
| Promotions | Overview, redemptions, campaigns, coupons, influencers |
| Feedback and issues | Review and update status |
| Support | Tickets (assign, status, priority, tags, audit, user context), knowledge base articles, agents (support roles re-checked on every request) |
| Notifications | Analytics, queue metrics, history, custom push |
| Missions | Template CRUD, assign, analytics, seed |
| Monitoring | Cache health, auth cache metrics, notification analytics |

## 10. Information Architecture

### 10.1 Route Map

| Group | Routes |
|---|---|
| Entry | / (redirects to /login, /accept-terms, or dashboard) |
| Auth | /login, /register, /forgot-password, /verify-otp, /reset-password, /accept-terms |
| Onboarding | /onboarding (?step=) |
| Dashboard | /dashboard, /indian-market/dashboard |
| Journal | /trades, /trades/view?id=, /trades/edit?id=, /add-trade, and Indian equivalents under /indian-market/ |
| Upload | /upload-trade, /indian-market/upload-trade (legacy /upload is unlinked) |
| Setups and checklist | /setups, /indian-market/setups, /checklist, /checklist/psychology, /checklist/notification-settings |
| Analytics | /analytics and 9 sub-routes, /indian-market/analytics, /indian-market/analytics/ai-coach |
| Discipline | /discipline, /indian-market/discipline, /psychology-timeline, /streaks |
| Intelligence | /intelligence, /indian-market/intelligence, /indian-market/intelligence/<module>, /trading-dna, /trading-dna/share?token= |
| Coach | /coach |
| Habits | /missions, /reflection, /weekly-reports?market= |
| Inbox | /notifications |
| Account | /settings, /profile (redirect) |
| Support | /support, /support/article, /support/tickets, /support/tickets/new, /support/tickets/detail, /issues (redirect) |
| Legal | /terms, /privacy-policy, /delete-account |
| Referral | /r?ref=<slug> and /r/<slug> |
| Admin (web) | /admin/login, dashboard, users, expired-users, trades, payments, promotions, feedback, issues, monitoring, support, support/articles |

Pricing has no page; it is a modal (PricingModal -> PaywallGate).

### 10.2 Navigation

- Bottom nav (mobile), Forex: Home, Trades, Add (raised button -> upload), Intelligence, Settings.
- Bottom nav, Indian: Home, Trades, Add, Analytics, Settings.
- Bottom nav is hidden on auth, legal, admin, support, add-trade, and upload screens.
- Desktop header (wide screens): Dashboard, Trades, Import, Checklist, Setups, Intelligence, Analytics, Reports, Settings, plus Market Switcher, Upgrade (only when purchase is possible and not Pro), Logout.
- Mobile drawer: same links, market switcher, upgrade, support.
- No sidebar. Android back button is handled natively.
- Offline banner when the network drops.

## 11. User Flows

### 11.1 New User

1. Open app -> session check -> login screen.
2. Register with email (OTP) or Google / Apple.
3. Accept Terms and Privacy.
4. First-login welcome (3 slides) -> guided onboarding (market, style, seeded setup, first trade, first AI insight).
5. Land on dashboard with the getting-started card.
6. Log more trades; locked insights unlock as data grows.
7. Daily loop: morning mentor -> checklist before trading -> log trades -> evening reflection.
8. Weekly loop: weekly report -> pick a mission -> act on the priority action.

### 11.2 Screenshot Upload

1. Tap Add -> choose market (and broker in Indian mode).
2. Pick image -> preview -> confirm.
3. Server checks quota before spending any OCR/AI call, stores the image, queues an OCR job.
4. Pipeline: Google Vision OCR -> Tesseract fallback -> Gemini Vision -> text-AI fallback.
5. Client polls every 4s (up to 10 minutes); stalled jobs are reaped by the server.
6. Review one or more extracted trades, fix fields, add psychology and checklist.
7. Save (with idempotency key) -> quota charged -> journal and analytics refresh.

### 11.3 Manual Trade

1. Log Trade -> enter core fields -> optional setup and checklist -> psychology, mistake, lesson, notes -> save -> analytics update.

### 11.4 Coach Chat

1. Open /coach or tap "Ask coach" on an insight, trade, reflection, or report.
2. Ask a question -> quota checked -> answer streams.
3. On failure: specific message, question refunded, Retry re-asks in place.
4. Free user out of quota -> upgrade prompt.

### 11.5 Upgrade - Web

1. Hit the trade limit or tap Upgrade -> SmartPaywall shows plans, per-month price, savings.
2. Optional coupon -> server quote and reservation -> Razorpay checkout (UPI, card, net banking).
3. Client verifies; Razorpay webhook confirms -> subscriptionExpiry extended -> Pro.

### 11.6 Upgrade - Android

1. PlayBillingPaywall -> Google Play purchase sheet (purchase bound to the account).
2. App sends the purchase token -> server re-reads state from Google -> acknowledges -> playEntitlementExpiry set -> Pro.
3. Renewals, cancellations, grace, hold arrive by real-time developer notifications; a 30-minute sweep acknowledges anything missed. The app reconciles on launch and resume.

### 11.7 Upgrade - iOS

1. AppStorePaywall -> Apple purchase sheet (appAccountToken binds it to the account).
2. App sends the signed transaction -> server verifies up to Apple Root CA G3 -> appStoreEntitlementExpiry set -> Pro.
3. Renewals, refunds, revocations arrive by App Store Server Notifications V2. Restore purchases is supported.

### 11.8 Expiry And Rescue

1. Rescue touchpoints at D-7, D-3, D-1, D0 (banner, push, email).
2. Razorpay expiry is applied hourly; the user keeps all data and returns to the free limits.
3. Post-expiry touchpoints at D+3, D+7, D+14 with an easy way back.

### 11.9 Account Deletion

1. Settings -> Delete account -> confirm (Apple users confirm with Apple on iOS).
2. Account disabled and sessions revoked -> Firebase user deleted -> every user-owned collection purged -> store subscription rows detached (not deleted) so tokens cannot be reused -> user record deleted last -> images removed.
3. Payment and webhook records are kept for legal reasons.
4. A live store subscription is not cancelled by deletion; the user is pointed to the store's cancel page.

### 11.10 Referral

1. Visitor opens edgecipline.com/r/<slug> -> attribution recorded -> /register?ref=<slug> -> attribution stored on the user.

## 12. Scoring And Formula Reference

### 12.1 System Trade Quality (backend/utils/tradeEvaluation.js)

| Factor | Points |
|---|---|
| Setup score (0-100 adherence x 0.4) | 40 |
| Entry basis (plan beats emotion beats impulsive) | 20 |
| Emotion (mood, emotion tags) | 20 |
| Would retake | 10 |
| Confidence | 10 |

Score = earned points / possible points x 100. Great = 70 or more. Average = 45-69. Poor = below 45. Missing fields are excluded from the possible points rather than scored as zero.

### 12.2 Self-Awareness

Compares the user's own Great / Average / Poor rating with the system rating. Accuracy = matches / rated trades x 100, also per tier. Flags overconfidence (rates Poor trades as Great), underconfidence, outcome bias, and loss bias. Unlocks at about 15 rated trades.

### 12.3 Pattern Confidence (Trading DNA And Patterns)

| Trades in the group | Confidence |
|---|---|
| Fewer than 5 | Hidden |
| 5-9 | Low |
| 10-29 | Medium |
| 30 or more | High |

Trading DNA dimensions include session, instrument, mood, confidence, day of week, and entry basis (10 modules in code).

### 12.4 Psychology Cost

- Sums P&L lost on trades tagged with each emotion, mistake, or rule violation. A trade's full P&L is counted against every tag it carries.
- Produces a 0-100 cost score and the top 3 leaks.
- Psychology Score compares P&L from plan trades with emotional and impulsive trades, weighted by plan adherence.
- Unlocks at about 10 tagged trades.

### 12.5 Tilt And Revenge

- Tilt: 3 losses in a row.
- Revenge (smart alert): 3 losses within 4 hours.

### 12.6 AI Coach Feed

- Impact score = abs(P&L of the pattern) / total traded volume x 300, capped at 100.
- Filtered out: insights worth under USD 50 or based on fewer than 5 trades.
- Mix: about 70% problems, 30% strengths; no duplicate topics; 5-15 insights.
- Each insight has id, category, type, priority, impact score, title, insight, evidence, recommendation.

### 12.7 Intelligence Unlock Thresholds

| Question | Engine | Unlocks at |
|---|---|---|
| What makes me money? | Trading DNA + patterns | about 20 trades |
| What costs me money? | Psychology cost | about 10 tagged trades |
| What should I improve? | Self-awareness + discipline | about 15 rated trades |
| How am I evolving? | Psychology timeline | about 2 weeks of data |
| What should I do now? | Coach feed | about 10 trades |

Intelligence loads up to the 10,000 most recent trades and caches results for 90-120 seconds.

### 12.8 Smart Coach Alert Rules

1. Trade without a stop loss.
2. Setup score under 60.
3. Mood risk (trading in a poor mood).
4. Revenge trading (3 losses within 4 hours).
5. Overtrading.
6. Repeated mistake (same mistake 3 times in a week).
7. Daily loss warning.
8. Confidence reminder.

### 12.9 Reflection Weekly Score (0-100)

| Part | Weight |
|---|---|
| Plan adherence | 40 |
| Would repeat | 20 |
| Mood and confidence | 20 |
| Completion (days reflected / 7) | 20 |

### 12.10 Setup Score And Checklist Grade

- Setup score = rules followed / rules in the setup x 100.
- Rule streak threshold default 70.
- Smart alert below 60.
- Checklist grade: A+, Moderate, Low by share of rules ticked.

## 13. Technical Architecture

### 13.1 Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (static export), React, Tailwind 4 (most pages use scoped styles), framer-motion, Recharts (lazy), lucide-react |
| Data on the client | TanStack React Query v5 (stale 2 min, retry 1, no refetch on focus), 24h persisted cache for read-heavy queries, axios with retries, MarketContext for global state |
| Mobile | Capacitor 6 with firebase-authentication, app, haptics, keyboard, network, preferences, push-notifications, status-bar, Sentry |
| Custom native code | Android: ChecklistNotification, EdgeBilling (Play Billing 8.0.0), EdgeAuthStorage (Keystore AES-GCM). iOS: ChecklistNotificationPlugin, EdgeStoreKitPlugin (StoreKit), EdgeAuthStoragePlugin (Keychain) |
| Backend | Node 20, Express 5, Mongoose 9 (MongoDB), Redis (ioredis), BullMQ, node-cron, zod validation, helmet, multer + sharp + file-type, winston + morgan |
| AI | Google Gemini (default gemini-3.5-flash via GEMINI_MODEL / GEMINI_TRADE_MODEL); optional OpenAI gpt-4o-mini for text extraction |
| OCR | Google Cloud Vision -> Tesseract.js -> Gemini Vision -> text-AI fallback |
| Storage | Cloudinary (screenshots, setup images) |
| Email | Resend (domain edgecipline.com) with SMTP fallback |
| Push | Firebase Cloud Messaging; iOS APNs token handed to Firebase Messaging |
| Payments | Razorpay, Google Play Developer API, Apple App Store Server Library |
| Auth | JWT HS256 access tokens (15 min), opaque rotating refresh tokens (hashed, httpOnly cookie, family replay detection), tokenVersion revocation, Firebase ID tokens for Google and Apple |
| Monitoring | Sentry (frontend, backend, mobile) |
| API docs | Swagger at /api/docs |

### 13.2 Request Pipeline

Request context -> Sentry -> HTTPS redirect -> CORS allowlist (including capacitor://localhost) -> helmet (strict CSP and HSTS in production) -> timeout -> logging -> no-store cache headers -> standard response envelope -> input sanitising -> global rate limiter -> route (protect -> Redis user cache -> tokenVersion check -> terms gate).

Webhooks are mounted before JSON parsing so their raw bodies can be verified.

### 13.3 Caching

- Redis response caching with TTL jitter and stampede protection.
- Per-user trade version (trade_version:<userId>) changes on every trade or setup change and invalidates analytics.
- Analytics snapshot service combines dashboard data in one call.
- Auth user cache in Redis.
- Client: React Query plus localStorage persistence; trade data refetches on reconnect.

### 13.4 Queues And Workers

| Queue | Worker | Settings |
|---|---|---|
| ocrQueue | ocrWorker | 3 attempts, 5s backoff |
| tradingDnaQueue | tradingDnaWorker | 2 attempts |
| smartNotificationsQueue | smartNotificationWorker | runSmartChecks and deliverNotification jobs, concurrency 8 |

### 13.5 Scheduled Jobs (Redis-locked; times IST unless noted)

| Job | Schedule | Purpose |
|---|---|---|
| OCR stalled-job reaper | Every 2 min | Fail OCR jobs with no consumer after 8 minutes |
| OCR screenshot retention | Hourly at :20 | Delete screenshots before the 24h job record expires |
| Session reminders | Every 15 min | London 12:45, New York 18:15, India 09:00 (weekdays, NSE holidays skipped) |
| Morning mentor | 07:00 | Daily focus message |
| Mission progress | 21:30 evaluate and expire; 07:30 reminders | Missions |
| Reflection reminder | 19:30 | Evening check-in |
| Streak protector | 21:00 | Streak at risk |
| Weekly report reminder | 09:00 | Reminder only, no AI call |
| Subscription expiry | Hourly | Expire lapsed Razorpay plans |
| Subscription rescue | Hourly at :15 | Rescue touchpoints |
| Free-tier nudge | Hourly at :35 | Free-tier touchpoints |
| Webhook reconciliation | Every 15 min | Replay failed webhook events |
| Webhook retention | 03:30 | Prune payloads after 90 days, token secrets after 30 |
| Play acknowledgement sweep | Every 30 min | Acknowledge Play purchases (Google refunds after 3 days otherwise) |
| Support auto-close | 02:00 | Close resolved tickets after 7 days |
| Data cleanup | 03:00 | Retention cleanup |

### 13.6 Deployment

- Backend on AWS EC2 under PM2 with three apps: edgecipline-api (port 5000, restart at 1 GB), edgecipline-ocr-worker, edgecipline-trading-dna-worker. A staging PM2 config also exists.
- Frontend web: static export. Mobile: Capacitor builds from the same code via scripts/build-mobile.mjs (pins the payment flags, prunes admin).
- Android release builds pin NEXT_PUBLIC_API_URL to production (the local .env.local points at localhost).
- iOS builds: the owner has no Mac; use GitHub Actions macOS runners for rebuilds.
- Branches: production currently runs the staging branch. CI deploys on push to main. Merging staging into main must be done carefully so iOS work is not dropped.
- CI (.github/workflows/deploy.yml): npm ci, security scan, mojibake check, mobile auth storage check, Android-only plugin check, payment isolation check, tests; then SSH deploy to EC2 and a health check.

### 13.7 Configuration (Main Environment Variables)

| Area | Variables |
|---|---|
| Core | NODE_ENV, PORT, MONGO_URI, REDIS_URL, JWT_SECRET, ADMIN_JWT_SECRET, TRUST_PROXY (required in production) |
| AI and OCR | GEMINI_API_KEY, GEMINI_MODEL, GEMINI_TRADE_MODEL, OPENAI_API_KEY, GOOGLE_VISION_* |
| Storage, email, push | CLOUD_*, RESEND_*, SMTP_*, EMAIL_*, FIREBASE_* |
| Payments | RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET, GOOGLE_PLAY_* (enabled flag, package, service account, RTDN audience, account salt), APPLE_IAP_* (enabled, bundle id, issuer, key, sandbox flags, account salt) |
| Free tier | FREE_TRADE_LIMIT, FREE_TRADE_LIMIT_ENFORCED, TRIAL_ENABLED, TRIAL_DAYS, FREE_TIER_NUDGE_* |
| Frontend builds | NEXT_PUBLIC_API_URL, NEXT_PUBLIC_PAYMENTS_ENABLED, NEXT_PUBLIC_PLAY_BILLING_ENABLED, NEXT_PUBLIC_APP_STORE_BILLING_ENABLED, NEXT_PUBLIC_FIREBASE_*, NEXT_PUBLIC_SENTRY_* |
| Monitoring | SENTRY_* |

Production refuses to boot with Razorpay test keys, and treats a broken Play service account as fatal. A missing required variable crash-loops PM2, so the server .env must be kept in step with .env.example.

## 14. API Surface

All user routes require login unless marked public. Responses use a standard envelope.

| Prefix | Purpose |
|---|---|
| /api/auth | Register, login, Google, Apple, OTP reset, refresh, logout, logout-all, accept terms, me, preferences, onboarding state, delete account |
| /api/trades | Forex trades: quota, create, batch create (idempotent), list (keyset), get, status, update, soft delete, restore |
| /api/indian/trades | Same for Indian trades |
| /api/upload | Screenshot upload, trade evidence, job status, cancel, queue health |
| /api/setups | Strategies and reference images |
| /api/checklists | Checklist tracking and reminder settings |
| /api/dashboard | Dashboard snapshot |
| /api/analytics, /api/indian/analytics | Snapshot, summary, weekly, risk-reward, distribution, performance, time, quality, drawdown, insights, advanced, psychology, self-awareness, psychology cost, DNA, patterns, coach feed, timeline, discipline (Indian adds P&L breakdown) |
| /api/indian/intelligence | Indian intelligence summary |
| /api/reports | Weekly reports, generate now |
| /api/trading-dna | Get, list, generate (sync and async), job status, share token; public share view |
| /api/coach | Quota, quick prompts, refresh context, conversations, messages (streaming) |
| /api/missions | Templates, active, stats, history, profile, recommend, accept, archive |
| /api/streaks | Get, no-trade-today, recompute, set threshold |
| /api/reflections | Today, summary, list, submit, skip |
| /api/onboarding | Step endpoints and complete |
| /api/notifications | Inbox, read, read-all, opened, delivered, action |
| /api/profile | Device tokens, notification preferences |
| /api/payments | Razorpay order and verify |
| /api/payments/google-play, /api/payments/app-store | Config, subscription, verify, restore |
| /api/promotions | Referral link resolve (public), attribution touch, coupon validate |
| /api/trial, /api/rescue | Paywall context, free-tier events, rescue banner and events |
| /api/support | Public config, home, articles; assistant and tickets need login |
| /api/feedback, /api/issues | Feedback and issue reports |
| Health | GET / and /health (database, Redis, rate limiter; 503 when degraded) |
| Webhooks | /api/payments/webhook (Razorpay, HMAC), /api/webhooks/google-play (Pub/Sub, OIDC), /api/webhooks/app-store (JWS) |
| Admin | /api/admin/* (auth, analytics, users, payments, trades, notifications, feedback, issues, missions, promotions, support) |

Rate limits are Redis-backed (in-memory fallback), per user or IP: global, auth (login/register about 5/min), refresh (about 10/min), password reset (per IP and per email), profile, device token, upload, status, payment, webhook, admin financial, admin destructive, issue report, coach chat (20/min), support, coupon validate, promotion touch, Trading DNA generate (about 2/min), DNA share (10/min), public share view (30/min).

Idempotency: Idempotency-Key or X-Idempotency-Key header on trade create and batch create; success is replayed, an in-flight duplicate gets 409, failures release the key.

## 15. Data Model

| Collection | Holds |
|---|---|
| User | Identity, auth provider, Google/Apple ids, role, support role, status, pending deletion, OTP and lockout, Razorpay subscription fields, Play and App Store entitlement expiries, trial and free-tier state, onboarding, preferred market, trading style, terms acceptance, token version, streaks, attribution |
| Trade | Forex trade: prices, SL/TP, P&L, fees, session, dates, OCR fields (raw text, AI response, confidence, job id), psychology fields, setup rules snapshot and score, quality, soft-delete fields |
| IndianTrade | Indian trade: segment, instrument, underlying, option type, strike, expiry, lot size, quantity, exchange, sector, brokerage, taxes, plus the same psychology and soft-delete fields |
| OCRJob | Upload job: market, broker, image, hash, status, attempts, extracted data, confirmed trade, recovery attempts, 24h expiry |
| ExtractionLog | Audit of each extraction |
| SetupStrategy | Setups, rules, reference images |
| ChecklistTracking, ChecklistNotificationSetting | Checklist results and reminder settings |
| DailyDisciplineEntry | Per-day trade count, no-trade-today, rule hit (feeds streaks) |
| DailyReflection | Evening reflection and AI line |
| WeeklyReport | Snapshot, AI feedback, model, prompt version |
| TradingDnaReport | Period, window, data bundle, AI output, model, versions, share token |
| CoachConversation, CoachMessage | Chats; messages carry status, billable, superseded, model, tokens, latency |
| MissionTemplate, MissionAssignment | Mission definitions and per-user progress |
| Notification, NotificationHistory, NotificationPreference, NotificationDebugLog, DeviceToken | Inbox, delivery history and dedupe, preferences and quiet hours, debug, push tokens |
| Payment, CheckoutSession | Razorpay payments and checkout quotes |
| PlaySubscription, AppStoreSubscription | Store subscription state, bound to the account |
| WebhookEvent | Webhook dedupe, retry, and retention |
| Coupon, CouponRedemption, CouponUserUsage, Campaign, Influencer, AttributionTouch | Promotions and attribution |
| RescueDispatch | Rescue and free-tier funnel log |
| AnalyticsEvent | Product analytics events |
| SupportTicket, SupportMessage, SupportAuditLog, KnowledgeBaseArticle, ArticleFeedback | Support system |
| Feedback, IssueReport | Feedback and bug reports |
| RefreshToken, IdempotencyRecord | Sessions and request dedupe |

## 16. Security, Privacy, And Compliance

- Roles: User and Admin, plus support roles for agents. Future: Coach/Mentor.
- Every query is scoped to the logged-in user; ownership tests cover trades, uploads, notifications, checklists, reports, feedback. Trade fields are allowlisted against mass assignment.
- Passwords hashed with bcrypt; lockout after 5 failures for 15 minutes; reset revokes all sessions.
- Refresh token reuse revokes the whole token family.
- Webhooks verified: Razorpay HMAC, Google Pub/Sub OIDC, Apple JWS signed chain.
- Store purchases bound to the account with HMAC tokens (obfuscatedAccountId on Play, appAccountToken on Apple).
- TRUST_PROXY must be set in production; trust-all values are rejected.
- Logs redact secrets; strict CORS (no wildcard previews); strict CSP and HSTS.
- Mobile tokens live in Keystore/Keychain only; CI blocks any fallback to plain storage.
- Account deletion purges about 24 user collections and keeps legally required payment records.
- Store compliance: Play Data Safety form done, financial features declared "none", 18+ rating, public deletion page. Apple Guideline 5.1.1(v) handled by in-app deletion with Sign in with Apple revocation.
- Disclaimers: analytics and coaching are educational, not financial advice.

## 17. Reliability And Capacity

### 17.1 Capacity (Load Test 2026-08-21, Single Laptop Process)

- Safe: 150 virtual users, about 108 requests/second, about 1,350 concurrent real users.
- Sustainable: 200 virtual users, about 1,800 concurrent real users.
- Breaks around 300 virtual users; ceiling 160-170 requests/second; zero server errors across about 350,000 requests.
- Bottlenecks: single API process, bcrypt blocking about 68ms per login, global rate limit too tight for heavy users.

### 17.2 Failure-Mode Audit Status (2026-10-14 Audit)

| Issue | Status |
|---|---|
| Endless OCR spinner when no worker runs | Fixed: server reaper + 10-minute client deadline |
| Raw AI provider errors shown to users | Fixed: friendly error mapping (OCR and coach) |
| Client timeout shorter than server deadline | Fixed: 20s client timeout |
| Duplicate trades on retry | Fixed: idempotency keys |
| Coach charges a question when the AI fails | Fixed: refund and retry |
| /health fails when only Redis is down | Open (review) |
| Lost Play notifications never recovered | Partly covered by the acknowledgement sweep and app reconcile; RTDN setup still open |
| Timeouts shown as "you're offline" | Open (review) |

## 18. Success Metrics

### 18.1 Activation

- Signup -> first saved trade (target 60%+).
- New users who try screenshot upload (target 40%+).
- Valid uploads that complete (target 80%+).
- Extracted trades saved after review; time from signup to first trade; onboarding completion.

### 18.2 Engagement

- Trades per active user per week; weekly active users.
- Users viewing analytics weekly (target 50%+).
- Checklist completion, psychology field completion, reflection completion.
- Coach questions per user per week; share of free users hitting the coach quota.
- Active streak holders and average streak length; missions accepted and completed.

### 18.3 Retention

- D1, D7, D30; weekly returning users.
- Cohorts by first successful upload, first insight viewed, first streak of 7, first mission completed.

### 18.4 Monetisation

- Free-to-Pro conversion, split by platform (Razorpay, Play, Apple).
- Conversion after hitting the trade limit vs not.
- Checkout start rate, payment success rate, MRR, churn, rescue funnel win-back rate, coupon and referral attribution.

### 18.5 Quality

- Extraction accuracy by broker and market (goal: 85% field accuracy across the top 10 brokers).
- Manual correction rate; failed upload rate; non-trade rejection accuracy; median extraction time.
- Coach failure and refund rate; support tickets per 100 uploads.

## 19. Deliberately Not Building In v1

- Live trading, order execution, broker account linking or auto-sync.
- Buy/sell signals, predictions, copy trading.
- Social feed, public profiles, community chat.
- Multi-asset portfolio management, tax filing.
- Options payoff modelling, real-time market data, backtesting.
- Strategy marketplace, funded-account challenge management.
- Institutional risk features, complex team permissions, white-label partnerships.
- Any promise of profit or financial advice.

## 20. Key Assumptions

- Traders want to journal but avoid manual entry.
- Screenshot upload is a strong enough wedge for activation.
- Traders will correct extracted fields when most are right.
- Psychology and discipline insights differentiate more than P&L charts.
- Indian traders are underserved by generic journals.
- 2 free trades per market plus visible locked insights drive paid conversion.
- Many retail traders operate from phones, on both Android and iPhone.
- A coach that answers with the user's own data is worth paying for.

## 21. Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Extraction accuracy is inconsistent | Confidence score, needs-review state, easy correction, broker-specific tracking, manual fallback |
| Users skip psychology fields | Chips and defaults, optional fields, show what they unlock, never block saving |
| Analytics feel generic | Locked states until data exists, insights tied to user data, always end with an action |
| Users expect signals | Clear positioning and voice rules; coach prompt forbids signals |
| AI provider outages or model retirement | Multi-step OCR fallback, deterministic fallbacks for reflections and onboarding, model set by env, coach refunds |
| Three billing systems drift apart | One isPremium rule, separate expiries, webhook reconciliation, Play sweep, CI payment-isolation check |
| Store review rejection | Handoff docs, demo account, in-app deletion, Apple revocation, 18+ rating |
| Weak paid conversion | Immediate free value, gate trade volume not basic journaling, rescue and nudge funnels |
| Forex and Indian complexity slows the team | Separate models and routes, shared UI where possible |
| Single API process limits scale | PM2 cluster or more instances, async password hashing, tune global rate limit |

## 22. Known Gaps And Tech Debt

| Gap | Impact | Suggested fix |
|---|---|---|
| No PM2 entry for the smart-notification worker | Smart alerts only run if the embedded worker flag is on | Add a PM2 app or confirm ENABLE_EMBEDDED_SMART_NOTIFICATION_WORKER=true |
| Server push payload has no explicit APNs block | iOS push behaviour should be verified on device | Add an apns section to the FCM payload |
| .env.example drift (broken first line, gemini-2.5 default, wrong admin secret name) | New environments boot wrong | Fix the example file; keep the server .env in step |
| About 43 failing trade-quota tests and 2 integration tests | CI signal is weak | Update tests to the shared-quota rules |
| Production runs staging; CI deploys main | A careless merge drops iOS work | Merge staging into main deliberately, then deploy from main |
| No lint script; server deploy uses npm install | Lint never runs; installs not reproducible | Add lint; use npm ci on the server |
| Missions and inbox have no in-app entry point | Users only reach them via push | Show the mission widget and a bell icon |
| Unused UI: WelcomeGuide, MissionWidget, InstallPWA, DailyThought, legacy /upload, react-joyride, trial banner | Bundle weight, confusion | Remove or wire up |
| No per-user timezone; IST fixed offset for mentor and crons | Wrong times for Forex users outside India | Add a timezone field |
| Mission cron times hardcoded | Cannot tune without a deploy | Move to env |
| Settings page requests the Inter font, which is not loaded | Falls back to another font | Use Plus Jakarta Sans |
| Google Play RTDN and Sentry upload token not finished | Missed renewals rely on sweeps; less readable crash reports | Finish setup |
| Plan labels in UI still mention Annual Pro and Premium Trial | Confusing for users | Align labels with current plans |

## 23. Roadmap

### 23.1 Shipped

- Phase 1, journal core: auth, manual entry, screenshot upload, journal CRUD, dashboard, Forex/Indian separation.
- Phase 2, discipline layer: setups, checklists, psychology fields, mistake tags, discipline analytics.
- Phase 3, coaching and review: Trading DNA, patterns, coach feed, weekly reports, self-awareness, psychology cost.
- Phase 4, monetisation and operations: plans, Razorpay, admin console, support center, notification preferences, promotions.
- Phase 5, mobile: Android app, push, native checklist, bottom navigation, Play Billing.
- Phase 6, behavioural gamification: streaks, missions, reflections, morning mentor.
- Phase 7, coach and iOS: coach chat, iOS app with Apple IAP and Sign in with Apple, reliability hardening.

### 23.2 Next

- iOS approval and launch; iOS 1.1 checklist Live Activity (lock screen and Dynamic Island).
- Close the known gaps in section 22.
- Coach: Ask Coach on trade rows and weekly reports, settings toggle, token cost tracking, cross-chat memory, weekly coach digest push, voice input, suggested tags.
- Onboarding analytics, A/B tests, day 1/3/7 drip pushes.
- Reflection streak, open reflection directly from the push, mentor that responds to reflections.
- Per-user timezone.
- CSV and PDF export; batch upload; more broker templates.

### 23.3 Proposed (Not Built)

- Discipline ranking: monthly seasons, 5 divisions (Elite, Sharp, Disciplined, Steady, Tilted), groups of about 30, top 5 promoted and bottom 5 relegated. Points per day: logged day 2, checklist 2, rules followed 3, reflection 2, mission 5, daily cap 10. At least 5 trades in the season to appear. Never ranks P&L, screen time, or volume. Opt-in with a display handle.
- Mentor and community dashboards, cohort benchmarks, trading plan builder, AI next-week checklist, annotated setup images.

## 24. Open Questions

- Do the Apple subscription prices in App Store Connect match INR 349 / 899 / 1499?
- Which market do we lead with publicly: Indian options, Forex, or both equally?
- Should manual journaling stay unlimited for free users, or keep the shared 2-trade limit?
- Which brokers are launch-critical for extraction quality?
- Discipline ranking: do mission points count, minimum group size, keep the "Tilted" name, monthly or 2-week seasons?
- Should Trading DNA share links expire?
- Should we add badges or a leaderboard before the ranking system?
- What compliance disclaimer is shown on analytics and coach answers in each country?
- When do we add dark mode?

## 25. Glossary

| Term | Meaning |
|---|---|
| Setup | A saved trading strategy with a list of rules |
| Setup score | Share of a setup's rules followed on a trade (0-100) |
| Entry basis | Why the trade was taken: plan, emotion, or impulsive |
| Trade quality | System score from setup, entry, emotion, retake, confidence (Great / Average / Poor) |
| Self-awareness | How closely the user's own rating matches the system rating |
| Psychology cost | Money lost on trades tagged with emotions, mistakes, or broken rules |
| Trading DNA | The user's trading identity: where their edge and leaks are |
| Intelligence Hub | The five-question page that organises all insights |
| Coach feed | Ranked, rule-based coaching insights |
| Coach chat | Conversational AI coach grounded in the user's data |
| Mission | A time-boxed behaviour goal tracked automatically |
| Streak | Consecutive days or trades meeting a habit rule |
| Reflection | 30-second evening check-in |
| Morning mentor | Daily 07:00 IST focus message |
| Rescue funnel | Reminders around subscription expiry |
| Free-tier nudge | Reminders after the last free trade is used |
| ISO week | Monday-to-Sunday week used for the coach quota |
| Pro | Any active paid entitlement (Razorpay, Play, or Apple) |
| RTDN | Google Play real-time developer notifications |
| Idempotency key | A request id that stops a retried request from creating a duplicate |
