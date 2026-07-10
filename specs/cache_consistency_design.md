# Feature: End-to-End Trade Cache Consistency

## Requirements (EARS Format)

- While an authenticated user has trade-derived data cached, when a trade is
  created, edited, deleted, restored, imported, or confirmed from OCR, the
  system shall advance that user's trade cache version before returning the
  successful mutation response.
- While an authenticated user has analytics cached in the browser, when a
  trade mutation succeeds, the system shall invalidate every trade-dependent
  React Query key.
- While trade-derived data may have changed in another session, when the
  browser regains focus or reconnects, the system shall refetch active
  trade-dependent queries.
- While analytics depend on setup names and rules, when setups are replaced,
  the system shall advance the server cache version and invalidate setup,
  dashboard, analytics, discipline, timeline, pattern, coaching, report, and
  trade queries before reporting the save as synchronized.
- While Redis is unavailable, when a read or mutation occurs, the database
  shall remain the source of truth and cache failures shall not expose data
  from another user.

## Acceptance Criteria

- All trade-derived Redis keys contain the authenticated user's cache version.
- Setup replacement awaits cache-version advancement after its database
  transaction commits.
- Trade-dependent React Query hooks use `staleTime: 0` and refetch on focus and
  reconnect.
- Setup saves invalidate both `setups` and all trade-derived query families.
- Cache invalidation remains user-scoped; no request path performs Redis
  wildcard scans or mass deletion.
- Unit tests cover version advancement, Redis-unavailable behavior, and setup
  replacement invalidation.
- Focused backend tests and frontend lint pass.

## Architecture

### Frontend

- Keep query-family definitions and freshness options in
  `frontend/utils/queryInvalidation.js`.
- Apply the shared freshness policy to trades, dashboard, analytics, Trading
  DNA, psychology timeline, and both discipline views.
- After either setup editor saves successfully, invalidate setup and
  trade-derived query families through the shared helper.
- Existing loading and error states remain unchanged.

### Backend

- Continue using `trade_version:{userId}` as the user-scoped generation token.
- Add a distinct `setup_edit` invalidation event for auditability.
- Await version advancement in `setup.service.js` after the atomic setup
  replacement succeeds.
- Redis failures remain non-fatal to the committed database write.

### Security Checkpoint

- Authentication: existing trade, analytics, and setup routes remain protected.
- Authorization: cache versions and setup writes derive `userId` from the
  authenticated server context; no client-provided owner ID is accepted.
- Input validation: no new request fields are introduced; existing market and
  setup payload validation remains server-side.
- Output safety: no response shape or rendered user content is added.
- Injection/XSS: no SQL/raw query construction or HTML rendering is introduced.
- Sensitive data: invalidation logs contain scoped identifiers and event
  metadata only; tokens, credentials, and trade payloads are excluded.
- Rate limiting: no new endpoint is added; existing route policy remains in
  force.

## Implementation Plan

- [x] Trace server and browser cache dependencies.
- [x] Centralize the trade-derived browser freshness policy.
- [x] Make setup replacement invalidation ordered and auditable.
- [x] Wire both setup editors to browser cache invalidation.
- [x] Add focused backend tests.
- [x] Repair and update the cache consistency audit.
- [x] Run focused tests and frontend lint.

## Verification Results

- Backend cache, setup, batch-create, and analytics snapshot tests: 25 passed.
- Focused frontend ESLint: 0 errors; 3 pre-existing warnings.
- Security scan: passed.
- Production build: cache-consistency files compiled far enough to expose
  unrelated existing failures in registration, modal JSX, and the admin API
  export. Those files are outside this feature and were not modified here.

## Rollback

- Revert the shared query freshness options to their previous per-query
  settings.
- Remove setup-query invalidation calls from both setup pages.
- Restore setup cache invalidation to the previous best-effort call if latency
  or Redis behavior requires emergency rollback.
$debugging-wizard find and fix this bug
$security-reviewer audit my authentication system
$code-reviewer review my current changes
$test-master add missing backend tests
$react-expert improve this React page
$database-optimizer inspect slow MongoDB queries
$api-designer review my REST API structure
$devops-engineer review deployment readiness
$fullstack-guardian implement a feature across frontend and backend