# MongoDB performance optimization

## What changed

- Trade feeds now sort and paginate on persisted `effectiveTradeDate` instead
  of computing `$ifNull(tradeDate, createdAt)` inside every query.
- Matching compound indexes support user-scoped date filtering and stable
  `(effectiveTradeDate, _id)` ordering.
- Analytics retains at most the newest 10,000 matching trades and reuses its
  in-memory performance and timeline results. The snapshot route now starts
  five database operations instead of seven.
- Admin trade and extraction-log lists use the built-in `_id` index. Lower
  volume admin collections have targeted `createdAt` indexes.
- The index manifest now uses real schema fields for weekly reports,
  notifications, checklist tracking, and refresh tokens.
- Index audit is read-only by default. Destructive index removal requires the
  explicit `--drop-obsolete` flag.

## Production rollout

Run this against staging first. Stop if the dry-run counts are unexpected.
The application does not run migrations automatically.

```powershell
cd backend

# 1. Count legacy documents only; no writes.
npm run indexes:backfill-effective-date

# 2. Backfill legacy Trade and IndianTrade documents in bounded batches.
npm run indexes:backfill-effective-date -- --apply

# 3. Create the corrected indexes. This does not remove existing indexes.
npm run indexes:optimize

# 4. Audit index differences and explain queries for a real test user.
npm run indexes:audit -- --user-id=<existing-user-object-id>
```

Deploy/restart the application only after steps 2 and 3 complete. New writes
populate `effectiveTradeDate` automatically.

## Validation

The explain output for the trade feed should use an `IXSCAN` and should not
contain a blocking `SORT` stage. Compare `totalDocsExamined`,
`totalKeysExamined`, and `executionTimeMillis` before and after rollout.

Do not run `--drop-obsolete` until production `$indexStats` confirms an index
is unused across a representative traffic window.
