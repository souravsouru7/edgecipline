# Edgecipline Capacitor App — Speed, Device Alignment & "Big-App" Feel

_Audited against the real codebase on 2026-09-20 (Capacitor 6.2, Next 16 static export, Android minSdk 24 / target 36). Every finding cites the file; every fix is concrete._

> **Status (2026-09-20, same day):** Phases 1–3 below were implemented. Corrections to the original audit found during implementation: fonts were **already self-hosted** (`fonts.css`, `font-display: swap`) — S8 was wrong; framer-motion is used by one paywall celebration only, already behind `dynamic()` — S3 needs no action; the trade list API already pages at 50/page, so the real gap was that the client showed only page 1 (fixed with incremental paging, not virtualization) — S7 amended; `mainlogo1.png` was 13199×4500 px (59 MP) decoded on every header — a bigger win than S10 suggested. Remaining open items are in the final report delivered with the work.

---

## 0. What "feels like a top-tier app" actually means

Users don't judge an app on features first. They judge it in the first 3 seconds and on every tap after that. The apps people call "smooth" (Zerodha Kite, Groww, Google Pay, Revolut) all nail the same five things:

| Pillar | What the user perceives | What it is technically |
|---|---|---|
| **Instant start** | "It opened immediately" | Cold start to first *real* content < 1.5 s on a mid-range Android; no white flash, no double splash, no logo-then-spinner-then-skeleton chain |
| **Everything fits** | "It looks made for my phone" | Layout adapts to 320–1280 px widths, notches, gesture bars, keyboards, foldables, font-scale 130 %, dark/light system bars |
| **60 fps** | "It doesn't stutter" | No layout thrash, no blur filters on scrolling surfaces, no canvas redraws on keyboard open, lists don't render 500 rows at once |
| **Native manners** | "It behaves like an app, not a website" | Hardware back button, status-bar colour, haptics on key actions, keyboard doesn't cover inputs, no rubber-band bounce, no text-selection on buttons, no pinch-zoom |
| **Never blocks on the network** | "It just works, even on the train" | Cached last screen shown instantly, then refreshed; optimistic writes; skeletons only for first-ever loads |

Everything below is organised around these five.

---

## 1. Where the app already stands (what's right)

These are already implemented well — keep them:

| Area | Implementation | File |
|---|---|---|
| Native splash → web hand-off | AndroidX `SplashScreen` with `postSplashScreenTheme`, dismissed in `MainActivity.onCreate` before `super.onCreate` | `android/.../MainActivity.java`, `res/values/styles.xml` |
| One continuous boot | `BrandOpener` overlays while the session restores; **startup gate** keeps it up on `/`, `/dashboard`, `/indian-market` until the first query settles — no splash→logo→skeleton chain | `components/BrandOpener.jsx`, `utils/startupGate.js`, `components/AuthSessionBootstrap.jsx` |
| Session survives kills | WebView third-party cookies enabled, `CookieManager.flush()` on pause, silent refresh before redirecting to login | `MainActivity.java`, `features/auth/hooks/useRequireAuth.js` |
| Safe areas | `viewportFit: "cover"`, `env(safe-area-inset-*)` on opener and bottom nav; bottom nav has a spacer so content is never hidden | `app/layout.tsx`, `features/shared/components/MobileBottomNav.jsx` |
| App-like touch | `touch-action: manipulation`, no tap highlight, no text selection on buttons/nav, 48 px minimum hit targets, `overscroll-behavior: none` | `app/mobile-optimizations.css`, `app/globals.css` |
| Reduced motion | `prefers-reduced-motion` honoured globally and in `MarketSwitcher` | `mobile-optimizations.css` |
| Store hygiene | Admin console pruned from the mobile bundle; payment code aliased out when payments are off | `scripts/prune-mobile-bundle.mjs`, `next.config.ts` |
| Permission etiquette | Push permission asked after login, never in `onCreate` | `MainActivity.java`, `services/pushNotifications.js` |
| Bottom sheet done right | Handles the Android back button and keyboard resize | `features/shared/components/BottomSheet.jsx` |

---

## 2. Device alignment — the rules and the current gaps

### 2.1 The device matrix you are actually shipping to

| Class | Width (CSS px) | Examples | Notes |
|---|---|---|---|
| Small phone | 320–359 | Redmi Go, older Galaxy A/J, Play "small" | Any hard-coded two-column grid breaks here |
| Standard phone | 360–412 | Redmi Note, Galaxy A5x/M-series, Pixel — **>80 % of Indian Android** | Design target |
| Large phone | 413–480 | Galaxy S Ultra, OnePlus, Pixel Pro | Fine unless text is fixed at 9–10 px |
| Foldable inner / small tablet | 600–800 | Galaxy Z Fold open, Tab A 8" | Phone layout looks stretched; grids should reflow |
| Tablet / desktop web | 800–1440 | iPad, Tab S, laptop browsers | `page-content-max` cap exists |
| **Font scale 115–200 %** | any | Android "Display size / Font size" | Fixed `px` font sizes ignore this; `rem` respects it |
| **Notch / punch-hole + gesture nav** | any | Nearly every phone since 2019 | `safe-area-inset-*` must be applied to *every* fixed element |

### 2.2 Findings — alignment

| # | Finding (from source) | Impact | Fix |
|---|---|---|---|
| A1 | **43 hard-coded `gridTemplateColumns: "1fr 1fr"`** and 4× `"1fr 1fr 1fr"` in pages | On 320–359 px phones stat cards/inputs overflow or squeeze labels to 2 chars; on foldables/tablets two giant columns look wrong | Replace with `repeat(auto-fit, minmax(150px, 1fr))` (already used in 30+ places) or a shared `<StatGrid cols={2}>` that collapses under 340 px |
| A2 | **455 uses of `fontSize: 9` / `10`**, 20 of `7`/`8`, all in `px` | Illegible on 5.5" 360 dp screens, ignores Android font-scale, Play's accessibility pre-launch report flags text < 12 sp | Set a floor: labels ≥ 11 px, body ≥ 13 px. Define tokens in `globals.css` (`--fs-xs: 0.6875rem` …) and use `rem` so system font scale applies |
| A3 | `viewport.userScalable: false, maximumScale: 1` | Blocks pinch-zoom (an accessibility complaint on web) but *is* what native apps do — keep for the Capacitor build, **allow zoom on the web build** | Make `viewport` conditional on `isNativeCapacitor()` at build time, or accept the trade-off consciously |
| A4 | `mobile-optimizations.css` applies `max-height: min(90dvh,720px); overflow-y:auto` to **every** `[style*="position: fixed"]` under 768 px | Catches the bottom nav, toasts, the brand opener and route progress bar — anything fixed becomes a scroll container; this is the source of "mystery" clipped overlays | Delete that selector; give real dialogs an explicit `.sheet` class with the constraint |
| A5 | `themeColor: "#000000"` in `layout.tsx` while the app surface and Android bars are `#F4F2EE` | Black task-switcher header / Chrome UI on the web version; visible mismatch | Set `themeColor: "#F4F2EE"` (and `#0F1923` for a future dark theme) |
| A6 | No `android:windowSoftInputMode` on the activity | Default is `adjustPan`/unspecified: the keyboard **covers** the lower inputs on add-trade (stop-loss, take-profit, brokerage) and the user must scroll blind | Add `android:windowSoftInputMode="adjustResize"` to `MainActivity` in `AndroidManifest.xml`, and install `@capacitor/keyboard` with `resize: "body"` so `100dvh` layouts shrink with the keyboard |
| A7 | No `android:screenOrientation` | Rotating to landscape on a phone reflows a 360-wide design into 800-wide with 10 px text — nothing is designed for it | Lock phones to `userPortrait`; leave tablets free (`android:screenOrientation="userPortrait"` + `resizeableActivity` for foldables) |
| A8 | Status/navigation bar colours are baked into `styles.xml` (`#F4F2EE`, light icons) | Fine for light theme; any dark screen (admin login, trading-DNA share card, brand opener on OLED) shows a light bar over dark content | Install `@capacitor/status-bar` and call `StatusBar.setStyle/setBackgroundColor` from a `useSystemBars(theme)` hook per route |
| A9 | Inline `padding: "12px 14px"` etc. repeated per input across 4 add/edit forms (no shared field component for Indian pages) | Small inconsistencies between markets (Forex uses `FormInput`, Indian pages hand-roll inputs) | Use `features/trade/components/FormInput.jsx` on the Indian pages too |
| A10 | `MobileBottomNav` hides on `/` only; on tablets ≥ 769 px it is hidden via CSS but page bottom padding stays | Extra blank band at the bottom on tablets | Tie the spacer to the same media query |

### 2.3 Alignment rules to adopt (put these in `CLAUDE.md` / PR template)

1. **Never** write a fixed-column grid; use `repeat(auto-fit, minmax(<min>, 1fr))` or a shared grid component.
2. **Never** put a `px` font size below 11 px. Use the tokens.
3. Every `position: fixed` element pads with `env(safe-area-inset-*)`.
4. Every screen must survive: 320 px width, 200 % font scale, keyboard open, landscape on tablet.
5. Width ≥ 600 px: cap content at `max-width: 640px` centred for forms; dashboards can go multi-column.
6. No horizontal scroll ever (`overflow-x: hidden` on body is a band-aid — the audit should find the overflowing element).

---

## 3. Speed — startup, navigation, data

### 3.1 Cold start today

```
Android process start
  └─ AndroidX splash (static PNG, #F4F2EE)                     ~300–600 ms
       └─ WebView init + load out/index.html                    ~400–900 ms (mid-range)
            └─ React hydrate → AuthSessionBootstrap
                 ├─ BrandOpener paints (inline styles, no font wait)
                 ├─ silentRefresh (network: /auth/refresh)      ~150–1200 ms
                 ├─ /auth/me + first dashboard query (network)  ~200–1500 ms
                 └─ startup gate → opener crossfade (320 ms) → dashboard
```

A returning user waits for **two sequential network round-trips** before any real content, every single launch. That is the single biggest gap to a "Groww-fast" feel.

### 3.2 Findings — speed

| # | Finding | Impact | Fix |
|---|---|---|---|
| S1 | **No persisted query cache.** React Query is memory-only; `TRADE_QUERY_FRESHNESS_OPTIONS.staleTime = 0` for trades | Every cold start shows the opener until the network answers; offline launch shows nothing | Add `@tanstack/react-query-persist-client` + `createSyncStoragePersister(localStorage)` (or Capacitor Preferences). Render cached dashboard/trades **immediately**, mark stale, refetch in background. This alone makes warm launches feel instant |
| S2 | **`recharts` is bundled into ~6 route chunks (356 kB each)**; total chunks 6 MB, `out/` 23 MB; only **2** `dynamic()` imports in the app | Every analytics/dashboard route pays a 350 kB parse; on a Redmi that is 300–600 ms of JS before first paint | `dynamic(() => import("./EquityCurve"), { ssr:false, loading: Skeleton })` for every chart; ensure recharts lands in one shared chunk (`experimental.optimizePackageImports` or a single `charts.js` barrel) |
| S3 | `framer-motion` (≈ 40 kB gz) imported for a handful of card transitions | Parse cost on every route that touches it | Replace simple fades/slides with CSS (`.animate-slide-up` already exists); keep framer only for gesture-driven sheets, loaded dynamically |
| S4 | `CandlestickBackground` draws a random candle chart to a full-screen canvas on **every `resize`** | Android fires `resize` when the keyboard opens/closes → canvas redraw + `Math.random()` flicker mid-typing on add/edit trade pages that use it (`/trades/edit`, register, admin login) | Debounce `resize` (150 ms) and ignore height-only changes; or render once to an offscreen canvas and scale; skip entirely when `prefers-reduced-motion` |
| S5 | `.sticky-header` / `.sticky-footer` use `backdrop-filter: blur(18px)` | Backdrop blur over a scrolling list is the classic Android WebView jank source (forces repaint of the blurred region every frame) | Use a 92 % opaque solid background on Android WebView (`Capacitor.getPlatform() === "android"` → `.no-blur`), keep blur on iOS/desktop |
| S6 | `silentRefresh` then `/auth/me` then dashboard query run **serially** | Adds a full RTT | Fire the dashboard query in parallel with `/auth/me` once a token exists (the token is enough to authorise) |
| S7 | Trade lists render all rows (`TradeTable`, `RecentTradeCards`) — no virtualization | Power users with 500+ trades: 2–4 s initial render, janky scroll | Paginate at the API (already supports `period`) and use `@tanstack/react-virtual` for the table |
| S8 | Google Fonts loaded via `fonts.css` at runtime | First paint in fallback font, then a swap; on flaky networks the swap happens mid-session | Self-host Plus Jakarta Sans + JetBrains Mono in `/public/fonts` with `font-display: optional` on native (no swap ever) |
| S9 | `STARTUP_REVEAL_TIMEOUT_MS` forces reveal after a timeout; the opener has a minimum hold | Correct, but on a fast warm start the minimum hold is pure wait | With S1 in place, drop the minimum hold when cache-hit content is available |
| S10 | Images in `public/` (brand-opener-logo.png, sample screenshots) are unoptimised PNGs | Bundle weight | Convert to WebP; the opener logo can be an inline SVG (paints before any asset loads) |

### 3.3 Targets (measure on a Redmi Note-class device, Chrome remote debugging → Performance)

| Metric | Now (est.) | Target |
|---|---|---|
| Cold start → first real content (returning user, online) | 2.0–3.5 s | **< 1.5 s** (cached) |
| Warm start (app in background) | 0.5 s | < 0.3 s |
| Route change (dashboard → trades) | 300–800 ms (chart chunk) | < 150 ms perceived (skeleton or cached) |
| Scroll FPS on trades list (200 rows) | 40–55 | 60 |
| JS on dashboard route | ≈ 1 MB parsed | < 500 kB |
| Bundle in APK (`out/`) | 23 MB | < 12 MB |

---

## 4. Native manners — what's missing from the Capacitor layer

Only four plugins are installed (`core`, `android/ios`, `push-notifications`, `firebase-authentication`). A "real app" feel needs these, all first-party and small:

| Plugin | Why | Where to wire |
|---|---|---|
| `@capacitor/app` | Hardware **back button**: today only `BottomSheet` listens ad hoc via `window.Capacitor?.Plugins?.App`. On every other screen, back pops the WebView history, which can exit the app from `/dashboard` or land on `/login` after logout | One listener in `providers.tsx`: if a sheet/modal is open → close it; else if `router` can go back → back; else on a root tab → `App.minimizeApp()`; double-back-to-exit toast |
| `@capacitor/status-bar` | Per-screen bar colour/style (A8), overlay mode for the brand opener | `useSystemBars()` hook |
| `@capacitor/keyboard` | `resize: "body"` + `Keyboard.addListener("keyboardWillShow")` to scroll the focused input into view above the keyboard; hide accessory bar on iOS | Global once; `BottomSheet` already handles its own case |
| `@capacitor/haptics` | `ImpactStyle.Light` on save-trade success, streak milestone, toggle checklist; `Notification` haptic on errors | Toast provider + `useAddTrade.onSuccess` |
| `@capacitor/splash-screen` | **Do not add** unless `MainActivity` is refactored — the config comment in `capacitor.config.ts` is correct; the AndroidX splash is the right approach |
| `@capacitor/preferences` | Durable KV for the persisted query cache and the FCM token (localStorage can be cleared by the OS under storage pressure) | `pushNotifications.js`, query persister |
| `@capacitor/network` | Show an "offline" pill instead of failing requests; skip refetches when offline | `apiClient` + a `<OfflineBanner/>` |

Page-transition feel: Next's client navigation is instant, but there is no motion between routes. Add a 180 ms shared-axis transition (CSS `view-transition` API is supported in Chrome WebView ≥ 111; fallback to a `translateX(8px)+fade` on the page wrapper). `RouteTransitionProgress` already exists for the slow case.

---

## 5. Implementation plan (ordered by user-visible payoff ÷ effort)

### Phase 1 — one sprint, biggest perceived gains
1. **Persisted React Query cache** (S1) + parallelise auth/dashboard (S6) → warm launches render instantly.
2. **`adjustResize` + `@capacitor/keyboard`** (A6) → inputs never hidden.
3. **`@capacitor/app` back-button policy** → no accidental exits.
4. **Delete the `[style*="position: fixed"]` CSS rule** (A4) and fix `themeColor` (A5).
5. **Debounce `CandlestickBackground` resize** (S4) and drop backdrop blur on Android (S5).

### Phase 2 — layout hardening
6. Font-size tokens with an 11 px floor; migrate `fontSize: 9/10` → tokens (A2). Do it per feature folder with a lint rule (`no-restricted-syntax` for `fontSize: [0-9]` below 11).
7. Replace `"1fr 1fr"` grids with `auto-fit/minmax` (A1); test at 320 px and 200 % font scale.
8. Lock phone orientation, keep tablets free (A7); add a 600 px+ layout pass for the four form pages (max-width 640, centred).
9. `@capacitor/status-bar` hook (A8); `@capacitor/haptics` on the three key moments.

### Phase 3 — bundle & rendering
10. Dynamic-import every chart; single recharts chunk (S2). Replace decorative framer-motion with CSS (S3).
11. Self-host fonts with `font-display: optional` (S8); WebP/SVG assets (S10).
12. Virtualise the trades table (S7).
13. View-transition between routes.

---

## 6. Code sketches for the Phase 1 items

**Persisted cache (`app/providers.tsx`)**
```tsx
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: "edge-query-cache-v1",
});
// gcTime must be >= maxAge or entries are dropped before restore
<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000, buster: APP_VERSION }}
>
```
Then in `useDashboard` / `useTrades`, keep `staleTime` low but rely on `placeholderData: keepPreviousData` — the cached snapshot paints, the refetch replaces it, and `markStartupContentReady()` fires on the cached data so the opener leaves early.

**Keyboard (`AndroidManifest.xml` + `capacitor.config.ts`)**
```xml
<activity android:name=".MainActivity"
  android:windowSoftInputMode="adjustResize"
  android:screenOrientation="userPortrait" …>
```
```ts
plugins: { Keyboard: { resize: "body", resizeOnFullScreen: true } }
```

**Back button (`components/NativeBackButton.jsx`, mounted in providers)**
```js
App.addListener("backButton", ({ canGoBack }) => {
  if (closeTopmostSheet()) return;                 // sheets/modals register themselves
  if (ROOT_TABS.has(pathname)) { App.minimizeApp(); return; }
  if (canGoBack) router.back(); else router.replace(getDashboardUrl(currentMarket));
});
```

**Blur only where it's cheap (`mobile-optimizations.css`)**
```css
.sticky-header { background: rgba(244,242,238,.96); }
@supports (backdrop-filter: blur(1px)) {
  html:not([data-platform="android"]) .sticky-header { backdrop-filter: blur(18px); background: rgba(244,242,238,.92); }
}
```
Set `document.documentElement.dataset.platform = Capacitor.getPlatform()` once in `Providers`.

**Font tokens (`globals.css`)**
```css
:root { --fs-2xs: .6875rem; --fs-xs: .75rem; --fs-sm: .8125rem; --fs-md: .9375rem; --fs-lg: 1.0625rem; }
```

---

## 7. QA matrix before each release

| Device / condition | What to check |
|---|---|
| 320 px emulator (Pixel 2 at 320 dp, or Chrome DevTools) | No horizontal scroll on dashboard, add-trade (both markets), trades list, analytics, settings |
| 360 × 800 phone at **font scale 150 %** | Labels wrap, nothing truncates to "…" in stat cards, buttons keep 48 px |
| Punch-hole + gesture nav (Pixel/OnePlus) | Header content below the camera, bottom nav above the gesture bar, toasts not under the bar |
| Keyboard open on add-trade | Every input scrolls into view; submit button reachable; no canvas flicker |
| Rotate on phone | Stays portrait |
| Galaxy Z Fold / 8" tablet | Grids reflow to 3–4 columns, forms capped at 640 px, bottom nav hidden and no dead band |
| Airplane mode, then open app | Last dashboard/trades visible with an offline pill; no infinite opener |
| Kill app → notification tap | Correct market page opens (see notifications guide) |
| Dark wallpaper + OLED | Status/nav bar colours match the screen |
| Low-end (2 GB RAM, Android 10) | Cold start < 2.5 s; scroll trades list without dropped frames |

Tools: `adb shell dumpsys gfxinfo com.edgecipline` for frame stats; `chrome://inspect` → Performance for JS; Play Console **pre-launch report** for accessibility/text-size flags; Android Studio **Layout Inspector** for the WebView bounds vs. insets.

---

## 8. Definition of "done" for the smooth-app initiative

- [ ] Returning user sees cached dashboard in < 1.5 s cold, < 0.3 s warm (measured on a Redmi Note-class device)
- [ ] Zero hard-coded two/three-column grids; zero font sizes < 11 px
- [ ] Keyboard never covers a focused input on any form
- [ ] Hardware back never exits from a non-root screen and never lands on `/login` while signed in
- [ ] Status bar colour matches every screen; safe areas respected on every fixed element
- [ ] Charts loaded on demand; dashboard route JS < 500 kB; APK web bundle < 12 MB
- [ ] 60 fps scrolling on a 200-row trades list; no canvas redraw on keyboard events
- [ ] Offline launch shows last content + offline pill
- [ ] Haptic feedback on save-trade, streak milestone, checklist toggle
- [ ] QA matrix in §7 passed on at least: one 320 px device, one 360 px at 150 % font, one foldable/tablet
