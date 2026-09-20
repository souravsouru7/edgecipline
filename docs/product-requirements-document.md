# Edgecipline Product Requirements Document

Last updated: 2026-09-18

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

This section lists every feature in Edgecipline in simple language. Each table tells you what the feature does and whether it is available on the Web app, the Mobile app, or both.

How to read the tables:

- **Web** = the browser app (desktop or mobile browser).
- **Mobile** = the Android app from Google Play (built with Capacitor). An iOS build is prepared but not published yet.
- **Yes** = available. **No** = not available on that platform. **Native** = works using the phone's own system features.

### 7.1 Where The App Runs

| Platform | Status | Notes |
|---|---|---|
| Web app | Live | Full feature set. Payments through Razorpay. |
| Android app | Live on Google Play | Same features as web plus phone-only extras (push notifications, native checklist reminders, Google Play billing). |
| iOS app | Prepared, not published | Capacitor iOS project exists. Not in the App Store yet. |

### 7.2 Account And Onboarding

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Register with email | Create an account with email and password. | Yes | Yes |
| Verify OTP | A one-time code is sent to your email to confirm it is really you. | Yes | Yes |
| Login | Sign in with your email and password. | Yes | Yes |
| Google login | Sign in with one tap using your Google account. | Yes | Yes |
| Forgot / reset password | Get a reset link by email and set a new password. | Yes | Yes |
| Accept terms | You must accept Terms and Privacy Policy before using the app. | Yes | Yes |
| Onboarding questions | Short questions about your trading style, market, and goals. Used to personalise coaching. | Yes | Yes |
| Profile page | See your name, email, plan, subscription expiry, and trade limits. | Yes | Yes |
| Settings page | Change preferences such as notifications and market mode. | Yes | Yes |
| Delete account | Permanently remove your account and all your data from inside the app. | Yes | Yes |
| Secure session | Your login stays safe using secure tokens. On the phone, tokens are stored in encrypted device storage. | Yes | Yes (Native) |
| Terms and Privacy pages | Public pages you can read anytime. | Yes | Yes |

### 7.3 Market Modes

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Forex mode | Journal, analytics, setups, and dashboard for Forex trading. | Yes | Yes |
| Indian Market mode | Journal, analytics, setups, and dashboard for Indian stocks and options. | Yes | Yes |
| Market switch | One toggle to move between Forex and Indian mode. Each market keeps its own data. | Yes | Yes |
| Indian-specific fields | Strike price, option type (CE/PE), expiry date, broker, quantity, and lot details. | Yes | Yes |
| Currency and labels | Money, symbols, and field names change to match the market you are in. | Yes | Yes |

### 7.4 Logging A Trade

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Upload screenshot | Upload a broker screenshot and the app reads the trade details for you using OCR and AI. | Yes | Yes |
| Confirm before extraction | You see the picture first and confirm it is a trade screenshot. | Yes | Yes |
| Choose broker | For Indian market, pick your broker so the AI reads the screenshot correctly. | Yes | Yes |
| Processing status | Clear states: uploading, queued, processing, completed, failed. | Yes | Yes |
| Reject non-trade images | If the picture is not a trade, the app tells you and does not save junk. | Yes | Yes |
| Multi-trade extraction | One screenshot with several trades creates several journal entries. | Yes | Yes |
| Review before save | Check and correct the extracted data before it goes into your journal. | Yes | Yes |
| Confidence score | The app shows how sure it is about the extracted data. | Yes | Yes |
| Manual add trade | Type a trade in yourself when there is no screenshot. | Yes | Yes |
| Trade fields | Pair or instrument, buy/sell, size, entry, exit, stop loss, take profit, P&L, date, session, strategy, notes, risk:reward. | Yes | Yes |
| Psychology fields | Entry basis (plan, emotion, impulsive), mood, confidence, emotion tags, mistake tag, lesson, would-retake. | Yes | Yes |
| Setup checklist in form | Pick a saved setup and tick which rules you followed. The app computes a setup score. | Yes | Yes |
| Free trade limit | Free users can log 2 trades per market. After that the app asks you to subscribe. | Yes | Yes |

### 7.5 Trade Journal

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Trade list | See all your trades in a list, newest first. | Yes | Yes |
| Filters and search | Filter by date, pair, result, strategy, session, and more. | Yes | Yes |
| Trade detail page | Open one trade and see every field, the screenshot, psychology, and checklist. | Yes | Yes |
| Edit trade | Fix any mistake after saving. | Yes | Yes |
| Delete trade | Remove a trade. Analytics update right away. | Yes | Yes |
| Trade status badge | Shows if the trade is still processing, completed, or needs review. | Yes | Yes |
| Separate journals | Forex and Indian trades are kept in separate lists. | Yes | Yes |

### 7.6 Setups And Checklists

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Create setups | Save your trading strategies (up to 50 per market) with a name. | Yes | Yes |
| Setup rules | Add up to 20 rules to each setup. This becomes your pre-trade checklist. | Yes | Yes |
| Reference images | Attach example chart images to each setup. | Yes | Yes |
| Setup score | For every trade, the app shows what percent of rules you followed. | Yes | Yes |
| Checklist page | A daily pre-trade checklist you tick before the market opens. | Yes | Yes |
| Psychology checklist | Quick mindset check (calm, focused, tired, etc.) before trading. | Yes | Yes |
| Checklist reminder | Get a reminder at your chosen time to complete the checklist. | Yes | Yes (Native alarm) |
| Checklist history | The app stores every checklist you complete so you can see your habit over time. | Yes | Yes |
| Safe history | Editing or deleting a setup never changes old trades. Each trade keeps a copy of the rules it was scored on. | Yes | Yes |

### 7.7 Dashboard

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Key numbers | Total trades, win rate, net P&L, and current streak at a glance. | Yes | Yes |
| Equity curve | A chart of how your account has grown or dropped over time. | Yes | Yes |
| Today's intelligence | A short summary of what your data says today. | Yes | Yes |
| AI coach snapshot | The latest coaching message based on your real trades. | Yes | Yes |
| Quick actions | One-tap buttons: log trade, upload screenshot, run checklist, open report. | Yes | Yes |
| Welcome guide | Step-by-step guide for new users on their first visit. | Yes | Yes |
| Rescue banner | If your plan is expiring or expired, a friendly banner shows how to continue. | Yes | Yes |
| Indian dashboard | A separate dashboard for Indian market mode. | Yes | Yes |

### 7.8 Analytics

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Analytics overview | Summary of wins, losses, profit, average trade, and more. | Yes | Yes |
| Weekly P&L | Profit and loss week by week. | Yes | Yes |
| Best and worst pairs | Which instruments make or lose you money. | Yes | Yes |
| Strategy league | Ranks your strategies by trades, win rate, and profit. | Yes | Yes |
| Session and time analysis | Which sessions and hours you trade best. | Yes | Yes |
| Risk:reward breakdown | How your risk:reward choices affect results. | Yes | Yes |
| Calendar P&L | A calendar showing green and red days. | Yes | Yes |
| Drawdown view | How deep your losing periods went. | Yes | Yes |
| Indian analytics | The same analytics built for Indian stocks and options. | Yes | Yes |
| Fast loading | Analytics are cached so pages open quickly. | Yes | Yes |

### 7.9 Psychology And Discipline

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Psychology analytics | How mood, confidence, and emotions affect your results. | Yes | Yes |
| Psychology cost | Shows how much money FOMO, revenge, fear, and greed have cost you. | Yes | Yes |
| Self-awareness score | Measures how honestly and completely you record your psychology. | Yes | Yes |
| Repeated mistakes | Lists the mistakes you make most often and what they cost. | Yes | Yes |
| Pattern detection | Finds patterns such as losing after a win, overtrading, or tilt. | Yes | Yes |
| Discipline page | Your daily discipline entries and discipline score. | Yes | Yes |
| Discipline analytics | Trend of your discipline over weeks. | Yes | Yes |
| Revenge and tilt detection | Warns when your trades look like revenge trading. | Yes | Yes |
| Psychology timeline | A day-by-day story of your mindset and results. | Yes | Yes |
| Streaks page | Journal streaks, discipline streaks, and best streaks. | Yes | Yes |

### 7.10 Intelligence Hub And AI Coaching

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Intelligence hub | One place with five questions: What makes me money? What costs me money? What should I improve? What should I do now? How am I evolving? | Yes | Yes |
| Trading DNA | Your trading identity: strengths, weaknesses, best setup, best session, risk style. | Yes | Yes |
| Share Trading DNA | Create a shareable card of your Trading DNA. | Yes | Yes |
| AI insights | Plain-English insights generated from your journal. | Yes | Yes |
| AI coach chat | Ask the coach questions about your trading. It answers using your real data. | Yes | Yes |
| AI coach feed | A running feed of coaching cues and next actions. | Yes | Yes |
| Rule follow-through | Tracks whether you act on the coach's advice. | Yes | Yes |
| Mindset evolution | Shows how your mindset scores change across review cycles. | Yes | Yes |
| Locked states | When there is not enough data, the app says so instead of guessing. | Yes | Yes |
| Indian intelligence modules | Six modules for Indian mode: Trading DNA, Patterns, Risk Patterns, Psychology Cost, Self-Awareness, AI Coach. | Yes | Yes |

### 7.11 Missions

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Missions page | Pick goals to work on. The app tracks progress automatically from your trades. | Yes | Yes |
| Risk missions | 1% Risk Discipline, Stop Loss on Every Trade, Protect Your Daily Limit, Risk:Reward Discipline. | Yes | Yes |
| Psychology missions | No Revenge Trades (14 and 30 days), No FOMO Trades, Calm Mindset, High Confidence Only, Psychology Complete. | Yes | Yes |
| Plan missions | Checklist Every Trade, Rule Adherence Streak, Follow Your Plan, A+ Setups Only, Avoid Low-Confidence Setups, Plan-Consistent Month. | Yes | Yes |
| Journal missions | 14-Day and 30-Day Journal Streak, Daily Reflection Streak, Lesson in Every Loss, 4 Weekly Reviews. | Yes | Yes |
| Mission progress | A progress bar and status for each active mission. | Yes | Yes |
| AI mission suggestions | The app recommends which mission fits your current weakness. | Yes | Yes |

### 7.12 Reflection And Reviews

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Daily reflection | Write a short end-of-day note. The app keeps a streak. | Yes | Yes |
| Weekly reports | A report every week with performance, discipline, and what to improve. | Yes | Yes |
| Weekly report email | The weekly report is also sent to your email. | Yes | Yes |
| Report history | All past weekly reports are stored in the app. | Yes | Yes |
| Morning mentor | A short morning message to set your focus for the day. | Yes | Yes |

### 7.13 Notifications

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Notifications page | In-app inbox of all messages the app sent you. | Yes | Yes |
| Push notifications | Alerts on your phone even when the app is closed. | No | Yes (Native) |
| Smart notifications | Sent only when useful, for example after a losing streak or a missed journal day. | Yes | Yes |
| Quiet hours | No notifications during the hours you choose. | Yes | Yes |
| Checklist reminders | Reminder at your chosen time. On Android this works even after phone restart. | Yes | Yes (Native) |
| Notification preferences | Turn each type of notification on or off. | Yes | Yes |

### 7.14 Subscription And Payments

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Free plan | 2 trades per market for free, with full analytics on those trades. | Yes | Yes |
| Paid plans | 1 month INR 349, 3 months INR 899, 6 months INR 1499. Unlimited trades and all features. | Yes | Yes |
| Razorpay checkout | Pay by UPI, card, or net banking on the web. | Yes | No |
| Google Play billing | Pay through Google Play inside the Android app (store rules require this). | No | Yes (Native) |
| Plan status | Your plan and expiry date are shown on the profile page. | Yes | Yes |
| Expiry handling | When the plan ends, you keep your data but return to the free limit. | Yes | Yes |
| Subscription rescue | Friendly reminders before and after expiry with an easy way to continue. | Yes | Yes |
| Promotions and referral links | Short links (edgecipline.com/r/...) that track where users came from and apply offers. | Yes | Yes |
| Manual activation | Admin can activate a plan by hand if a payment needs help. | Yes | Yes |

### 7.15 Support And Feedback

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Support center | Help page with contact options and articles. | Yes | Yes |
| Help articles | Guides that answer common questions. | Yes | Yes |
| Support tickets | Create a ticket, see replies, and track its status. | Yes | Yes |
| AI support assistant | Instant answers from a helper trained on the help articles. | Yes | Yes |
| WhatsApp contact | Tap to chat with the team on WhatsApp. | Yes | Yes |
| Report an issue | Report a bug with screenshots and see the status of your report. | Yes | Yes |
| Feedback | Send suggestions or ratings from inside the app. | Yes | Yes |

### 7.16 Admin Console (Internal, Web Only)

| Feature | What it does | Web | Mobile |
|---|---|---|---|
| Admin login | Separate secure login for the team. | Yes | No |
| Admin dashboard | Users, trades, revenue, and platform health at a glance. | Yes | No |
| User management | Search users, see their plan, activate or extend subscriptions. | Yes | No |
| Expired users | List of users whose plan has ended, for follow-up. | Yes | No |
| Trade review | Look at any user's trades to help with support. | Yes | No |
| Payments | All Razorpay and Google Play payments with status. | Yes | No |
| Promotions | Create and manage promo codes and referral campaigns. | Yes | No |
| Feedback review | Read and manage user feedback. | Yes | No |
| Issue reports | Review bug reports and update their status. | Yes | No |
| Support tickets and articles | Reply to tickets and write help articles. | Yes | No |
| Notification management | Send and analyse notifications. | Yes | No |
| Mission management | Add or edit mission templates. | Yes | No |
| Monitoring | Cache health, notification analytics, and system metrics. | Yes | No |

### 7.17 Nice-To-Have For Version 1 Or Shortly After

| Feature | What it would do |
|---|---|
| iOS App Store release | Publish the prepared iOS build. |
| More broker templates | Better extraction for more brokers. |
| Export to CSV or PDF | Download your journal. |
| Calendar-based weekly review builder | Build reviews from the calendar view. |
| Plan comparison screen | Side-by-side plan features before paying. |
| AI next-week checklist | The coach writes your checklist for next week. |
| Cohort benchmarks | Compare yourself with similar traders. |
| Trading plan document builder | Write and store your full trading plan. |
| Community or mentor dashboards | Let a mentor view a student's journal. |
| More advanced setup image references | Annotate and compare setup images. |

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

