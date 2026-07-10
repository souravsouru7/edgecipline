"use client";

import { Suspense } from "react";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import TickerTape            from "@/features/shared/components/TickerTape";
import LoginForm             from "@/features/auth/components/LoginForm";
import { useLogin }          from "@/features/auth/hooks/useLogin";

const PREVIEW_STATS = [
  { label: "TRADES LOGGED", val: "1,284", bull: true  },
  { label: "AVG WIN RATE",  val: "67.4%", bull: true  },
  { label: "AI INSIGHTS",   val: "3,910", bull: false },
];

function LoginPageContent() {
  const loginState = useLogin();
  const { mounted } = loginState;

  return (
    <div style={{ minHeight: "100vh", background: "#F0EEE9", display: "flex", flexDirection: "column", fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923", position: "relative", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Background */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0 }}>
        <CandlestickBackground canvasId="login-bg-canvas" />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,rgba(240,238,233,0.78) 0%,rgba(240,238,233,0.72) 100%)" }} />
        <div style={{ position: "absolute", top: -60, left: -60, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle,rgba(13,158,110,0.08) 0%,transparent 70%)" }} />
        <div style={{ position: "absolute", bottom: -80, right: -50, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle,rgba(214,59,59,0.06) 0%,transparent 70%)" }} />
      </div>

      {/* Header */}
      <header style={{ position: "relative", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", height: 60, background: "rgba(240,238,233,0.97)", borderBottom: "1px solid var(--color-border)", boxShadow: "0 1px 12px rgba(15,25,35,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 168, height: 44, display: "flex", alignItems: "center" }}>
            <img src="/mainlogo1.png" alt="Edgecipline" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "left center" }} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 20, padding: "5px 14px" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-primary)", animation: "blink 1.2s ease-in-out infinite" }} />
          <span style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--color-primary)", fontWeight: 600, fontFamily: "'JetBrains Mono',monospace" }}>AI ENGINE ACTIVE</span>
        </div>
      </header>

      <TickerTape />

      {/* Main */}
      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 5, padding: "32px 20px" }}>
        <div style={{ width: "100%", maxWidth: 440, opacity: mounted ? 1 : 0, transform: mounted ? "translateY(0)" : "translateY(20px)", transition: "all 0.6s cubic-bezier(0.22,1,0.36,1)" }}>

          {/* Preview stats pills */}
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            {PREVIEW_STATS.map((s, i) => (
              <div key={s.label} style={{ flex: 1, background: "rgba(255,255,255,0.92)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 12px", textAlign: "center", boxShadow: "0 1px 6px rgba(15,25,35,0.06)", animation: `fadeUp 0.5s ease ${i * 0.07}s both` }}>
                <div style={{ fontSize: 8, color: "#94A3B8", letterSpacing: "0.1em", marginBottom: 4, fontFamily: "'JetBrains Mono',monospace" }}>{s.label}</div>
                <div style={{ fontSize: 14, color: s.bull ? "var(--color-primary)" : "#B8860B", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* Login card */}
          <LoginForm {...loginState} />

          {/* Footer */}
          <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span style={{ fontSize: 10, color: "#CBD5E1", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>256-BIT ENCRYPTED</span>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              {["FOREX", "CRYPTO", "STOCKS", "FUTURES"].map(m => (
                <span key={m} style={{ fontSize: 9, color: "#CBD5E1", letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace" }}>{m}</span>
              ))}
            </div>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes spin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
        @keyframes ticker  { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes fadeUp  { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shake   { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
        input::placeholder { color:#CBD5E1; font-family:'JetBrains Mono',monospace; font-size:12px; }
        * { box-sizing:border-box; margin:0; padding:0; }
      `}</style>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}
