"use client";

import { useEffect, useRef, useState } from "react";
import PaywallGate from "@/components/PaywallGate";
import FocusTrap from "@/features/shared/components/FocusTrap";
import { canShowPurchaseUI } from "@/config/payments";
import { dismissLastFreeTradeSheet, getPaywallContext, recordTrialEvent } from "@/services/api";
import { marketLabel } from "@/features/trade/lib/tradeLimit";
import RecentTradeCards, { LockedInsightTeaser } from "./RecentTradeCards";

// Soft, dismissible sheet shown ONCE — right after the save that used the
// account's last free trade in a market. It is not the wall (the user just
// saved successfully); it is the moment to show them their own trades and
// the locked read on them, then let them carry on.
//
// The server decides whether it appears (`showLastFreeTradeSheet` on the
// create response, false once dismissed on any device), and "Maybe later"
// persists the dismissal server-side. Nothing here threatens data loss or
// invents a deadline: the log stays readable on the free tier.
//
// Props:
//   open        — controlled visibility
//   quota       — { market, limit, ... } from the create response
//   onClose     — called after dismissal or after the paywall closes; the
//                 caller resumes its normal post-save navigation here
//   onUpgraded  — optional, forwarded to the paywall's onSuccess
export default function LastFreeTradeSheet({ open, quota, onClose, onUpgraded }) {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const viewedRef = useRef(false);
  const closingRef = useRef(false);

  const purchaseAvailable = canShowPurchaseUI();
  const label = marketLabel(quota?.market);
  const limit = quota?.limit ?? 2;

  useEffect(() => {
    if (!open) {
      viewedRef.current = false;
      closingRef.current = false;
      setPaywallOpen(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    getPaywallContext()
      .then((data) => { if (!cancelled) setCtx(data || null); })
      .catch(() => { if (!cancelled) setCtx(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    if (!viewedRef.current) {
      viewedRef.current = true;
      recordTrialEvent("free_sheet_viewed", { market: quota?.market || null, purchaseAvailable });
    }
    return () => { cancelled = true; };
  }, [open, quota?.market, purchaseAvailable]);

  // Escape = "Maybe later".
  useEffect(() => {
    if (!open || paywallOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") handleLater();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paywallOpen]);

  if (!open) return null;

  const finish = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Persist first so a second device polling right now already sees it;
    // the promise is best-effort and never blocks the UI.
    dismissLastFreeTradeSheet();
    if (typeof onClose === "function") onClose();
  };

  const handleLater = () => {
    recordTrialEvent("free_sheet_dismissed", { market: quota?.market || null });
    finish();
  };

  const handleUnlock = () => {
    recordTrialEvent("free_nudge_cta_clicked", {
      surface: "last_free_trade_sheet",
      market: quota?.market || null,
      teaser: ctx?.teaserInsight?.code || null,
    });
    setPaywallOpen(true);
  };

  const trades = Array.isArray(ctx?.recentTrades) ? ctx.recentTrades : [];
  const teaser = ctx?.teaserInsight || null;

  if (paywallOpen) {
    return (
      <PaywallGate
        isOpen
        variant="trade-limit"
        onClose={finish}
        onSuccess={(...args) => {
          if (typeof onUpgraded === "function") onUpgraded(...args);
          finish();
        }}
      />
    );
  }

  return (
    <div
      onClick={handleLater}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,25,35,0.55)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: 0,
      }}
    >
      <FocusTrap>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="last-free-trade-title"
          aria-describedby="last-free-trade-desc"
          onClick={(event) => event.stopPropagation()}
          className="last-free-trade-sheet"
          style={{
            background: "#FFFFFF",
            borderRadius: "22px 22px 0 0",
            padding: "22px 22px calc(22px + env(safe-area-inset-bottom, 0px))",
            width: "100%",
            maxWidth: 520,
            maxHeight: "88vh",
            overflowY: "auto",
            boxShadow: "0 -20px 60px -20px rgba(0,0,0,0.35)",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}
        >
          <div aria-hidden="true" style={{ width: 40, height: 4, borderRadius: 999, background: "#E2E8F0", margin: "0 auto 16px" }} />

          <div style={{
            display: "inline-block", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em",
            color: "#0D9E6E", background: "rgba(13,158,110,0.12)",
            borderRadius: 999, padding: "4px 10px", marginBottom: 12,
          }}>
            TRADE SAVED
          </div>

          <h2 id="last-free-trade-title" style={{ fontSize: 20, fontWeight: 800, color: "#0F1923", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
            You&apos;ve used your free trades
          </h2>
          <p id="last-free-trade-desc" style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, margin: "0 0 16px" }}>
            That was your last of {limit} free {label} trades. Everything you&apos;ve logged stays here to read any time.
          </p>

          {loading ? (
            <div aria-busy="true" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
              {[0, 1].map((i) => (
                <div key={i} style={{ height: 68, borderRadius: 14, background: "linear-gradient(90deg,#F1F5F9,#E2E8F0,#F1F5F9)" }} />
              ))}
            </div>
          ) : trades.length > 0 ? (
            <div style={{ marginBottom: 14 }}>
              <RecentTradeCards trades={trades} />
            </div>
          ) : null}

          <div style={{ marginBottom: 20 }}>
            <LockedInsightTeaser teaser={teaser} />
          </div>

          {purchaseAvailable ? (
            <button
              type="button"
              onClick={handleUnlock}
              style={{
                width: "100%", padding: 14,
                background: "linear-gradient(135deg, #0F1923 0%, #1e293b 100%)",
                color: "#FFFFFF", border: "none", borderRadius: 12,
                fontSize: 14, fontWeight: 800, cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Unlock Premium
            </button>
          ) : (
            <p style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6, margin: "0 0 4px", textAlign: "center" }}>
              Upgrades aren&apos;t available in this build. Open Edgecipline on the web to unlock Premium.
            </p>
          )}

          <button
            type="button"
            onClick={handleLater}
            style={{
              width: "100%", padding: 12, marginTop: 8,
              background: "transparent", color: "#64748B",
              border: "none", borderRadius: 12,
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {purchaseAvailable ? "Maybe later" : "Got it"}
          </button>
        </div>
      </FocusTrap>

      <style jsx>{`
        @media (min-width: 640px) {
          div[role="dialog"].last-free-trade-sheet {
            border-radius: 22px;
            margin-bottom: 24px;
          }
        }
      `}</style>
    </div>
  );
}
