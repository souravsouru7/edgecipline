"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import Link from "next/link";
import { getProfile } from "@/services/api";
import PageHeader from "@/features/shared/components/PageHeader";
import { Skeleton } from "@/features/shared";
import { useMarket, MARKETS } from "@/context/MarketContext";
import { BarChart3, Check, ChevronRight, ClipboardList, GraduationCap, Globe2, LifeBuoy, Upload } from "lucide-react";
import { canShowPurchaseUI } from "@/config/payments";
import { isAndroidNative } from "@/utils/platform";
import {
  PLAY_MANAGE_URL,
  resolveExpiryLabel,
  describePlayLifecycle,
  showsPlayActions,
} from "@/features/premium/utils/subscriptionCard.mjs";
import DeleteAccountSection from "@/components/DeleteAccountSection";
// Same upgrade surface the header uses. PricingModal is a shim over
// PaywallGate, so the whole chunk is dropped when payments are disabled
// rather than merely hidden — and there is no route to 404 on.
import PricingModal from "@/components/PricingModal";

const PLAN_CONFIG = {
  free: { label: "Free", color: "#475569", bg: "#F1F5F9" },
  monthly: { label: "Monthly Pro", color: "#0369A1", bg: "#E0F2FE" },
  yearly: { label: "Annual Pro", color: "#92400E", bg: "#FEF3C7" },
};

const STATUS_CONFIG = {
  active: { label: "Active", color: "#15803D", bg: "#DCFCE7" },
  inactive: { label: "Inactive", color: "#475569", bg: "#F1F5F9" },
  expired: { label: "Expired", color: "#B91C1C", bg: "#FEE2E2" },
  trial: { label: "Trial", color: "#0369A1", bg: "#E0F2FE" },
};

// Play lifecycle copy, the Renews/Ends/Expires rule and the manage link live
// in features/premium/utils/subscriptionCard.mjs (unit-tested under node:test).

function Pill({ label, color, bg }) {
  return <span className="st-pill" style={{ color, background: bg }}>{label}</span>;
}

function Row({ label, value, mono }) {
  return (
    <div className="st-row">
      <span className="st-row-label">{label}</span>
      <span className={`st-row-value${mono ? " st-mono" : ""}`}>{value || "-"}</span>
    </div>
  );
}

function NavRow({ href, onClick, Icon, label, hint, disabled }) {
  const body = (
    <>
      <span className="st-nav-icon"><Icon size={18} strokeWidth={2} /></span>
      <span className="st-nav-text">
        <span className="st-nav-label">{label}</span>
        {hint && <span className="st-nav-hint">{hint}</span>}
      </span>
      <ChevronRight size={18} strokeWidth={2} className="st-nav-chev" />
    </>
  );
  return href
    ? <Link href={href} className="st-nav">{body}</Link>
    : <button type="button" className="st-nav" onClick={onClick} disabled={disabled}>{body}</button>;
}

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-";

export default function SettingsPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { currentMarket } = useMarket();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [replayingTutorial, setReplayingTutorial] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const data = await getProfile();
      if (data?.message === "Not authorized") { router.push("/login"); return; }
      if (data && !data.message) setProfile(data);
    } catch (e) {
      console.error("Failed to load profile", e);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    loadProfile();
  }, [ready, loadProfile]);

  // The subscription card was a one-shot read, so after a purchase it kept
  // saying "Inactive" until the user left and came back. Re-read whenever the
  // app returns to the foreground too: a Play purchase finishes in Google's
  // own sheet, and renewals/cancellations arrive from Google's server later,
  // so the page cannot know when the answer changed without asking again.
  useEffect(() => {
    if (!ready) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") loadProfile();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ready, loadProfile]);

  // The coach links to /profile?section=billing (redirected here).
  useEffect(() => {
    if (loading) return;
    if (new URLSearchParams(window.location.search).get("section") !== "billing") return;
    document.getElementById("billing")?.scrollIntoView({ block: "start" });
  }, [loading]);

  const initials = profile?.name
    ? profile.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : "U";

  const joinedDate = fmtDate(profile?.createdAt);
  const lastLogin = fmtDate(profile?.lastLogin);

  // `subscription` is resolved on the server across both processors. The raw
  // subscriptionStatus/subscriptionExpiry fields are the Razorpay ledger only:
  // a Google Play subscriber has "inactive" and no date there while paying,
  // which is exactly what this card used to show them. Fall back to the raw
  // fields only for a server that predates the resolved object.
  const subscription = profile?.subscription || {
    status: profile?.subscriptionStatus,
    plan: profile?.subscriptionPlan,
    provider: null,
    expiresAt: profile?.subscriptionExpiry,
  };

  const expiryDate = subscription.expiresAt ? fmtDate(subscription.expiresAt) : null;
  // Play subscriptions renew on that date unless cancelled in the Play Store,
  // in which case access simply ends there; Razorpay purchases always just
  // end. "Expires" on a renewing plan reads like a warning and "Renews" on a
  // cancelled one is a lie, so name the date for what it is.
  const expiryLabel = resolveExpiryLabel(subscription);
  const lifecycleNotice = describePlayLifecycle(subscription, expiryDate);
  // isAndroidNative() is the third argument: "Manage subscription" opens
  // play.google.com, so it is offered only where Google owns the purchase —
  // never inside the iOS app, where an external payment link is a 3.1.1 risk.
  const playActions = showsPlayActions(subscription, profile?.isPremium, isAndroidNative());

  // A trial user is premium with subscription status "inactive", so reading
  // status alone would label someone with full access "Free / Inactive".
  // The server resolves entitlement for us — trust it over the raw status.
  const onTrial = Boolean(profile?.trial?.active) && subscription.status !== "active";
  // The server resolves the label across both processors (a six-month Play
  // plan is stored as "monthly" in the Razorpay-shaped plan field); fall back
  // to the local table only for a server that predates `planLabel`.
  const basePlanCfg = PLAN_CONFIG[subscription.plan] || PLAN_CONFIG.free;
  const planCfg = onTrial
    ? { label: "Premium Trial", color: "#0369A1", bg: "#E0F2FE" }
    : subscription.planLabel
      ? { ...basePlanCfg, label: subscription.planLabel, ...(subscription.planLabel === "Free" ? PLAN_CONFIG.free : {}) }
      : basePlanCfg;
  const statusCfg = onTrial
    ? STATUS_CONFIG.trial
    : (STATUS_CONFIG[subscription.status] || STATUS_CONFIG.inactive);

  const authProvider = profile?.authProvider === "google" ? "Google" : "Email & password";

  const isIndian = currentMarket === MARKETS.INDIAN_MARKET;
  const shortcuts = [
    { href: isIndian ? "/indian-market/analytics" : "/analytics", label: "Analytics", hint: "Win rate, P&L and patterns", Icon: BarChart3 },
    { href: isIndian ? "/indian-market/upload-trade" : "/upload-trade", label: "Upload a trade", hint: "From a broker screenshot or manually", Icon: Upload },
    { href: "/weekly-reports", label: "Weekly reports", hint: "Your week, reviewed", Icon: ClipboardList },
    isIndian
      ? { href: "/dashboard", label: "Switch to Forex", hint: "Open the Forex dashboard", Icon: Globe2 }
      : { href: "/indian-market/dashboard", label: "Switch to Indian market", hint: "Open the NSE / BSE dashboard", Icon: Globe2 },
  ];

  // The dashboard opens the welcome tutorial when it sees ?tour=1; it used to
  // reset a server flag the tutorial never read, so nothing appeared.
  const handleReplayTutorial = () => {
    setReplayingTutorial(true);
    router.push(isIndian ? "/indian-market/dashboard?tour=1" : "/dashboard?tour=1");
  };

  return (
    <div className="st-root">
      <style>{`
        .st-root { --st-ink: #0F1923; --st-muted: #64748B; --st-faint: #94A3B8; --st-line: #E2E8F0; --st-green: #0D9E6E;
          min-height: 100vh; background: #F4F6F9; color: var(--st-ink); font-family: 'Inter', sans-serif; }
        .st-root *, .st-root *::before, .st-root *::after { box-sizing: border-box; }
        .st-main { max-width: 720px; margin: 0 auto; padding: 24px 24px 64px; }
        .st-title { margin: 0 0 16px; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }

        .st-card { background: #FFFFFF; border: 1px solid var(--st-line); border-radius: 16px; box-shadow: 0 1px 3px rgba(15,25,35,0.04); overflow: hidden; }
        .st-section { margin-top: 28px; }
        .st-section-title { margin: 0 0 8px 4px; font-size: 13px; font-weight: 700; color: var(--st-muted); }

        .st-profile { display: flex; align-items: center; gap: 16px; padding: 20px; }
        .st-avatar { width: 56px; height: 56px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0D9E6E, #22C78E); color: #FFFFFF; font-size: 20px; font-weight: 700; }
        .st-profile-text { flex: 1; min-width: 0; }
        .st-name { margin: 0; font-size: 18px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .st-email { margin-top: 2px; font-size: 14px; color: var(--st-muted); overflow-wrap: anywhere; }
        .st-pills { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
        .st-pill { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }

        .st-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 52px; padding: 12px 20px; border-top: 1px solid #F1F4F8; }
        .st-row:first-child { border-top: none; }
        .st-row-label { font-size: 14px; color: var(--st-muted); flex-shrink: 0; }
        .st-row-value { font-size: 14px; font-weight: 600; text-align: right; min-width: 0; overflow-wrap: anywhere; }
        .st-mono { font-family: 'JetBrains Mono', monospace; font-size: 13px; }

        .st-plan { padding: 18px 20px; }
        .st-plan-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .st-plan-name { font-size: 16px; font-weight: 700; }
        .st-plan-date { margin-top: 4px; font-size: 14px; color: var(--st-muted); }
        .st-plan-date b { color: var(--st-ink); font-weight: 600; }
        .st-notice { margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
        .st-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
        .st-btn { height: 44px; padding: 0 18px; border-radius: 10px; font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
        .st-btn--primary { border: none; background: linear-gradient(135deg, #0D9E6E, #0BB866); color: #FFFFFF; box-shadow: 0 2px 8px rgba(13,158,110,0.25); }
        .st-btn--secondary { border: 1px solid #CBD5E0; background: #FFFFFF; color: var(--st-ink); }
        .st-btn--secondary:hover { background: #F8FAFB; }
        .st-access { margin-top: 14px; display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: #15803D; }

        .st-nav { width: 100%; display: flex; align-items: center; gap: 14px; min-height: 64px; padding: 10px 20px; border: none; border-top: 1px solid #F1F4F8; background: transparent; text-align: left; text-decoration: none; color: inherit; font-family: inherit; cursor: pointer; }
        .st-card > .st-nav:first-child { border-top: none; }
        .st-nav:hover { background: #F8FAFB; }
        .st-nav:disabled { opacity: 0.6; cursor: default; }
        .st-nav-icon { width: 36px; height: 36px; border-radius: 10px; background: #EEF9F4; color: var(--st-green); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .st-nav-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .st-nav-label { font-size: 15px; font-weight: 600; }
        .st-nav-hint { font-size: 13px; color: var(--st-muted); margin-top: 1px; }
        .st-nav-chev { color: var(--st-faint); flex-shrink: 0; }


        @media (max-width: 600px) {
          .st-main { padding: 16px 16px 96px; }
          .st-title { font-size: 22px; }
          .st-profile { flex-wrap: wrap; padding: 16px; }
          .st-pills { flex-basis: 100%; justify-content: flex-start; padding-left: 72px; }
          .st-row { padding: 12px 16px; }
          .st-plan { padding: 16px; }
          .st-actions .st-btn { flex: 1 1 100%; }
          .st-nav { padding: 10px 16px; }
        }
        @media (max-width: 420px) {
          .st-row { flex-direction: column; align-items: flex-start; gap: 2px; }
          .st-row-value { text-align: left; }
        }
      `}</style>

      <PageHeader showMarketSwitcher={false} />

      <main className="st-main">
        <h1 className="st-title">Settings</h1>

        {/* Profile */}
        <div className="st-card st-profile">
          <div className="st-avatar" aria-hidden="true">{loading ? "" : initials}</div>
          <div className="st-profile-text">
            {loading ? (
              <>
                <Skeleton width="160px" height="18px" style={{ marginBottom: 8 }} />
                <Skeleton width="220px" height="14px" />
              </>
            ) : (
              <>
                <h2 className="st-name">{profile?.name || "Trader"}</h2>
                <div className="st-email">{profile?.email || ""}</div>
              </>
            )}
          </div>
          {!loading && (
            <div className="st-pills">
              <Pill {...planCfg} />
              {profile?.role === "admin" && <Pill label="Admin" color="#6D28D9" bg="#EDE9FE" />}
            </div>
          )}
        </div>

        {/* Account */}
        <section className="st-section">
          <h3 className="st-section-title">Account</h3>
          <div className="st-card">
            {loading ? (
              [...Array(4)].map((_, i) => (
                <div key={i} className="st-row"><Skeleton width="100%" height="16px" /></div>
              ))
            ) : (
              <>
                <Row label="Name" value={profile?.name} />
                <Row label="Email" value={profile?.email} mono />
                <Row label="Sign-in method" value={authProvider} />
                <Row label="Member since" value={joinedDate} />
                <Row label="Last login" value={lastLogin} />
              </>
            )}
          </div>
        </section>

        {/* Subscription */}
        <section className="st-section" id="billing">
          <h3 className="st-section-title">Subscription</h3>
          <div className="st-card st-plan">
            {loading ? (
              <>
                <Skeleton width="140px" height="18px" style={{ marginBottom: 8 }} />
                <Skeleton width="200px" height="14px" />
              </>
            ) : (
              <>
                <div className="st-plan-head">
                  <span className="st-plan-name">{planCfg.label}</span>
                  <Pill {...statusCfg} />
                </div>
                {expiryDate && (
                  <div className="st-plan-date">{expiryLabel} <b>{expiryDate}</b></div>
                )}
                {lifecycleNotice && (
                  <div
                    role="status"
                    className="st-notice"
                    style={{
                      background: lifecycleNotice.tone === "warn" ? "#FEF3C7" : "#E0F2FE",
                      color: lifecycleNotice.tone === "warn" ? "#92400E" : "#075985",
                    }}
                  >
                    {lifecycleNotice.text}
                  </div>
                )}
                {profile?.isPremium && (
                  <div className="st-access"><Check size={16} strokeWidth={2.6} /> Full access enabled</div>
                )}
                {(playActions || (!profile?.isPremium && canShowPurchaseUI())) && (
                  <div className="st-actions">
                    {!profile?.isPremium && canShowPurchaseUI() && (
                      <button type="button" className="st-btn st-btn--primary" onClick={() => setPricingOpen(true)}>
                        Upgrade plan
                      </button>
                    )}
                    {playActions && (
                      <button
                        type="button"
                        className="st-btn st-btn--secondary"
                        onClick={() => window.open(PLAY_MANAGE_URL, "_blank", "noopener")}
                      >
                        Manage subscription
                      </button>
                    )}
                    {playActions && canShowPurchaseUI() && (
                      <button type="button" className="st-btn st-btn--secondary" onClick={() => setPricingOpen(true)}>
                        Change plan
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Shortcuts */}
        <section className="st-section">
          <h3 className="st-section-title">Shortcuts</h3>
          <div className="st-card">
            {shortcuts.map(s => <NavRow key={s.href} {...s} />)}
          </div>
        </section>

        {/* Help */}
        <section className="st-section">
          <h3 className="st-section-title">Help</h3>
          <div className="st-card">
            <NavRow
              onClick={handleReplayTutorial}
              disabled={replayingTutorial}
              Icon={GraduationCap}
              label={replayingTutorial ? "Starting tutorial…" : "Replay app tutorial"}
              hint="Walk through the app intro again"
            />
            <NavRow href="/support" Icon={LifeBuoy} label="Help & support" hint="Guides, FAQs and contacting the team" />
          </div>
        </section>

        {/* Play User Data policy / Apple 5.1.1(v): account deletion must be
            reachable from inside the app. */}
        <DeleteAccountSection email={profile?.email} subscription={subscription} />

      </main>

      {/* Every button that can open this is already behind canShowPurchaseUI(),
          so on iOS nothing sets pricingOpen. Gating the mount too means the
          paywall chunk is never even requested there. */}
      {canShowPurchaseUI() && (
        <PricingModal
          isOpen={pricingOpen}
          onClose={() => setPricingOpen(false)}
          onSuccess={loadProfile}
        />
      )}
    </div>
  );
}
