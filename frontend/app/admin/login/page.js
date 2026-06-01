"use client";

import { useState, useEffect, useRef } from "react";
import { adminLogin, clearAdminSession, getAdminProfile } from "@/services/adminApi";
import { useRouter } from "next/navigation";

/* ─────────────────────────────────────────
   LIGHT THEME DESIGN TOKENS (matching main site)
   Base bg:      #F0EEE9  (warm parchment)
   Card:         #FFFFFF
   Header:       rgba(255,255,255,0.92)
   Bull:         #0D9E6E
   Bear:         #D63B3B
   Gold:         #B8860B
   Text primary: #0F1923
   Text muted:   #94A3B8
   Border:       #E2E8F0
───────────────────────────────────────── */

/* ─────────────────────────────────────────
   CANDLESTICK BACKGROUND (light, subtle)
───────────────────────────────────────── */
function CandlestickBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const draw = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const candles = [];
      const count = Math.floor(W / 30);
      let price = 200;
      for (let i = 0; i < count; i++) {
        const open = price + (Math.random() - 0.5) * 20;
        const close = open + (Math.random() - 0.5) * 28;
        const high = Math.max(open, close) + Math.random() * 12;
        const low = Math.min(open, close) - Math.random() * 12;
        price = close;
        candles.push({ open, close, high, low });
      }

      const all = candles.flatMap(c => [c.high, c.low]);
      const mx = Math.max(...all), mn = Math.min(...all), rng = mx - mn || 1;
      const toY = p => H * 0.1 + (H * 0.8 * (mx - p)) / rng;

      // Grid
      ctx.strokeStyle = "rgba(0,0,0,0.04)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 7; i++) {
        ctx.beginPath(); ctx.moveTo(0, (H / 7) * i); ctx.lineTo(W, (H / 7) * i); ctx.stroke();
      }

      candles.forEach((c, i) => {
        const x = i * 30 + 15, bull = c.close >= c.open;
        ctx.strokeStyle = bull ? "rgba(13,158,110,0.22)" : "rgba(214,59,59,0.18)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, toY(c.high)); ctx.lineTo(x, toY(c.low)); ctx.stroke();
        ctx.fillStyle = bull ? "rgba(13,158,110,0.15)" : "rgba(214,59,59,0.12)";
        const bTop = toY(Math.max(c.open, c.close)), bBot = toY(Math.min(c.open, c.close));
        ctx.fillRect(x - 8, bTop, 16, Math.max(bBot - bTop, 1));
      });

      // MA line
      const ma = candles.map((_, i) => {
        const sl = candles.slice(Math.max(0, i - 5), i + 1);
        return sl.reduce((a, c) => a + c.close, 0) / sl.length;
      });
      ctx.strokeStyle = "rgba(184,134,11,0.28)";
      ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ma.forEach((p, i) => { const x = i * 30 + 15, y = toY(p); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
    };

    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);

  return (
    <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 1 }} />
  );
}

/* ─────────────────────────────────────────
   TICKER TAPE — dark strip for contrast
───────────────────────────────────────── */
const tickers = [
  { sym: "BTC", val: "+2.34%", bull: true }, { sym: "ETH", val: "-1.12%", bull: false },
  { sym: "AAPL", val: "+0.87%", bull: true }, { sym: "TSLA", val: "+4.20%", bull: true },
  { sym: "NVDA", val: "-0.55%", bull: false }, { sym: "GOLD", val: "+0.62%", bull: true },
  { sym: "SPY", val: "+0.31%", bull: true }, { sym: "OIL", val: "-2.18%", bull: false },
  { sym: "AMZN", val: "+1.05%", bull: true }, { sym: "USD/JPY", val: "-0.33%", bull: false },
];
function TickerTape() {
  const items = [...tickers, ...tickers];
  return (
    <div style={{
      overflow: "hidden", background: "#0F1923",
      borderBottom: "3px solid #B8860B",
      padding: "7px 0", whiteSpace: "nowrap", position: "relative", zIndex: 10,
    }}>
      <div style={{ display: "inline-flex", gap: "48px", animation: "ticker 32s linear infinite" }}>
        {items.map((t, i) => (
          <span key={i} style={{ fontSize: "11px", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.04em" }}>
            <span style={{ color: "#94A3B8", marginRight: 6 }}>{t.sym}</span>
            <span style={{ color: t.bull ? "#22C78E" : "#F87171" }}>{t.bull ? "▲" : "▼"} {t.val}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   ADMIN LOGIN PAGE (light theme)
───────────────────────────────────────── */
export default function AdminLoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [focused, setFocused] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [shake, setShake] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isActive = true;

    const restoreAdminSession = async () => {
      setMounted(true);

      // Check if an active admin session cookie exists by calling the profile endpoint
      try {
        const profile = await getAdminProfile();
        if (isActive && profile?.role === "admin") {
          router.replace("/admin/dashboard");
        }
      } catch {
        // No valid session — stay on login page
      }
    };

    restoreAdminSession();

    return () => {
      isActive = false;
    };
  }, [router]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await clearAdminSession();
      const data = await adminLogin(form);
      if (data?._id) {
        if (data.name) localStorage.setItem("adminName", data.name);
        router.replace("/admin/dashboard");
      } else {
        setShake(true);
        setTimeout(() => setShake(false), 600);
        setError(data.message || "Login failed");
      }
    } catch (err) {
      await clearAdminSession();
      setShake(true);
      setTimeout(() => setShake(false), 600);
      setError(err.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    {
      name: "email", type: "email",
      label: "Admin Email", placeholder: "admin@edgecipline.com",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>,
    },
    {
      name: "password", type: showPass ? "text" : "password",
      label: "Password", placeholder: "Enter admin password",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>,
    },
  ];

  return (
    <div style={{
      minHeight: "100vh", background: "#F0EEE9",
      display: "flex", flexDirection: "column",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923", position: "relative", overflow: "hidden",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* BG canvas */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0 }}>
        <CandlestickBackground />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,rgba(240,238,233,0.78) 0%,rgba(240,238,233,0.72) 100%)" }} />
        <div style={{ position: "absolute", top: -60, left: -60, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle,rgba(184,134,11,0.08) 0%,transparent 70%)" }} />
        <div style={{ position: "absolute", bottom: -80, right: -50, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle,rgba(13,158,110,0.06) 0%,transparent 70%)" }} />
      </div>

      {/* ── HEADER ── */}
      <header style={{
        position: "relative", zIndex: 20,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 60,
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid #E2E8F0",
        boxShadow: "0 1px 12px rgba(15,25,35,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 168, height: 44, position: "relative", display: "flex", alignItems: "center", justifyContent: "flex-start" }}><img src="/mainlogo1.png" alt="Edgecipline" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "left center" }} /></div>
          <div>
            <div style={{ display: "none" }}>EDGEDISCIPLINE</div>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "#B8860B", marginTop: 1, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>ADMIN PORTAL</div>
          </div>
        </div>

        {/* Admin chip */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "#FFF7ED", border: "1px solid #FDE68A",
          borderRadius: 20, padding: "5px 14px",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#B8860B", animation: "blink 1.2s ease-in-out infinite" }} />
          <span style={{ fontSize: 10, letterSpacing: "0.1em", color: "#B8860B", fontWeight: 600, fontFamily: "'JetBrains Mono',monospace" }}>
            ADMIN ACCESS
          </span>
        </div>
      </header>

      <TickerTape />

      {/* ── MAIN ── */}
      <main style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", zIndex: 5, padding: "32px 20px",
      }}>
        <div style={{
          width: "100%", maxWidth: 440,
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(20px)",
          transition: "all 0.6s cubic-bezier(0.22,1,0.36,1)",
        }}>

          {/* Security badges */}
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            {[
              { label: "ROLE-BASED", val: "ADMIN", bull: false },
              { label: "ENCRYPTION", val: "256-BIT", bull: true },
              { label: "ACCESS", val: "RESTRICTED", bull: false },
            ].map((s, i) => (
              <div key={s.label} style={{
                flex: 1, background: "rgba(255,255,255,0.7)",
                border: "1px solid #E2E8F0", borderRadius: 8,
                padding: "10px 12px", textAlign: "center",
                backdropFilter: "blur(8px)",
                boxShadow: "0 1px 6px rgba(15,25,35,0.06)",
                animation: `fadeUp 0.5s ease ${i * 0.07}s both`,
              }}>
                <div style={{ fontSize: 8, color: "#94A3B8", letterSpacing: "0.1em", marginBottom: 4, fontFamily: "'JetBrains Mono',monospace" }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 14, color: s.bull ? "#0D9E6E" : "#B8860B", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>
                  {s.val}
                </div>
              </div>
            ))}
          </div>

          {/* Card */}
          <div style={{
            background: "#FFFFFF", borderRadius: 16, overflow: "hidden",
            border: "1px solid #E2E8F0",
            boxShadow: "0 8px 40px rgba(15,25,35,0.1), 0 2px 8px rgba(15,25,35,0.05)",
            animation: shake ? "shake 0.5s ease-in-out" : "none",
          }}>
            {/* Top accent */}
            <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B 0%,#0D9E6E 50%,#B8860B 100%)" }} />

            {/* Card header */}
            <div style={{ padding: "26px 28px 20px", borderBottom: "1px solid #F1F5F9" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <h2 style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 24, fontWeight: 800, color: "#0F1923", lineHeight: 1.15, margin: 0, marginBottom: 6, letterSpacing: "-0.02em" }}>
                    Admin<br />
                    <span style={{ color: "#B8860B" }}>Access</span>
                  </h2>
                  <p style={{ fontSize: 11, color: "#94A3B8", margin: 0, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}>
                    AUTHORIZED PERSONNEL ONLY
                  </p>
                </div>

                {/* Shield icon */}
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(184,134,11,0.12)" stroke="#B8860B" strokeWidth="1.5" />
                  <path d="M9 12l2 2 4-4" stroke="#0D9E6E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/* Admin pills */}
              <div style={{ display: "flex", gap: 6, marginTop: 16, flexWrap: "wrap" }}>
                {[
                  { label: "User Management", icon: "👥" },
                  { label: "System Control", icon: "⚙️" },
                  { label: "Analytics", icon: "📊" },
                ].map(f => (
                  <div key={f.label} style={{
                    fontSize: 10, color: "#B8860B", fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 600,
                    background: "#FFF7ED", border: "1px solid #FDE68A",
                    borderRadius: 20, padding: "4px 10px", display: "flex", alignItems: "center", gap: 5,
                  }}>
                    <span style={{ fontSize: 11 }}>{f.icon}</span> {f.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div style={{
                margin: "16px 28px 0", padding: "10px 14px",
                background: "rgba(214,59,59,0.06)", border: "1px solid rgba(214,59,59,0.2)",
                borderRadius: 8, fontSize: 12, color: "#D63B3B",
                fontFamily: "'JetBrains Mono',monospace",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ padding: "26px 28px" }}>
              {fields.map((field, idx) => (
                <div key={field.name} style={{
                  marginBottom: 18,
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? "translateX(0)" : "translateX(-10px)",
                  transition: `all 0.5s ${0.1 + idx * 0.1}s`,
                }}>
                  <label style={{
                    display: "block", fontSize: 11, fontWeight: 600, marginBottom: 7,
                    color: focused === field.name ? "#B8860B" : "#4A5568",
                    transition: "color 0.2s",
                    fontFamily: "'Plus Jakarta Sans',sans-serif",
                    letterSpacing: "0.01em",
                  }}>
                    {field.label}
                  </label>
                  <div style={{ position: "relative" }}>
                    <div style={{
                      position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                      color: focused === field.name ? "#B8860B" : "#CBD5E1",
                      transition: "color 0.2s", pointerEvents: "none",
                    }}>
                      {field.icon}
                    </div>

                    <input
                      type={field.type}
                      name={field.name}
                      placeholder={field.placeholder}
                      value={form[field.name]}
                      onChange={handleChange}
                      onFocus={() => setFocused(field.name)}
                      onBlur={() => setFocused(null)}
                      required
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: focused === field.name ? "#FFFBF0" : "#F8FAFC",
                        border: `1.5px solid ${focused === field.name ? "#B8860B" : "#E2E8F0"}`,
                        borderRadius: 8, padding: "12px 40px 12px 38px",
                        color: "#0F1923", fontSize: 13,
                        fontFamily: "'JetBrains Mono',monospace",
                        outline: "none", transition: "all 0.2s",
                        boxShadow: focused === field.name ? "0 0 0 3px rgba(184,134,11,0.1)" : "none",
                      }}
                    />

                    {field.name === "password" && (
                      <button type="button" onClick={() => setShowPass(p => !p)} style={{
                        position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer", padding: 0,
                        color: showPass ? "#B8860B" : "#CBD5E1", transition: "color 0.2s",
                      }}>
                        {showPass ? (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    )}

                    {field.name === "email" && form.email && (
                      <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Divider */}
              <div style={{ height: 1, background: "#F1F5F9", marginBottom: 20 }} />

              {/* CTA Button */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%", padding: "13px 0",
                  background: loading
                    ? "#FFFBF0"
                    : "linear-gradient(135deg,#B8860B 0%,#D4A843 100%)",
                  border: loading ? "1.5px solid #FDE68A" : "none",
                  borderRadius: 8,
                  color: loading ? "#B8860B" : "#FFFFFF",
                  fontSize: 12, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
                  letterSpacing: "0.15em", cursor: loading ? "not-allowed" : "pointer",
                  transition: "all 0.25s",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  boxShadow: loading ? "none" : "0 4px 20px rgba(184,134,11,0.35), 0 1px 4px rgba(184,134,11,0.2)",
                  position: "relative", overflow: "hidden",
                }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
              >
                {!loading && (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(105deg,transparent 40%,rgba(255,255,255,0.18) 50%,transparent 60%)",
                    animation: "shimmer 2.5s linear infinite",
                  }} />
                )}
                {loading ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    AUTHENTICATING...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    ADMIN ACCESS
                  </>
                )}
              </button>

              {/* Back to user login */}
              <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#94A3B8", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                Not an admin?{" "}
                <span
                  style={{ color: "#0D9E6E", cursor: "pointer", fontWeight: 700, borderBottom: "1px solid rgba(13,158,110,0.3)", paddingBottom: 1 }}
                  onClick={() => router.push("/login")}
                >
                  User login →
                </span>
              </div>
            </form>
          </div>

          {/* Footer row */}
          <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span style={{ fontSize: 10, color: "#CBD5E1", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>ADMIN PORTAL v1.0</span>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              {["SECURED", "MONITORED", "LOGGED"].map(m => (
                <span key={m} style={{ fontSize: 9, color: "#CBD5E1", letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace" }}>{m}</span>
              ))}
            </div>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes blink    { 0%,100%{opacity:1}      50%{opacity:0.2} }
        @keyframes spin     { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes shimmer  { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
        @keyframes ticker   { 0%{transform:translateX(0)}    100%{transform:translateX(-50%)} }
        @keyframes fadeUp   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shake    {
          0%,100%{ transform:translateX(0) }
          20%    { transform:translateX(-6px) }
          40%    { transform:translateX(6px) }
          60%    { transform:translateX(-4px) }
          80%    { transform:translateX(4px) }
        }
        input::placeholder {
          color: #CBD5E1;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
        }
        * { box-sizing:border-box; margin:0; padding:0; }
      `}</style>
    </div>
  );
}
