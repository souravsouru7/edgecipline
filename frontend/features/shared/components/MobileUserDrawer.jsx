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
}) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimate(true));
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setAnimate(false);
      const t = setTimeout(() => setVisible(false), 320);
      return () => clearTimeout(t);
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
          background: "rgba(15,25,35,0.45)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          opacity: animate ? 1 : 0,
          transition: "opacity 0.32s cubic-bezier(0.32,0.72,0,1)",
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          background: "#FFFFFF",
          borderRadius: "20px 20px 0 0",
          boxShadow: "0 -8px 40px rgba(15,25,35,0.18)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 80px)",
          transform: animate ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.32s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#E2E8F0", margin: "12px auto 0" }} />

        {/* User block */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 20px 16px" }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: "linear-gradient(135deg,#0D9E6E,#22C78E)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#FFFFFF", fontSize: 16, fontWeight: 800, flexShrink: 0,
            fontFamily: "'Plus Jakarta Sans',sans-serif",
            boxShadow: "0 4px 12px rgba(13,158,110,0.3)",
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1A202C", fontFamily: "'Plus Jakarta Sans',sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {profile?.name || "Trader"}
            </div>
            {profile?.email && (
              <div style={{ fontSize: 12, color: "#94A3B8", fontFamily: "'Plus Jakarta Sans',sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {profile.email}
              </div>
            )}
          </div>
        </div>

        <div style={{ height: 1, background: "#F1F5F9", margin: "0 20px" }} />

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
                  color: active ? "#0D9E6E" : "#2D3748",
                  background: active ? "rgba(13,158,110,0.07)" : "transparent",
                  fontFamily: "'Plus Jakarta Sans',sans-serif",
                }}
              >
                <span style={{ width: 16, height: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: active ? "#0D9E6E" : "#94A3B8" }}>
                  {item.icon ?? (
                    <svg width="6" height="6" viewBox="0 0 6 6"><circle cx="3" cy="3" r="3" fill="currentColor" /></svg>
                  )}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {extraSlot && (
          <div style={{ padding: "4px 20px 8px" }}>
            <div style={{ height: 1, background: "#F1F5F9", marginBottom: 12 }} />
            {extraSlot}
          </div>
        )}

        {/* Logout */}
        <div style={{ padding: "8px 20px 20px" }}>
          <div style={{ height: 1, background: "#F1F5F9", marginBottom: 12 }} />
          <button
            onClick={() => { onClose(); onLogout(); }}
            style={{
              width: "100%", height: 48,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              background: "#FFF5F5", border: "1px solid #FED7D7",
              color: "#C53030", borderRadius: 12,
              fontSize: 15, fontWeight: 600, cursor: "pointer",
              fontFamily: "'Plus Jakarta Sans',sans-serif",
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
