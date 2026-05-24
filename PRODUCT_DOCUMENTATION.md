# Edgecipline — Complete Product Documentation

> **Edgecipline** by Stratedge · AI-Powered Trading Journal & Psychology Coach  
> Version 1.0 · Product & Strategy Document · May 2026

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [User Perspective](#2-user-perspective)
3. [Complete App Workflow](#3-complete-app-workflow)
4. [Page-by-Page Explanation](#4-page-by-page-explanation)
5. [User Journeys](#5-user-journeys)
6. [Features & Benefits](#6-features--benefits)
7. [Product Value](#7-product-value)
8. [UX & Engagement Strategy](#8-ux--engagement-strategy)
9. [Business & Growth Perspective](#9-business--growth-perspective)
10. [Future Vision](#10-future-vision)
11. [Final Product Summary](#11-final-product-summary)

---

## 1. Project Overview

### What Is Edgecipline?

**Edgecipline** is an AI-powered trading journal and behavioral coaching platform built for retail traders. It combines trade logging, performance analytics, psychological pattern detection, and AI-generated coaching — all in one mobile-first application available on Android and the web.

The name says it all: **Edge** (your trading edge, your statistical advantage) + **Discipline** (the only thing standing between a trader and consistent profitability).

> *Most traders don't fail because they lack a strategy. They fail because they can't follow one.*

Edgecipline exists to solve exactly that problem.

---

### Main Concept

At its core, Edgecipline is three things working together:

| Layer | What It Does |
|---|---|
| **Journal** | Frictionless trade logging — manual entry or AI screenshot extraction |
| **Analytics** | 60+ performance metrics that reveal what's actually working |
| **Psychology Coach** | AI-powered behavioral alerts, mood tracking, and weekly coaching reports |

The platform supports two major markets out of the box:
- **Forex / Global Markets** — Currency pairs, indices, commodities
- **Indian Markets** — NSE/BSE Equity, F&O (Futures & Options), Intraday/Delivery

---

### Vision

> **To become the world's most trusted trading accountability system — the coach in every trader's pocket that never lets them forget their own rules.**

### Mission

To help retail traders build the discipline, emotional awareness, and analytical clarity required for long-term profitability — by connecting their psychology directly to their performance data.

---

### The Problem It Solves

The global retail trading industry has a brutal reality:

- **~70–80% of retail traders lose money** consistently
- The #1 reason cited is not strategy failure — it is **emotional decision-making**: revenge trading, overtrading, ignoring stop losses, breaking their own rules
- Existing trading journals are spreadsheets or basic loggers — they record data but offer no behavioral insight
- There is no product today that **connects mood, emotions, and psychology directly to P&L outcomes**

Edgecipline fills this exact gap. It is not just a journal. It is a **behavioral accountability system**.

---

### Why This App Matters

1. The retail trading audience is **massive and growing** — millions of new traders entered markets globally post-2020
2. Every trader, at every level, struggles with discipline and emotional control
3. AI has made it possible — for the first time — to deliver **personalized coaching at scale**, without a human coach
4. No existing competitor (Tradervue, Edgewonk, TraderSync) tracks **psychology as a primary first-class metric** the way Edgecipline does
5. The Indian F&O market alone has **50 million+ active retail traders** — a largely underserved product-market fit

---

## 2. User Perspective

### Who Uses Edgecipline?

Edgecipline is built for **retail traders** who are serious about improving their performance. This is not a beginner app for people learning what a candlestick is. It is for traders who already have a strategy but struggle to execute it consistently.

---

### Target Audience

| Segment | Description |
|---|---|
| **Aspiring professional traders** | Trading 6–36 months, have a strategy, losing discipline under pressure |
| **Active Forex traders** | Trading currency pairs, using MetaTrader, want systematic performance review |
| **Indian F&O traders** | Options/futures traders on NSE/BSE, Intraday-focused, high trade frequency |
| **Prop firm traders** | In evaluation or funded accounts — need zero rule violations, track drawdown obsessively |
| **Trading educators/mentees** | Students of trading mentors who want to prove their discipline with data |
| **Independent swing traders** | Lower frequency, high-conviction trades, want setup quality tracking |

---

### User Personas

#### Persona 1 — Arjun, 26, Indian F&O Trader
- Trades Nifty options intraday, 3–5 trades/day
- Has a profitable strategy in theory but revenge trades after losses
- Frustrated that he ends green days negative because of "one bad trade"
- **What he needs:** Revenge trading alerts, daily P&L awareness, emotional pattern detection

#### Persona 2 — Sarah, 31, Forex Swing Trader
- Trades 4–8 trades/week on EUR/USD, GBP/JPY
- Keeps a messy spreadsheet, never reviews it consistently
- Wants to know which setups actually make money
- **What she needs:** Clean journal, setup performance comparison, weekly AI review

#### Persona 3 — Marcus, 34, Prop Firm Trader
- Trades a $50K funded account with 4% max drawdown
- One violation ends his account — rule adherence is critical
- **What he needs:** Pre-trade checklist, drawdown tracking, no-stop-loss alerts, discipline score

#### Persona 4 — Priya, 22, Learning Trader
- 8 months into trading, taking courses, building a strategy
- Wants to build habits from the beginning
- **What she needs:** Morning mentor guidance, simple journal, setup builder, weekly reports

---

### Real-World Use Cases

| Use Case | How Edgecipline Helps |
|---|---|
| "I always revenge trade after losses" | Morning mentor detects pattern, sends alert before market open |
| "I don't know which setup is actually profitable" | Analytics shows P&L breakdown by setup/strategy |
| "I trade when I'm stressed and it always goes wrong" | Mood tracking correlates emotional state to win rate |
| "I forget my rules mid-trade" | Pre-trade checklist forces rule verification before entry |
| "I want to upload my MT4 screenshot and log the trade" | AI extraction reads the screenshot and fills the form |
| "I need a weekly review of my trading" | Sunday AI report covers mistakes, improvements, next-week focus |

---

## 3. Complete App Workflow

### The Master Flow

```
SIGN UP / LOG IN
      │
      ▼
DASHBOARD (Home Hub)
      │
      ├──► PRE-TRADE CHECKLIST → Verify setup rules → Take/Skip trade
      │
      ├──► ADD TRADE (Manual) ─── or ──► UPLOAD TRADE (AI Screenshot)
      │              │                              │
      │              └──────────────────────────────┘
      │                          │
      │                    Trade Saved
      │                          │
      ▼                          ▼
TRADE JOURNAL             ANALYTICS UPDATE
(View all trades)         (KPIs recalculate)
      │
      ▼
WEEKLY AI REPORT (auto-generated Sunday)
      │
      ▼
MORNING MENTOR NOTIFICATION (daily behavioral coaching)
      │
      ▼
NOTIFICATIONS HUB (review all alerts & insights)
      │
      ▼
PROFILE (Subscription, settings)
```

---

### Step-by-Step: First Visit to Long-Term Habit

#### Day 1 — First Visit

1. User lands on the **root page** → automatic auth check
2. If not logged in → redirected to **Login page**
3. Login page shows **demo stats** (win rate, P&L sample data) to build trust and desire
4. User signs up with **Email/Password** or **Google OAuth**
5. Account created → redirected to **Dashboard**
6. Dashboard shows empty state with welcome guide prompting "Log your first trade"

#### Day 1 — Logging First Trade

7. User visits **Add Trade** page
8. Fills in trade details: pair, direction, prices, P&L
9. Tags **mood** (emoji scale) and **emotional state** (FOMO, Fear, Confident, etc.)
10. Optionally links to a **Setup** (or creates one)
11. Trade saved → Analytics page now has first data point

#### Week 1 — Building the System

12. User creates their first **Trading Setup** (strategy name, rules, reference screenshots)
13. Before the next trade: visits **Pre-Trade Checklist**, selects setup, runs through rules
14. Gets confidence score (A+/Moderate/Low) — only takes trade if A+
15. Logs outcome → sees checklist adherence tracked in Analytics
16. Receives first **Morning Mentor** notification next morning

#### Week 2 — AI Insights Begin

17. Accumulates enough trades → **Analytics** shows patterns
18. User discovers: "I win 70% when calm, 30% when frustrated"
19. **Weekly AI Report** generated (Sunday) — AI identifies top 3 mistakes, ranks by P&L cost
20. User adjusts behavior → next week improves

#### Month 1+ — Long-Term Accountability

21. Morning mentor becomes daily habit — behavioral guardrail before trading
22. Pre-trade checklist prevents impulsive trades
23. Weekly reports track discipline trend over time
24. Equity curve shows account growth trajectory
25. Repeated mistakes panel shrinks as user fixes behaviors

---

## 4. Page-by-Page Explanation

### Root Page (`/`)

| | |
|---|---|
| **Purpose** | Auth gatekeeper & smart redirect |
| **What user sees** | Blank (instant redirect) |
| **Logic** | If authenticated → Dashboard. If not → Login |
| **User emotion** | Seamless — no friction, no loading screen confusion |

---

### Login Page (`/login`)

| | |
|---|---|
| **Purpose** | Authenticate returning users, attract new ones |
| **What user sees** | Edgecipline branding, login form, Google OAuth button, demo statistics panel |
| **Key design decision** | Shows live-looking demo stats (win rate, trades, P&L) to build social proof before user even logs in |
| **Actions available** | Email/password login, Google sign-in, link to Register |
| **User goal** | Get back into their trading data as fast as possible |
| **User emotion** | Curiosity from demo stats → motivation to see their own data |

---

### Register Page (`/register`)

| | |
|---|---|
| **Purpose** | Create new account |
| **What user sees** | Signup form (name, email, password) + Google OAuth option |
| **Actions available** | Create account, switch to login |
| **User goal** | Quick signup, no friction |
| **Post-action** | Account created → redirect to Dashboard with empty state |

---

### Dashboard (`/dashboard` & `/indian-market/dashboard`)

> **The command center. The first thing a trader sees every session.**

| | |
|---|---|
| **Purpose** | Top-level performance overview — the trader's morning briefing |
| **What user sees** | KPI cards, equity curve chart, 6 feature shortcut cards, recent activity |

**KPI Cards Displayed:**
- Total Trades
- Win Rate (%)
- Net P&L ($ or ₹)
- Average Win / Average Loss
- Profit Factor
- Max Drawdown (%)
- Sharpe Ratio
- Current Streak

**Feature Cards (navigation shortcuts):**

| Card | Destination | Purpose |
|---|---|---|
| Trade Journal | `/trades` | View & manage trade history |
| Add Trade | `/add-trade` | Log a new trade |
| Analytics | `/analytics` | Deep performance analysis |
| Upload Trade | `/upload-trade` | AI screenshot extraction |
| Pre-Trade Checklist | `/checklist` | Pre-entry discipline check |
| Weekly Reports | `/weekly-reports` | AI coaching summaries |

**Why This Page Exists:** A trader who opens the app should know in 5 seconds whether they're on track or not. No digging. No clicking. The dashboard delivers that instant awareness.

**User emotion:** Grounded, informed, accountable — or appropriately cautious if metrics are negative.

---

### Trade Journal (`/trades` & `/indian-market/trades`)

> **The complete record of every trading decision ever made.**

| | |
|---|---|
| **Purpose** | The searchable, filterable record of all trades |
| **What user sees** | Trade cards/list with direction (Buy/Sell), pair, P&L, date, setup used, mood indicator |

**Filter & Search Options:**
- Direction: Long / Short / All
- Time period: Today / This Week / This Month / Custom range
- Setup: Filter by strategy
- Text search: By symbol/pair

**Trade Card Shows:**
- Symbol / Pair
- Direction (color-coded: green Buy, red Sell)
- Entry / Exit prices
- P&L (green profit, red loss)
- Setup name used
- Mood emoji
- Emotional tags
- Date & time

**Actions available:**
- View trade detail
- Edit trade
- Delete trade
- Filter/search

**User goal:** Review past trades, identify patterns, audit decisions.

**User emotion:** Reflective — "Did I follow my rules?" This page makes a trader face their own decisions.

---

### Add Trade — Manual (`/add-trade` & `/indian-market/add-trade`)

> **The primary data entry point. Fast, structured, psychologically aware.**

| | |
|---|---|
| **Purpose** | Log a completed trade with full context |
| **What user sees** | Multi-section form covering trade details + psychology layer |

**Trade Details Fields:**
- Market / Symbol (e.g., EUR/USD, NIFTY)
- Direction: Buy / Sell (Long / Short)
- Entry Price
- Exit Price
- Stop Loss
- Take Profit
- Position Size / Lot Size
- Profit / Loss (auto-calculated)
- Risk-Reward Ratio (auto-calculated)
- Trade Date & Time

**Indian Market Specific Fields:**
- Segment: Equity / F&O / Commodity / Currency
- Trade Type: Intraday / Delivery / BTST
- Instrument: Equity / Future / Option
- Strike Price & Expiry (for Options)

**Psychology Layer (unique differentiator):**

| Field | Options |
|---|---|
| **Mood** | 1–5 emoji scale (😰 Stressed → 😐 Neutral → 🔥 Peak State) |
| **Confidence Level** | Low / Medium / High / Overconfident |
| **Emotional Tags** | FOMO, Revenge, Fear, Greed, Impatient, Disciplined, Confident, Hesitant |
| **Setup Used** | Dropdown of user-created strategies |
| **Would You Retake?** | Yes / No (instinct calibration) |
| **Notes** | Free-text trade notes |
| **Screenshot** | Optional image upload |

**Why This Page Exists:** Data without context is useless. A trade logged with mood, emotions, and setup creates a dataset that reveals *why* you win and lose — not just *what* happened.

**User emotion:** Reflective and honest. The psychology fields force a moment of self-awareness.

---

### Upload Trade — AI Extraction (`/upload-trade` & `/indian-market/upload-trade`)

> **Zero-friction logging. Take a screenshot, let AI do the rest.**

| | |
|---|---|
| **Purpose** | Remove the friction of manual data entry via AI-powered screenshot reading |
| **What user sees** | Upload zone (drag & drop or camera), processing animation, extracted data preview, confirmation form |

**The Flow:**
1. User uploads broker screenshot (MT4, Zerodha, Groww, Upstox, Angel One, etc.)
2. AI (OCR + Gemini Vision) reads the image
3. Extracted fields appear pre-filled: pair, direction, entry, exit, P&L
4. User reviews, corrects if needed, adds psychology tags
5. Confirms → trade saved

**What AI Detects:**
- Broker type / platform
- Trade direction (Buy/Sell)
- Symbol / instrument
- Entry & exit prices
- Stop loss & take profit levels
- Profit / Loss amount
- Trade timestamp
- Multi-trade detection (when screenshot shows multiple trades)
- Confidence score for each extracted field

**User goal:** Log trades in under 30 seconds. No manual typing.

**User emotion:** Delight at the magic of AI extraction. Relief at removed friction.

---

### Analytics (`/analytics` & `/indian-market/analytics`)

> **The performance mirror. 60+ metrics that reveal the honest truth about your trading.**

| | |
|---|---|
| **Purpose** | Deep, data-driven performance analysis across every dimension |
| **What user sees** | Tabbed dashboard with KPIs, charts, psychology insights, and behavioral flags |

**Analytics Sections:**

#### Performance Overview
| Metric | What It Reveals |
|---|---|
| Win Rate % | Raw success frequency |
| Profit Factor | Gross profit ÷ gross loss (>1.5 = good) |
| Expectancy | Average $ earned per trade |
| Sharpe Ratio | Risk-adjusted return |
| Max Drawdown % | Worst peak-to-trough decline |
| Recovery Factor | How fast account recovered from drawdown |
| Best/Worst Streak | Consecutive wins / consecutive losses |
| Avg Win vs Avg Loss | Risk-reward reality check |

#### Setup Performance Analysis
- P&L breakdown by strategy/setup
- Win rate per setup
- Number of trades per setup
- Shows which setup is actually profitable vs which "feels" good

#### Direction Analysis
- Long trades vs Short trades performance
- Directional bias identification

#### Symbol / Pair Analysis
- Performance by currency pair or stock/index
- Best and worst performing instruments

#### Time Analysis
- Best time of day to trade (by session/hour)
- Worst time of day to trade
- Day of week performance breakdown

#### Equity Curve
- Visual account growth chart over time
- Drawdown periods highlighted
- Trend line overlay

#### Calendar Heatmap
- Daily P&L color-coded on calendar grid
- Instantly shows loss-heavy days/weeks

#### Psychology Analytics (unique to Edgecipline)

| Insight | What It Shows |
|---|---|
| **Mood vs Win Rate** | Correlation: do you win more when calm? |
| **Confidence vs Outcome** | Is overconfidence causing losses? |
| **Emotional Tag Impact** | FOMO trades vs Confident trades — P&L difference |
| **Would You Retake analysis** | Are your instincts calibrated correctly? |
| **Discipline Score** | % of trades that followed setup rules |
| **Revenge Trading Detection** | Flags: trade after loss with 1.5× bigger position |
| **Overtrading Detection** | More trades than usual + declining performance |
| **Tilt Pattern** | 3+ consecutive losses with increasing size |

#### Repeated Mistakes Tracker
- Lists user's self-tagged mistakes ranked by total P&L cost
- Shows: "Your top mistake cost you $430 this month"
- Visual emphasis: fixing one mistake = more gain than finding a new setup

**User emotion:** Confronting but empowering. Seeing the data forces honesty and creates clear direction.

---

### Pre-Trade Checklist (`/checklist`)

> **The gate between impulse and execution. The discipline enforcer.**

| | |
|---|---|
| **Purpose** | Force rule verification before entering any trade |
| **What user sees** | Setup selector, rules checklist, visual reference images, confidence score, action button |

**The Checklist Flow:**
1. Select which trading setup you're considering
2. View reference screenshot(s) of ideal setup pattern
3. Go through each rule one-by-one (check Yes / Partly / No)
4. System calculates confidence score:
   - **A+ Setup** (≥80% Yes) → "Take Trade" unlocked
   - **Moderate Setup** (50–79%) → Warning shown, user can override
   - **Low Confidence** (<50%) → "Skip This Trade" recommended
5. User takes or skips trade
6. Decision logged for discipline tracking in Analytics

**Rules Examples (user-defined):**
- "Price is above 200 EMA"
- "RSI is between 40–60"
- "Session is London or New York"
- "Stop loss placed before entry"
- "Risk is max 1% of account"

**Why This Page Exists:** The #1 cause of bad trades is taking setups that "feel close enough." This page makes traders confront the gap between their ideal setup and the current one — before money is on the line.

**User emotion:** Grounded, methodical, protected. If they skip a bad trade, they feel the satisfaction of discipline.

---

### Trading Setups (`/setups`)

> **The strategy library. Where discipline is defined before the market opens.**

| | |
|---|---|
| **Purpose** | Define, document, and manage trading strategies |
| **What user sees** | Setup cards, create/edit setup form |

**What a Setup Contains:**
- Setup name (e.g., "London Breakout", "Nifty Opening Range")
- Up to 5 reference screenshots (ideal setup examples)
- Up to 10+ rules (the conditions that must be met)
- Tags or description
- Trade count and P&L linked to this setup (from analytics)

**Why This Page Exists:** Without defined setups, every trade becomes a judgment call. Setups create an objective standard that the checklist enforces and analytics tracks.

**User emotion:** Structured, professional. Users feel like real trading businesses, not gamblers.

---

### Weekly AI Reports (`/weekly-reports`)

> **The Sunday coaching session. Honest, specific, actionable.**

| | |
|---|---|
| **Purpose** | AI-generated weekly performance review with coaching insights |
| **What user sees** | Report cards organized by week, each containing structured AI analysis |

**Report Sections:**

| Section | Content |
|---|---|
| **Week Summary** | Total trades, win rate, net P&L for the week |
| **Top Mistakes** | AI-identified behavioral errors ranked by P&L cost |
| **Discipline Score** | % of trades taken with checklist confirmation |
| **Psychology Trend** | Mood and emotional pattern for the week |
| **Focus Areas** | Specific behaviors to address next week |
| **Next Week Checklist** | 3–5 specific action items generated by AI |
| **Positive Patterns** | What worked well (reinforce good behavior) |

**Sample AI Coaching Output:**
> *"This week your biggest loss came from 3 revenge trades on Tuesday after a morning loss of ₹4,200. Each revenge trade was 2× your normal position size. Consider implementing a hard stop: no trading for 2 hours after hitting your daily loss limit."*

**Why This Page Exists:** Daily data alone doesn't build improvement. Weekly pattern analysis, delivered by an AI coach that has seen every trade, creates the reflection loop that drives behavioral change.

**User emotion:** Accountable, coached, motivated. Like having a mentor who studied your entire week and gave you honest feedback.

---

### Notifications (`/notifications`)

> **The behavioral alert center. Where the AI coach speaks.**

| | |
|---|---|
| **Purpose** | Central hub for all alerts, coaching messages, and insights |
| **What user sees** | Notification cards with color-coded badges, unread indicators, timestamps |

**Notification Types:**

| Type | Description | Trigger |
|---|---|---|
| **Morning Mentor** | Daily behavioral coaching message | Every trading morning |
| **Revenge Trading Alert** | "You're at risk of revenge trading" | After a significant loss |
| **Overtrading Warning** | "You've taken 40% more trades than usual" | High-frequency day |
| **No Stop-Loss Alert** | "Last 2 trades had no stop loss set" | Missing risk management |
| **Daily Loss Limit** | "You've hit 3% drawdown today" | Risk threshold breach |
| **Discipline Signal** | "Well done — 5 consecutive rule-following trades" | Positive reinforcement |
| **Setup Reminder** | "You haven't used your checklist in 3 days" | Engagement nudge |
| **Weekly Report Ready** | "Your weekly report is available" | Sunday report generation |
| **Mood Risk Warning** | "Your last 3 trades were taken at Stress Level 1" | Low-mood trading pattern |

**Notification UX:**
- Dark mode cards with color-coded priority badges
- Unread indicators (dot badges)
- Deep links to relevant page (tapping "Revenge Alert" → opens analytics)
- Mark all as read option

**Why This Page Exists:** The journal is where users record the past. Notifications are where the app speaks in real-time — the behavioral guardrail that fires before damage is done.

---

### Morning Mentor Notifications

> **The most powerful engagement feature. Daily behavioral coaching delivered to your phone.**

The Morning Mentor is an AI-driven notification system that analyzes recent trading behavior and sends a **personalized coaching message every trading morning** before markets open.

**Behavioral Scenarios Tracked:**

| Scenario | Alert Type | Message Focus |
|---|---|---|
| Revenge trading pattern | Warning | "Yesterday's loss led to 2 oversized trades" |
| No stop-loss trades | Risk | "2 recent trades had no stop loss defined" |
| Overtrading detected | Warning | "You're averaging 40% more trades this week" |
| Emotional trading (FOMO/Fear tags) | Psychology | "3 trades tagged FOMO this week — watch for it" |
| Low setup discipline | Discipline | "Only 50% of trades used your checklist" |
| Loss-heavy day | Support | "Yesterday was tough. Reset your risk for today." |
| Disciplined win day | Positive | "Yesterday you followed all rules and won. Do it again." |
| Profitable streak | Reinforcement | "4-day winning streak — stay disciplined, don't oversize" |
| Weekend reset | Preparation | "Markets open Monday. Review your setups tonight." |

**Push Notification Flow:**
1. System evaluates past 24–72h of trading behavior every morning
2. Selects highest-priority behavioral scenario
3. Generates personalized message referencing actual trade data
4. Delivers via Android push notification
5. Tapping notification → opens Notifications page with full message

---

### Profile (`/profile`)

| | |
|---|---|
| **Purpose** | Account management, subscription status, quick navigation |
| **What user sees** | Profile info, subscription tier/expiry, quick action buttons |

**Profile Information:**
- Display name & email
- Authentication method (Email or Google)
- Member since date
- Last login
- Subscription tier (Free / Monthly Pro / Annual Pro)
- Subscription expiry date

**Quick Actions:**
- Go to Analytics
- Upload Trade
- Weekly Reports
- Indian Market

**Subscription Tiers:**

| Feature | Free | Monthly Pro | Annual Pro |
|---|---|---|---|
| Trade Journal | ✓ | ✓ | ✓ |
| Basic Analytics | ✓ | ✓ | ✓ |
| Add Trade (Manual) | ✓ | ✓ | ✓ |
| AI Screenshot Extraction | — | ✓ | ✓ |
| Full Analytics (60+ metrics) | — | ✓ | ✓ |
| Weekly AI Reports | — | ✓ | ✓ |
| Morning Mentor Notifications | — | ✓ | ✓ |
| Psychology Analytics | — | ✓ | ✓ |
| Setup Score Tracking | — | ✓ | ✓ |
| Advanced Psychology Insights | — | — | ✓ |
| Priority Support | — | — | ✓ |

---

### Support (`/support`)

| | |
|---|---|
| **Purpose** | Help center and feedback channel |
| **What user sees** | FAQ, contact options, feedback form |
| **Why it exists** | Reduce churn by solving problems quickly; gather product feedback |

---

### Indian Market — Full Feature Parity

The Indian Market section is a **complete parallel universe** within the app — every Forex feature exists for Indian markets with market-appropriate adaptations:

| Feature | Indian Market Adaptation |
|---|---|
| Add Trade | Segment (Equity/F&O/Commodity), Trade Type (Intraday/Delivery/BTST), Instrument (Equity/Future/Option), Strike & Expiry |
| Analytics | ₹ currency, lot-size aware calculations, F&O specific metrics |
| Dashboard | NSE/BSE context, F&O P&L |
| AI Extraction | Trained on Zerodha, Groww, Upstox, Angel One, IIFL screenshots |
| Morning Mentor | Indian trading session-aware (9:15 AM IST) |

**Market Switcher:** A prominent toggle in the header lets users switch between Forex and Indian Market seamlessly, preserving context.

---

## 5. User Journeys

### Beginner User Journey

```
Week 1:  Sign up → Log first 3 trades manually → Explore dashboard
Week 2:  Create first setup → Use checklist → Feel what discipline feels like
Week 3:  Receive first weekly report → Identify first mistake pattern
Week 4:  Morning mentor alerts start → Begin building pre-market routine
Month 2: Analytics shows mood-performance correlation → Behavior starts shifting
Month 3: Discipline score improves → Win rate improves → User tells a friend
```

**Key emotions:** Curiosity → Structure → Awareness → Improvement → Loyalty

---

### Returning Daily User Journey

```
6:30 AM → Morning mentor notification arrives (check phone)
         → Open notification: "Yesterday you revenge traded after a loss. Start fresh today."
         → Tap through to full message → feel accountability
8:30 AM → Open app → check Dashboard KPIs
         → Review equity curve → note where we are
9:00 AM → Pre-trade checklist before first trade
         → Setup: London Breakout → Rules check: A+ → Take trade
10:15 AM → Trade exits → Open Add Trade → Log details + mood (Confident) + tag (Disciplined)
12:00 PM → Second trade opportunity → Checklist again → Low confidence → Skip trade
5:00 PM → Review Journal → reflect on day
Sunday  → Weekly AI Report notification → open report → plan next week
```

**Retention driver:** The app is woven into the trader's routine at 4–5 natural touch points per day.

---

### Power User Journey

```
· Creates 5+ setups with full rules and reference images
· Uses checklist religiously — only A+ trades
· Uploads screenshots for instant logging (saves 3 min/trade)
· Checks psychology analytics weekly to spot behavioral drift
· Uses weekly reports to set measurable improvement goals
· Compares Forex and Indian Market performance side-by-side
· Reviews repeated mistakes panel monthly — fixes one mistake at a time
· Discipline score consistently above 85%
· Win rate improving quarter-over-quarter
```

**Power user identity:** They don't just use the app — they consider it their competitive advantage.

---

### Daily Habit Flow

The app is designed to create a **triple-touch daily habit:**

| Touch | Timing | Feature | Duration |
|---|---|---|---|
| **Morning** | Pre-market | Morning Mentor notification + Checklist | 3–5 min |
| **During Session** | After each trade | Add Trade (manual or upload) | 1–2 min per trade |
| **Evening** | Post-session | Journal review + Dashboard KPIs | 5–10 min |

Weekly:
- **Sunday:** Weekly AI Report → planning session → setup review

---

### Retention Flow

```
Day 1–3:   New user excitement → logging trades, exploring analytics
Day 7:     First weekly report → "Wow, the AI identified exactly what I was doing wrong"
Day 14:    Morning mentor becomes expected → habit formed
Day 30:    Analytics shows real improvement → emotional investment in data
Day 60:    Discipline score visibly improved → user has proof of growth
Day 90:    User upgrades to Annual Pro → becomes long-term retained user
Day 180:   User shares app with trading community → organic referral
```

---

## 6. Features & Benefits

### Main Features

| Feature | Description |
|---|---|
| **Smart Trade Journal** | Manual + AI screenshot logging with full psychology tagging |
| **60+ Analytics Metrics** | Performance, psychology, setup, time, and behavioral analysis |
| **Pre-Trade Checklist** | Rule-by-rule verification with confidence scoring before entry |
| **Trading Setup Builder** | Create named strategies with rules, images, and performance tracking |
| **Morning Mentor** | Daily AI behavioral coaching push notification |
| **Weekly AI Reports** | Sunday coaching reports with ranked mistakes and action items |
| **Psychology Tracking** | Mood, confidence, emotional tags linked directly to P&L |
| **Indian Market Support** | Full F&O/Equity/Intraday support with ₹ analytics |
| **AI Screenshot Extraction** | Auto-fill trade details from broker screenshots |
| **Equity Curve & Drawdown** | Visual account growth with drawdown visualization |
| **Revenge Trading Detection** | Automatic behavioral flags for dangerous trading patterns |
| **Repeated Mistakes Tracker** | Ranks costly mistakes to prioritize improvement |

---

### User Benefits

| Benefit | Impact |
|---|---|
| **Clarity** | Know exactly which setups, times, and emotional states make money |
| **Discipline** | Checklist prevents emotional entries before they happen |
| **Accountability** | Morning mentor and weekly reports hold you to your own rules |
| **Speed** | AI extraction means logging takes seconds, not minutes |
| **Insight** | Psychology analytics reveal patterns invisible in any spreadsheet |
| **Confidence** | Discipline score and streak tracking build genuine confidence |
| **Safety** | No-stop-loss and overtrading alerts protect the account |

---

### Psychological Benefits

- **Reduces emotional trading** by making emotions data, not just feelings
- **Builds trading identity** — users start thinking of themselves as disciplined traders
- **Creates positive feedback loops** — discipline → better results → more discipline
- **Reduces post-loss spiral** — morning mentor resets mindset before the next session
- **Eliminates shame** — replacing self-judgment with data-driven understanding

---

### Habit-Building Advantages

| Trigger | Routine | Reward |
|---|---|---|
| Morning notification | Open app, read mentor | Feel prepared and accountable |
| Trade exits | Log trade with emotions | Data feels complete, habit satisfied |
| End of day | Review journal | Sense of closure, reflection done |
| Sunday | Read weekly report | Insight, improvement direction |

Edgecipline is designed using **habit loop psychology** — every feature creates a trigger, routine, and reward.

---

### Competitive Advantages

| vs Competitors | Edgecipline Advantage |
|---|---|
| **vs Tradervue** | Psychology tracking, AI coaching, Indian market, mobile-first |
| **vs Edgewonk** | Mobile app, AI extraction, morning mentor, push notifications |
| **vs TraderSync** | Psychology depth, Indian market, AI report coaching, behavioral detection |
| **vs Spreadsheets** | Zero friction, automated analysis, AI insights, behavioral alerts |
| **vs Nothing** | Accountability system that actually changes trading behavior |

---

## 7. Product Value

### Why Users Would Love This App

1. **It tells the truth** — no vanity metrics, no feel-good dashboards. It shows exactly what's wrong and what it costs.
2. **It feels like a coach** — the morning mentor and weekly reports have personality, specificity, and genuine insight
3. **It removes friction** — AI extraction, one-tap logging, instant KPIs
4. **It meets traders where they are** — both Forex and Indian market traders have a home
5. **It builds pride** — a rising discipline score and equity curve create emotional ownership

---

### Why Users Would Continue Using It

- **Data lock-in:** All trade history, setups, and analytics live here — leaving means losing the record
- **Habit integration:** Morning mentor is woven into the pre-market routine
- **Progress visibility:** Discipline score and streak tracking make improvement visible and motivating
- **Weekly rhythm:** Sunday AI reports create a weekly appointment with the app
- **Identity shift:** Users start identifying as "disciplined traders" — the app becomes part of that identity

---

### What Makes It Unique

> **No other trading journal connects psychology directly to performance metrics and then coaches you about it every single morning.**

The three-layer combination — Journal + Psychology + AI Coach — has never been done in a single mobile product at this depth.

---

### Why It Can Succeed as a Startup/SaaS

- **Massive TAM:** 50M+ Indian F&O traders, 20M+ global retail Forex traders
- **High pain point:** Emotional trading is the #1 reason traders lose money — it's deeply felt
- **Recurring behavior:** Trading is a daily activity — daily habit = daily DAU
- **Network effects possible:** Leaderboard of discipline scores, community features
- **AI moat:** Morning mentor personalization and weekly report quality improve with data
- **Subscription model fit:** Traders are accustomed to paying for tools and education

---

## 8. UX & Engagement Strategy

### User Engagement Architecture

Edgecipline engages users at **every level of the habit stack:**

| Layer | Mechanism | Frequency |
|---|---|---|
| External trigger | Morning push notification | Daily |
| Internal trigger | Curiosity about their metrics | Continuous |
| Variable reward | AI insight discovery | Weekly |
| Investment | Trade history data grows | Cumulative |

---

### Gamification Elements

| Element | Mechanic | Effect |
|---|---|---|
| **Discipline Score** | % of trades with checklist | Motivates rule-following |
| **Win Streak Counter** | Consecutive profitable trades | Creates streak protection mindset |
| **Setup Confidence Grade** | A+ / Moderate / Low | Gamifies setup quality |
| **Mood Emoji Scale** | 1–5 emoji progression | Makes emotional tracking playful |
| **Repeated Mistakes Rank** | Cost-ranked mistake list | Creates "fix the #1" goal |
| **Equity Curve** | Visual growth line | Makes progress tangible and visual |
| **Weekly Report Delivery** | Sunday "reward" | Creates anticipation and ritual |

---

### Notification & Reminder Strategy

**Morning Mentor (Primary Engagement Driver):**
- Personalized — references actual trades, actual mistakes
- Timely — arrives before market open
- Actionable — specific behavioral guidance
- Positive and negative — reinforces wins, warns about risks

**Secondary Notifications:**
- Unread badge on notification icon creates FOMO on insights
- Weekly report arrival is an event, not a notification
- In-app empty states (first trade, first setup) guide users to next action

---

### Emotional Connection with Users

Edgecipline builds emotional connection through **radical honesty with kindness:**

- It never shames. It presents data.
- It celebrates discipline even when trades lose money.
- It reminds users that bad days are patterns, not destiny.
- The morning mentor speaks like a respected mentor, not a system message.
- Weekly reports highlight positives alongside areas for improvement.

**Brand personality:** Disciplined, honest, supportive, data-driven, psychologically aware.

---

### Retention Ideas

| Idea | Mechanism |
|---|---|
| **30-Day Discipline Challenge** | Streak of checklist-confirmed trades with badge reward |
| **Monthly Improvement Badge** | Discipline score improved vs prior month |
| **Setup Performance Awards** | "Your London Breakout setup has 78% win rate" |
| **Milestone celebrations** | 100 trades logged, 6-month member, first profitable month |
| **Insight of the Week** | One personalized analytical insight surfaced on Dashboard |
| **Trading Streak** | Days in a row logging trades (builds consistency habit) |

---

## 9. Business & Growth Perspective

### Monetization Model

#### Primary: SaaS Subscription (B2C)

| Plan | Price (Suggested) | Target User |
|---|---|---|
| **Free** | ₹0 / $0 | Trial, casual traders |
| **Monthly Pro** | ₹499/mo / $9.99/mo | Active traders, testing the product |
| **Annual Pro** | ₹3,999/yr / $79/yr | Serious traders, committed improvers |

**Free → Paid Conversion Triggers:**
- Free user hits analytics paywall after 30 trades
- Free user can't access AI extraction
- Free user sees "Weekly Report" in nav but can't open it (teaser locked state)
- Morning mentor is a Pro feature (free users miss the most powerful feature)

---

#### Secondary Revenue Streams

| Stream | Description |
|---|---|
| **Prop Firm Partnerships** | Co-brand with prop firms; they give new traders an Edgecipline Pro subscription |
| **Trading Course Integrations** | Trading educators use Edgecipline as the accountability tool for students |
| **Trading Community Licenses** | Discord communities or Telegram groups license Edgecipline for their members |
| **White Label** | Broker-branded version of the journal for their retail clients |
| **Data Insights (Anonymized)** | Aggregate behavioral patterns sold to institutional researchers |

---

### Marketing Strategy

#### Organic / Content Marketing
- **YouTube channel:** "What your trading data reveals about you" — analytics walkthroughs
- **Twitter/X:** Daily discipline tips, morning mentor sample messages, P&L transparency threads
- **Reddit (r/Forex, r/IndianStreetBets, r/DayTrading):** Genuine value posts, community building
- **Trading Discord servers:** Sponsor or partner with large trading communities

#### Performance Marketing
- **YouTube ads** targeting "trading journal", "how to stop revenge trading", "trading psychology"
- **Google Search ads** for "best trading journal app", "trading analytics app"
- **Instagram/Meta** targeting users following trading pages

#### Referral Mechanics
- "Share your discipline score" → shareable card with QR code
- Refer a friend → both get 1 month Pro free
- Trading community license → admin gets Pro free for managing X active users

#### Influencer / Creator Strategy
- Partner with Indian trading YouTubers (Finance with Sharan, CA Rachana, etc.)
- Affiliate commissions for trading educators who recommend to students
- "Pro trader case studies" — real traders sharing before/after data

---

### Branding Ideas

**Name:** Edgecipline (Edge + Discipline) — memorable, domain-ownable, mission-aligned  
**Tagline options:**
- *"Trade with discipline. Win with data."*
- *"Your AI coach for consistent trading."*
- *"The journal that coaches back."*
- *"Know yourself. Trade yourself."*

**Color palette:** Dark navy/charcoal primary (professional, trustworthy), electric green accents (growth, profit), red for warnings (immediate attention)

**Brand voice:** Like a respected trading mentor — direct, no-nonsense, supportive, data-driven. Not a cheerleader. Not a robot. A coach.

---

### Community Building

| Initiative | Description |
|---|---|
| **Discipline Leaderboard** | Weekly public leaderboard of discipline scores (opt-in) |
| **Setup Library** | Community-shared setups with crowd-sourced performance ratings |
| **Weekly Challenge** | "This week's challenge: No trades below 70% checklist score" |
| **Mentor Pairing** | Connect experienced users with newer ones based on similar trading styles |
| **Live Group Reports** | Trading communities share anonymized group performance data |

---

## 10. Future Vision

### Near-Term Roadmap (6–12 months)

| Feature | Impact |
|---|---|
| **iOS App** (Capacitor) | Doubles addressable market |
| **Broker API Integration** | Auto-import trades from supported brokers (Zerodha, MT4, Interactive Brokers) |
| **Risk Calculator** | Built-in position sizing tool before entering the checklist |
| **Trade Replay** | Replay how a trade developed on a price chart |
| **Custom Analytics Builder** | Drag-and-drop your own metrics dashboard |
| **Multi-Account Support** | Track multiple brokerage accounts separately |
| **Goals & Milestones** | Set monthly P&L, win rate, or discipline goals with progress tracking |

---

### Medium-Term Vision (12–24 months)

| Feature | Impact |
|---|---|
| **AI Trade Quality Scorer** | AI reviews each trade entry and rates quality (1–10) with reasoning |
| **Broker Direct Integration** | Zerodha API, Dhan API, MT5 API for real-time auto-import |
| **Live Market Alerts** | "Your London Breakout setup is forming right now" (real-time market scanning) |
| **Social Trading Journal** | Share selected trades publicly; follow other traders |
| **Team / Prop Firm Dashboard** | Admin view for prop firm managers to monitor trader discipline |
| **Edgecipline Academy** | Curated psychology courses embedded within the app |
| **AI Backtesting** | Submit a setup's rules → AI backtests against historical data |

---

### Long-Term Vision (24–48 months)

| Vision | Description |
|---|---|
| **The Bloomberg Terminal for Retail Traders** | The definitive platform for serious retail trading — analytics + coaching + community |
| **Institutional Grade Psychology Data** | The largest dataset of trading psychology vs performance correlations ever assembled |
| **AI Trading Coach (Conversational)** | Chat-based AI coach that knows your full trade history and answers questions like a human mentor |
| **Global Expansion** | Localized for US (TD Ameritrade, ThinkorSwim), UK, EU, SEA markets |
| **Prop Firm OS** | The operating system for prop trading firms — evaluation tracking, rule enforcement, trader development |

---

### AI Opportunities

| Opportunity | Description |
|---|---|
| **Predictive Behavioral Alerts** | "Based on your pattern, you're 73% likely to revenge trade today" |
| **Setup Discovery** | AI analyzes trade history and suggests new setups based on your winning patterns |
| **Personalized Risk Rules** | AI recommends position sizing rules based on your drawdown history |
| **Emotional State Prediction** | Before a session, AI asks 3 questions → predicts trading readiness score |
| **Market Context Awareness** | AI adjusts coaching based on current market volatility (VIX, India VIX) |
| **Voice Trade Logging** | Speak your trade details → AI transcribes and logs |

---

### Scaling Possibilities

| Scale Vector | Path |
|---|---|
| **Geographic** | India → SEA → Middle East → Global |
| **Market** | Forex + Indian → US Stocks → Crypto → Commodities |
| **User Segment** | Retail → Prop Firms → Hedge Fund Compliance |
| **Platform** | Mobile → Web → Desktop → TradingView Plugin |
| **Revenue** | Subscription → Marketplace → Data → White Label |

---

## 11. Final Product Summary

### Complete End-to-End Product Flow

```
TRADER OPENS APP
        │
        ├── Morning: Reads AI mentor alert → enters market psychologically prepared
        │
        ├── Pre-Trade: Runs checklist → only takes A+ setups
        │
        ├── During Trade: AI extraction logs trade in 10 seconds
        │
        ├── Post-Trade: Adds mood tag and emotional state
        │
        ├── Evening: Reviews dashboard KPIs and equity curve
        │
        └── Sunday: Reads weekly AI coaching report → adjusts behavior

MONTH OVER MONTH:
        Discipline score rises → Win rate improves → Drawdown shrinks
        → Account grows → Trader becomes consistently profitable
        → Trader is loyal, tells other traders → Platform grows
```

---

### Overall App Experience

Edgecipline feels like **having a world-class trading mentor inside your phone** — one who watched every trade you made, knows every mistake you repeated, celebrates your discipline, and warns you before you make costly emotional decisions.

It is simultaneously:
- A **productivity tool** (frictionless logging, instant analytics)
- A **coaching platform** (morning mentor, weekly reports)
- A **behavioral accountability system** (checklist, psychology tracking)
- A **performance analytics engine** (60+ metrics, psychological correlations)

The design philosophy: **every feature serves one mission — helping traders follow their own rules consistently.**

---

### Overall User Value

| Before Edgecipline | After Edgecipline |
|---|---|
| Vague sense of what went wrong | Exact data on what went wrong and why |
| Emotional reactions to losses | Data-driven understanding of patterns |
| Breaking rules without realizing | Morning alerts warn before the market opens |
| Unknown which setups work | Setup performance ranked by P&L |
| Weekly losses from repeated mistakes | Mistakes ranked and systematically eliminated |
| No accountability | AI coach reviews every week |
| Trading journal as chore | Trading journal as competitive advantage |

---

### Why This App Matters

> The trading world gives retail traders every disadvantage: no coach, no accountability, no systematic review, and no behavioral awareness tools. Institutional traders have risk managers, performance coaches, and trading desks. Retail traders have nothing.
>
> **Edgecipline is the retail trader's institutional advantage.**

It closes the gap between knowing what to do and actually doing it — consistently, day after day, trade after trade.

That gap is where retail traders lose money. And closing it is worth building a company around.

---

---

## 12. Frequently Asked Questions (FAQ)

> Organized by user intent — from first-time visitors to long-term power users. These are the real questions users ask, with the answers they need.

---

### SECTION A — Getting Started

---

**Q1. What exactly is Edgecipline and how is it different from a regular trading journal?**

A regular trading journal is a spreadsheet or basic log — you record what happened and that's it. Edgecipline is a **behavioral coaching system** built on top of a journal. It tracks not just your trades but your psychology — mood, emotions, confidence — and connects those directly to your P&L. Then an AI coach analyzes your patterns every morning and every week, tells you exactly what you're doing wrong and what it's costing you. No spreadsheet does that.

---

**Q2. I'm a complete beginner. Is this app for me?**

Edgecipline is best suited for traders who already have some experience — people who have a strategy but struggle to follow it consistently. That said, beginners can absolutely use it to build disciplined habits from day one, which is far better than forming bad habits and trying to fix them later. The app will guide you through setup creation, checklist use, and journaling from your very first trade.

---

**Q3. What markets does Edgecipline support?**

Currently Edgecipline supports two market types:

| Market | What's Supported |
|---|---|
| **Forex / Global** | Currency pairs, indices, commodities, CFDs |
| **Indian Markets** | NSE/BSE Equity, F&O (Futures & Options), Intraday, Delivery, BTST, Commodity |

More markets (US Stocks, Crypto) are on the roadmap.

---

**Q4. Is Edgecipline a web app, mobile app, or both?**

Both. Edgecipline is available as:
- A **Progressive Web App (PWA)** accessible from any browser
- A **native Android app** (available on Play Store / direct APK)
- iOS support is on the near-term roadmap

The mobile app uses push notifications for the Morning Mentor feature — this is a key advantage over web-only journals.

---

**Q5. Do I need to create an account to use the app?**

Yes. An account is required to save your trade data, generate analytics, and receive personalized AI coaching. You can sign up with your email/password or with Google (one-tap). Your data is linked to your account and accessible from any device.

---

**Q6. How long does it take to see useful insights from the app?**

You'll see basic analytics after your **first 5–10 trades**. Meaningful patterns — psychology correlations, setup performance, behavioral flags — start emerging after **30–50 trades** (typically 2–4 weeks of active trading). The weekly AI report generates after your **first full trading week**. The more you log, the smarter the insights become.

---

**Q7. Can I import my old trades from a spreadsheet or another journal?**

Bulk import from CSV/spreadsheet is on the roadmap. Currently, trades can be added manually or via AI screenshot extraction. If you have historical trades in a broker platform, you can upload screenshots from past trades to use the AI extraction feature.

---

### SECTION B — Trade Logging

---

**Q8. How do I log a trade?**

Two ways:

1. **Manual entry** — Go to Add Trade, fill in the details (pair, direction, entry/exit, P&L), add your psychology tags (mood, emotional state, setup used), and save. Takes about 60–90 seconds.

2. **AI Screenshot Upload** — Go to Upload Trade, take or upload a screenshot of your broker platform. The AI reads the image, extracts all trade details, and pre-fills the form. You review, add psychology tags, and confirm. Takes about 15–30 seconds.

---

**Q9. What information should I log for each trade?**

At minimum: symbol, direction (buy/sell), entry price, exit price, and P&L. For maximum value from analytics, also log: stop loss, take profit, position size, mood, emotional state tags, confidence level, and which setup/strategy you used. The psychology fields are what make Edgecipline powerful — don't skip them.

---

**Q10. What are "emotional tags" and why should I use them?**

Emotional tags are labels you apply to a trade describing your mental state when you took it. Options include: **FOMO, Revenge, Fear, Greed, Impatient, Hesitant, Confident, Disciplined.**

Why they matter: after 50+ trades, the analytics will show you the P&L difference between your "Disciplined" trades and your "Revenge" trades. For most traders, this single comparison is worth the entire subscription — it puts a dollar figure on what emotional trading is actually costing you.

---

**Q11. What is the "Would You Retake?" field?**

After a trade exits, you answer: *"If you could go back to the entry moment, would you take this trade again?"* This is answered regardless of whether the trade was a win or loss.

Over time, this trains your instinct calibration. If you're saying "Yes" to losing trades and "No" to winning trades, your intuition is inversed. If you're consistently saying "No" and those trades are losses — your gut is already ahead of your execution.

---

**Q12. Can I add notes or screenshots to individual trades?**

Yes. Each trade has a free-text notes field where you can write your reasoning, market context, or post-trade observations. You can also attach a screenshot (broker screenshot, chart screenshot, etc.) to any trade for visual reference.

---

**Q13. Can I edit or delete a trade after saving it?**

Yes. Go to the Trade Journal, find the trade, and use the edit or delete options. Editing updates all analytics calculations immediately. Note: editing historical trades changes your analytics history — only correct genuine data entry errors, don't retroactively "clean up" bad trades.

---

**Q14. For Indian market trades, what specific fields are available?**

Indian market trades have additional fields:
- **Segment:** Equity / F&O / Commodity / Currency
- **Trade Type:** Intraday / Delivery / BTST (Buy Today Sell Tomorrow)
- **Instrument:** Equity / Future / Option
- **Strike Price** (for Options)
- **Expiry Date** (for F&O)
- **Lot Size** (auto-calculated for position value)

These enable accurate analytics specific to F&O trading — including lot-aware P&L and segment-wise performance breakdown.

---

### SECTION C — AI Screenshot Extraction

---

**Q15. How does the AI trade extraction work?**

You upload a screenshot from your broker platform (or take a photo). The AI uses OCR (text recognition) and Vision AI to:
1. Detect which broker/platform the screenshot is from
2. Read all relevant trade data from the image
3. Extract: symbol, direction, entry/exit prices, P&L, date/time, stop loss, take profit
4. Pre-fill the trade form with the extracted data
5. Show a confidence score for each extracted field

You then review the pre-filled data, make any corrections, add psychology tags, and confirm.

---

**Q16. Which broker platforms does the AI support?**

**Forex/Global:** MetaTrader 4, MetaTrader 5, cTrader, TradingView, and most major broker statement formats.

**Indian Markets:** Zerodha (Kite), Groww, Upstox, Angel One, IIFL Markets, Dhan, Fyers, 5Paisa, and growing.

If your broker isn't listed, try uploading a screenshot anyway — the AI often handles new formats. You can also manually correct any misread fields before confirming.

---

**Q17. What if the AI reads the screenshot incorrectly?**

The AI shows a confidence score for each extracted field. Low-confidence fields are highlighted. Before confirming, you can manually correct any field that was misread. The corrected data is what gets saved — you always have the final review step. Over time, the AI improves as it processes more screenshots.

---

**Q18. Can I upload multiple trades at once from a single screenshot?**

Yes. If your screenshot shows multiple closed trades (like a trade history page), the AI detects multiple trades and extracts all of them in one upload. You review each extracted trade and confirm which ones to save.

---

**Q19. Is the screenshot upload feature available on the free plan?**

No. AI screenshot extraction is a Pro feature. Free plan users can log trades manually without limitation, but AI extraction requires a Monthly Pro or Annual Pro subscription.

---

### SECTION D — Analytics

---

**Q20. What analytics does Edgecipline provide?**

Edgecipline tracks 60+ metrics across six dimensions:

| Dimension | Key Metrics |
|---|---|
| **Performance** | Win rate, profit factor, expectancy, Sharpe ratio, max drawdown |
| **Risk** | Avg risk:reward, recovery factor, max drawdown %, worst loss |
| **Setup** | P&L and win rate per strategy/setup |
| **Time** | Best/worst hour, day of week, market session |
| **Direction** | Long vs short performance comparison |
| **Psychology** | Mood-win rate correlation, emotional tag impact, discipline score |

---

**Q21. What is the "Discipline Score" and how is it calculated?**

The Discipline Score is the percentage of your trades that were confirmed through the Pre-Trade Checklist before entry. A trade taken with an A+ checklist result counts as disciplined. A trade taken without using the checklist at all — or with Low Confidence — counts as undisciplined.

Formula: `(Disciplined Trades / Total Trades) × 100`

A score above 80% is excellent. Below 50% means you're trading on impulse more than on rules. The score appears on your Dashboard and is tracked week-over-week in your weekly reports.

---

**Q22. What is the "Repeated Mistakes Tracker"?**

This panel in Analytics ranks your self-tagged mistakes by their total P&L cost. For example, if you tagged "No Stop Loss" on 5 trades that together lost ₹12,400, that mistake appears at the top ranked by cost.

The insight: instead of hunting for a new strategy, fixing your single most expensive habit typically recovers more P&L than anything else you could do. The tracker makes that priority obvious.

---

**Q23. How does mood tracking connect to my P&L?**

Every trade you log includes a mood rating (1 = very stressed, 5 = peak state). Over time, Analytics plots your average P&L by mood level. Most traders discover a clear pattern: they win significantly more when calm (mood 3–4) and significantly more when stressed (mood 1–2).

Once this correlation is visible in your own data, the motivation to trade with the right mindset becomes personal — not theoretical advice, but your own numbers.

---

**Q24. What is the equity curve and why does it matter?**

The equity curve is a visual chart of your account balance growing (or shrinking) over time, based on your logged trade P&L. It shows:
- Overall account trajectory (upward trend = profitable)
- Drawdown periods (dips below peak)
- Recovery speed
- Consistency of growth vs erratic swings

Professional traders watch their equity curve religiously. A smooth, upward-sloping curve indicates consistent, disciplined trading. A jagged, volatile curve signals emotional or inconsistent execution.

---

**Q25. Can I filter analytics by a specific time period or setup?**

Yes. Analytics supports filters for:
- Time period (Today, This Week, This Month, Last 3 Months, Custom range)
- Setup / Strategy
- Direction (Long / Short)
- Market (Forex or Indian)

This lets you compare performance across different strategies, time periods, or market conditions to find what's actually working.

---

**Q26. How many trades do I need before analytics becomes meaningful?**

- **5–10 trades:** Basic KPIs (win rate, P&L) show up
- **20–30 trades:** Setup performance comparison starts being reliable
- **50+ trades:** Psychology correlations become statistically meaningful
- **100+ trades:** Full behavioral pattern detection, reliable mood-P&L correlation

The app works with any number of trades, but the insights get dramatically more accurate and useful as your dataset grows.

---

### SECTION E — Pre-Trade Checklist

---

**Q27. What is the Pre-Trade Checklist and why should I use it?**

The Pre-Trade Checklist is a structured gate you go through before entering any trade. You select your setup, then go through your predefined rules one by one, marking Yes / Partly / No for each. The system scores the result and gives you a confidence grade:

- **A+ (≥80% Yes):** Setup conditions fully met — take the trade
- **Moderate (50–79%):** Conditions partially met — proceed with caution
- **Low (<50%):** Setup not ready — skip the trade

The checklist forces a deliberate, rational evaluation before money enters the market — the most reliable way to prevent impulse trades.

---

**Q28. Do I have to use the checklist before every trade?**

No — it's not mandatory. But every trade you take without a checklist confirmation is counted as "undisciplined" in your Discipline Score and analytics. Over time, your data will show the P&L difference between your checklist-confirmed trades and your impulse trades. For most traders, this difference is significant enough to make the checklist a non-negotiable habit.

---

**Q29. How do I create my rules for the checklist?**

Rules are created in the **Trading Setups** section. When you create or edit a setup, you define its rules — the conditions that must be met for the setup to be valid. Examples:

- "Price is above the 200 EMA"
- "RSI is not overbought (below 70)"
- "Session is London or New York open"
- "Stop loss is placed below structure"
- "Risk is maximum 1% of account"

These rules then automatically appear in the checklist whenever you select that setup.

---

**Q30. What if I take a trade and score Moderate on the checklist — is that okay?**

The app doesn't prevent you from taking Moderate-confidence trades. It shows you the score and highlights which rules aren't met, then you make the decision. The system is an informer, not a blocker.

However, your Analytics will track the P&L separately for A+, Moderate, and Low confidence trades. Most traders discover that only their A+ trades are profitable on average — making the choice clear over time.

---

### SECTION F — Morning Mentor & Notifications

---

**Q31. What is the Morning Mentor?**

The Morning Mentor is an AI-powered push notification that arrives every trading morning before the market opens. It analyzes your recent trading behavior (last 24–72 hours) and sends a personalized coaching message relevant to your specific patterns.

It is not a generic motivational message. It references your actual trades. For example:

> *"Good morning. Yesterday you placed 3 trades after your initial stop-out — each one larger than the last. That's your revenge trading pattern. Today, set a daily loss limit before the session starts."*

---

**Q32. When does the Morning Mentor notification arrive?**

- **Forex traders:** Typically sent early morning before London or New York session open (timing configurable)
- **Indian market traders:** Sent before NSE/BSE market open at 9:15 AM IST
- **Weekends:** A "week preparation" message sent Sunday evening to review the upcoming week

---

**Q33. What behavioral patterns does the Morning Mentor detect?**

| Pattern | What Triggers It |
|---|---|
| Revenge trading | Losing trade followed by a larger position within 30–60 minutes |
| Overtrading | Significantly more trades than your average (40%+ above baseline) |
| No stop-loss | Two or more recent trades logged without a stop loss price |
| Emotional trading | Multiple FOMO/Fear/Revenge tags in recent trades |
| Low setup discipline | Discipline score dropped below threshold this week |
| Loss day reset | Yesterday ended with a significant loss |
| Positive reinforcement | Following rules consistently — streak of disciplined trades |
| Profitable week | Week ended positively — don't get overconfident |

---

**Q34. Can I turn off Morning Mentor notifications?**

Yes. Notification preferences can be managed from your device notification settings or within the app's profile/settings section. However, the Morning Mentor is consistently cited by users as the highest-value feature — most users who initially disable it re-enable it within a week.

---

**Q35. What other notifications does the app send?**

| Notification | When |
|---|---|
| Weekly Report Ready | Sunday after trading week ends |
| Revenge Trading Alert | Detected in real-time after a loss |
| Daily Loss Limit Warning | When drawdown threshold is reached |
| Overtrading Warning | During session when trade frequency spikes |
| No Stop-Loss Alert | After logging trades without stop loss |
| Setup Reminder | If you haven't used checklist in 3+ days |
| Discipline Signal | Positive — after consistent rule-following |

---

**Q36. Are the notifications personalized to my actual trades?**

Yes. Notifications are generated from analysis of your specific trade data — not generic templates. A revenge trading alert references how many trades you placed, after which loss, and by how much you oversized. This personalization is what makes them feel like coaching rather than spam.

---

### SECTION G — Trading Setups

---

**Q37. What is a "Trading Setup" in Edgecipline?**

A Trading Setup is a named, documented strategy with defined rules and reference images. It is the foundation of the discipline system. Examples:

- **London Breakout** — rules for trading the London session opening range
- **Nifty Opening Range** — rules for the first 15 minutes of NSE trading
- **EMA Pullback** — rules for taking pullbacks to the 50 EMA in trend

Once defined, a setup:
- Appears in the Pre-Trade Checklist for rule verification
- Tags trades logged under it
- Gets its own analytics (win rate, P&L, number of trades)
- Feeds into Weekly AI Reports

---

**Q38. How many setups can I create?**

You can create multiple setups based on your subscription tier. Pro users have no practical limit. For most traders, 2–5 well-defined setups is ideal — more than that and the checklist becomes unwieldy.

---

**Q39. Can I add reference images to my setups?**

Yes. Each setup supports up to 5 reference screenshots — examples of ideal trade entries for that setup. When you use the checklist, these images appear alongside the rules, letting you visually compare the current setup with your historical ideal examples. This is extremely useful for pattern recognition.

---

**Q40. What if I trade differently each day — can I still use setups?**

Yes. Setups don't restrict what you trade — they define the standard for each strategy. You can have multiple setups for different market conditions (trending, ranging, breakout) and select the appropriate one in the checklist. Trades without a setup tag are still logged — they just don't contribute to setup-specific analytics.

---

### SECTION H — Indian Market Specific

---

**Q41. Is Edgecipline built for Indian traders specifically?**

Yes. The Indian market module was built from the ground up for NSE/BSE traders, with features specific to the Indian trading context:

- Full F&O support (Futures, Options with strike/expiry)
- Intraday / Delivery / BTST trade types
- Segment tracking (Equity, F&O, Commodity, Currency)
- ₹ currency throughout analytics
- Morning Mentor timed to 9:15 AM IST
- AI extraction trained on Indian broker screenshots
- Lot-size aware P&L calculation

---

**Q42. I trade both Nifty options and Forex. Can I use Edgecipline for both?**

Yes. Edgecipline has a Market Switcher in the header that toggles between Forex and Indian Market modes. Both maintain completely separate journals, analytics, and setups. You can switch between them at any time. Your profile and subscription covers both markets.

---

**Q43. Does the app work with Zerodha? Upstox? Groww?**

Yes. The AI extraction feature is trained on screenshots from:
- **Zerodha Kite** — web and mobile
- **Upstox** — web and mobile
- **Groww** — web and mobile
- **Angel One** — web and mobile
- **IIFL Markets**
- **Dhan**
- **Fyers**

Manual entry works for any broker regardless of screenshot support.

---

**Q44. Can I track F&O Greeks (Delta, Theta, IV) in the app?**

Currently the app focuses on P&L, psychology, and discipline tracking rather than Greeks analysis. F&O-specific metrics like IV, Delta, and Theta tracking are planned for a future release in the Advanced Analytics module.

---

### SECTION I — Subscription & Pricing

---

**Q45. What is the difference between Free and Pro?**

| Feature | Free | Pro |
|---|---|---|
| Trade logging (manual) | ✓ Unlimited | ✓ Unlimited |
| Basic dashboard | ✓ | ✓ |
| AI screenshot extraction | — | ✓ |
| Full analytics (60+ metrics) | Limited (30 trades) | ✓ Unlimited |
| Psychology analytics | — | ✓ |
| Weekly AI reports | — | ✓ |
| Morning Mentor notifications | — | ✓ |
| Setup score tracking | — | ✓ |
| Pre-trade checklist | ✓ | ✓ |
| Indian market module | ✓ | ✓ |
| Priority support | — | ✓ Annual only |

---

**Q46. Is there a free trial of Pro features?**

Yes. New users get a trial period of Pro features when they first sign up, so they can experience the weekly report, morning mentor, and full analytics before deciding to subscribe. The trial period is shown in your profile.

---

**Q47. What happens to my data if I downgrade from Pro to Free?**

Your data is never deleted. All your trades, setups, and history remain intact. You lose access to Pro-gated features (AI extraction, full analytics, weekly reports, morning mentor) but your data is preserved and fully accessible again when you re-subscribe.

---

**Q48. Is annual subscription worth it over monthly?**

The Annual Pro plan offers significant savings over paying monthly (typically 30–40% discount). If you plan to use the app for more than 4–5 months, annual is the better value. Serious traders who integrate Edgecipline into their daily routine consistently renew annually.

---

**Q49. Can I get a refund if I'm not satisfied?**

Refund policy is available on the Terms of Service page. Generally, if you haven't used the Pro features significantly after subscribing, a refund can be requested within the policy window. Contact support for individual cases.

---

**Q50. Is there a plan for trading communities or prop firms?**

Community and business licensing is available. If you run a trading group, Discord server, or prop firm and want to give your members/traders access to Edgecipline, contact the team for group pricing and white-label options.

---

### SECTION J — Privacy & Data Security

---

**Q51. Is my trade data private? Who can see it?**

Your trade data is private to your account. No other user can see your trades, analytics, or reports. The only exception is if you explicitly opt-in to a future community leaderboard feature (which only shows discipline score, not individual trades). Edgecipline does not sell or share individual user trading data.

---

**Q52. What data does Edgecipline store about me?**

The app stores:
- Account info (name, email, auth method)
- Trade records you log (prices, P&L, tags, notes, screenshots)
- Analytics derived from your trades
- Notification history
- Setups and checklists you create
- Subscription status

It does not store: your actual brokerage account credentials, live positions, or direct broker data.

---

**Q53. Are my trade screenshots stored securely?**

Yes. All uploaded images are stored in Cloudinary — a secure, enterprise-grade cloud storage platform with encryption at rest and in transit. Screenshots are linked only to your account and are not accessible to other users.

---

**Q54. Can I export or download my trade data?**

Data export (CSV/Excel) is on the near-term roadmap. Currently your data lives within the app. This is a high-priority feature request and will be released in an upcoming version.

---

**Q55. Can I delete my account and all my data?**

Yes. You can request full account deletion including all associated data from the Profile page or by contacting support. Deletion is permanent and irreversible.

---

### SECTION K — Technical & App Usage

---

**Q56. The app is slow or not loading. What should I do?**

1. Check your internet connection
2. Force-close and reopen the app
3. Clear the app cache (Android: Settings → Apps → Edgecipline → Clear Cache)
4. Try on a different network (WiFi vs mobile data)
5. If the issue persists, report it via the Support page with your device model and Android version

---

**Q57. I'm not receiving Morning Mentor notifications. How do I fix it?**

1. Check that notifications are enabled for Edgecipline in Android Settings → Notifications
2. Check that battery optimization is NOT enabled for Edgecipline (battery optimization kills background processes)
3. Ensure you have a Pro subscription (Morning Mentor is a Pro feature)
4. Make sure you have logged at least a few trades — the mentor needs trade data to analyze
5. Check the Notifications page inside the app — messages appear there even if push delivery fails

---

**Q58. Can I use Edgecipline on multiple devices?**

Yes. Your account is cloud-based — log in on any device (Android phone, tablet, or web browser) and all your trades, analytics, and setups sync automatically. Notifications are delivered to whichever device is logged into the Android app.

---

**Q59. Does Edgecipline work offline?**

Basic browsing of cached data is possible offline, but logging trades and accessing analytics requires an internet connection as all data is cloud-stored. Offline trade logging with sync on reconnect is planned for a future release.

---

**Q60. I accidentally deleted a trade. Can I recover it?**

Currently, deleted trades cannot be recovered. There is no recycle bin or undo for trade deletion. Be careful when deleting — this is intentional to prevent users from selectively deleting losing trades to game their analytics. A confirmation prompt appears before any deletion.

---

### SECTION L — Product & Philosophy Questions

---

**Q61. Will using Edgecipline make me profitable?**

Edgecipline does not make trading decisions for you and does not guarantee profitability. What it does is give you accurate, honest data about your own behavior — and a coaching system that helps you improve it. Traders who consistently log trades, use the checklist, and act on weekly report insights typically see measurable improvement in discipline score and reduction in behavioral mistakes over 60–90 days. Profitability follows from discipline — but execution is always yours.

---

**Q62. How is this different from just using a spreadsheet?**

| | Spreadsheet | Edgecipline |
|---|---|---|
| Trade logging | Manual, tedious | Manual + AI extraction |
| Psychology tracking | Not possible | Built-in, structured |
| Analytics | Manual formulas | Auto-calculated, 60+ metrics |
| Psychology-P&L correlation | Impossible | Core feature |
| AI coaching | No | Morning mentor + weekly reports |
| Mobile access | Poor | Native Android app |
| Behavioral alerts | No | Real-time + daily |
| Equity curve | Manual chart | Auto-generated |
| Weekly reports | Write yourself | AI-generated coaching |

---

**Q63. I already have a trading strategy. Why do I need this app?**

Having a strategy and executing it consistently are completely different skills. Most traders with good strategies lose money not because their strategy is wrong, but because they don't follow it when it counts — when they're scared, greedy, or recovering from a loss.

Edgecipline's value is not in improving your strategy. It is in helping you follow the strategy you already have, identify when and why you deviate, and reduce the cost of those deviations over time.

---

**Q64. Does the app tell me when to buy or sell? Does it give trading signals?**

No. Edgecipline is not a signal service, a copy-trading platform, or a market analysis tool. It does not predict market movements or tell you what to trade. It is a behavioral coaching and analytics platform — it helps you understand and improve your own trading process. All trade decisions remain entirely yours.

---

**Q65. I'm a trading mentor/educator. Can my students use Edgecipline?**

Yes, and this is an ideal use case. Students can use Edgecipline to demonstrate their discipline to their mentor — sharing weekly reports, discipline scores, and setup adherence data. Group licensing for trading courses and communities is available. Contact the team for educator partnerships and custom pricing.

---

**Q66. How is the AI coaching generated? Is it actually intelligent or just templates?**

The weekly reports and morning mentor messages are generated using large language model AI (similar to ChatGPT/Claude) that receives your actual trade data as input — not templates with fill-in-the-blank values. The AI reads your trades, identifies behavioral patterns, calculates impact, and writes a coaching response personalized to your specific situation.

The result is a message that references your actual numbers, your specific mistakes, and your actual patterns — not generic advice. As your trade history grows, the AI has more context to work with, and the coaching becomes more precise.

---

**Q67. What happens if I have a really bad trading week — will the app make me feel worse?**

No. The coaching philosophy of Edgecipline is rooted in **data, not judgment**. A bad week is presented as patterns and numbers — not shame or failure. The weekly report always includes positive reinforcement alongside improvement areas. The morning mentor after a loss is supportive in tone — focused on reset and preparation, not criticism.

The goal is always the same: understand what happened, adjust, and trade better tomorrow. The app does not celebrate losses — but it also does not punish them. It simply shows you the truth and gives you tools to respond to it.

---

**Q68. Is Edgecipline suitable for prop firm traders?**

Yes — and prop firm traders are one of the most motivated user segments. For prop firm traders:
- **Max drawdown tracking** is critical — Edgecipline shows this prominently
- **Pre-trade checklist** prevents rule violations that can fail evaluations
- **No stop-loss alerts** immediately flag missing risk management
- **Discipline score** provides auditable proof of rule adherence
- **Morning mentor** prevents tilt/revenge trading that typically ends evaluations

Many prop firm failures happen in a single session of emotional trading. The morning mentor and real-time behavioral alerts are designed exactly for this scenario.

---

**Q69. Can Edgecipline help with trading psychology specifically?**

Yes — this is the core of what makes Edgecipline unique. The psychology layer includes:

- **Mood tracking** (1–5 scale per trade) correlated to P&L
- **Emotional tags** (FOMO, Revenge, Fear, Greed, etc.) with impact analysis
- **Confidence level tracking** with outcome correlation
- **Revenge trading detection** and alerts
- **Overtrading behavioral flags**
- **Tilt pattern detection** (escalating position size after losses)
- **Weekly psychology trend** in AI reports
- **Would-you-retake analysis** for instinct calibration

No other trading journal tracks psychology at this depth or connects it directly to financial outcomes.

---

**Q70. What is your long-term vision for Edgecipline?**

The long-term vision is to become **the standard accountability and development platform for serious retail traders globally** — the same way Strava became the standard for runners and cyclists. A platform where traders track not just their P&L, but their behavioral growth, their discipline evolution, and their journey from emotional to systematic trading.

Over time, Edgecipline will expand to include broker integrations (auto-import), live market alerts, AI backtesting, a trader community, and eventually an AI coach you can actually have a conversation with — one that knows your entire trading history and coaches you like a human mentor would.

The mission never changes: help every trader close the gap between knowing what to do and actually doing it.

---

*Documentation prepared for Edgecipline / Stratedge · May 2026*  
*Version 1.0 — Product & Strategy Document*

---
