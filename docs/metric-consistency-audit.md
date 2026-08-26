# Metric Consistency Audit

## Source Of Truth

Canonical metric definitions live in `backend/utils/metricEngine.js`.

Frontend local list summaries use `frontend/utils/metricEngine.js` only for display of already-fetched trade lists. Server analytics, reports, DNA, timeline, and coach inputs must use backend metric outputs.

## Central Definitions

| Metric | Official Definition | Engine Function |
| --- | --- | --- |
| Trade Count | Count of active trade rows supplied by repository/query layer | `calculatePerformanceMetrics` |
| Win / Loss / Breakeven | `profit > 0`, `profit < 0`, `profit === 0` | `calculatePerformanceMetrics` |
| Win Rate | `wins / totalTrades * 100`, rounded to 1 decimal | `percent`, `calculatePerformanceMetrics` |
| Gross P&L | Sum of `trade.profit` | `getGrossPnL`, `calculatePerformanceMetrics` |
| Costs | Forex: `commission + swap`; Indian: `brokerage + sttTaxes` | `getTradeCosts` |
| Net P&L | `gross P&L - costs` | `getNetPnL`, `calculatePerformanceMetrics` |
| Average Win | Sum winning gross P&L / wins | `calculatePerformanceMetrics` |
| Average Loss | Absolute sum losing gross P&L / losses | `calculatePerformanceMetrics` |
| Profit Factor | Sum winning gross P&L / absolute sum losing gross P&L | `calculatePerformanceMetrics` |
| Expectancy | Net P&L / total trades | `calculatePerformanceMetrics` |
| Setup Score | Followed labelled setup rules / labelled setup rules | `calculateSetupScore` |
| Discipline Score | Average of setup score and rule compliance when both exist | `calculateDisciplineScore` |
| Psychology Score | 50 + healthy P&L lift - unhealthy P&L drag | `calculatePsychologyScore` |
| Bucket Stats | Count/wins/losses/win rate/net/avg for grouped P&L arrays | `calculateBucketStats` |
| Max Win / Loss Streak | Longest consecutive run of `profit > 0` / `profit < 0`, trades ordered chronologically | `calculateStreaks` |
| Average Setup Score | Mean `trade.setupScore` over trades that carry one; `null` when none do | `calculatePerformanceMetrics`, `aggregatePerformance` |

### P&L Cost Convention

What `trade.profit` holds depends on the market, because the two write paths differ.
`metricEngine.storedProfitIsNet()` is the single switch; `aggregatePerformance` mirrors it.

| Market | `trade.profit` is | Gross P&L | Net P&L |
| --- | --- | --- | --- |
| Forex | already NET of `commission`/`swap` (applied by `deriveForexProfit` at save time) | `profit + costs` (estimate) | `profit` |
| Indian | GROSS of `brokerage`/`sttTaxes` | `profit` | `profit - costs` |

The asymmetry is not cosmetic. The Indian add-trade form makes "Profit / Loss" a
required field and posts it straight through, so `deriveIndianProfit` never runs on
create and costs are never applied at save time -- they must come off in the metric
engine. The Forex path derives profit server-side with costs already applied, so
deducting them again there would double-count.

Every other metric -- win/loss classification, average win, average loss, profit
factor, best/worst trade, volume -- is defined on the **stored** `profit` in both
markets. Only gross P&L, net P&L, average P&L and expectancy are cost-sensitive.

## Metric Inventory

| Area | Metrics | Source After Refactor |
| --- | --- | --- |
| Dashboard | total trades, win rate, net P&L, psychology/DNA summaries | Analytics snapshot / metric engine |
| Analytics Snapshot | performance, psychology, self-awareness, DNA, patterns, timeline, discipline | Metric engine + specialized engines |
| Weekly Reports | counts, P&L, win rate, avg win/loss, profit factor, psychology score | Metric engine |
| Trading DNA | bucket count/win rate/net/avg P&L by session, instrument, mood, confidence, setup | Metric engine bucket stats |
| Psychology Timeline | bucket psychology score, discipline score, P&L, win rate | Metric engine |
| Discipline Analytics | rule compliance, rule P&L, setup performance | Specialized discipline engine; should consume metric engine for future deeper rule stats |
| AI Coach | Consumes psychology cost, DNA, patterns, self-awareness, total trades | Upstream metric-engine-backed snapshots |
| Frontend Journals | local list total, win rate, P&L | Frontend metric display helper |

## Duplicate Analysis

High-risk duplicates found:

- Win rate was calculated in analytics snapshot, weekly reports, timeline buckets, Trading DNA buckets, and frontend journals.
- P&L and average win/loss were calculated independently in analytics snapshot and weekly reports.
- Psychology score was independently calculated in timeline and weekly reports.
- Discipline score was independently calculated in timeline.
- Setup score was calculated in multiple trade save forms.

Refactor completed:

- Analytics snapshot in-memory performance now delegates to `calculatePerformanceMetrics`.
- Analytics aggregate normalization and combined market merge now use `finalizePerformance` / `mergePerformanceMetrics`.
- Weekly report snapshot uses `calculatePerformanceMetrics` and `calculatePsychologyScore`.
- Trading DNA bucket stats use `calculateBucketStats`.
- Psychology timeline uses `calculatePsychologyScore`, `calculateDisciplineScore`, and `calculatePerformanceMetrics`.
- Forex and Indian journal local summaries use frontend metric helper.

Remaining bounded duplication:

- Mongo aggregation pipelines still compute sums/counts in the database for performance, but JS finalization is centralized.
- Trade form setup-score calculation still exists client-side before save; backend analytics treats saved `setupScore` as data and `calculateSetupScore` is the official formula for new shared server code.

## Verification

Automated tests added:

- `backend/__tests__/unit/metricEngine.test.js`
- `backend/__tests__/unit/metricConsistency.test.js`

Coverage includes:

- 0, 1, 5, 100, 1000 trade datasets
- Forex and Indian market cost rules
- merged mixed-market metrics
- win rate, P&L, avg win/loss, profit factor, expectancy
- psychology score
- discipline score
- analytics snapshot vs weekly report vs timeline vs DNA consistency

## Refactor Rule

New metric work must use `metricEngine` first. If a metric cannot be expressed there, add the definition to the engine or document why it is domain-specific before adding local math.
