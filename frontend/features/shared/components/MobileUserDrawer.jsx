"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function getInitials(name) {
  if (!name) return "T";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function MobileUserDrawer({
  open,
  onClose,
  onLogout,
  profile,
  navItems = [],
  extraSlot,
  paymentSlot,
}) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => {
        setVisible(true);
        requestAnimationFrame(() => setAnimate(true));
      });
      return () => cancelAnimationFrame(raf);
    } else {
      const animateTimer = setTimeout(() => {
        setAnimate(false);
      }, 0);
      const visibleTimer = setTimeout(() => setVisible(false), 320);
      return () => {
        clearTimeout(animateTimer);
        clearTimeout(visibleTimer);
      };
    }
  }, [open]);

  if (!visible) return null;

  const initials = getInitials(profile?.name);

  const isActive = (href) => {
    const base = href.split("?")[0];
    return pathname === href || pathname?.startsWith(base);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          background: "rgba(15,25,35,0.55)",
          opacity: animate ? 1 : 0,
          transition: "opacity 0.32s cubic-bezier(0.32,0.72,0,1)",
        }}
      />

      {/* Sheet */}
      <div
        className="ec-drawer"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          background: "var(--ec-surface)",
          borderTop: "1px solid var(--ec-border)",
          borderRadius: "20px 20px 0 0",
          boxShadow: "var(--ec-shadow-3)",
          color: "var(--ec-text)",
          fontFamily: "var(--ec-font-sans)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 80px)",
          transform: animate ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.32s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--ec-border-strong)", margin: "12px auto 0" }} />

        {/* User block */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 20px 16px" }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: "var(--ec-accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--ec-on-accent)", fontSize: 16, fontWeight: 700, flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ec-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {profile?.name || "Trader"}
            </div>
            {profile?.email && (
              <div style={{ fontSize: 12, color: "var(--ec-text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {profile.email}
              </div>
            )}
          </div>
        </div>

        <div style={{ height: 1, background: "var(--ec-border)", margin: "0 20px" }} />

        {/* Nav items */}
        <nav style={{ padding: "8px 12px" }}>
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  height: 48, padding: "0 8px", borderRadius: 10,
                  textDecoration: "none",
                  fontSize: 15, fontWeight: 500,
                  color: active ? "var(--ec-accent-text)" : "var(--ec-text-2)",
                  background: active ? "var(--ec-accent-soft)" : "transparent",
                    }}
              >
                <span style={{ width: 16, height: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: active ? "var(--ec-accent-text)" : "var(--ec-text-3)" }}>
                  {item.icon ?? (
                    <svg width="6" height="6" viewBox="0 0 6 6"><circle cx="3" cy="3" r="3" fill="currentColor" /></svg>
                  )}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Help & Support.
            Rendered outside `navItems` on purpose: those are the two
            market-specific nav sets, and support is neither — it is reachable
            from every workspace and, unlike the rest of this drawer, works
            without a session. */}
        <div style={{ padding: "0 12px 4px" }}>
          <Link
            href="/support"
            onClick={onClose}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              height: 48, padding: "0 8px", borderRadius: 10,
              textDecoration: "none",
              fontSize: 15, fontWeight: 500,
              color: isActive("/support") ? "var(--ec-accent-text)" : "var(--ec-text-2)",
              background: isActive("/support") ? "var(--ec-accent-soft)" : "transparent",
            }}
          >
            <span style={{ width: 16, height: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: isActive("/support") ? "var(--ec-accent-text)" : "var(--ec-text-3)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="4" />
                <line x1="4.93" y1="4.93" x2="9.17" y2="9.17" />
                <line x1="14.83" y1="14.83" x2="19.07" y2="19.07" />
                <line x1="14.83" y1="9.17" x2="19.07" y2="4.93" />
                <line x1="4.93" y1="19.07" x2="9.17" y2="14.83" />
              </svg>
            </span>
            Help &amp; Support
          </Link>
        </div>

        {extraSlot && (
          <div style={{ padding: "4px 20px 8px" }}>
            <div style={{ height: 1, background: "var(--ec-border)", marginBottom: 12 }} />
            {extraSlot}
          </div>
        )}

        {paymentSlot && (
          <div style={{ padding: "8px 20px 4px" }}>
            {paymentSlot}
          </div>
        )}

        {/* Logout */}
        <div style={{ padding: "8px 20px 20px" }}>
          <div style={{ height: 1, background: "var(--ec-border)", marginBottom: 12 }} />
          <button
            onClick={() => { onClose(); onLogout(); }}
            style={{
              width: "100%", height: 48,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              background: "var(--ec-loss-soft)", border: "1px solid color-mix(in srgb, var(--ec-loss) 30%, transparent)",
              color: "var(--ec-loss)", borderRadius: 12,
              fontSize: 15, fontWeight: 600, cursor: "pointer",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
