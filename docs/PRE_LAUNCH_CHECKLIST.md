# EdgeCipline — Pre-Launch Verification

This is the short list. Everything here either **loses money, locks users out, or gets the app pulled from the store** if it is wrong — so it must be verified by a human on the **production** build and **production** config before real traffic. Everything else (analytics, psychology pages, streaks, reports, coupons, knowledge base, admin dashboards) can be found and fixed after launch.

**Order:** do **Pass 1 — Web** completely first (browser only, ~2 hours). Then **Pass 2 — Android** (~1 hour), which only repeats what genuinely behaves differently in the app.

**Rules:** production URL / production env / production Android build. If any item fails → do not launch until fixed. Fill in **P** = pass, **F** = fail, **–** = not applicable.

---

# PASS 1 — WEB (browser, desktop + one phone-width check)

## W1. Production config — read before you click (≈15 min)

- [ ] **Backend `.env` (prod):** Razorpay key is LIVE (not `rzp_test_`), `MONGO_URI` is the production cluster and `MONGO_URI_LOCAL` is NOT set, Cloudinary is the production account, mail provider is production, `SUPPORT_TICKETS_ENABLED=true`, free-trade limit enforcement is on.
- [ ] **Web build flags:** `NEXT_PUBLIC_PAYMENTS_ENABLED=true`, `NEXT_PUBLIC_PLAY_BILLING_ENABLED=false`, `NEXT_PUBLIC_RAZORPAY_KEY_ID` is the live key. Confirm the checkout modal does NOT say "Sandbox demo".
- [ ] **CORS:** allowlist contains only the production frontend origin(s). No `localhost`, no old Cloudflare preview URLs. `CORS_DEBUG` off.
- [ ] **Secrets:** JWT / admin JWT secrets differ from staging/dev and are not committed to git.
- [ ] **HTTPS:** site and API load over HTTPS; browser console shows no mixed-content or CORS errors on the dashboard.
- [ ] **Database backup:** Atlas (or host) shows automated backups enabled and at least one snapshot exists.
- [ ] **Indexes & seeds:** `syncIndexes.js` run once on production; production admin exists (`ensureAdminUser.js --list`); knowledge base seeded (`/support` shows articles, not "Guides are on their way").

## W2. Lockout paths — if these break, nobody can get in (≈20 min)

- [ ] **Register → OTP.** Register a fresh email. Expected: OTP email arrives within a minute from the production mail provider; correct OTP works; wrong OTP rejected; resend works.
- [ ] **Accept terms.** New account is asked to accept Terms once, then never again.
- [ ] **Login / session / logout.** Login works; refresh keeps you in; open a second tab → still logged in; logout in one tab logs out the other.
- [ ] **Forgot password.** Request reset → email arrives → link opens `/reset-password` → new password works, old one does not, the link cannot be reused.
- [ ] **Admin login.** `/admin/login` with the real production admin (not the local seed). Expected: admin dashboard loads; wrong password rejected. (3 failures lock for 1 hour.)
- [ ] **Admin routes blocked for users.** Logged in as a normal user, open `/admin/users` directly. Expected: refused, not rendered.

## W3. Money — irreversible if wrong (≈30 min)

- [ ] **Real Razorpay payment.** Buy the cheapest plan with a real card/UPI on the LIVE key. Expected: Premium unlocks immediately without a refresh; Settings shows plan + correct expiry; payment appears in `/admin/payments` with the same order id and amount as the Razorpay dashboard.
- [ ] **Payment failure.** Start checkout and cancel / use a failing method. Expected: clear error, still free plan, no charge, retry works without a duplicate order.
- [ ] **Pricing matches.** Plan cards on the paywall, the amount on the pay button, and what Razorpay actually charged are the same numbers (monthly / 3-month / 6-month).
- [ ] **Coupon (if you launch with one).** Valid code reduces the payable amount on the button and the charged amount matches; invalid/disabled code shows "This code isn't valid".
- [ ] **Premium survives re-login.** Log out and back in → still Premium.

## W4. Core loop on web (≈30 min)

- [ ] **Onboarding.** New account → onboarding → create a setup → lands on the dashboard; Growth Path shows "Build Setup" as done.
- [ ] **Manual trade — Forex.** Log one trade filling Setup / Pattern, SL/TP, R:R, mood, confidence, emotions. Expected: saves; appears in Trades; detail/edit shows every field intact.
- [ ] **Manual trade — Indian (Options + Equity).** Switch to India market, log one of each. Expected: strike/CE-PE (options) or symbol/qty (equity), SL/TP, trade type, screenshot all saved.
- [ ] **OCR upload.** `/upload-trade` with a real broker screenshot (NOT EURUSD). Expected: extracted pair/entry/exit/P&L match the image — never the generic EURUSD / 0.01 lot / +50 sample. Then upload a blurry/non-chart image → clear "could not extract" error, no invented trade.
- [ ] **Free-trade limit.** On a free account log a 3rd trade in one market. Expected: limit dialog ("You've used your 2 free … trades"), and it opens the Razorpay paywall. Switch market → that market still allows its own 2 trades. Existing trades still viewable/editable.
- [ ] **Dashboard reflects trades.** P&L / trade count match what you logged; market switcher changes the numbers; no stale data after adding a trade.
- [ ] **Checklist image preview.** Checklist → expand a setup with reference images → click a thumbnail → the × close button is visible top-right and closes it. Also check at a short window height (reported bug).
- [ ] **Phone width once.** Resize the browser to ~375px: Add Trade (both markets), the paywall, and the Help widget are usable — no cut-off buttons, no horizontal scroll.

## W5. Support is reachable — your post-launch safety net (≈15 min)

- [ ] **`/support` logged out** in a private window. Expected: page renders with articles + contact options (this URL goes to Google/Apple reviewers).
- [ ] **Open a ticket as a user** from `/support/tickets/new` with a screenshot. Expected: appears in `/admin/support` within seconds; the attachment opens for the admin; pasting the raw image URL in a logged-out window returns 404 (private).
- [ ] **Report an issue from the app.** OCR review screen → "Report OCR Issue" → submit with a screenshot. Expected: success screen shows a ticket code (EC-…); the ticket has a **Bug report** badge in `/support/tickets` and in `/admin/support`; the admin context panel shows the OCR values table.
- [ ] **Admin reply → user.** Reply from `/admin/support`. Expected: user receives the notification/email and sees the reply on the ticket.
- [ ] **Issue → ticket sync.** In `/admin/issues`, mark that report **Fixed** with a summary. Expected: the ticket gets a Support reply with the summary and becomes Resolved.
- [ ] **Floating Help widget** opens on the dashboard, answers a question or hands off to "Create a support ticket"; WhatsApp / email links open with the correct number/address.

## W6. Admin sanity (≈10 min)

- [ ] `/admin/users` shows the accounts you just created with the correct plan; `/admin/trades` shows the trades you logged (including Setup / SL / TP fields); `/admin/payments` shows the real payment from W3.
- [ ] `/admin/promotions` — if launching with a coupon, it is **active** and tied to an active campaign.

**Web pass complete?** All of W1–W6 **P** → move to Android. Any **F** in W1–W3 → stop and fix first.

---

# PASS 2 — ANDROID (production build, ~1 hour)

Only the things that genuinely differ from web. Do not repeat analytics/admin checks here.

## A1. Store compliance — suspension risk (≈15 min)

- [ ] **Build flags.** The Android build was made with `NEXT_PUBLIC_PAYMENTS_ENABLED=false` and `NEXT_PUBLIC_PLAY_BILLING_ENABLED=true`.
- [ ] **No Razorpay on Android.** Hit the free-trade limit in the app. Expected: the **Google Play** paywall opens. Razorpay UI must never appear anywhere in the app — also check Settings → Upgrade.
- [ ] **Play Console products match code.** Subscription product ID and base plan IDs (`edgecipline-pro-monthly`, `-3month`, `-6month`) match `backend/constants/googlePlay.js` exactly; prices in the paywall are Play's own localized prices.
- [ ] **Store listing.** Support URL and privacy policy URL open; listing screenshots show the current (redesigned) UI.

## A2. Google Play money (≈25 min)

- [ ] **Real purchase.** With a license-tester account, subscribe from the paywall. Expected: Play sheet opens; after paying, Premium unlocks and the celebration screen shows the expiry.
- [ ] **Cancel out of the Play sheet.** Expected: paywall returns to normal, no error, no charge.
- [ ] **Double-tap Subscribe.** Expected: only one Play sheet opens.
- [ ] **Kill the app mid-purchase** (after the Play sheet, before confirmation) → reopen. Expected: purchase is picked up and Premium is granted automatically.
- [ ] **Restore purchases.** Uninstall/reinstall (or log out/in) → Restore. Expected: Premium restored without paying again. With no purchase on the device → "No previous Google Play subscription was found".
- [ ] **Cancel from Play Store.** Play Store → Subscriptions → cancel the test sub. Expected: within a few minutes the app reflects it and `/admin/payments` shows the change (webhook path works).

## A3. App-only behaviour (≈20 min)

- [ ] **Login + session** on the app; app kill and reopen keeps you logged in.
- [ ] **Push notifications.** Trigger one (e.g. admin replies to your ticket) → notification arrives on the device and opens the right screen.
- [ ] **Camera / gallery.** Add Trade → screenshot picker works; Report Issue → attaching from gallery works (Android storage permission prompt behaves).
- [ ] **OCR upload from the app** with a real broker screenshot → correct extraction (not the EURUSD sample).
- [ ] **Checklist image preview** on the phone (and in split-screen if you can) → the × button is visible and closes it.
- [ ] **Bug report from the app** → ticket appears in `/admin/support` with platform = **android** and the app version shown.
- [ ] **Back button / bottom nav.** Android back closes modals (paywall, image preview, Help widget) before leaving the screen; bottom nav works on both markets.

---

# Before you press deploy (5 min, no testing)

- [ ] **Rollback noted:** previous build / git tag written here: `______________` and you know the exact command to redeploy it.
- [ ] **Monitoring:** you know where errors show up (logs / `/admin/monitoring`) and you will watch `/admin/support` + `/admin/issues` for the first 24 hours — the in-app reporter is now your live test suite.
- [ ] **Someone else** (not the developer) has done W4 once, end to end, without help.

---

## Sign-off

| Section | P / F | Tested by | Date | Notes |
|---|---|---|---|---|
| W1. Production config | | | | |
| W2. Lockout paths | | | | |
| W3. Money (Razorpay) | | | | |
| W4. Core loop (web) | | | | |
| W5. Support reachable | | | | |
| W6. Admin sanity | | | | |
| A1. Android compliance | | | | |
| A2. Google Play money | | | | |
| A3. App-only behaviour | | | | |
| Rollback & monitoring | | | | |

**Launch decision:** all sections **P** → launch. Any **F** in W1–W3 or A1–A2 → do not launch. An **F** elsewhere → fix or consciously accept it with an owner and a date written next to it.
