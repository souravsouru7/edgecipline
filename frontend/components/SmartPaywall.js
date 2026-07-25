"use client";

import { useEffect, useState } from "react";
import {
  createPaymentOrder,
  verifyPayment,
  getPaywallContext,
  recordTrialEvent,
} from "@/services/api";
import { validateEnvironment } from "@/config/environment";
import FocusTrap from "@/features/shared/components/FocusTrap";

let razorpayCheckoutPromise = null;

function isNativeAndroidApp() {
  if (typeof window === "undefined") return false;
  const capacitor = window.Capacitor;
  if (!capacitor) return false;
  if (typeof capacitor.getPlatform === "function") {
    return capacitor.getPlatform() === "android";
  }
  return Boolean(capacitor.isNativePlatform?.()) && /Android/i.test(window.navigator?.userAgent || "");
}

function isSandboxCheckout() {
  return isNativeAndroidApp() || !String(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "").trim();
}

function loadRazorpayCheckout() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Checkout is only available in the browser."));
  }
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (razorpayCheckoutPromise) return razorpayCheckoutPromise;

  if (isSandboxCheckout()) {
    razorpayCheckoutPromise = import("@/utils/mockRazorpay")
      .then(({ injectMockRazorpay }) => {
        injectMockRazorpay();
        if (!window.Razorpay) throw new Error("Sandbox checkout failed to initialize.");
        return window.Razorpay;
      })
      .catch((error) => {
        razorpayCheckoutPromise = null;
        throw error;
      });
    return razorpayCheckoutPromise;
  }

  razorpayCheckoutPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-razorpay-checkout='true']");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Razorpay), { once: true });
      existing.addEventListener("error", () => reject(new Error("Razorpay Checkout could not be loaded.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error("Razorpay Checkout loaded without exposing Razorpay."));
    };
    script.onerror = () => reject(new Error("Razorpay Checkout could not be loaded."));
    document.body.appendChild(script);
  }).catch((error) => {
    razorpayCheckoutPromise = null;
    throw error;
  });

  return razorpayCheckoutPromise;
}

// SmartPaywall — opens after trial expiry OR when a user explicitly upgrades.
// Unlike a generic price card, every label here references the user's own
// progress so the offer feels earned, not extracted.
//
// Props:
//   isOpen     — controls visibility
//   onClose    — callback to dismiss
//   onSuccess  — invoked after Razorpay verifies the payment
//   variant    — "trial_ended" | "upgrade" (default). Adjusts headline copy.

const METRIC_TILES = [
  { key: "disciplineScore",     label: "Your Discipline Score", emptyHint: "Log a trade to start your streak" },
  { key: "tradesLogged",        label: "Trades Logged",         emptyHint: "Add your first trade" },
  { key: "bestSetup",           label: "Best Setup",            emptyHint: "Tag setups to discover yours" },
  { key: "aiInsightsGenerated", label: "AI Insights Generated", emptyHint: "Unlock after trial" },
  { key: "weeklyReports",       label: "Weekly Reports",        emptyHint: "Earn one each Sunday" },
];

function formatTile(key, metrics) {
  if (key === "bestSetup") {
    const bs = metrics?.bestSetup;
    if (bs?.name) return { value: bs.name, sub: `${bs.winRate}% win · ${bs.trades} trades` };
    return null;
  }
  const v = metrics?.[key];
  if (typeof v !== "number" || v <= 0) return null;
  return { value: String(v), sub: null };
}

export default function SmartPaywall({ isOpen, onClose, onSuccess, variant = "upgrade" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ctx, setCtx] = useState(null);
  const [ctxLoading, setCtxLoading] = useState(true);

  // Razorpay SDK — loads real SDK when key is set, injects sandbox mock otherwise.
  useEffect(() => {
    if (!isOpen) return;
    loadRazorpayCheckout().catch(() => {});
  }, [isOpen]);

  // Personalized context — loaded each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setCtxLoading(true);
    setError("");
    getPaywallContext()
      .then((data) => { if (!cancelled) setCtx(data); })
      .catch(() => { if (!cancelled) setCtx(null); })
      .finally(() => { if (!cancelled) setCtxLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  const handlePayment = async () => {
    try {
      setLoading(true);
      setError("");
      recordTrialEvent("paywall_cta_clicked", {
        variant,
        trialEnded: Boolean(ctx?.trialEnded),
      });

      const environment = validateEnvironment();
      const isSandbox = isSandboxCheckout();
      const RazorpayCheckout = await loadRazorpayCheckout();

      const order = await createPaymentOrder();
      const options = {
        key: isSandbox ? "rzp_sandbox_demo" : environment.razorpayKeyId,
        amount: order.amount,
        currency: order.currency,
        name: "Edgecipline",
        description: ctx?.cta?.orderableLabel || "3 Months Premium Access",
        image: "/mainlogo1.png",
        order_id: order.id,
        handler: async (response) => {
          try {
            setLoading(true);
            const result = await verifyPayment({
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
            });
            if (result.success) {
              if (typeof onSuccess === "function") onSuccess();
              if (typeof onClose === "function") onClose();
              return;
            }
            setError("Payment could not be confirmed. Please try again.");
          } catch (verifyError) {
            setError(verifyError?.message || "Payment verification failed. Please contact support.");
          } finally {
            setLoading(false);
          }
        },
        prefill: {
          name:  (typeof window !== "undefined" && localStorage.getItem("userName"))  || "",
          email: (typeof window !== "undefined" && localStorage.getItem("userEmail")) || "",
        },
        theme: { color: "#0D9E6E" },
        modal: {
          ondismiss: () => setLoading(false),
        },
      };
      const rzp1 = new RazorpayCheckout(options);
      rzp1.on("payment.failed", (resp = {}) => {
        setLoading(false);
        setError(resp.error?.description || "Payment failed. Please try again.");
      });
      rzp1.open();
    } catch (err) {
      setError(err.message || "Failed to initialize payment");
      setLoading(false);
    }
  };

  const handleClose = () => {
    recordTrialEvent("paywall_dismissed", { variant, trialEnded: Boolean(ctx?.trialEnded) });
    if (typeof onClose === "function") onClose();
  };

  if (!isOpen) return null;

  const sandboxMode = isSandboxCheckout();
  const headline =
    ctx?.headline ||
    (variant === "trial_ended" ? "Your 7-day Premium trial has ended" : "Unlock your full edge");
  const subheadline =
    ctx?.subheadline ||
    "Continue improving with unlimited AI insights, weekly reports, and the full coach.";

  const tiles = METRIC_TILES
    .map((t) => ({ ...t, payload: formatTile(t.key, ctx?.metrics) }))
    .filter((t) => t.payload !== null);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(10, 15, 20, 0.78)",
        padding: 20,
      }}
    >
      <FocusTrap>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Upgrade to Edgecipline Premium"
          style={{
            background: "#FFFFFF",
            borderRadius: 28,
            width: "100%",
            maxWidth: 520,
            border: "1px solid rgba(226, 232, 240, 0.8)",
            boxShadow: "0 40px 100px -20px rgba(0,0,0,0.35)",
            position: "relative",
            overflow: "hidden",
            animation: "modalFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}
        >
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            style={{
              position: "absolute", top: 20, right: 20,
              background: "#F1F5F9", border: "none",
              width: 34, height: 34, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "#64748B", zIndex: 10,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div style={{ padding: "40px 32px 32px" }}>
            <div style={{
              display: "inline-block",
              padding: "6px 12px",
              background: ctx?.trialEnded ? "rgba(220,38,38,0.1)" : "rgba(13,158,110,0.1)",
              color: ctx?.trialEnded ? "#DC2626" : "#0D9E6E",
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 16,
            }}>
              {ctx?.trialEnded ? "Trial Ended" : "Keep your edge"}
            </div>

            <h2 style={{
              fontSize: 26,
              fontWeight: 800,
              color: "#0F1923",
              margin: 0,
              letterSpacing: "-0.03em",
              lineHeight: 1.2,
            }}>
              {headline}
            </h2>
            <p style={{
              fontSize: 14,
              color: "#64748B",
              lineHeight: 1.55,
              marginTop: 10,
              marginBottom: 24,
            }}>
              {subheadline}
            </p>

            {/* Personalized metric grid */}
            {ctxLoading ? (
              <MetricsSkeleton />
            ) : tiles.length > 0 ? (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
                marginBottom: 24,
              }}>
                {tiles.map((t) => (
                  <MetricTile key={t.key} label={t.label} value={t.payload.value} sub={t.payload.sub} />
                ))}
              </div>
            ) : (
              <ColdStartCallout />
            )}

            {/* Price */}
            <div style={{
              background: "linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)",
              borderRadius: 20,
              padding: 20,
              border: "1px solid #E2E8F0",
              marginBottom: 18,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", letterSpacing: "0.04em" }}>
                  CONTINUE IMPROVING FOR ONLY
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 30, fontWeight: 800, color: "#0F1923", letterSpacing: "-0.02em" }}>
                    ₹50
                  </span>
                  <span style={{ fontSize: 14, color: "#64748B", fontWeight: 600 }}>/month</span>
                </div>
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                  Billed ₹150 every 3 months · Cancel anytime
                </div>
              </div>
              <div aria-hidden="true" style={{
                width: 40, height: 40, borderRadius: 12,
                background: "rgba(13,158,110,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#0D9E6E",
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>

            {error && (
              <div style={{
                color: "#D63B3B",
                fontSize: 12,
                marginBottom: 14,
                padding: 10,
                background: "#FEF2F2",
                borderRadius: 10,
                border: "1px solid #FEE2E2",
                fontWeight: 600,
              }}>
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handlePayment}
              disabled={loading}
              style={{
                width: "100%",
                padding: 18,
                background: "linear-gradient(135deg, #0F1923 0%, #1e293b 100%)",
                color: "#22C78E",
                border: "none",
                borderRadius: 14,
                fontSize: 15,
                fontWeight: 800,
                cursor: loading ? "wait" : "pointer",
                letterSpacing: "0.02em",
                boxShadow: "0 16px 36px -10px rgba(15,25,35,0.32)",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Processing..." : (ctx?.cta?.label || "Continue improving")}
            </button>

            <div style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              color: "#94A3B8",
              fontSize: 11,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>{sandboxMode ? "Sandbox demo - no real charge" : "Secure payment via Razorpay - Your data stays yours"}</span>
            </div>
          </div>

          <style>{`
            @keyframes modalFadeIn {
              from { opacity: 0; transform: scale(0.95) translateY(12px); }
              to   { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>
        </div>
      </FocusTrap>
    </div>
  );
}

function MetricTile({ label, value, sub }) {
  return (
    <div style={{
      background: "#FAFAFA",
      border: "1px solid #EEF2F6",
      borderRadius: 14,
      padding: "12px 14px",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#0F1923", marginTop: 2, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

function MetricsSkeleton() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 24 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{
          height: 70, borderRadius: 14, background: "linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%)",
          backgroundSize: "200% 100%", animation: "shimmer 1.4s linear infinite",
        }} />
      ))}
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}

// Shown when the user has no measurable activity yet — never make them feel
// like they're being charged for something they didn't earn. Reframe the
// offer as "this is what's waiting".
function ColdStartCallout() {
  return (
    <div style={{
      background: "#F8FAFC",
      border: "1px dashed #CBD5E1",
      borderRadius: 14,
      padding: 16,
      marginBottom: 24,
      color: "#475569",
      fontSize: 13,
      lineHeight: 1.55,
    }}>
      You haven&apos;t logged enough data yet — but Premium unlocks the moment you do:
      unlimited AI screenshot extractions, weekly behavioral recaps, and your personal
      Trading DNA. Start with a single trade and see the difference.
    </div>
  );
}
