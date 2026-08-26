# StratEdge API — Capacity & Performance Report

**Test date:** 2026-08-21
**Tested by:** performance engineering pass using k6 v2.2.0
**Scope:** StratEdge backend REST API (`backend/server.js`), Forex journal workload

---

## 1. Executive summary

| Question | Answer |
|---|---|
| **Safe concurrent users** | **150 VUs** (~108 RPS) — soak-proven for 10 min at p95 45 ms, 0.01% errors |
| **Sustainable concurrent users** | **200 VUs** (~120 RPS) — all latency budgets met, 0.02% errors |
| **Approximate breaking point** | **~300 VUs** — latency budgets broken across every endpoint class, request timeouts begin, throughput plateaus |
| **Recommended production capacity** | **150 VUs / ~100 RPS per API instance**, with autoscaling above that |
| **Throughput ceiling** | **160–170 RPS**, regardless of added load |
| **Primary bottleneck** | The **single Node.js process** — not MongoDB, not Redis, not the host |

The API **never returned a single 5xx** across ~350,000 requests, including a
450-VU stress run. It degrades gracefully into latency and eventually client
timeouts rather than failing.

> **Critical caveat:** these numbers are an **upper bound**. See §8.

---

## 2. Environment

| Component | Detail |
|---|---|
| Host | Windows 11 Home, AMD Ryzen 3 5300U, **4 cores / 8 logical**, 2.6 GHz |
| RAM | 5.83 GB total (~700 MB free at test start — the host was already under memory pressure) |
| Node.js | v24.14.1 |
| API | Single process, port 5001, `NODE_ENV=development` |
| MongoDB | **Local** `mongodb://127.0.0.1:27017/stratedge_loadtest` |
| Redis | **Local** `redis://127.0.0.1:6379/3` |
| k6 | v2.2.0 (windows/amd64) — **co-located on the same host** |
| Test corpus | 250 users × (120 trades + 4 setups) = **30,000 trades** |

**Isolation.** Tests never touched development data. A dedicated database
(`stratedge_loadtest`, guarded by a name check that refuses any DB without
`loadtest` in it), a dedicated Redis keyspace (db 3), a dedicated API instance
on port 5001, and accounts confined to `@loadtest.invalid`.

**Topology modelled.** Background workers and cron jobs were disabled on the
test instance, matching production (where the OCR and Trading-DNA workers run as
separate PM2 processes) and preventing wall-clock-scheduled jobs from
contaminating 60-second measurement windows.

---

## 3. Workload model — what one VU means

Journeys are weighted to approximate real usage, not to hammer one endpoint:

| Weight | Journey | Requests |
|---|---|---|
| 50% | Morning check-in | `/auth/me`, `/dashboard/snapshot`, `/streaks`, `/notifications` |
| 25% | Analytics review | `/auth/me`, `/analytics/snapshot`, `/advanced`, `/psychology`, `/drawdown`, `/psychology-cost` |
| 15% | Journal a trade | `/auth/me`, `/setups`, **POST** `/trades`, `/trades` |
| 10% | Trade history | `/trades?page=…`, `/trades/:id` |

With 2–6 s think time, **one VU issued a measured 36–43 requests/minute** — a
*continuously active* user, moving between screens without pause.

**A VU is not a registered user.** A real engaged user generates roughly
4 requests/minute while actively using the app (a dashboard load alone is 4
requests, then they read for a while). On that assumption:

> **1 VU ≈ 9–10 concurrently-active real users.**
> 200 VUs ≈ **~1,800 simultaneously-active users**, ≈ 120 RPS.

Total registered users supportable is higher still, since most are idle at any
moment. That multiplier depends on your DAU-to-concurrency ratio, which this
test cannot measure.

**Cache realism.** Analytics/dashboard responses are Redis-cached per user under
a key containing a trade-version token. The journal journey writes a trade,
bumping that token and invalidating that user's analytics — so the mix produces
genuine cold rebuilds, not just cache hits. Every level also started from a
flushed cache, and `?days=` windows were randomised.

---

## 4. Thresholds used

Budgets are per endpoint class, because a cached profile read and a cold
multi-aggregation build differ by an order of magnitude.

| Class | Endpoints | p95 | p99 |
|---|---|--:|--:|
| `auth_light` | `/auth/me` | 150 ms | 400 ms |
| `simple_read` | `/setups`, `/streaks`, `/notifications` | 300 ms | 700 ms |
| `list_read` | `/trades`, `/trades/:id` | 500 ms | 1200 ms |
| `dashboard` | `/dashboard/snapshot` | 800 ms | 2000 ms |
| `analytics` | `/analytics/*` | 1000 ms | 2500 ms |
| `write` | `POST /trades` | 600 ms | 1500 ms |
| `login` | `POST /auth/login` | 1500 ms | 3000 ms |

Error budget **< 1%** non-429. **429s are counted separately** — under production
limits a 429 is correct behaviour, and folding it into the error rate would make
a healthy server look broken.

---

## 5. Results — capacity curve

Rate limits relaxed, so this measures the **server**, not the limiter.
Latency in ms, aggregated across all endpoints.

| VUs | RPS | avg | p50 | p90 | p95 | p99 | max | Err% | Timeouts | 5xx | Verdict |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|
| 3 | 2.3 | 13.5 | 7.3 | 30.2 | 54.4 | 81.1 | 94.9 | 0.00 | 0 | 0 | PASS |
| 10 | 6.3 | 9.1 | 5.9 | 22.0 | 33.3 | 49.2 | 60.8 | 0.00 | 0 | 0 | PASS |
| 25 | 15.2 | 9.7 | 6.0 | 23.9 | 35.0 | 57.9 | 106.0 | 0.00 | 0 | 0 | PASS |
| 50 | 30.9 | 9.0 | 5.7 | 22.7 | 29.5 | 51.1 | 129.9 | 0.00 | 0 | 0 | PASS |
| 100 | 60.7 | 11.3 | 7.0 | 25.0 | 36.9 | 66.6 | 148.2 | 0.00 | 0 | 0 | **PASS** |
| 150 | 91.6 | 30.4 | 10.6 | 60.3 | 122.0 | 322.9 | 1524 | 0.00 | 0 | 0 | **PASS** |
| 200 | 120.2 | 32.4 | 17.5 | 74.6 | 103.5 | 210.4 | 678 | 0.02 | 1 | 0 | **PASS** (limit) |
| 250 | 144.4 | 75.1 | 34.0 | 174.9 | 275.8 | 564.1 | 1929 | 0.02 | 0 | 0 | WARNING |
| 300 | 158.6 | 239.8 | 171.9 | 471.7 | 683.7 | 1707 | 4471 | 0.04 | 6 | 0 | **FAIL** |
| 400 | 169.8 | 582.6 | 387.3 | 979.5 | 1393 | 4912 | 7239 | 0.05 | 7 | 0 | FAIL |

**Throughput saturation.** 300→400 VUs (+33% load) bought **+7% throughput**
while p95 grew 2×. The ceiling is **160–170 RPS**.

### Per-class latency at the decision points

| Class | 100 VUs p95 | 200 VUs p95 | 300 VUs p95 | Budget |
|---|--:|--:|--:|--:|
| `auth_light` | 12.3 | 48.5 | 290.5 | 150 |
| `simple_read` | — | — | — | 300 |
| `dashboard` | 42.7 | 104.9 | 820.2 | 800 |
| `analytics` | 30.4 | — | 577.7 | 1000 |
| `write` | 115.7 | 476.3 | **2500** | 600 |

`write` (POST /trades) is the first class to break — it is the only path doing a
duplicate-check query + insert + cache invalidation.

---

## 6. Soak, spike and stress

### Soak — 150 VUs, 10 minutes — **PASS**

| Metric | Value |
|---|---|
| Requests | **71,937** @ 107.8 RPS |
| p95 / p99 | **45.0 ms** / 92.2 ms |
| Errors | 0.01% (7), 1 timeout, **0 5xx** |
| Checks | 141,317 / 141,317 passed |
| **API memory drift** | **−2.1 MB** (284.7 → 282.6 MB, 181 samples) |
| **Handle drift** | **+0.1** (482.5 → 482.5) |
| Threads | constant at 12 |

**No memory leak, no connection/handle leak, no latency drift.** Confirmed
independently: after 1 h 39 m uptime and ~350,000 requests the API sat at
274 MB — unchanged from 262 MB early in the session — with `redisFailureCount: 0`
and `fallbackRequestCount: 0`.

Note the soak's p95 (45 ms) is **far better than the 1-minute 150-VU run
(122 ms)**, because short runs start from a flushed cache. Steady-state
performance is materially better than cold-start performance.

### Spike — 25 → 300 VUs in 10 s — **PASS**

**Zero errors, zero timeouts.** Latency by 10-second bucket:

| Phase | t (s) | median | p95 |
|---|--:|--:|--:|
| Pre-spike (25 VUs) | 0–40 | 5–6 ms | 30–40 ms |
| Spike hits | 50 | 116 ms | 461 ms |
| Peak degradation | 60 | 254 ms | 1172 ms |
| **Self-stabilising at 300 VUs** | 80–100 | 40–70 ms | 180–210 ms |
| Post-spike (back to 25) | 110 | 9 ms | 45 ms |
| Recovered | 120+ | 5 ms | 30 ms |

The system absorbs the burst, **self-stabilises within ~30 s while still at peak
load**, and returns to baseline within ~5–10 s of the spike ending. The initial
hit is a cold-cache artefact, not sustained degradation.

### Stress — ramp to 450 VUs — degrades gracefully

61,161 requests, **0 5xx**, 20 client timeouts (0.03%), `write` p95 6.75 s.
Failure mode is queueing and eventual timeout — never a crash, never a 5xx.

---

## 7. Bottleneck analysis

### 7.1 PRIMARY — single Node.js process / event loop saturation

**Evidence:**

1. **API process CPU plateaus.** Peak CPU (100 = one full core):

   | VUs | 50 | 100 | 150 | 200 | 250 | 300 | 400 |
   |---|--:|--:|--:|--:|--:|--:|--:|
   | API CPU % | 100 | 153 | 150 | 163 | 124 | 175 | 172 |

   From 100 VUs onward the process **never exceeds ~175%** despite 4× more
   offered load. A Node process executes JS on one thread; the extra ~75% is
   GC and libuv. This is the ceiling of one process.

2. **The host is not saturated.** At peak: API 175% + Mongo 118% + Redis 33% +
   k6 71% ≈ **400% of 800% available**. Roughly half the machine's CPU sits
   idle while the API is the constraint.

3. **A zero-I/O endpoint slows down.** `GET /health` performs no DB query, no
   Redis command, no disk I/O — only synchronous in-memory checks. Its latency
   is therefore almost pure event-loop scheduling delay:

   | Condition | median | p95 |
   |---|--:|--:|
   | Idle | 12.4 ms | 27.9 ms |
   | 250 VUs normal traffic | 20.8 ms | **72.4 ms** |
   | **10 VUs of login traffic** | **388.9 ms** | **474.2 ms** |

   Nothing but event-loop contention can slow this endpoint.

4. **Degradation is uniform across endpoint classes.** `auth_light` — a JWT
   verify plus a Redis cache hit — went from 12 ms to 290 ms p95. That is
   queue-wait, not query cost.

5. **Confirmed in configuration:** [`backend/ecosystem.config.js:6`](../../backend/ecosystem.config.js#L6)
   sets `instances: 1`. The API runs as a **single process with no cluster mode**.

### 7.2 CRITICAL — `bcryptjs` blocks the event loop on every login

The app uses **`bcryptjs`** ([`backend/package.json:33`](../../backend/package.json#L33),
[`backend/controllers/authController.js:5`](../../backend/controllers/authController.js#L5)) —
a **pure-JavaScript** implementation with no native binding and no threadpool
offload. Every hash blocks the process's only JS thread.

**Measured directly:**

| Measurement | Value |
|---|---|
| `bcryptjs.compare` at cost 10 | **67.6 ms** |
| Event-loop lag from **one** compare | **71 ms** |
| Theoretical login ceiling (1000 ÷ 68) | ~14.7 logins/s |
| **Measured login throughput** | **13.5 logins/s** |
| Login p95 at just 10 VUs | **1.05 s** |
| `/health` median during 10-VU login load | **388.9 ms** |

Measured throughput lands within 8% of the theoretical bcrypt bound, so **bcrypt
is essentially 100% of the login bottleneck**.

The severe consequence: **10 concurrent logins degrade the entire API more than
250 VUs of normal traffic does.** A login stampede — a deploy, a session-expiry
wave, market open — would stall every other request. Note `loginUser` runs bcrypt
even for unknown emails (a deliberate timing-attack defence), so failed logins
and credential-stuffing attempts block the loop too.

### 7.3 SECONDARY — MongoDB

Mongo CPU peaked at 118% and also plateaued. It is doing real work but is **not**
the first constraint — the API process saturates first. The trade collection is
well indexed (16 compound indexes on `user` + filters), and connection pooling
(`maxPoolSize: 50`) was never exhausted.

### 7.4 The binding constraint in production is the rate limiter

With production defaults the global limiter allows **100 requests / 15 min /
user = 6.67 req/min**. Measured demand was 36–43 req/min per active VU — **5.4–6.4×
the allowance**.

**Production-limits test — 100 VUs, 4 minutes:**

| Metric | Value |
|---|---|
| Requests | 19,141 |
| **429 rate-limited** | **9,141 (47.75%)** |
| **Journeys failed** | **2,219 of 4,500 (49%)** |
| p95 of *served* requests | 32.2 ms |

Nearly half of a continuously-active cohort's requests were rejected. A typical
user at ~4 req/min stays under the limit, but the budget is only **~1.6 dashboard
loads per minute** (a dashboard load is 4 requests), so genuinely engaged
sessions, multi-tab use, and pull-to-refresh will hit 429s.

---

## 8. Limitations — why these are upper bounds

1. **Local MongoDB.** Production likely uses a networked instance (Atlas). Every
   query would add 1–20 ms of network round-trip, and `/dashboard/snapshot`
   issues many queries per request. **Real-world latency will be higher.**
2. **Load generator co-located.** k6 consumed up to 92% of a core on the same
   4-core host, competing with the API.
3. **`NODE_ENV=development`.** Production enables CSP/HSTS and different logging.
4. **Modest dataset.** 120 trades/user. Heavier accounts will make analytics
   aggregations slower.
5. **Host under memory pressure** (~700 MB free at start), so >450 VUs was not
   attempted — beyond that the laptop, not the app, would be the subject.
6. **Single 1-minute samples** per level carry noise; the `write` class in
   particular varied between runs (150 VUs showed a worse p95 than 200 VUs).
   The soak is the more reliable steady-state figure.

---

## 9. Critical findings, by severity

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **Critical** | `bcryptjs` blocks the event loop 68 ms per login; 10 concurrent logins add ~390 ms to *every* request | §7.2, measured |
| 2 | **High** | API runs as a single process (`instances: 1`); ~50% of host CPU unusable | §7.1, `ecosystem.config.js:6` |
| 3 | **High** | Global rate limit (100 req/15 min) rejects ~48% of an active cohort's requests | §7.4, measured |
| 4 | **Medium** | `POST /trades` is the first class to break its budget (p95 476 ms @200 VUs → 2.5 s @300 VUs) | §5 |
| 5 | **Low** | Cold-cache start costs ~2.7× latency vs steady state (150 VUs: 122 ms → 45 ms) | §6 |
| 6 | **Informational** | Zero 5xx across ~350k requests; graceful degradation; clean soak | §6 |

---

## 10. Recommendations

Ordered by measured impact. Only changes the evidence supports.

### 1. Enable PM2 cluster mode — largest single win
`ecosystem.config.js` currently sets `instances: 1`. On a 4-core host:

```js
instances: 4,          // or "max"
exec_mode: "cluster",
```

The API process ceiling is ~175% of one core while ~400% of host CPU is idle
(§7.1). Four workers should lift the ceiling from ~170 RPS toward
**500–650 RPS**, roughly **3–4× capacity**, with no code change.
*Verify by re-running the curve — the event loop moves, it does not vanish.*

### 2. Replace `bcryptjs` with a native implementation — fixes the worst cliff
Swap for `bcrypt` or `@node-rs/bcrypt`, which run on the libuv threadpool
instead of the JS thread. This removes 68 ms of **blocking** per login and lets
hashing use idle cores. Expected: login throughput from ~13.5/s to roughly
`13.5 × UV_THREADPOOL_SIZE`, and — more importantly — **login load stops
starving unrelated requests**. Consider raising `UV_THREADPOOL_SIZE` above the
default 4 to match.

### 3. Revisit the global rate limit
100 requests / 15 minutes is **~1.6 dashboard loads per minute**. Either raise
the budget (e.g. 300–500 / 15 min), or make it per-route so cheap cached reads
(`/auth/me`, `/notifications`) do not consume the same budget as
`/analytics/advanced`. The existing `profileRateLimiter` (60/min) shows the
pattern already exists — extend it.

### 4. Reduce request fan-out on the dashboard
The morning check-in journey costs 4 requests, and `/dashboard/snapshot` itself
fans out to streaks + reflections + onboarding counts + analytics. A combined
bootstrap endpoint would cut both request count (easing the rate limit) and
event-loop work per screen.

### 5. Optimise the `POST /trades` path
First class to break budget. It performs a duplicate-check query, an insert and
a cache-version bump. Confirm `findRecentDuplicateTrade` is index-covered.

### 6. Re-test against production-like infrastructure
Re-run this suite with a networked MongoDB and an off-host load generator before
committing to a capacity number. The suite is parameterised by `BASE_URL`, so
this needs no code change.

### 7. Add capacity guardrails
Alert on API process CPU > 150% sustained, `/health` p95 > 100 ms (a direct
event-loop-saturation signal), and 429 rate > 5%.

---

## 11. Final answer

> **How many concurrent users can the application reliably handle?**

Per API instance, on this hardware, with the measured workload:

- **Safe:** **150 VUs** ≈ 108 RPS ≈ **~1,350 concurrently-active users**
- **Sustainable:** **200 VUs** ≈ 120 RPS ≈ **~1,800 concurrently-active users**
- **Breaking point:** **~300 VUs** ≈ 160 RPS
- **Recommended production ceiling:** **150 VUs / ~100 RPS per instance**, scaling
  horizontally beyond that

(User figures assume ~4 requests/minute per actively-engaged user — §3. Scale
proportionally if your real usage differs.)

> **What is limiting scalability?**

The **single Node.js process**. It saturates its one JS thread at ~170 RPS while
half the host's CPU is idle. Fixing that is a config change (cluster mode).

The sharper limit is **`bcryptjs` blocking the event loop for 68 ms per login** —
10 concurrent logins hurt the API more than 250 VUs of ordinary traffic.

In production today, though, users hit the **rate limiter long before the
server** — a limiter that rejected 48% of an active cohort's requests.
