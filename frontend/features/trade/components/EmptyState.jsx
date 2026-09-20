"use client";

import Link from "next/link";

/**
 * EmptyState
 * Shown in the trade list when there are no trades to display.
 * Includes an onboarding illustration and CTA button.
 */
export default function EmptyState() {
  return (
    <div style={{
      textAlign: "center", padding: "80px 20px",
      background: "linear-gradient(135deg, rgba(13,158,110,0.03) 0%, rgba(240,238,233,0.5) 100%)",
      borderRadius: 14, margin: "20px",
      border: "1px dashed rgba(13,158,110,0.2)",
    }}>
      {/* Illustration */}
      <div style={{ marginBottom: 24 }}>
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none" style={{ margin: "0 auto" }}>
          <circle cx="40" cy="40" r="36" fill="rgba(13,158,110,0.08)" stroke="rgba(13,158,110,0.15)" strokeWidth="2" />
          <rect x="24" y="38" width="8"  height="18" fill="rgba(13,158,110,0.6)" rx="2" />
          <rect x="36" y="32" width="8"  height="24" fill="rgba(13,158,110,0.8)" rx="2" />
          <rect x="48" y="42" width="8"  height="14" fill="rgba(214,59,59,0.5)"  rx="2" />
          <path d="M20 52 L32 42 L42 50 L60 28" stroke="rgba(13,158,110,0.9)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="52 28 60 28 60 36" fill="none" stroke="rgba(13,158,110,0.9)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 20, fontWeight: 800, color: "#0F1923", marginBottom: 10, letterSpacing: "-0.02em" }}>
        Upload your first trade to get started
      </div>
      <div style={{ fontSize: 11, color: "#64748B", lineHeight: 1.6, maxWidth: 420, margin: "0 auto 24px", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
        Track your trades, analyze performance, and improve discipline with detailed analytics and insights.
      </div>

      <Link
        href="/upload-trade"
        style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "linear-gradient(135deg, #0D9E6E 0%, #22C78E 100%)", color: "#FFFFFF", padding: "14px 28px", borderRadius: 12, textDecoration: "none", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", boxShadow: "0 4px 14px rgba(13,158,110,0.3)", transition: "transform 0.2s, box-shadow 0.2s" }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(13,158,110,0.4)"; }}
        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 14px rgba(13,158,110,0.3)"; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        UPLOAD TRADE
      </Link>

      {/* Quick tips */}
      <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid rgba(13,158,110,0.15)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, maxWidth: 520, margin: "28px auto 0" }}>
        {[{ icon: "📊", text: "Track Performance" }, { icon: "🎯", text: "Analyze Patterns" }, { icon: "📈", text: "Improve Strategy" }].map((tip, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 20 }}>{tip.icon}</span>
            <span style={{ fontSize: "var(--fs-2xs)", color: "#64748B", fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 600 }}>{tip.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
