"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getAppStoreConfig,
  verifyAppStorePurchase,
  restoreAppStorePurchases,
  getPaywallContext,
  recordTrialEvent,
} from "@/services/api";
import {
  isIOSApp,
  isStoreKitAvailable,
  getStoreKitProducts,
  startStoreKitPurchase,
  finishStoreKitTransaction,
  restoreStoreKitPurchases,
  openStoreKitManageSubscriptions,
  onStoreKitTransactionUpdated,
} from "@/plugins/EdgeStoreKitPlugin";
import FocusTrap from "@/features/shared/components/FocusTrap";
import RecentTradeCards, { LockedInsightTeaser } from "@/features/trade/components/RecentTradeCards";
import PremiumWelcome from "@/features/premium/components/PremiumWelcome";

// The iPhone paywall. Apple In-App Purchase only — this component must never
// reference any other payment processor or mention buying elsewhere (App Store
// Guidelines 3.1.1 and 3.1.3).
//
// Prices come from StoreKit, localised, at runtime. Nothing is hard-coded and
// nothing is sent from our backend.
//
// What Guideline 3.1.2 requires on the purchase screen, all present below:
// the plan title and length, the price, that it auto-renews and how to cancel,
// a Restore Purchases control, and links to the Terms of Use and Privacy Policy.

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

const GREEN = "#0D9E6E";

// Cheapest first, matching the Android paywall. Unknown ids are not sold.
const PLAN_ORDER = [
  "com.edgecipline.pro.monthly",
  "com.edgecipline.pro.3month",
  "com.edgecipline.pro.6month",
];
const PLAN_LABELS = {
  "com.edgecipline.pro.monthly": "1 month",
  "com.edgecipline.pro.3month": "3 months",
  "com.edgecipline.pro.6month": "6 months",
};

function periodText(period) {
  if (!period?.unit) return "";
  const value = Number(period.value) || 1;
  const unit = value === 1 ? period.unit : `${period.unit}s`;
  return value === 1 ? `per ${unit}` : `every ${value} ${unit}`;
}

export default function AppStorePaywall({ isOpen, onClose, onSuccess, variant = "upgrade" }) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState(PHASE.LOADING);
  const [error, setError] = useState("");
  const [products, setProducts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [config, setConfig] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [celebrating, setCelebrating] = useState(null);

  const mountedRef = useRef(true);
  const verifyingRef = useRef(false);

  const active = isOpen && isIOSApp();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const markPremium = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["trial", "status"] });
    queryClient.invalidateQueries({ queryKey: ["userProfile"] });
  }, [queryClient]);

  // ─── Verification ────────────────────────────────────────────────────────

  const verifyAndFinish = useCallback(
    async ({ signedTransaction, transactionId }) => {
      if (verifyingRef.current) return;
      verifyingRef.current = true;
      try {
        setPhase(PHASE.VERIFYING);
        setError("");
        const result = await verifyAppStorePurchase({ signedTransaction });
        // Recorded server-side; only now tell StoreKit it is delivered. If
        // anything above threw, the transaction stays unfinished and StoreKit
        // redelivers it on the next launch — the purchase cannot be lost.
        await finishStoreKitTransaction(transactionId);
        if (!mountedRef.current) return;
        markPremium();
        if (result?.premium || result?.subscription?.entitled) {
          setCelebrating({ planLabel: "Premium", expiresAt: result?.expiresAt || null });
          return;
        }
        setPhase(PHASE.ERROR);
        setError("Apple hasn't confirmed this subscription yet. Reopen the app in a few minutes — you won't be charged twice.");
      } catch (err) {
        if (!mountedRef.current) return;
        setPhase(PHASE.ERROR);
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
      const { transactions } = await restoreStoreKitPurchases();
      if (!transactions?.length) {
        setPhase(PHASE.READY);
        setError("No active Edgecipline subscription was found for this Apple ID.");
        return;
      }
      const result = await restoreAppStorePurchases(transactions);
      if (!mountedRef.current) return;
      markPremium();
      if (result?.premium) {
        setCelebrating({ planLabel: "Premium", expiresAt: result?.expiresAt || null });
        return;
      }
      setPhase(PHASE.READY);
      const ownedElsewhere = (result?.results || []).some(
        (r) => r?.errorCode === "APP_STORE_PURCHASE_OWNED_ELSEWHERE" || r?.errorCode === "APP_STORE_ACCOUNT_MISMATCH"
      );
      setError(
        ownedElsewhere
          ? "This Apple ID's subscription is linked to a different Edgecipline account. Sign in with that account to use it."
          : "We found a purchase but it isn't currently active. If you believe this is wrong, contact support."
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

        const availability = await isStoreKitAvailable();
        if (cancelled) return;
        if (!availability?.available) {
          setPhase(PHASE.UNAVAILABLE);
          setError("Purchases are turned off on this device. You can allow them in Settings › Screen Time.");
          return;
        }

        const storeConfig = await getAppStoreConfig();
        if (cancelled) return;
        if (!storeConfig?.available || !storeConfig?.appAccountToken) {
          setPhase(PHASE.UNAVAILABLE);
          setError("In-app purchases are temporarily unavailable. Please try again later.");
          return;
        }
        setConfig(storeConfig);

        const { products: storeProducts } = await getStoreKitProducts(storeConfig.productIds);
        if (cancelled) return;
        const ordered = (storeProducts || [])
          .filter((p) => PLAN_ORDER.includes(p.productId))
          .sort((a, b) => PLAN_ORDER.indexOf(a.productId) - PLAN_ORDER.indexOf(b.productId));

        if (!ordered.length) {
          setPhase(PHASE.UNAVAILABLE);
          setError("No subscription options are available right now. Please try again later.");
          return;
        }
        setProducts(ordered);
        setSelectedId(ordered[0].productId);
        setPhase(PHASE.READY);
      } catch (err) {
        if (cancelled) return;
        setPhase(PHASE.ERROR);
        setError(err?.message || "Couldn't load subscription options. Check your connection.");
      }
    })();

    getPaywallContext()
      .then((data) => {
        if (!cancelled) setCtx(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [active]);

  // Purchases that complete outside the sheet's promise: Ask to Buy approved
  // later, or a transaction left unfinished by a previous launch.
  useEffect(() => {
    if (!active) return undefined;
    let handle;
    let cancelled = false;
    const subscription = onStoreKitTransactionUpdated((event) => {
      if (!mountedRef.current || !event?.signedTransaction) return;
      verifyAndFinish(event);
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
  }, [active, verifyAndFinish]);

  const selected = products.find((p) => p.productId === selectedId) || products[0] || null;

  const handleSubscribe = useCallback(async () => {
    if (!selected || !config) return;
    if (phase === PHASE.PURCHASING || phase === PHASE.VERIFYING) return;
    try {
      setPhase(PHASE.PURCHASING);
      setError("");
      recordTrialEvent("paywall_cta_clicked", { variant, provider: "app_store" });
      if (variant === "trade-limit") {
        recordTrialEvent("free_nudge_cta_clicked", {
          surface: "trade_limit_paywall",
          provider: "app_store",
          teaser: ctx?.teaserInsight?.code || null,
        });
      }

      // Switching between plans needs nothing special: all three share one
      // subscription group, so StoreKit treats a different one as a plan change.
      const result = await startStoreKitPurchase({
        productId: selected.productId,
        appAccountToken: config.appAccountToken,
      });

      if (result?.status === "purchased") {
        await verifyAndFinish(result);
        return;
      }
      if (result?.status === "pending") {
        setPhase(PHASE.PENDING);
        return;
      }
      // Cancelled: not an error.
      setPhase(PHASE.READY);
    } catch (err) {
      setPhase(PHASE.ERROR);
      setError(err?.message || "The purchase couldn't be completed. Please try again.");
    }
  }, [selected, config, phase, variant, ctx, verifyAndFinish]);

  const handleClose = useCallback(() => {
    recordTrialEvent("paywall_dismissed", { variant, provider: "app_store" });
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

  const busy = phase === PHASE.PURCHASING || phase === PHASE.VERIFYING || phase === PHASE.RESTORING;
  const headline = ctx?.headline || "Unlock your full edge";
  const subheadline =
    ctx?.subheadline || "Unlimited AI insights, weekly reports, and the full coach.";

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
        padding: "max(20px, env(safe-area-inset-top, 0px)) max(20px, env(safe-area-inset-right, 0px)) max(20px, env(safe-area-inset-bottom, 0px)) max(20px, env(safe-area-inset-left, 0px))",
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
            maxHeight: "min(720px, calc(100vh - 40px))",
            display: "flex",
            flexDirection: "column",
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

          <div style={{ padding: "40px 32px 28px", overflowY: "auto", WebkitOverflowScrolling: "touch", minHeight: 0 }}>
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
              {variant === "trade-limit" ? "Free plan limit" : "Keep your edge"}
            </div>

            <h2 style={{ fontSize: 26, fontWeight: 800, color: "#0F1923", margin: 0, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
              {headline}
            </h2>
            <p style={{ fontSize: 14, color: "#64748B", lineHeight: 1.55, marginTop: 10, marginBottom: 24 }}>
              {subheadline}
            </p>

            {variant === "trade-limit" && Array.isArray(ctx?.recentTrades) && ctx.recentTrades.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                <RecentTradeCards trades={ctx.recentTrades} compact />
                <LockedInsightTeaser teaser={ctx?.teaserInsight} compact />
              </div>
            )}

            {phase === PHASE.LOADING && <PaywallSkeleton />}

            {phase === PHASE.PENDING && (
              <StatusPanel
                tone="info"
                title="Waiting for approval"
                body="This purchase needs approval (for example Ask to Buy). Premium unlocks automatically once it's approved — you won't be charged twice."
              />
            )}

            {phase === PHASE.UNAVAILABLE && <StatusPanel tone="warn" title="Purchases unavailable" body={error} />}

            {products.length > 0 && phase !== PHASE.PENDING && phase !== PHASE.UNAVAILABLE && (
              <div role="radiogroup" aria-label="Choose a plan" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
                {products.map((product) => {
                  const isSelected = product.productId === selected?.productId;
                  return (
                    <button
                      key={product.productId}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      disabled={busy}
                      onClick={() => setSelectedId(product.productId)}
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
                      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "#0F1923" }}>
                          Pro · {PLAN_LABELS[product.productId] || product.displayName}
                        </span>
                        <span style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                          Auto-renews {periodText(product.period)}
                        </span>
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: "#0F1923", whiteSpace: "nowrap" }}>
                        {product.displayPrice}
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
                disabled={busy || !selected}
                style={{
                  width: "100%",
                  padding: "15px 20px",
                  borderRadius: 16,
                  border: "none",
                  background: busy || !selected ? "#94A3B8" : GREEN,
                  color: "#FFFFFF",
                  fontSize: 15,
                  fontWeight: 800,
                  cursor: busy || !selected ? "default" : "pointer",
                }}
              >
                {phase === PHASE.VERIFYING
                  ? "Confirming your subscription…"
                  : phase === PHASE.PURCHASING
                    ? "Opening the App Store…"
                    : selected
                      ? `Subscribe · ${selected.displayPrice}`
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

            {/* Guideline 3.1.2 auto-renewal disclosure. */}
            <p style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.55, marginTop: 14, textAlign: "center" }}>
              Billed to your Apple ID at confirmation of purchase. The subscription renews
              automatically at the same price unless auto-renew is turned off at least 24 hours
              before the end of the current period. Manage or cancel any time in{" "}
              <button
                type="button"
                onClick={() => openStoreKitManageSubscriptions().catch(() => {})}
                style={{ background: "none", border: "none", padding: 0, color: "#64748B", textDecoration: "underline", fontSize: 11, cursor: "pointer" }}
              >
                Settings › Apple ID › Subscriptions
              </button>
              .
            </p>
            <p style={{ fontSize: 11, color: "#64748B", marginTop: 8, textAlign: "center" }}>
              <Link href="/terms" style={{ color: "#64748B", textDecoration: "underline" }}>
                Terms of Use
              </Link>
              {"  ·  "}
              <Link href="/privacy-policy" style={{ color: "#64748B", textDecoration: "underline" }}>
                Privacy Policy
              </Link>
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
            height: 62,
            borderRadius: 16,
            background: "linear-gradient(90deg,#F1F5F9 0%,#E2E8F0 50%,#F1F5F9 100%)",
          }}
        />
      ))}
    </div>
  );
}
