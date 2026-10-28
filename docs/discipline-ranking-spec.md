# Discipline Ranking — Specification

**Status:** proposal, nothing implemented
**Last updated:** 2026-10-08

---

## 1. What this is

A competitive ranking that scores traders on **how well they followed their own process**, not on how much money they made.

Every day a trader logs their journal, uses the checklist before entering, sticks to their setup rules, writes a reflection, or finishes a mission, they earn points. Those points place them in a division against about thirty other traders at the same level. At the end of each month the top few move up and the bottom few move down.

The whole thing runs on data Edgecipline already collects. No new tracking is required.

## 2. What we deliberately do not rank

**Profit and loss.** The moment money appears on a public board, people chase the number. A reckless trader who got lucky would top the board and the product would be endorsing them. P&L never appears on any leaderboard surface.

**Time spent in the app.** Rewarding screen time encourages overtrading and screen addiction, which is the behaviour the product exists to cure.

**Trade volume.** See the daily cap in section 4. Taking more trades must never be a way to climb.

## 3. The two concepts

There is exactly one score and one placement. Keeping it to one score is deliberate; two competing numbers confuse users and implementers alike.

| Concept | Resets | Drives |
|---|---|---|
| **Season points** | First of each month, 00:00 UTC | Position inside your division |
| **Division** | Never resets, moves by promotion and relegation | Which group of ~30 you compete in |

Points reset monthly so a new user can win their first month. The division is sticky, so a good month is not thrown away and a bad month does not erase a year of work.

### Division ladder

```
  Elite          ▲ top 5 of each group promoted at season end
  Sharp          ▲▼
  Disciplined    ▲▼        everyone starts here
  Steady         ▲▼
  Tilted         ▼ bottom 5 of each group relegated
```

New users start in **Disciplined**, the middle. Starting at the bottom feels like a punishment for joining; starting at the top makes the first demotion feel like a loss.

## 4. Scoring

Points are awarded per **day**, in the user's own timezone.

| What they did | Points | Source of truth |
|---|---|---|
| Logged the day, including an honest "no trade today" | 2 | `DailyDisciplineEntry.tradeCount > 0` or `noTradeToday` |
| Used the checklist before entering | 2 | `DailyDisciplineEntry.checklistUsed` |
| Followed their setup rules | 3 | `DailyDisciplineEntry.ruleHit` |
| Wrote the daily reflection | 2 | a `DailyReflection` exists for that day |
| Completed a mission | 5 | `MissionAssignment` completed that day |

**Daily cap: 10 points.** A day cannot be worth more than 10 no matter how many trades, missions or markets it contains. This is the single most important rule in the document. Without it, the optimal strategy is to trade more, and the product would be rewarding exactly what it is meant to prevent.

### Why abstaining cannot game the board

A trader who marks "no trade today" every single day earns 2 points, plus 2 if they reflect, so 4 at best. A trader who actually traded with discipline earns 2 + 2 + 3 + 2 = 9. The active disciplined trader out-scores the permanent abstainer by more than two to one, without any special rule.

The honest "no trade" day still pays, because sitting out when there is no setup is real discipline and the product should pay for it. It simply does not pay as much as trading well.

### Eligibility floor

To appear on a leaderboard at all, a user must have **at least 5 logged trades in the current season**. This stops a pure-abstainer account from occupying a board position it has not earned, and it stops empty accounts from padding groups. Users below the floor still see their own points and division; they are just not listed.

## 5. Data model

Three additions. Everything else is read from existing collections.

### `SeasonScore` — one document per user per season

```js
{
  user:         ObjectId,
  seasonKey:    String,   // '2026-10', UTC calendar month
  division:     String,   // tilted | steady | disciplined | sharp | elite
  groupId:      String,   // '2026-10:disciplined:003'
  points:       Number,   // season total, recomputed, never incremented
  daysScored:   Number,   // how many days contributed
  tradesLogged: Number,   // drives the eligibility floor
  lastScoredDay: String,  // 'YYYY-MM-DD' in the user's timezone
  optedIn:      Boolean,  // false means scored privately, never listed
}
```

Indexes:

```js
{ user: 1, seasonKey: 1 }            // unique
{ groupId: 1, points: -1, user: 1 }  // the leaderboard read, already ordered
{ seasonKey: 1, division: 1 }        // season rollover sweep
```

### `SeasonDay` — the audit trail, one document per user per day

```js
{
  user:      ObjectId,
  seasonKey: String,
  day:       String,   // 'YYYY-MM-DD' in the user's timezone
  points:    Number,   // after the daily cap
  breakdown: {
    logged: Number, checklist: Number, rules: Number,
    reflection: Number, missions: Number, capped: Boolean,
  },
}
```

Unique on `{ user: 1, day: 1 }`. This is what makes the nightly job idempotent, and what lets support answer "why did I only get 6 points on Tuesday".

### Fields added to `Users`

```js
ranking: {
  displayHandle: String,   // shown on boards instead of a real name
  optedIn:       Boolean,  // default false
  division:      String,   // denormalised for cheap dashboard reads
  lastSeasonKey: String,
  lastResult:    String,   // promoted | held | relegated
}
```

This mirrors how `Users.streaks` already denormalises `DailyDisciplineEntry`. The denormalised copy can always be rebuilt from `SeasonDay`.

## 6. How points are actually awarded

**Scheduled recompute, not live increments.**

This matches the existing streak design, where `DailyDisciplineEntry` is the source of truth and `Users.streaks` is a rebuildable cache. Live increments would drift the moment a trade is edited, deleted or backdated, and there would be no way to prove a score was right.

### `disciplineRankingCron`

Follows the conventions already used in `backend/jobs/`: `node-cron`, `withCronLock`, `runCronWithMetrics`, and a concurrency value from `appConfig.cron`.

```
Schedule:    hourly, on the hour
Lock:        'discipline-ranking', TTL 2h, keyed by the hour
Concurrency: appConfig.cron.disciplineRankingConcurrency || appConfig.cron.concurrency
```

Hourly rather than once at midnight, because users are in different timezones and each user's day closes at their own midnight.

For each user whose local day has just closed:

1. Resolve the day key with `streakService.dayKeyInTz`, reusing the timezone logic the streaks already use.
2. Read every `DailyDisciplineEntry` for that user and that day, **across all markets**.
3. Collapse those entries into one day. See the multi-market edge case.
4. Add reflection and mission points for the same day.
5. Apply the 10-point daily cap.
6. Upsert `SeasonDay`. If a document already exists for that day, overwrite it.
7. Recompute `SeasonScore.points` as the sum of that season's `SeasonDay` rows.

Because step 6 is an upsert keyed by `{ user, day }` and step 7 is a sum rather than an increment, running the job twice for the same day produces exactly the same result.

### `seasonRolloverCron`

```
Schedule: 00:10 UTC on the first of each month
Lock:     'season-rollover', TTL 6h, keyed by the season
```

1. Freeze the finished season: mark every `SeasonScore` read-only.
2. For each group, order by points descending, then `daysScored` descending, then earlier `updatedAt`.
3. Promote the top 5, relegate the bottom 5, hold the rest.
4. Write `Users.ranking.division` and `lastResult`.
5. Create the new season's `SeasonScore` rows and assign groups.
6. Queue a push to everyone whose division changed.

### Group assignment

Within a division, sort eligible users and deal them into groups of 30. Fill a group to at least 10 before opening another; a group of 3 is not a competition. If a division has fewer than 10 eligible users in total, run it as one group of whatever size it has.

## 7. API

```
GET   /api/ranking/me
      → { division, points, groupPosition, groupSize, seasonEndsAt,
          eligible, pointsToPromotion, breakdownLast7Days }

GET   /api/ranking/leaderboard
      → { groupId, division, seasonEndsAt,
          rows: [{ rank, handle, points, isYou }], yourRank }

GET   /api/ranking/history
      → [{ seasonKey, division, points, finalRank, result }]

PATCH /api/ranking/settings
      body { optedIn?: boolean, displayHandle?: string }
```

The leaderboard returns at most 30 rows, because a group is 30 people. There is no pagination and no global list of every user.

## 8. Screens

### Dashboard card

The primary surface. Always visible, even when opted out of the board.

```
┌──────────────────────────────────────────┐
│  DISCIPLINED            season ends 23d  │
│                                          │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░        142 pts     │
│                                          │
│  4th of 30        18 pts to promotion    │
└──────────────────────────────────────────┘
```

### Leaderboard screen

Thirty rows, the user's own row pinned and highlighted. Promotion and relegation zones shaded so the stakes are visible at a glance.

```
  ▲ PROMOTION
  1   ironhand        201
  2   calm_entry      187
  3   nina_fx         150
▶ 4   you             142
  5   patient_pip     139
  ...
  ▼ RELEGATION
  26  driftwood        24
```

Never show P&L, win rate, account size or real names on this screen.

### Settings

One toggle, "Show me on the leaderboard", default off, plus a display handle field. Opting out keeps scoring and the dashboard card; it only removes the user from other people's lists.

### Notifications

Send at most these, and respect the existing quiet hours:

- Division changed at season end, promoted or relegated.
- Three days left in the season and the user is in the promotion zone.
- Three days left and the user is in the relegation zone.

Do not send daily point updates. That is noise, and it pulls people to the app when the market gives them no reason to be there.

## 9. Edge cases

**Multiple markets on one day.** `DailyDisciplineEntry` is unique on `{ user, day, market }`, so a trader active in both Forex and the Indian market has two entries for the same day. Collapse them before scoring: the day counts as logged once, checklist is true if true in either, and `ruleHit` is true only if true in **every** market entry that had trades. Otherwise trading both markets would double the points, and the daily cap would be the only thing holding it back.

**Timezones.** Use `streakService.dayKeyInTz` with the user's configured timezone, the same one the streaks use. Never use server time. A trader in Mumbai and one in London must both get credit for their own Tuesday.

**Daylight saving.** Day keys are strings, not timestamps, so a 23-hour or 25-hour day is still one day key and scores once.

**Season boundary mid-day.** Seasons turn at 00:00 UTC, but days close at local midnight. A day belongs to the season containing its **local day key**, decided when the day closes. A day is never split across two seasons.

**Joining mid-season.** The user is scored from their first day, and becomes eligible once they reach 5 logged trades. Joining late means fewer days to earn points, which is accepted: the season is only a month and the ladder is sticky, so the cost is one slightly weaker month.

**Backdated or edited trades.** Editing a trade changes `DailyDisciplineEntry`, which changes that day's score. The scheduled job only rewrites the day that just closed, so add a rescore trigger: when a trade is created, edited or deleted with an `effectiveTradeDate` inside the current season, mark that day dirty and let the next hourly run recompute it. Days in a **closed** season are never rescored; the result is final.

**Deleted trades.** Same path. If a deletion drops a day below a threshold, that day's points go down. This is correct, and because the season total is a sum rather than a counter, it cannot drift or go negative.

**A missed cron run.** The job recomputes every day since `lastScoredDay` that is now closed, not just yesterday. An outage self-heals on the next run.

**The cron runs twice.** `SeasonDay` is upserted by `{ user, day }` and the season total is a sum, so a double run is a no-op.

**Free versus premium users.** Missions may be plan-gated. If they are, premium users can earn 5 points a day that free users cannot, which makes the board a paywall rather than a discipline contest. Pick one before launch: cap mission points at 3 so they cannot swing a division, or exclude mission points from the ranked score entirely and keep them as a personal stat. The recommendation is to exclude them, so the board stays strictly on behaviour every user can perform.

**Ties.** Break on `daysScored` descending, which favours consistency, then on the earlier `updatedAt`, which favours whoever got there first. Never break ties randomly; users notice.

**Too few users.** If a division has under 10 eligible users, run one group and suspend relegation out of the bottom division. Relegating someone out of a five-person group is meaningless.

**Groups that empty out.** If a group falls below 5 active users mid-season, leave it alone until the season ends, then merge at rollover. Reshuffling mid-season destroys trust in the standings.

**Inactive users.** A user who does nothing scores zero, drifts to the bottom of their group, and is relegated at season end. No special handling, and they are never punished below the bottom division.

**Account deletion.** Delete `SeasonScore` and `SeasonDay` with the account. Leaderboards read live, so the row disappears and the remaining ranks renumber on the next read.

**Opting out mid-season.** Scoring continues, the row leaves other people's boards immediately, and promotion and relegation still apply, so the ladder position stays honest if the user opts back in.

**Offensive display handles.** Validate on write: 3 to 16 characters, letters, digits and underscore only, uniqueness enforced, and run the existing profanity filter if one exists. Fall back to an auto-generated handle such as `trader_8f21`.

**Gaming by logging fake trades.** The daily cap means fake trades buy at most 10 points, the same as one honest day, so the effort is not worth it. Watch for accounts with a high trade count and almost no variance in daily points as a signal, but do not build enforcement in phase 1.

**Streak grace recovery.** The existing 24-hour grace that protects a streak does **not** award ranking points. A day with no activity is worth zero even if the streak survives. Streaks and rank answer different questions and should not borrow each other's mechanics.

## 10. Rollout

| Phase | Scope |
|---|---|
| 1 | Scoring, `SeasonDay`, `SeasonScore`, the hourly job, the dashboard card. No leaderboard, no social surface. |
| 2 | Divisions, groups, the season rollover job, the leaderboard screen, opt-in and handles. |
| 3 | Promotion and relegation notifications, season history, an end-of-season recap in the weekly report. |

Phase 1 is shippable alone and worth shipping alone. It answers "am I more disciplined this month than last" with no social risk, and it lets the scoring run against real users for a month before anyone can see anyone else.

## 11. Decisions still open

1. Do mission points count toward the ranked score? The recommendation is no, on fairness grounds, if missions stay plan-gated.
2. Is the eligibility floor 5 trades per season, or should it scale with how long the user has been active?
3. Should the bottom division be called "Tilted"? It is honest and on-brand, but it is also the one name a user sees when they are already struggling.
4. Monthly seasons, or two-week seasons? Shorter seasons mean faster feedback and more pushes, but also more churn in the standings.
