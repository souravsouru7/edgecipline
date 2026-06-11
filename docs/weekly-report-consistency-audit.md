# Weekly Report Consistency Audit

## Executive Summary

Weekly reports now act as a presentation layer over the analytics snapshot. Core report metrics no longer run an independent weekly formula path at runtime; they map the shared analytics snapshot and canonical metric engine output into the report payload consumed by storage, UI, and AI feedback.

## Dependency Map

| Report Field | Source of Truth | Dependencies | Consumers |
| --- | --- | --- | --- |
| Trade count, wins, losses, break-even | `analyticsSnapshotService.performance` | `metricEngine.calculatePerformanceMetrics` | Weekly report UI, AI feedback prompt, report history |
| Gross PnL, net PnL, average win/loss, profit factor | `analyticsSnapshotService.performance` | `metricEngine.calculatePerformanceMetrics` | Weekly report UI, AI feedback prompt |
| Trading costs | `metricEngine.calculateCostBreakdown` | Trade costs by market type | Weekly report validation, AI prompt |
| Discipline summary | `analyticsSnapshotService.disciplineSummary` | Discipline analytics + metric engine | Weekly report UI, AI feedback prompt |
| Psychology score | `metricEngine.calculatePsychologyScore` | Weekly trades | Weekly psychology summary, AI prompt |
| Psychology cost | `analyticsSnapshotService.psychologyCost` | Psychology cost service | Weekly report UI, AI feedback prompt |
| Trading DNA | `analyticsSnapshotService.tradingDNA` | Trading DNA utility + shared metric helpers | Weekly report UI, AI feedback prompt |
| Pattern detection | `analyticsSnapshotService.patterns` | Pattern detection utility | Weekly report UI, AI feedback prompt |
| Self awareness | `analyticsSnapshotService.selfAwareness` | Trade evaluation utility | Weekly report UI, AI feedback prompt |
| Timeline | `analyticsSnapshotService.timeline` | Psychology timeline utility + metric engine | Weekly report UI, AI feedback prompt |

## Stale And Duplicate Metric Analysis

Previous risk:

- `weeklyReport.service.js` calculated performance, costs, discipline, quality, DNA, pattern, and psychology-adjacent values locally.
- A report could disagree with analytics when formulas changed in one place but not the weekly service.
- The manual weekly generation guard queried recent reports without selecting `aiFeedback`, so throttle behavior could drift from intent.
- Stored reports had no reliable trade-version check before blocking regeneration.

Current behavior:

- `computeSnapshot` maps `analyticsSnapshotService.getSnapshot` or `generateSnapshotFromTrades` output into the weekly report payload.
- Weekly report payload records `source.metricSource = "analytics_snapshot"` plus analytics cache metadata.
- Manual regeneration is blocked only when the recent report already has psychology AI feedback for the same `trade_version`.
- If trades changed, the version differs and report regeneration is allowed.

## Invalidation And Storage Rules

- Trade lifecycle events increment `trade_version:{userId}` through the central cache invalidation service.
- Analytics snapshots are versioned by `trade_version`.
- Weekly report snapshots include analytics snapshot cache metadata, including version when available.
- Existing weekly reports are historical records; regeneration uses the latest analytics snapshot and replaces the same rolling 7-day storage key for the current window.
- No wildcard Redis deletion or Redis scan is required for weekly report consistency.

## Date Window Strategy

Weekly reports use the rolling 7-day UTC range ending at the current day boundary, with local labels derived from `appConfig.timezoneOffsetHours`. Storage keys normalize `weekStart` and `weekEnd` to day-level UTC dates so repeated same-day generation updates the same rolling report document.

## Verification

Automated checks run:

- `node --check backend\services\weeklyReport.service.js`
- `node --check backend\repositories\weeklyReport.repository.js`
- `npm test -- --runTestsByPath __tests__\unit\metricEngine.test.js __tests__\unit\metricConsistency.test.js __tests__\unit\analyticsSnapshotService.test.js`
- `npm test -- --runTestsByPath __tests__\unit\metricConsistency.test.js`

Results:

- 3 suites passed, 20 tests passed.
- Weekly-specific consistency regression passed: weekly reports follow analytics snapshot values even when the raw trade array would produce different values.

## Residual Risk

The legacy local weekly formula body remains physically present but is unreachable after the analytics-snapshot return. It should be removed in a cleanup-only pass once no downstream compatibility concerns remain.
