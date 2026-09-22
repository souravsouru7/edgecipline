"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import Link from "next/link";
import { getProfile, resetOnboarding } from "@/services/api";
import PageHeader from "@/features/shared/components/PageHeader";
import { ArrowRight, BarChart3, Check, ClipboardList, GraduationCap, Globe2, LifeBuoy, Upload } from "lucide-react";
import { canShowPurchaseUI } from "@/config/payments";
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

const C = {
  bg: "#F0EEE9",
  card: "#FFFFFF",
  navy: "#0F1923",
  navyLight: "#1A2D3D",
  green: "#0D9E6E",
  greenLight: "#22C78E",
  gold: "#B8860B",
  red: "#D63B3B",
  secondary: "#4A5568",
  muted: "#94A3B8",
  border: "#E2E8F0",
  borderDark: "#CBD5E0",
};

const PLAN_CONFIG = {
  free: { label: "Free", color: C.muted, bg: "#F1F5F9" },
  monthly: { label: "Monthly Pro", color: "#0369A1", bg: "#E0F2FE" },
  yearly: { label: "Annual Pro", color: C.gold, bg: "#FEF9E7" },
};

const STATUS_CONFIG = {
  active: { label: "Active", color: "#15803D", bg: "#DCFCE7" },
  inactive: { label: "Inactive", color: C.muted, bg: "#F1F5F9" },
  expired: { label: "Expired", color: C.red, bg: "#FEE2E2" },
  trial: { label: "Trial", color: "#0369A1", bg: "#E0F2FE" },
};

// Play lifecycle copy, the Renews/Ends/Expires rule and the manage link live
// in features/premium/utils/subscriptionCard.mjs (unit-tested under node:test).

function Badge({ label, color, bg }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        color,
        background: bg,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      {label}
    </span>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "11px 0",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          color: C.navy,
          fontWeight: 600,
          fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
        }}
      >
        {value || "-"}
      </span>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: "16px 18px",
        flex: 1,
        minWidth: 100,
        boxShadow: "0 1px 4px rgba(15,25,35,0.04)",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 800, color: accent || C.navy, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.secondary, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: "var(--fs-2xs)", color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
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

  const initials = profile?.name
    ? profile.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : "U";

  const joinedDate = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "-";

  const lastLogin = profile?.lastLogin
    ? new Date(profile.lastLogin).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "-";

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

  const expiryDate = subscription.expiresAt
    ? new Date(subscription.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;
  // Play subscriptions renew on that date unless cancelled in the Play Store,
  // in which case access simply ends there; Razorpay purchases always just
  // end. "Expires" on a renewing plan reads like a warning and "Renews" on a
  // cancelled one is a lie, so name the date for what it is.
  const expiryLabel = resolveExpiryLabel(subscription);
  const lifecycleNotice = describePlayLifecycle(subscription, expiryDate);
  const playActions = showsPlayActions(subscription, profile?.isPremium);

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

  const authProvider = profile?.authProvider === "google" ? "Google" : "Email & Password";

  const handleReplayTutorial = async () => {
    setReplayingTutorial(true);
    try {
      await resetOnboarding();
    } catch {
      // Even if the API call fails, navigate to dashboard so the tutorial shows
    } finally {
      router.push("/dashboard");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        color: C.navy,
      }}
    >
      <PageHeader showMarketSwitcher={false} />

      <main style={{ maxWidth: 780, margin: "0 auto", padding: "32px 16px 64px" }}>

        {/* Hero Banner */}
        <div
          style={{
            background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyLight} 60%, #1E3A4A 100%)`,
            borderRadius: 18,
            padding: "36px 32px",
            marginBottom: 24,
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(15,25,35,0.18)",
          }}
        >
          {/* Decorative circles */}
          <div
            style={{
              position: "absolute", top: -40, right: -40,
              width: 180, height: 180, borderRadius: "50%",
              background: `rgba(13,158,110,0.08)`,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute", bottom: -60, right: 80,
              width: 240, height: 240, borderRadius: "50%",
              background: `rgba(34,199,142,0.05)`,
              pointerEvents: "none",
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 22, position: "relative" }}>
            {/* Avatar */}
            <div
              style={{
                width: 76,
                height: 76,
                borderRadius: "50%",
                background: `linear-gradient(135deg, ${C.green} 0%, ${C.greenLight} 100%)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 28,
                fontWeight: 700,
                flexShrink: 0,
                boxShadow: `0 0 0 3px rgba(34,199,142,0.3), 0 4px 16px rgba(13,158,110,0.4)`,
              }}
            >
              {loading ? "..." : initials}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h1
                  style={{
                    margin: 0,
                    fontSize: 22,
                    fontWeight: 800,
                    color: "#fff",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {loading ? "Loading..." : profile?.name || "Trader"}
                </h1>
                {!loading && <Badge {...planCfg} />}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.55)",
                  marginTop: 4,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.02em",
                }}
              >
                {loading ? "" : profile?.email || ""}
              </div>
              {!loading && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                  <Badge {...statusCfg} />
                  {profile?.role === "admin" && (
                    <Badge label="Admin" color="#7C3AED" bg="#EDE9FE" />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats Row */}
        {!loading && (
          <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
            <StatCard
              label="Member Since"
              value={joinedDate}
              accent={C.green}
            />
            <StatCard
              label="Last Login"
              value={lastLogin}
              accent={C.navy}
            />
            <StatCard
              label="Auth Method"
              value={authProvider}
              accent={C.secondary}
            />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 20 }}>

          {/* Account Info */}
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: "20px 22px",
              boxShadow: "0 2px 8px rgba(15,25,35,0.05)",
              gridColumn: "1 / -1",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, letterSpacing: "0.12em", marginBottom: 8 }}>
              ACCOUNT INFORMATION
            </div>
            {loading ? (
              <div style={{ fontSize: 13, color: C.muted, padding: "12px 0" }}>Loading profile...</div>
            ) : (
              <>
                <InfoRow label="Full Name" value={profile?.name} />
                <InfoRow label="Email Address" value={profile?.email} mono />
                <InfoRow label="Auth Provider" value={authProvider} />
                <InfoRow label="Role" value={profile?.role === "admin" ? "Administrator" : "Trader"} />
                <div style={{ padding: "11px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>Account Created</span>
                    <span style={{ fontSize: 13, color: C.navy, fontWeight: 600 }}>{joinedDate}</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Subscription */}
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: "20px 22px",
              boxShadow: "0 2px 8px rgba(15,25,35,0.05)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, letterSpacing: "0.12em", marginBottom: 8 }}>
              SUBSCRIPTION
            </div>
            {loading ? (
              <div style={{ fontSize: 13, color: C.muted }}>Loading...</div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <Badge {...planCfg} />
                  <Badge {...statusCfg} />
                </div>
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                  {expiryDate && (
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>
                      {expiryLabel} <span style={{ color: C.navy, fontWeight: 600 }}>{expiryDate}</span>
                    </div>
                  )}
                  {lifecycleNotice && (
                    <div
                      role="status"
                      style={{
                        marginTop: 6,
                        marginBottom: 8,
                        padding: "8px 10px",
                        borderRadius: 8,
                        fontSize: 12,
                        lineHeight: 1.5,
                        background: lifecycleNotice.tone === "warn" ? "#FEF3C7" : "#E0F2FE",
                        color: lifecycleNotice.tone === "warn" ? "#92400E" : "#075985",
                      }}
                    >
                      {lifecycleNotice.text}
                    </div>
                  )}
                  {playActions && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 6 }}>
                      <button
                        type="button"
                        onClick={() => window.open(PLAY_MANAGE_URL, "_blank", "noopener")}
                        style={{
                          padding: "7px 12px",
                          background: "#FFFFFF",
                          color: C.navy,
                          border: `1px solid ${C.borderDark}`,
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Manage subscription
                      </button>
                      {canShowPurchaseUI() && (
                        <button
                          type="button"
                          onClick={() => setPricingOpen(true)}
                          style={{
                            padding: "7px 12px",
                            background: "#FFFFFF",
                            color: C.green,
                            border: `1px solid ${C.green}`,
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          Change plan
                        </button>
                      )}
                    </div>
                  )}
                  {!profile?.isPremium && canShowPurchaseUI() && (
                    <button
                      type="button"
                      onClick={() => setPricingOpen(true)}
                      style={{
                        display: "inline-block",
                        marginTop: 8,
                        padding: "8px 16px",
                        background: `linear-gradient(135deg, ${C.green}, ${C.greenLight})`,
                        color: "#fff",
                        border: "none",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        boxShadow: "0 2px 8px rgba(13,158,110,0.3)",
                      }}
                    >
                      Upgrade Plan <ArrowRight size={12} style={{ verticalAlign: "middle", marginLeft: 4 }} />
                    </button>
                  )}
                  {profile?.isPremium && (
                    <div style={{ fontSize: 12, color: "#15803D", fontWeight: 600 }}>
                      <Check size={13} style={{ verticalAlign: "middle", marginRight: 4 }} /> Full access enabled
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Quick Actions */}
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: "20px 22px",
              boxShadow: "0 2px 8px rgba(15,25,35,0.05)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, letterSpacing: "0.12em", marginBottom: 12 }}>
              QUICK ACTIONS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { href: "/analytics", label: "View Analytics", Icon: BarChart3 },
                { href: "/upload-trade", label: "Upload Trade", Icon: Upload },
                { href: "/weekly-reports", label: "Weekly Reports", Icon: ClipboardList },
                { href: "/indian-market/dashboard", label: "Indian Market", Icon: Globe2 },
                { href: "/support", label: "Help & Support", Icon: LifeBuoy },
              ].map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 12px",
                    borderRadius: 9,
                    border: `1px solid ${C.border}`,
                    textDecoration: "none",
                    color: C.navy,
                    fontSize: 12,
                    fontWeight: 600,
                    transition: "all 0.15s",
                    background: "#FAFAFA",
                  }}
                >
                  <Icon size={14} strokeWidth={2.2} />
                  {label}
                  <ArrowRight size={12} style={{ marginLeft: "auto", color: C.muted }} />
                </Link>
              ))}
              <button
                onClick={handleReplayTutorial}
                disabled={replayingTutorial}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 9,
                  border: `1px solid ${C.green}`,
                  textDecoration: "none",
                  color: C.green,
                  fontSize: 12,
                  fontWeight: 600,
                  transition: "all 0.15s",
                  background: "rgba(13,158,110,0.04)",
                  cursor: replayingTutorial ? "not-allowed" : "pointer",
                  opacity: replayingTutorial ? 0.6 : 1,
                  width: "100%",
                  textAlign: "left",
                }}
              >
                <GraduationCap size={14} strokeWidth={2.2} />
                {replayingTutorial ? "Starting tutorial..." : "Replay App Tutorial"}
                <ArrowRight size={12} style={{ marginLeft: "auto", color: C.green }} />
              </button>
            </div>
          </div>
        </div>

        {/* Play User Data policy / Apple 5.1.1(v): account deletion must be
            reachable from inside the app. */}
        <DeleteAccountSection email={profile?.email} subscription={subscription} />

      </main>

      <PricingModal
        isOpen={pricingOpen}
        onClose={() => setPricingOpen(false)}
        onSuccess={loadProfile}
      />
    </div>
  );
}
