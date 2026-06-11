"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * CreateTradeButton
 * Dropdown button with two options: Add Manually and Upload Screenshot.
 */
export default function CreateTradeButton() {
  const router  = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const go = (path) => { setIsOpen(false); router.push(path); };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setIsOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 10, background: "linear-gradient(135deg, #0F1923 0%, #1a2d3d 100%)", color: "#22C78E", borderRadius: 10, padding: "12px 20px", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, letterSpacing: "0.08em", boxShadow: "0 4px 16px rgba(15,25,35,0.25), 0 0 20px rgba(34,199,142,0.15)", border: "1px solid rgba(34,199,142,0.3)", cursor: "pointer", transition: "all 0.25s ease" }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 24px rgba(15,25,35,0.3), 0 0 30px rgba(34,199,142,0.25)"; }}
        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(15,25,35,0.25), 0 0 20px rgba(34,199,142,0.15)"; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        LOG TRADE
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {isOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setIsOpen(false)} />
          <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, background: "#FFFFFF", borderRadius: 12, border: "1px solid #E2E8F0", boxShadow: "0 8px 32px rgba(15,25,35,0.15)", overflow: "hidden", minWidth: 220, zIndex: 100, animation: "fadeDown 0.2s ease" }}>
            {[
              { path: "/add-trade", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>, iconBg: "rgba(13,158,110,0.12)", iconColor: "#0D9E6E", label: "Add Entry Manually",    sub: "Fill in trade details by hand" },
              { path: "/upload-trade", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>, iconBg: "rgba(184,134,11,0.12)", iconColor: "#B8860B", label: "Upload Screenshot", sub: "AI will extract trade data" },
            ].map((opt, i) => (
              <div key={opt.path}>
                {i > 0 && <div style={{ height: 1, background: "#E2E8F0", margin: "0 12px" }} />}
                <button onClick={() => go(opt.path)}
                  style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "14px 18px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", transition: "background 0.15s ease" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#F0EEE9"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: opt.iconBg, display: "flex", alignItems: "center", justifyContent: "center", color: opt.iconColor }}>{opt.icon}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F1923", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{opt.label}</div>
                    <div style={{ fontSize: 10, color: "#94A3B8", fontFamily: "'Plus Jakarta Sans',sans-serif", marginTop: 2 }}>{opt.sub}</div>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <style>{`@keyframes fadeDown { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }`}</style>
    </div>
  );
}
