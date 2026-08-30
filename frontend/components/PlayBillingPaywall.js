"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGooglePlayConfig,
  verifyGooglePlayPurchase,
  restoreGooglePlayPurchases,
  getPaywallContext,
  recordTrialEvent,
} from "@/services/api";
import {
  isAndroidApp,
  isBillingAvailable,
  getBillingProducts,
  startPurchase,
  getDevicePurchases,
  onPurchaseUpdated,
} from "@/plugins/EdgeBillingPlugin";
import FocusTrap from "@/features/shared/components/FocusTrap";
import PremiumWelcome from "@/features/premium/components/PremiumWelcome";

// The Android paywall. Google Play Billing only — this component contains no
// Razorpay code and must never gain any: a third-party processor for digital
// goods inside an Android app is a Play Payments policy violation.
//
// Prices come from Play, localised, at runtime. Nothing is hard-coded and
// nothing is sent from our backend, so what the user sees is exactly what
// Google charges them.

// Phase 12's state machine. Rendered explicitly rather than inferred from a
// tangle of booleans, because "pending" in particular must never be allowed to
// look like either success or failure.
const PHASE = {
  LOADING: "loading",
  READY: "ready",
  UNAVAILABLE: "unavailable",
  PURCHASING: "purchasing",
  VERIFYING: "verifying",
  PENDING: "pending",
  RESTORING: "restoring",
  ERROR: "error",
};

// Ordered cheapest-first, matching the web catalogue. Play returns offers in no
// guaranteed order, so the paywall imposes one.
const BASE_PLAN_ORDER = [
  "edgecipline-pro-monthly",
  "edgecipline-pro-3month",
  "edgecipline-pro-6month",
];

const BASE_PLAN_LABELS = {
  "edgecipline-pro-monthly": "1 month",
  "edgecipline-pro-3month": "3 months",
  "edgecipline-pro-6month": "6 months",
};

const GREEN = "#0D9E6E";

export default function PlayBillingPaywall({ isOpen, onClose, onSuccess, variant = "upgrade" }) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState(PHASE.LOADING);
  const [error, setError] = useState("");
  const [offers, setOffers] = useState([]);
  const [selectedBasePlanId, setSelectedBasePlanId] = useState(null);
  const [config, setConfig] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [celebrating, setCelebrating] = useState(null);

  // Guards against a listener firing after unmount, and against the purchase
  // event racing the verify call it triggers.
  const mountedRef = useRef(true);
  const verifyingRef = useRef(false);

  const active = isOpen && isAndroidApp();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const markPremium = useCallback(() => {
    // Entitlement lives on the server; these two queries are how the rest of
    // the app finds out. Without them the user stays on a "Free" UI until the
    // next 60s poll or the 10-minute profile staleTime elapses.
    queryClient.invalidateQueries({ queryKey: ["trial", "status"] });
    queryClient.invalidateQueries({ queryKey: ["userProfile"] });
  }, [queryClient]);

  // ─── Verification ────────────────────────────────────────────────────────

  const verifyToken = useCallback(
    async (purchaseToken, productId) => {
      // Double-tapping Subscribe, or a purchase event arriving twice, must not
      // fire two verifications. The backend is idempotent regardless — this
      // just avoids the pointless round-trip and the flickering UI.
      if (verifyingRef.current) return;
      verifyingRef.current = true;

      try {
        setPhase(PHASE.VERIFYING);
        setError("");
        const result = await verifyGooglePlayPurchase({ purchaseToken, productId });
        if (!mountedRef.current) return;

        markPremium();

        if (result?.entitled) {
          setCelebrating({
            planLabel: "Premium",
            expiresAt: result?.subscription?.expiresAt || null,
          });
          return;
        }

        if (result?.pending) {
          // Google has NOT taken payment yet (cash/voucher methods). Granting
          // here would be free premium; calling it a failure would tell a user
          // who is mid-payment that something broke. Say exactly what is true.
          setPhase(PHASE.PENDING);
          return;
        }

        setPhase(PHASE.ERROR);
        setError(
          "Google Play hasn't confirmed this subscription yet. Reopen the app in a few minutes — you won't be charged twice."
        );
      } catch (err) {
        if (!mountedRef.current) return;
        setPhase(PHASE.ERROR);
        // The money may already be gone. Never suggest paying again — the
        // reconcile-on-resume path will pick this up by itself.
        setError(
          err?.message ||
            "We couldn't confirm your purchase. Please don't buy again — reopen the app shortly and it will be restored automatically."
        );
      } finally {
        verifyingRef.current = false;
      }
    },
    [markPremium]
  );

  // ─── Restore ─────────────────────────────────────────────────────────────

  const handleRestore = useCallback(async () => {
    try {
      setPhase(PHASE.RESTORING);
      setError("");
      const { purchases } = await getDevicePurchases();
      const tokens = (purchases || []).map((p) => p?.purchaseToken).filter(Boolean);

      if (!tokens.length) {
        setPhase(PHASE.READY);
        setError("No previous Google Play subscription was found on this device.");
        return;
      }

      const result = await restoreGooglePlayPurchases(tokens);
      if (!mountedRef.current) return;
      markPremium();

      if (result?.entitled) {
        setCelebrating({ planLabel: "Premium", expiresAt: result?.subscription?.expiresAt || null });
        return;
      }

      setPhase(PHASE.READY);
      // The most useful failure to name explicitly: the purchase on this
      // device belongs to a different Edgecipline account. Anything else stays
      // generic.
      const conflict = (result?.results || []).find((r) => r?.message);
      setError(
        conflict?.message ||
          "We found a purchase but it isn't currently active. If you believe this is wrong, contact support."
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setPhase(PHASE.READY);
      setError(err?.message || "Restore failed. Check your connection and try again.");
    }
  }, [markPremium]);

  // ─── Load catalogue ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;

    (async () => {
      try {
        setPhase(PHASE.LOADING);
        setError("");

        const availability = await isBillingAvailable();
        if (cancelled) return;
        if (!availability?.available) {
          setPhase(PHASE.UNAVAILABLE);
          setError(
            "Google Play billing isn't available on this device right now. Make sure the Play Store is installed and up to date."
          );
          return;
        }

        const billingConfig = await getGooglePlayConfig();
        if (cancelled) return;
        if (!billingConfig?.available) {
          setPhase(PHASE.UNAVAILABLE);
          setError("In-app purchases are temporarily unavailable. Please try again later.");
          return;
        }
        setConfig(billingConfig);

        const { offers: playOffers } = await getBillingProducts(billingConfig.productId);
        if (cancelled) return;

        // Base plans only. An offer with an offerId is a promotional or
        // free-trial variant of a base plan; showing both would list the same
        // tier twice at two different prices.
        const basePlanOffers = (playOffers || []).filter((offer) => !offer.offerId);
        const ordered = [...basePlanOffers].sort(
          (a, b) => BASE_PLAN_ORDER.indexOf(a.basePlanId) - BASE_PLAN_ORDER.indexOf(b.basePlanId)
        );

        if (!ordered.length) {
          setPhase(PHASE.UNAVAILABLE);
          setError(
            "No subscription options are available right now. Please try again later."
          );
          return;
        }

        setOffers(ordered);
        setSelectedBasePlanId(ordered[0].basePlanId);
        setPhase(PHASE.READY);
      } catch (err) {
        if (cancelled) return;
        setPhase(PHASE.ERROR);
        setError(err?.message || "Couldn't load subscription options. Check your connection.");
      }
    })();

    // Personalised copy. Best-effort — the paywall must still work if it fails.
    getPaywallContext()
      .then((data) => {
        if (!cancelled) setCtx(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [active]);

  // ─── Purchase outcomes ───────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return undefined;
    let handle;
    let cancelled = false;

    const subscription = onPurchaseUpdated((event) => {
      if (!mountedRef.current) return;

      if (event?.status === "purchased") {
        const purchase = (event.purchases || [])[0];
        if (purchase?.purchaseToken) {
          verifyToken(purchase.purchaseToken, (purchase.products || [])[0]);
        }
        return;
      }

      if (event?.status === "cancelled") {
        // The user backed out. Not an error — say nothing and let them choose
        // again or close.
        setPhase(PHASE.READY);
        setError("");
        return;
      }

      if (event?.status === "already_owned") {
        // Play says there is a subscription this install doesn't know about.
        // Restoring is exactly the right response and needs no user action.
        handleRestore();
        return;
      }

      setPhase(PHASE.ERROR);
      setError(event?.message || "The purchase couldn't be completed. Please try again.");
    });

    Promise.resolve(subscription)
      .then((h) => {
        if (cancelled) h?.remove?.();
        else handle = h;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      handle?.remove?.();
    };
  }, [active, verifyToken, handleRestore]);

  const selectedOffer =
    offers.find((offer) => offer.basePlanId === selectedBasePlanId) || offers[0] || null;

  const handleSubscribe = useCallback(async () => {
    if (!selectedOffer || !config) return;
    // Guard against a double tap opening two Play sheets.
    if (phase === PHASE.PURCHASING || phase === PHASE.VERIFYING) return;

    try {
      setPhase(PHASE.PURCHASING);
      setError("");
      recordTrialEvent("paywall_cta_clicked", { variant, provider: "google_play" });

      await startPurchase({
        productId: selectedOffer.productId,
        offerToken: selectedOffer.offerToken,
        // Binds the purchase to this Edgecipline account so it cannot later be
        // claimed by whoever signs in next on this device.
        obfuscatedAccountId: config.obfuscatedAccountId,
      });
      // Resolves once Play's sheet is on screen. The outcome arrives on the
      // purchaseUpdated listener above — including if the app is killed and
      // reopened before the user finishes.
    } catch (err) {
      setPhase(PHASE.ERROR);
      setError(err?.message || "Couldn't open Google Play. Please try again.");
    }
  }, [selectedOffer, config, phase, variant]);

  const handleClose = useCallback(() => {
    recordTrialEvent("paywall_dismissed", { variant, provider: "google_play" });
    if (typeof onClose === "function") onClose();
  }, [onClose, variant]);

  if (celebrating) {
    return (
      <PremiumWelcome
        open
        planLabel={celebrating.planLabel}
        expiresAt={celebrating.expiresAt}
        onClose={() => {
          setCelebrating(null);
          if (typeof onSuccess === "function") onSuccess();
          if (typeof onClose === "function") onClose();
        }}
      />
    );
  }

  if (!active) return null;

  const busy =
    phase === PHASE.PURCHASING || phase === PHASE.VERIFYING || phase === PHASE.RESTORING;
  const headline = ctx?.headline || "Unlock your full edge";
  const subheadline =
    ctx?.subheadline ||
    "Unlimited AI insights, weekly reports, and the full coach — billed securely through Google Play.";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
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
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}
        >
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            disabled={busy}
            style={{
              position: "absolute",
              top: 20,
              right: 20,
              background: "#F1F5F9",
              border: "none",
              width: 34,
              height: 34,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
              color: "#64748B",
              zIndex: 10,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div style={{ padding: "40px 32px 32px" }}>
            <div
              style={{
                display: "inline-block",
                padding: "6px 12px",
                background: "rgba(13,158,110,0.1)",
                color: GREEN,
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 16,
              }}
            >
              Keep your edge
            </div>

            <h2
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: "#0F1923",
                margin: 0,
                letterSpacing: "-0.03em",
                lineHeight: 1.2,
              }}
            >
              {headline}
            </h2>
            <p style={{ fontSize: 14, color: "#64748B", lineHeight: 1.55, marginTop: 10, marginBottom: 24 }}>
              {subheadline}
            </p>

            {phase === PHASE.LOADING && <PaywallSkeleton />}

            {phase === PHASE.PENDING && (
              <StatusPanel
                tone="info"
                title="Waiting for Google Play"
                body="Your payment is still being processed by Google. Premium unlocks automatically as soon as it clears — there's nothing else to do, and you won't be charged twice."
              />
            )}

            {phase === PHASE.UNAVAILABLE && (
              <StatusPanel tone="warn" title="Purchases unavailable" body={error} />
            )}

            {/* Plan picker. Prices are Play's own, already localised. */}
            {offers.length > 0 && phase !== PHASE.PENDING && phase !== PHASE.UNAVAILABLE && (
              <div
                role="radiogroup"
                aria-label="Choose a plan"
                style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}
              >
                {offers.map((offer) => {
                  const isSelected = offer.basePlanId === selectedOffer?.basePlanId;
                  return (
                    <button
                      key={offer.basePlanId}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      disabled={busy}
                      onClick={() => setSelectedBasePlanId(offer.basePlanId)}
                      style={{
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "14px 16px",
                        borderRadius: 16,
                        cursor: busy ? "default" : "pointer",
                        border: isSelected ? `2px solid ${GREEN}` : "1px solid #E2E8F0",
                        background: isSelected ? "rgba(13,158,110,0.06)" : "#FFFFFF",
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 700, color: "#0F1923" }}>
                        {BASE_PLAN_LABELS[offer.basePlanId] || offer.basePlanId}
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: "#0F1923" }}>
                        {offer.formattedPrice}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {error && phase !== PHASE.UNAVAILABLE && phase !== PHASE.PENDING && (
              <p
                role="alert"
                style={{
                  fontSize: 13,
                  color: "#B91C1C",
                  background: "rgba(220,38,38,0.08)",
                  borderRadius: 12,
                  padding: "10px 12px",
                  marginBottom: 14,
                  lineHeight: 1.5,
                }}
              >
                {error}
              </p>
            )}

            {phase !== PHASE.UNAVAILABLE && phase !== PHASE.PENDING && (
              <button
                type="button"
                onClick={handleSubscribe}
                disabled={busy || !selectedOffer}
                style={{
                  width: "100%",
                  padding: "15px 20px",
                  borderRadius: 16,
                  border: "none",
                  background: busy || !selectedOffer ? "#94A3B8" : GREEN,
                  color: "#FFFFFF",
                  fontSize: 15,
                  fontWeight: 800,
                  cursor: busy || !selectedOffer ? "default" : "pointer",
                }}
              >
                {phase === PHASE.VERIFYING
                  ? "Confirming your subscription…"
                  : phase === PHASE.PURCHASING
                    ? "Opening Google Play…"
                    : selectedOffer
                      ? `Subscribe · ${selectedOffer.formattedPrice}`
                      : "Subscribe"}
              </button>
            )}

            <button
              type="button"
              onClick={handleRestore}
              disabled={busy}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "12px 20px",
                borderRadius: 16,
                border: "1px solid #E2E8F0",
                background: "#FFFFFF",
                color: "#475569",
                fontSize: 14,
                fontWeight: 700,
                cursor: busy ? "default" : "pointer",
              }}
            >
              {phase === PHASE.RESTORING ? "Restoring…" : "Restore purchases"}
            </button>

            <p style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.5, marginTop: 14, textAlign: "center" }}>
              Billed through Google Play and renews automatically. Cancel any time in the Play Store
              &rsaquo; Subscriptions.
            </p>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}

function StatusPanel({ tone, title, body }) {
  const palette =
    tone === "warn"
      ? { bg: "rgba(217,119,6,0.08)", fg: "#B45309" }
      : { bg: "rgba(13,158,110,0.08)", fg: "#0F766E" };
  return (
    <div style={{ background: palette.bg, borderRadius: 16, padding: "16px 18px", marginBottom: 18 }}>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: palette.fg }}>{title}</p>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "#475569", lineHeight: 1.55 }}>{body}</p>
    </div>
  );
}

function PaywallSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            height: 54,
            borderRadius: 16,
            background: "linear-gradient(90deg,#F1F5F9 0%,#E2E8F0 50%,#F1F5F9 100%)",
          }}
        />
      ))}
    </div>
  );
}
