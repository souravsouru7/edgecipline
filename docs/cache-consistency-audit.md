# Cache Consistency Audit

## Version Strategy

All user trade mutations and setup-rule replacements advance
`trade_version:{userId}` through `invalidateTradeCaches`. Trade-dependent Redis
keys include that version, so old values become unreachable and expire by TTL.

Example keys:

- `dashboard:{userId}:version={n}:forex_summary:/analytics/summary:{query}`
- `analytics:forex:{userId}:version={n}:trading_dna:/analytics/trading-dna:{query}`
- `analytics_snapshot:{userId}:Forex:all:weekly:v{n}`
- `analytics_aggregate:performance:{userId}:Forex:all:v{n}`
- `trades:{userId}:version={n}:list:period=all&page=1&limit=50`

## Dependency Map

| Cache | Source | Depends on | TTL | Invalidated by | Consumers |
| --- | --- | --- | --- | --- | --- |
| Trade list/detail/status | `Trade`, `IndianTrade` | User trade rows, soft-delete state | 10-45s | `trade_version` increment | Journals, edit/view, OCR status |
| Dashboard summary | Analytics controllers | Active user trades | 45s | `trade_version` increment + React Query fan-out | Dashboard, AI surface summaries |
| Analytics snapshot | `analyticsSnapshotService` | Active trades, psychology fields, setup rules | 120s | `trade_version` increment | Analytics, weekly reports |
| Analytics aggregates | Mongo aggregation | Active trades, market/instrument/date filters | 120s | `trade_version` increment | Performance, timeline, discipline, distributions |
| Trading DNA | Analytics controllers/snapshot utils | Trades, self-awareness, psychology | 120s | `trade_version` increment | Dashboard, Trading DNA page, AI Coach |
| Pattern detection | Pattern controller/utils | Trades, setup, emotions, session | 120s | `trade_version` increment | Analytics, AI Coach |
| Psychology cost/self-awareness | Analytics controllers/utils | Review fields, mood, tags, P&L | 90s | `trade_version` increment | Dashboard, analytics, weekly reports |
| Psychology timeline | Timeline controller/utils | Trades, mood, confidence, quality | 120s | `trade_version` increment | Timeline page, analytics snapshot |
| Discipline | Discipline controller/utils | Setup rules, setup score, entry basis | 120s | `trade_version` increment | Discipline page, analytics |
| Setup definitions | `SetupStrategy` | User setup names, rules, reference images | Browser query cache | `setup_edit` version increment + setup query invalidation | Setup editors, trade forms, discipline |
| Weekly report snapshot | `weeklyReport.service` | Latest analytics snapshot with `includeTrades` | Persisted report | New generation consumes current version | Weekly reports, AI feedback |
| OCR status bridge | Redis `trade_status_bridge` | Temporary OCR multi-trade payload | 24h | TTL only | Upload polling |
| React Query trade-dependent keys | Browser memory | API responses above | `staleTime: 0` for defaults/dashboard/analytics | `invalidateTradeDependentQueries` | All frontend pages |
| Auth/user/rate-limit/notification caches | Redis/browser | Auth/session/user notification state | Independent | Not trade-versioned | Auth/profile/notifications |

## Stale Cache Analysis

- Fixed: manual trade create/edit/delete/restore now call central invalidation with event metadata.
- Fixed: OCR save/import/reject/fail paths now call central invalidation.
- Fixed: frontend trade mutations now invalidate dashboard, analytics, DNA, timeline, discipline, patterns, AI Coach, reports, and trade queries together.
- Fixed: setup saves await the server version advance, then invalidate setup and all trade-dependent browser queries.
- Fixed: trade-dependent React Query hooks share `staleTime: 0` and refetch on focus/reconnect.
- Existing safe behavior: Redis outages bypass cache reads/writes and return version `0`; DB remains source of truth.
- Manual cache clearing remains only in maintenance scripts (`clearCache.js`, `prepare-load-test.js`) and is not part of request handling.

## Invalidation Rules

All trade lifecycle and setup-rule mutation events must call:

```js
invalidateTradeCaches({ userId, event, market, tradeId, count, source })
```

Covered events:

- `create`
- `edit`
- `delete`
- `restore`
- `ocr_save`
- `import`
- `bulk_import`
- `bulk_delete`
- `setup_edit`

No request path should use wildcard deletes, Redis scans, or mass purges for trade-derived data.

## Verification

- `cacheInvalidation.test.js` covers version reads, version advancement, legacy delegation, and Redis-unavailable behavior.
- `setupCacheInvalidation.test.js` verifies setup replacement commits before the `setup_edit` version advance.
- Batch trade tests verify one version advance per successful batch and no advance on rejected batches.
