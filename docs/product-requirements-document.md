# Edgecipline Product Requirements Document

Last updated: 2026-06-13

## 1. Product Summary

Edgecipline is an AI-powered trading journal and discipline coach for retail traders, starting with Forex and Indian market traders. The product lets users upload screenshots from their broker, automatically extracts trade details using OCR and AI, saves those trades into a journal, and turns the journal into actionable analytics about performance, psychology, setup quality, discipline, and repeated mistakes.

The core product promise is:

> "Upload your trade screenshot. Edgecipline builds your journal, finds your patterns, and helps you become a more disciplined trader."

The app is not just a record-keeping tool. It is designed to help traders understand why they win, why they lose, when they break rules, which setups are actually working, and what they should focus on next.

## 2. Problem Statement

Retail traders often know they should journal, but most do not do it consistently because manual journaling is slow, repetitive, and emotionally uncomfortable after losses. Even when traders do journal, their records are usually incomplete and do not connect execution behavior, psychology, setup rules, and P&L outcomes.

As a result, traders struggle to answer important questions:

- Which market, session, setup, or instrument actually makes me money?
- Am I following my trading plan or trading emotionally?
- How much money do FOMO, revenge trading, overconfidence, or broken rules cost me?
- Which mistakes repeat most often?
- What should I improve next week?

Edgecipline reduces the friction of journaling by extracting trade data from screenshots, then converts that data into practical coaching insights.

## 3. Target Users

### Primary Users

Retail Forex traders who use platforms such as MT4, MT5, cTrader, or broker history screenshots and want to improve consistency without manually entering every trade.

Indian retail traders, especially NSE/BSE options and F&O traders using brokers such as Zerodha, Upstox, Angel One, Dhan, Groww, Fyers, 5paisa, ICICI Direct, Kotak Securities, and Paytm Money.

### Secondary Users

Early-stage serious traders who are not yet profitable but are willing to review their behavior.

Small trading communities, mentors, or educators who want their students to build journaling discipline.

Trading coaches who may eventually use aggregated journal data to review student performance.

### Excluded Users For Version 1

Institutional trading desks.

High-frequency or fully automated traders.

Users who need direct broker sync as the only acceptable journaling method.

Users seeking trade signals, copy trading, or financial advice.

## 4. User Personas

### Persona 1: The Inconsistent Retail Trader

This user takes trades frequently but does not maintain a reliable journal. They often remember big wins and losses emotionally, but cannot identify patterns objectively. They want quick answers and dislike manual admin work.

Needs:

- Fast trade logging.
- Clear P&L and win-rate views.
- Simple feedback on repeated mistakes.
- Low-friction mobile experience.

### Persona 2: The Discipline-Focused Trader

This user already has a strategy and rules, but struggles to follow them consistently. They care about process quality, not just outcome.

Needs:

- Setup checklists.
- Plan adherence analytics.
- Psychology and emotional tags.
- Weekly review and discipline trend.

### Persona 3: The Indian Options Trader

This user trades NIFTY, BANKNIFTY, CE/PE options, or intraday stocks and needs a product that understands Indian market terminology, brokers, rupee P&L, lot sizes, expiry, strike price, and option type.

Needs:

- Indian market mode.
- Broker-aware screenshot extraction.
- Option-specific fields.
- Indian analytics separate from Forex data.

### Persona 4: The Mobile-First Trader

This user trades and reviews mostly from a phone. They want screenshot upload, journal review, and quick insights without desktop complexity.

Needs:

- PWA / Android app support.
- Fast mobile navigation.
- Upload from phone gallery.
- Push notifications and reminders.

## 5. Value Proposition

Edgecipline saves traders time by turning screenshots into structured trade entries, then uses the journal data to reveal behavioral and strategic patterns.

Core value drivers:

- Less manual journaling.
- Better trading self-awareness.
- Clearer discipline feedback.
- Market-specific support for Forex and Indian traders.
- AI-assisted extraction and coaching.
- Weekly review loop that encourages improvement.

## 6. Product Goals

### Business Goals

- Acquire early retail traders in India and Forex communities.
- Convert free users into paid subscribers after they experience screenshot extraction value.
- Build a defensible data layer around trade behavior, psychology, setups, and outcomes.
- Establish Edgecipline as a discipline-first trading journal, not another signal app.

### User Goals

- Log trades quickly.
- Understand what is working and what is not.
- Follow trading rules more consistently.
- Reduce emotional and impulsive trades.
- Review each week with specific improvement actions.

### Product Principles

- Reduce journaling friction first.
- Show insights only when enough data exists.
- Separate Forex and Indian market data cleanly.
- Coach discipline without pretending to predict the market.
- Make every insight actionable.

## 7. Core Features

### Must-Have For MVP

#### Authentication And Account Setup

Users must be able to register, log in, reset password, log in with Google, accept terms, and maintain a secure authenticated session.

Requirements:

- Email/password signup and login.
- Google login.
- Forgot password and reset password.
- Terms acceptance gate.
- Secure JWT session handling.
- User profile with subscription status.

Success criteria:

- A new user can create an account and reach the dashboard without manual support.
- Protected pages redirect unauthenticated users to login.

#### Market Mode Selection

Users must be able to work in either Forex mode or Indian Market mode, with separate routes, models, analytics, and UI expectations.

Requirements:

- Global market toggle.
- Forex trade journal and analytics.
- Indian market trade journal and analytics.
- Indian mode supports options and intraday stocks.
- Currency and field labels adapt to market type.

Success criteria:

- A user's Forex trades do not pollute Indian market analytics.
- Indian options fields such as strike price, option type, expiry, and broker are captured.

#### Screenshot Trade Upload

Users must be able to upload broker screenshots and have the system extract trade data into editable trade entries.

Requirements:

- Upload image file.
- Confirm screenshot before extraction.
- Select broker when needed for Indian market extraction.
- Async OCR/AI processing.
- Processing status states: uploading, queued, processing, completed, failed.
- Reject non-trade images.
- Support single-trade and multi-trade extraction.
- Store extraction confidence and review state.
- Allow user to review/edit extracted data before saving.

Success criteria:

- User can upload a valid screenshot, review extracted fields, and save to journal.
- Invalid screenshots produce helpful error guidance.
- Extraction failure does not create misleading completed journal entries.

#### Manual Trade Entry

Users must be able to log a trade manually when screenshot extraction is not available or not desired.

Requirements:

- Create trade without screenshot.
- Capture pair/instrument, type, quantity/lot size, entry, exit, P&L, date, strategy, session, notes.
- Capture Indian market-specific fields.
- Capture psychology and setup checklist fields.

Success criteria:

- Users can maintain a journal even if AI extraction fails.

#### Trade Journal

Users must be able to view, filter, edit, and delete logged trades.

Requirements:

- Trade list page.
- Trade detail page.
- Edit trade page.
- Delete trade.
- Paginated and filterable API.
- Separate Forex and Indian trade views.

Success criteria:

- Users can correct AI extraction mistakes after saving.
- Analytics update after trade create, update, or delete.

#### Dashboard

Users must have a clear home base showing current trading state and next actions.

Requirements:

- Total trades.
- Win rate.
- Net P&L.
- Current streak.
- Equity curve.
- Today's intelligence summary.
- AI coach snapshot.
- Quick actions: log trade, upload screenshot, run checklist, generate/open report.
- Onboarding welcome guide.

Success criteria:

- A returning user can understand their current status in under 30 seconds.

#### Analytics Overview

Users must be able to see performance analytics based on journal data.

Requirements:

- Summary stats.
- Weekly P&L.
- Best/worst instruments or pairs.
- Strategy performance.
- Session/time behavior.
- Risk-reward distribution.
- Calendar P&L.
- Drawdown view.
- Separate Indian market analytics.

Success criteria:

- Users can identify at least one profitable condition and one weak condition from their journal.

#### Psychology And Discipline Tracking

Users must be able to attach behavioral context to trades and receive analytics from it.

Requirements:

- Entry basis: plan, emotion, impulsive, custom.
- Mood rating.
- Confidence level.
- Emotional tags such as FOMO, revenge, fear, greed, calm, focused, rushed.
- Mistake tags.
- Lesson field.
- Would-retake review.
- Discipline score.
- Psychology analytics.
- Psychology cost calculator.
- Self-awareness score.
- Repeated mistakes page.
- Discipline trend.
- Revenge and tilt detection.

Success criteria:

- Users can see how psychological states and mistakes affect P&L.

#### Setup Strategies And Checklists

Users must be able to define trading setups and check whether a trade followed the setup rules.

Requirements:

- Create setup strategy.
- Add editable setup rules.
- Attach setup checklist to a trade.
- Calculate setup score.
- Save checklist tracking history.
- Show checklist in upload and manual trade flows.

Success criteria:

- Users can measure plan adherence over time.

#### AI Insights And Coaching

Users should receive summarized, plain-language insights when enough data exists.

Requirements:

- AI-generated or rule-generated insights.
- AI coach feed.
- Trading DNA engine.
- Pattern detection.
- Actionable recommendation language.
- Unlock states when data is insufficient.

Success criteria:

- Insights explain what happened, why it matters, and what to do next.
- The product avoids generic advice when there is not enough data.

#### Weekly Reports

Users must be able to review weekly performance.

Requirements:

- Generate weekly report from trade history.
- Store weekly reports.
- View reports in app.
- Email reports when email configuration is available.
- Include performance, discipline, and improvement highlights.

Success criteria:

- Users have a repeatable weekly review loop.

#### Subscription And Payment

Users must be able to experience limited free value and pay to continue using premium capabilities.

Requirements:

- Free plan with limited screenshot upload usage.
- Monthly and yearly subscription support.
- Razorpay order creation and verification.
- Subscription status and expiry on user profile.
- Admin ability to manually activate subscriptions.

Success criteria:

- Free users understand when and why they need to subscribe.
- Paid users can continue uploading without manual intervention.

#### Admin Console

Internal operators must be able to manage users, trades, payments, notifications, feedback, and platform health.

Requirements:

- Separate admin login.
- User management.
- Subscription management.
- Trade review.
- Payment history.
- Platform analytics.
- Feedback review.
- Notification management.

Success criteria:

- Founder/operator can support early users without database access.

### Nice-To-Have For Version 1 Or Shortly After

- Push notification reminders.
- Morning mentor notifications.
- More granular broker templates.
- More advanced setup image references.
- Community or mentor dashboards.
- Export to CSV/PDF.
- Calendar-based weekly review builder.
- In-app subscription upgrade prompts with plan comparison.
- More polished mobile bottom navigation.
- AI-generated next-week checklist.
- Advanced benchmark comparisons across user cohorts.
- Trading plan document builder.

## 8. User Flow From Start To Finish

### New User Flow

1. User opens the app.
2. App checks for a valid session.
3. If unauthenticated, user is sent to login.
4. User registers with email/password or signs in with Google.
5. User accepts terms.
6. User lands on dashboard.
7. User sees onboarding guide and quick actions.
8. User chooses market mode: Forex or Indian Market.
9. User uploads first trade screenshot or logs a trade manually.
10. App extracts trade fields or opens manual entry form.
11. User reviews trade details.
12. User adds psychology, notes, setup, and checklist data.
13. User saves trade to journal.
14. Dashboard and analytics refresh.
15. User reviews performance, mistakes, and AI coach snapshot.
16. User returns over time to log more trades.
17. Once enough trades exist, deeper insights unlock.
18. User reviews weekly report and acts on next improvement focus.

### Screenshot Upload Flow

1. User selects Upload Screenshot.
2. User selects market mode.
3. If Indian market, user selects broker and trade subtype where required.
4. User uploads image.
5. App shows confirmation preview.
6. User confirms extraction.
7. Backend uploads image to storage and creates pending trade/job.
8. OCR/AI pipeline extracts structured trade data.
9. Client shows progress state.
10. Extraction completes.
11. User reviews one or more extracted trades.
12. User edits incorrect fields.
13. User adds psychology/checklist metadata.
14. User saves trade or saves all extracted trades.
15. Trade appears in journal.

### Manual Trade Flow

1. User selects Log Trade.
2. User enters core trade details.
3. User optionally selects setup strategy.
4. User completes checklist.
5. User adds psychology, mistake, lesson, and notes.
6. User saves trade.
7. Dashboard and analytics update.

### Analytics Flow

1. User opens dashboard or analytics.
2. If trade count is low, user sees unlock states explaining what data is needed.
3. If enough data exists, user sees performance metrics, patterns, psychology cost, discipline trends, and AI coach insights.
4. User drills into specific sections such as psychology, trading DNA, repeated mistakes, patterns, or AI coach.
5. User leaves with one practical improvement target.

### Subscription Flow

1. User uses free screenshot upload allowance.
2. User attempts additional premium upload.
3. App displays subscription-required message.
4. User selects plan.
5. Razorpay checkout opens.
6. Payment is verified by backend.
7. User subscription becomes active.
8. Screenshot uploads continue.

## 9. MVP Definition

The MVP should prove that traders will consistently log trades when screenshot extraction removes friction, and that analytics/discipline insights are valuable enough to drive retention and paid conversion.

### MVP Must Include

- Auth and terms acceptance.
- Forex and Indian market modes.
- Screenshot upload with AI/OCR extraction.
- Manual trade entry.
- Trade journal CRUD.
- Dashboard with core KPIs.
- Basic analytics: trade count, win rate, net P&L, equity curve, weekly P&L, pair/instrument performance, strategy performance.
- Setup checklist attached to trades.
- Psychology fields attached to trades.
- Discipline and mistake analytics.
- Basic AI coach or rules-based insight feed.
- Weekly report view.
- Subscription gating for screenshot uploads.
- Admin console for early support.
- Mobile-friendly PWA/Android wrapper.

### MVP Can Be Rough But Functional

- AI insight copy does not need to be perfect.
- Charts can be simple.
- Broker extraction coverage can start with the most common brokers.
- Weekly emails can be enabled after in-app report generation works.
- Admin console can be utilitarian.

### MVP Launch Criteria

- A user can register, upload a valid screenshot, save a trade, and see analytics update.
- Indian and Forex data remain separated.
- Invalid screenshots fail gracefully.
- Manual trade entry works as a fallback.
- Payment verification activates subscription.
- Admin can resolve user subscription issues.
- No critical security issue allows users to access another user's trades.

## 10. Success Metrics

### Activation Metrics

- Account creation to first saved trade conversion.
- Percentage of new users who upload a screenshot within first session.
- Screenshot extraction completion rate.
- Percentage of extracted trades saved after review.
- Time from signup to first saved trade.

Target:

- 60%+ of registered users save at least one trade.
- 40%+ of new users try screenshot upload.
- 80%+ of valid uploads complete successfully.

### Engagement Metrics

- Trades logged per active user per week.
- Weekly active users.
- Percentage of users returning to dashboard after first trade.
- Percentage of users viewing analytics after logging trades.
- Checklist completion rate.
- Psychology field completion rate.
- Weekly report views.

Target:

- Users who log 5+ trades are materially more likely to return the next week.
- 50%+ of active users view analytics at least once per week.

### Retention Metrics

- D1, D7, D30 retention.
- Weekly returning users.
- Cohort retention by first successful screenshot upload.
- Cohort retention by first analytics insight viewed.

Target:

- Successful screenshot upload should correlate with higher D7 retention.
- Users with 10+ saved trades should show strong weekly retention.

### Monetization Metrics

- Free-to-paid conversion.
- Subscription checkout start rate.
- Payment success rate.
- Monthly recurring revenue.
- Churn rate.
- Upload limit conversion rate.

Target:

- Free users who hit upload limit should convert at a meaningfully higher rate than users who do not.

### Quality Metrics

- Extraction accuracy by broker and market type.
- Manual correction rate after extraction.
- Failed upload rate.
- Non-trade rejection accuracy.
- Average processing time.
- Support tickets per 100 uploads.

Target:

- Keep median extraction time low enough that users do not abandon the upload flow.
- Track broker-specific extraction issues to prioritize fixes.

## 11. What We Are Deliberately Not Building In Version 1

Version 1 should not attempt to become a full trading platform.

Not building:

- Live trading execution.
- Broker account linking or automatic trade sync.
- Buy/sell signals.
- Copy trading.
- Social feed or public trader profiles.
- Community chat.
- Portfolio management across asset classes.
- Tax filing.
- Advanced options strategy payoff modeling.
- Real-time market data terminal.
- Backtesting engine.
- Strategy marketplace.
- Funded account challenge management.
- Institutional risk desk features.
- Complex team permissions.
- White-label broker partnerships.
- Guaranteed financial advice or profit predictions.

The version one product should stay focused on journaling, extraction, behavioral analytics, and discipline coaching.

## 12. Key Assumptions

- Traders want to journal but avoid doing it because manual entry is too painful.
- Screenshot upload is a strong enough wedge to drive first-use activation.
- Traders will correct extracted fields if the app gets most fields right.
- Psychology and discipline insights are a stronger differentiator than generic P&L charts.
- Indian traders are underserved by generic trading journals.
- A limited free upload model can drive paid conversion.
- Mobile upload is important because many retail traders operate from phones.

## 13. Risks And Mitigations

### Risk: AI Extraction Accuracy Is Inconsistent

Mitigation:

- Store extraction confidence.
- Mark low-confidence trades as needs review.
- Allow easy user correction.
- Track broker-specific accuracy.
- Keep manual entry as fallback.

### Risk: Users Do Not Enter Psychology Data

Mitigation:

- Make psychology fields lightweight.
- Use chips, defaults, and optional fields.
- Show clear analytics unlocked by psychology data.
- Do not block trade saving.

### Risk: Analytics Feel Generic

Mitigation:

- Use unlock states until enough data exists.
- Tie insights to specific user data.
- Prioritize "what to do next" over long explanations.

### Risk: Traders Expect Signals

Mitigation:

- Position product clearly as a journal and discipline coach.
- Avoid language implying prediction, guaranteed profits, or financial advice.

### Risk: Indian And Forex Complexity Slows Product

Mitigation:

- Keep separate models and routes.
- Prioritize top brokers and common screenshot formats.
- Avoid overgeneralizing market logic too early.

### Risk: Paid Conversion Is Weak

Mitigation:

- Make free value immediate.
- Gate the high-value extraction workflow, not basic manual journaling.
- Show users what insights unlock as they add data.

## 14. Recommended V1 Roadmap

### Phase 1: Reliable Journal Core

- Auth.
- Manual trade entry.
- Screenshot upload.
- Trade journal CRUD.
- Dashboard KPIs.
- Forex and Indian separation.

### Phase 2: Discipline Layer

- Setup strategies.
- Trade checklist.
- Psychology fields.
- Mistake tagging.
- Discipline analytics.

### Phase 3: Coaching And Review

- Trading DNA.
- Pattern detection.
- AI coach feed.
- Weekly reports.
- Self-awareness and psychology cost.

### Phase 4: Monetization And Operations

- Subscription gating.
- Razorpay flow.
- Admin console.
- Feedback tooling.
- Notification preferences.

### Phase 5: Mobile Polish

- PWA install flow.
- Android APK.
- Push reminders.
- Mobile bottom navigation.
- Faster upload/review loop.

## 15. Open Product Questions

- Which market should be positioned first publicly: Indian options, Forex, or both?
- What is the exact free plan limit: one lifetime upload, one monthly upload, or limited number of trades?
- Should manual journaling remain free forever?
- Which brokers should be considered launch-critical?
- What extraction accuracy threshold is acceptable for beta launch?
- Should weekly reports be generated automatically or manually triggered in MVP?
- Should the AI coach be marketed as AI-powered from day one, or should the product lead with "discipline analytics"?
- What compliance disclaimer should appear around analytics and coaching?

## 16. Positioning Recommendation

For an early-stage startup, the strongest wedge is:

> "The trading journal that fills itself from your broker screenshots."

The broader product vision is:

> "A discipline operating system for retail traders."

Recommended MVP positioning:

- Lead with screenshot-to-journal automation.
- Differentiate with Indian market support and psychology analytics.
- Avoid sounding like a signal provider.
- Use discipline, review, and repeatability as the emotional promise.

