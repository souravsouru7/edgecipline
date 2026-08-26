# StratEdge — k6 Performance & Capacity Testing

Load tests for the StratEdge API, kept separate from the Jest unit/integration
suites in `backend/__tests__/`.

The goal of this suite is not "generate traffic" — it is to answer **how many
concurrent users the API can serve while staying inside its latency and error
budgets**, and to identify what limits that number.

---

## 1. Safety model

Load tests never touch development or production data.

| Concern | Isolation |
|---|---|
| Database | Separate Mongo DB `stratedge_loadtest`. The seed and cleanup scripts **refuse to run** unless the target DB name contains `loadtest`. |
| Cache / rate limits | Separate Redis keyspace (`redis://127.0.0.1:6379/3`). |
| API process | Separate instance on port **5001**, so a dev server can keep running on 5000. |
| Accounts | All seeded users are `k6-loadtest-N@loadtest.invalid`, making cleanup unambiguous. |
| Secrets | Nothing is hardcoded. Tokens live in `.testdata/` which is gitignored. |

Background workers and cron jobs are disabled on the test instance. This mirrors
production topology (where the OCR and Trading-DNA workers run as their own PM2
processes) and stops a wall-clock-scheduled job from contaminating a 60-second
measurement window.

---

## 2. Setup

### Prerequisites
- MongoDB and Redis running locally
- Node.js
- k6 (`winget install k6` / `brew install k6`, or the standalone binary)

### Seed the test data

```bash
LOADTEST_MONGO_URI="mongodb://127.0.0.1:27017/stratedge_loadtest" \
  node tests/performance/scripts/seed-test-data.js --users 250 --trades 120
```

Creates 250 users, each with 4 setups and 120 trades spread over 180 days, and
writes pre-minted access tokens to `tests/performance/.testdata/users.json`.

Tokens are signed with the app's real `JWT_SECRET` and carry the real
`tokenVersion`, so `authMiddleware` validates them exactly as it would a token
from `/api/auth/login`. Pre-minting avoids paying bcrypt on every iteration,
which would otherwise dominate the measurement — login is tested separately by
`auth-load.js`.

### Start the test API

```bash
# Production rate limits — measures what real users experience
LOADTEST_MONGO_URI="mongodb://127.0.0.1:27017/stratedge_loadtest" \
  node tests/performance/scripts/start-test-server.js

# Relaxed rate limits — measures true server capacity
LOADTEST_MONGO_URI="mongodb://127.0.0.1:27017/stratedge_loadtest" \
LOADTEST_RELAX_RATE_LIMIT=true \
  node tests/performance/scripts/start-test-server.js
```

**Both modes matter.** With production defaults the global limiter allows
100 requests per 15 minutes per user, so a sustained test measures the rate
limiter, not the application. Relaxed mode is required to find where the server
itself saturates. Results from the two modes answer different questions and must
not be mixed.

### Clean up

```bash
LOADTEST_MONGO_URI="mongodb://127.0.0.1:27017/stratedge_loadtest" \
  node tests/performance/scripts/cleanup-test-data.js          # remove seeded docs
  #                                                --drop      # or drop the whole DB
```

---

## 3. Running tests

All scenarios accept `BASE_URL`, `TARGET_VUS`, `DURATION`, `THINK_MIN`,
`THINK_MAX`, and `DEBUG_ERRORS`.

```bash
cd tests/performance

# Baseline — 3 VUs, best-case latency, validates the harness
k6 run scenarios/baseline.js

# One load level
TARGET_VUS=50 DURATION=1m k6 run scenarios/load-step.js

# Stress — ramp past capacity, then drop back to observe recovery
STRESS_PEAK=450 k6 run scenarios/stress.js

# Spike — sudden burst and recovery
SPIKE_PEAK=200 SPIKE_BASE=10 k6 run scenarios/spike.js

# Soak — sustained load, looking for leaks and drift
SOAK_VUS=100 SOAK_DURATION=10m k6 run scenarios/soak.js

# Login throughput, measured in isolation
TEST_PASSWORD='...' TARGET_VUS=20 k6 run scenarios/auth-load.js
```

### Wrapper (Windows)

`run-level.ps1` flushes the cache for a cold, comparable start, runs the
resource sampler alongside k6, and writes all artifacts into `results/`:

```powershell
powershell -File scripts/run-level.ps1 -Vus 100 -Duration 1m -Label "L-100vu"
```

### Diagnosing a failing test

Set `DEBUG_ERRORS=true` to print the body of any unexpected non-2xx response.
A malformed test payload and a genuine application failure look identical in the
k6 summary otherwise — this is the most common way a load test is misread.

---

## 4. Workload model

Journeys are weighted to approximate real usage rather than hammering one route:

| Weight | Journey | Requests |
|---|---|---|
| 50% | Morning check-in | `/auth/me`, `/dashboard/snapshot`, `/streaks`, `/notifications` |
| 25% | Analytics review | `/auth/me`, `/analytics/snapshot`, `/advanced`, `/psychology`, `/drawdown`, `/psychology-cost` |
| 15% | Journal a trade | `/auth/me`, `/setups`, **POST** `/trades`, `/trades` |
| 10% | Trade history | `/trades?page=…`, `/trades/:id` |

**What one VU represents.** With the default 2–6 s think time a journey takes
roughly 12–20 s, so one VU issues ~15–25 requests/minute continuously. That
models a *continuously active* user — someone with the app open, moving between
screens without pause.

A real registered user is burstier and mostly idle. **One VU therefore stands
for several real users.** Never report a VU count as a user count without
stating the per-user request rate it assumes.

### Cache realism

Dashboard and analytics responses are Redis-cached per user (45–120 s) under a
key that includes a per-user trade-version token. The journal journey writes a
trade, which bumps that token and invalidates the user's cached analytics — so
the journey mix produces both cache hits and cold rebuilds naturally. Each level
also starts from a flushed cache. Randomised `?days=` windows widen the key
space further. Together these stop the suite from silently measuring only Redis.

---

## 5. Thresholds

Budgets are per endpoint class, because a cached profile read and a cold
multi-aggregation analytics build differ by an order of magnitude. A single
global latency threshold would be meaningless. Defined in `lib/thresholds.js`:

| Class | Endpoints | p95 | p99 |
|---|---|---|---|
| `auth_light` | `/auth/me` | 150 ms | 400 ms |
| `simple_read` | `/setups`, `/streaks`, `/notifications` | 300 ms | 700 ms |
| `list_read` | `/trades`, `/trades/:id` | 500 ms | 1200 ms |
| `dashboard` | `/dashboard/snapshot` | 800 ms | 2000 ms |
| `analytics` | `/analytics/*` | 1000 ms | 2500 ms |
| `write` | `POST /trades` | 600 ms | 1500 ms |
| `login` | `POST /auth/login` | 1500 ms | 3000 ms |

Error budget: **< 1%** non-429 failures.

**429s are tracked separately** (`rate_limited_429`) and excluded from the error
rate. Under production limits a 429 is the application behaving correctly;
counting it as a failure would make a healthy server look broken.

---

## 6. Layout

```
tests/performance/
├── lib/
│   ├── config.js       env config, user pool, endpoint classes, workload model
│   ├── metrics.js      per-class Trends/Rates, 429 & timeout counters
│   ├── thresholds.js   documented latency budgets
│   └── flows.js        weighted user journeys
├── scenarios/
│   ├── baseline.js     3 VUs — best case + harness validation
│   ├── load-step.js    hold a fixed VU count (walks the capacity curve)
│   ├── stress.js       ramp past capacity, then recover
│   ├── spike.js        sudden burst
│   ├── soak.js         sustained load
│   └── auth-load.js    login throughput in isolation
├── scripts/
│   ├── seed-test-data.js      seed users/trades, mint tokens
│   ├── cleanup-test-data.js   remove everything seeded
│   ├── start-test-server.js   isolated API instance
│   ├── run-level.ps1          flush + sample + run one level
│   ├── monitor-resources.ps1  CPU/RAM for api, mongod, redis, k6
│   └── probe-event-loop.ps1   /health latency = event-loop queueing delay
└── results/            k6 summaries, resource CSVs, console logs (gitignored)
```
