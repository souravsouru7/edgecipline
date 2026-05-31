"use client";

import { useState, useEffect, useRef } from "react";
import { googleLogin, registerUser, acceptTerms as acceptTermsApi, testConnection as apiTestConnection } from "@/services/api";
import { signInWithFirebaseGoogle, handleGoogleRedirectResult } from "@/services/firebaseAuth";
import { setAuthToken, getValidToken } from "@/utils/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";

/* ─────────────────────────────────────────
   LIGHT THEME DESIGN TOKENS
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
function CandlestickBg() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const draw = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const count = Math.floor(W / 32) + 2;
      const candles = [];
      let price = 180;
      for (let i = 0; i < count; i++) {
        const o = price + (Math.random() - 0.48) * 22;
        const c = o + (Math.random() - 0.46) * 28;
        const h = Math.max(o, c) + Math.random() * 12;
        const l = Math.min(o, c) - Math.random() * 12;
        price = c;
        candles.push({ o, c, h, l });
      }
      const all = candles.flatMap(c => [c.h, c.l]);
      const mn = Math.min(...all), mx = Math.max(...all), rng = mx - mn || 1;
      const toY = p => H * 0.08 + (H * 0.84 * (mx - p)) / rng;

      // Grid
      ctx.strokeStyle = "rgba(0,0,0,0.04)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        ctx.beginPath(); ctx.moveTo(0,(H/6)*i); ctx.lineTo(W,(H/6)*i); ctx.stroke();
      }

      candles.forEach((c, i) => {
        const x = i * 32 + 16, bull = c.c >= c.o;
        ctx.strokeStyle = bull ? "rgba(13,158,110,0.22)" : "rgba(214,59,59,0.18)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, toY(c.h)); ctx.lineTo(x, toY(c.l)); ctx.stroke();
        ctx.fillStyle = bull ? "rgba(13,158,110,0.15)" : "rgba(214,59,59,0.12)";
        const bTop = toY(Math.max(c.o, c.c)), bBot = toY(Math.min(c.o, c.c));
        ctx.fillRect(x - 8, bTop, 16, Math.max(bBot - bTop, 1));
      });

      // MA line
      const ma = candles.map((_, i) => {
        const sl = candles.slice(Math.max(0,i-6),i+1);
        return sl.reduce((a,c) => a+c.c, 0) / sl.length;
      });
      ctx.strokeStyle = "rgba(184,134,11,0.28)";
      ctx.lineWidth = 2; ctx.setLineDash([5,5]);
      ctx.beginPath();
      ma.forEach((p,i) => { const x=i*32+16, y=toY(p); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
      ctx.stroke(); ctx.setLineDash([]);
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);
  return <canvas ref={ref} style={{ position:"absolute", inset:0, width:"100%", height:"100%", opacity:1 }}/>;
}

/* ─────────────────────────────────────────
   TICKER TAPE — dark strip for contrast
───────────────────────────────────────── */
const tickers = [
  {sym:"BTC",val:"+2.34%",bull:true},{sym:"ETH",val:"-1.12%",bull:false},
  {sym:"AAPL",val:"+0.87%",bull:true},{sym:"TSLA",val:"+4.20%",bull:true},
  {sym:"NVDA",val:"-0.55%",bull:false},{sym:"GOLD",val:"+0.62%",bull:true},
  {sym:"SPY",val:"+0.31%",bull:true},{sym:"OIL",val:"-2.18%",bull:false},
  {sym:"AMZN",val:"+1.05%",bull:true},{sym:"USD/JPY",val:"-0.33%",bull:false},
];
function TickerTape() {
  const items = [...tickers, ...tickers];
  return (
    <div style={{
      overflow:"hidden", background:"#0F1923",
      borderBottom:"3px solid #0D9E6E",
      padding:"7px 0", whiteSpace:"nowrap", position:"relative", zIndex:10,
    }}>
      <div style={{ display:"inline-flex", gap:"48px", animation:"ticker 32s linear infinite" }}>
        {items.map((t,i) => (
          <span key={i} style={{ fontSize:"11px", fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.04em" }}>
            <span style={{ color:"#94A3B8", marginRight:6 }}>{t.sym}</span>
            <span style={{ color: t.bull ? "#22C78E" : "#F87171" }}>{t.bull?"▲":"▼"} {t.val}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   JOURNAL PREVIEW — auto-cycling widget
───────────────────────────────────────── */
const feedItems = [
  { pair:"BTC/USD", pnl:"+$342", rr:"2.4R", bull:true,  note:"AI flagged breakout before entry ✓" },
  { pair:"EUR/JPY", pnl:"-$88",  rr:"-0.8R",bull:false, note:"Ignored SR level — noted by AI" },
  { pair:"GOLD",    pnl:"+$210", rr:"1.9R", bull:true,  note:"Perfect retest, AI confidence 91%" },
];

function JournalPreview() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive(a => (a+1) % feedItems.length), 2800);
    return () => clearInterval(t);
  }, []);
  const item = feedItems[active];
  return (
    <div style={{
      background:"rgba(255,255,255,0.75)", backdropFilter:"blur(10px)",
      border:"1px solid #E2E8F0", borderRadius:10,
      padding:"14px 16px", marginBottom:20,
      boxShadow:"0 2px 10px rgba(15,25,35,0.06)",
      animation:"fadeUp 0.5s ease 0s both",
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ width:5, height:5, borderRadius:"50%", background:"#0D9E6E", animation:"blink 1.2s ease-in-out infinite" }}/>
          <span style={{ fontSize:9, letterSpacing:"0.12em", color:"#94A3B8", fontFamily:"'JetBrains Mono',monospace", fontWeight:600 }}>
            AI JOURNAL PREVIEW
          </span>
        </div>
        <div style={{ display:"flex", gap:4 }}>
          {feedItems.map((_,i) => (
            <div key={i} style={{
              width: i===active ? 18 : 5, height:5, borderRadius:3,
              background: i===active ? "#0D9E6E" : "#E2E8F0",
              transition:"all 0.3s",
            }}/>
          ))}
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:14, fontFamily:"'JetBrains Mono',monospace", color:"#0F1923", fontWeight:700, marginBottom:3 }}>
            {item.pair}
          </div>
          <div style={{ fontSize:10, color:"#94A3B8", fontFamily:"'Plus Jakarta Sans',sans-serif" }}>
            {item.note}
          </div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:16, fontFamily:"'JetBrains Mono',monospace", color: item.bull?"#0D9E6E":"#D63B3B", fontWeight:700 }}>
            {item.pnl}
          </div>
          <div style={{ fontSize:10, color: item.bull?"#0D9E6E":"#D63B3B", fontFamily:"'JetBrains Mono',monospace", opacity:0.7 }}>
            {item.rr}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   MAIN REGISTER PAGE
───────────────────────────────────────── */
export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm]         = useState({ name:"", email:"", password:"" });
  const [focused, setFocused]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [strength, setStrength] = useState(0);
  const [mounted, setMounted]   = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError]       = useState("");

  useEffect(() => {
    setMounted(true);
    // Use getValidToken() to check both in-memory and legacy localStorage tokens
    if (getValidToken()) { router.push("/dashboard"); return; }

    // Pick up idToken after mobile redirect Google sign-in on register page
    handleGoogleRedirectResult()
      .then(idToken => { if (idToken) return googleLogin(idToken); })
      .then(data => {
        if (!data?.token) return;
        setAuthToken(data.token);
        router.push(data.requiresTermsAcceptance ? "/accept-terms" : "/dashboard");
      })
      .catch(err => alert("Google login failed: " + (err?.message || err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    if (name === "password") {
      let s = 0;
      if (value.length >= 8) s++;
      if (/[A-Z]/.test(value)) s++;
      if (/[0-9]/.test(value)) s++;
      if (/[^A-Za-z0-9]/.test(value)) s++;
      setStrength(s);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!termsAccepted) {
      setTermsError("You must accept the Terms & Privacy Policy to continue");
      return;
    }
    setTermsError("");
    setLoading(true);
    try {
      const data = await registerUser({
        ...form,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
      if (data.token) {
        setAuthToken(data.token);
        if (data.requiresTermsAcceptance) {
          router.push("/accept-terms");
        } else {
          router.push("/dashboard");
        }
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert("Registration Error: " + (err.message || JSON.stringify(err)));
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    try {
      await apiTestConnection();
      alert("Connection test to " + process.env.NEXT_PUBLIC_API_URL + " : SUCCESS");
    } catch (err) {
      alert("Connection test ERROR: " + err.message);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!termsAccepted) {
      setTermsError("You must accept the Terms & Privacy Policy to continue");
      return;
    }
    setTermsError("");
    setGoogleLoading(true);
    try {
      const idToken = await signInWithFirebaseGoogle();
      if (!idToken) return;
      const data = await googleLogin(idToken);
      if (data.token) {
        setAuthToken(data.token);
        if (data.requiresTermsAcceptance) {
          router.push("/accept-terms");
        } else {
          router.push("/dashboard");
        }
      } else {
        alert(data.message || "Google login failed.");
      }
    } catch (err) {
      alert("Google Login Error: " + (err.message || JSON.stringify(err)));
    } finally {
      setGoogleLoading(false);
    }
  };

  // Strength bar config
  const strengthMeta = [
    { label:"Weak",     color:"#D63B3B", bg:"#FEF2F2", bar:"#D63B3B" },
    { label:"Fair",     color:"#D97706", bg:"#FFFBEB", bar:"#F59E0B" },
    { label:"Good",     color:"#B8860B", bg:"#FEFCE8", bar:"#EAB308" },
    { label:"Strong",   color:"#0D9E6E", bg:"#ECFDF5", bar:"#0D9E6E" },
  ];

  const fields = [
    {
      name:"name", type:"text",
      label:"Trader Name", placeholder:"Your full name",
      icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    },
    {
      name:"email", type:"email",
      label:"Email Address", placeholder:"your@email.com",
      icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>,
    },
    {
      name:"password", type:"password",
      label:"Password", placeholder:"Min. 8 characters",
      icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    },
  ];

  return (
    <div style={{
      minHeight:"100vh", background:"#F0EEE9",
      display:"flex", flexDirection:"column",
      fontFamily:"'Plus Jakarta Sans',sans-serif",
      color:"#0F1923", position:"relative", overflow:"hidden",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      {/* Background */}
      <div style={{ position:"fixed", inset:0, zIndex:0 }}>
        <CandlestickBg/>
        {/* Warm overlay */}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg,rgba(240,238,233,0.78) 0%,rgba(240,238,233,0.72) 100%)" }}/>
        {/* Green glow top-left */}
        <div style={{ position:"absolute", top:-60, left:-60, width:320, height:320, borderRadius:"50%", background:"radial-gradient(circle,rgba(13,158,110,0.08) 0%,transparent 70%)" }}/>
        {/* Red glow bottom-right */}
        <div style={{ position:"absolute", bottom:-80, right:-50, width:300, height:300, borderRadius:"50%", background:"radial-gradient(circle,rgba(214,59,59,0.06) 0%,transparent 70%)" }}/>
      </div>

      {/* ── HEADER ── */}
      <header style={{
        position:"relative", zIndex:20,
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"0 24px", height:60,
        background:"rgba(255,255,255,0.92)", backdropFilter:"blur(20px)",
        borderBottom:"1px solid #E2E8F0",
        boxShadow:"0 1px 12px rgba(15,25,35,0.06)",
      }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width: 168, height: 44, position: "relative", display: "flex", alignItems: "center", justifyContent: "flex-start" }}><img src="/mainlogo1.png" alt="Edgecipline" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "left center" }} /></div>
          <div>
            <div style={{ display: "none" }}>EDGEDISCIPLINE</div>
            <div style={{ fontSize:9, letterSpacing:"0.18em", color:"#0D9E6E", marginTop:1, fontFamily:"'JetBrains Mono',monospace", fontWeight:600 }}>AI JOURNAL</div>
          </div>
        </div>

        {/* AI chip */}
        <div style={{
          display:"flex", alignItems:"center", gap:6,
          background:"#ECFDF5", border:"1px solid #A7F3D0",
          borderRadius:20, padding:"5px 14px",
        }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:"#0D9E6E", animation:"blink 1.2s ease-in-out infinite" }}/>
          <span style={{ fontSize:10, letterSpacing:"0.1em", color:"#0D9E6E", fontWeight:600, fontFamily:"'JetBrains Mono',monospace" }}>
            AI ENGINE ACTIVE
          </span>
        </div>
      </header>

      <TickerTape/>

      {/* ── MAIN ── */}
      <main style={{
        flex:1, display:"flex", alignItems:"center", justifyContent:"center",
        position:"relative", zIndex:5, padding:"32px 20px",
      }}>
        <div style={{
          width:"100%", maxWidth:440,
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(20px)",
          transition:"all 0.6s cubic-bezier(0.22,1,0.36,1)",
        }}>

          {/* Journal preview widget */}
          <JournalPreview/>

          {/* ── CARD ── */}
          <div style={{
            background:"#FFFFFF", borderRadius:16, overflow:"hidden",
            border:"1px solid #E2E8F0",
            boxShadow:"0 8px 40px rgba(15,25,35,0.1), 0 2px 8px rgba(15,25,35,0.05)",
          }}>
            {/* Top accent gradient */}
            <div style={{ height:3, background:"linear-gradient(90deg,#0D9E6E 0%,#0D9E6E55 40%,#D63B3B55 60%,#D63B3B 100%)" }}/>

            {/* Card header */}
            <div style={{ padding:"26px 28px 20px", borderBottom:"1px solid #F1F5F9" }}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
                <div>
                  <h2 style={{
                    fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:24, fontWeight:800,
                    color:"#0F1923", lineHeight:1.15, margin:0, marginBottom:6, letterSpacing:"-0.02em",
                  }}>
                    Create your<br/>
                    <span style={{ color:"#0D9E6E" }}>Journal</span> account
                  </h2>
                  <p style={{ fontSize:11, color:"#94A3B8", margin:0, fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.06em" }}>
                    LET AI ANALYZE YOUR TRADES
                  </p>
                </div>

                {/* Candle icon cluster */}
                <svg width="44" height="42" viewBox="0 0 40 38" fill="none" style={{ flexShrink:0, marginTop:2 }}>
                  <rect x="4"  y="12" width="8" height="14" fill="rgba(13,158,110,0.85)" rx="1"/>
                  <line x1="8"  y1="5"  x2="8"  y2="12" stroke="rgba(13,158,110,0.85)" strokeWidth="1.5"/>
                  <line x1="8"  y1="26" x2="8"  y2="33" stroke="rgba(13,158,110,0.85)" strokeWidth="1.5"/>
                  <rect x="16" y="8"  width="8" height="10" fill="rgba(214,59,59,0.85)" rx="1"/>
                  <line x1="20" y1="2"  x2="20" y2="8"  stroke="rgba(214,59,59,0.85)" strokeWidth="1.5"/>
                  <line x1="20" y1="18" x2="20" y2="27" stroke="rgba(214,59,59,0.85)" strokeWidth="1.5"/>
                  <rect x="28" y="10" width="8" height="16" fill="rgba(13,158,110,0.85)" rx="1"/>
                  <line x1="32" y1="4"  x2="32" y2="10" stroke="rgba(13,158,110,0.85)" strokeWidth="1.5"/>
                  <line x1="32" y1="26" x2="32" y2="35" stroke="rgba(13,158,110,0.85)" strokeWidth="1.5"/>
                  <circle cx="20" cy="36" r="2.5" fill="#0D9E6E" opacity="0.7"/>
                  <circle cx="20" cy="36" r="4.5" stroke="#0D9E6E" strokeWidth="0.8" opacity="0.25"/>
                </svg>
              </div>

              {/* Feature pills */}
              <div style={{ display:"flex", gap:6, marginTop:16, flexWrap:"wrap" }}>
                {[
                  { label:"AI Trade Analysis", icon:"🤖" },
                  { label:"Pattern Detection",  icon:"📊" },
                  { label:"Risk Scoring",        icon:"🎯" },
                ].map(f => (
                  <div key={f.label} style={{
                    fontSize:10, color:"#0D9E6E", fontWeight:600,
                    fontFamily:"'Plus Jakarta Sans',sans-serif",
                    background:"#ECFDF5", border:"1px solid #A7F3D0",
                    borderRadius:20, padding:"4px 10px",
                    display:"flex", alignItems:"center", gap:5,
                  }}>
                    <span>{f.icon}</span> {f.label}
                  </div>
                ))}
              </div>
            </div>

            {/* ── FORM ── */}
            <form onSubmit={handleSubmit} style={{ padding:"26px 28px" }}>
              {fields.map((field, idx) => (
                <div key={field.name} style={{
                  marginBottom:18,
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? "translateX(0)" : "translateX(-10px)",
                  transition:`all 0.5s ${0.1 + idx*0.09}s`,
                }}>
                  <label style={{
                    display:"block", fontSize:11, fontWeight:600, marginBottom:7,
                    color: focused === field.name ? "#0D9E6E" : "#4A5568",
                    transition:"color 0.2s",
                    fontFamily:"'Plus Jakarta Sans',sans-serif", letterSpacing:"0.01em",
                  }}>
                    {field.label}
                  </label>
                  <div style={{ position:"relative" }}>
                    {/* Left icon */}
                    <div style={{
                      position:"absolute", left:12, top:"50%", transform:"translateY(-50%)",
                      color: focused===field.name ? "#0D9E6E" : "#CBD5E1",
                      transition:"color 0.2s", pointerEvents:"none",
                    }}>
                      {field.icon}
                    </div>

                    <input
                      type={field.type}
                      name={field.name}
                      placeholder={field.placeholder}
                      onChange={handleChange}
                      onFocus={() => setFocused(field.name)}
                      onBlur={() => setFocused(null)}
                      style={{
                        width:"100%", boxSizing:"border-box",
                        background: focused===field.name ? "#F0FDF9" : "#F8FAFC",
                        border:`1.5px solid ${focused===field.name ? "#0D9E6E" : "#E2E8F0"}`,
                        borderRadius:8, padding:"12px 40px 12px 38px",
                        color:"#0F1923", fontSize:13,
                        fontFamily:"'JetBrains Mono',monospace",
                        outline:"none", transition:"all 0.2s",
                        boxShadow: focused===field.name ? "0 0 0 3px rgba(13,158,110,0.1)" : "none",
                      }}
                    />

                    {/* Green tick when filled */}
                    {form[field.name] && (
                      <div style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Password strength meter */}
                  {field.name === "password" && form.password && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ display:"flex", gap:3, marginBottom:5 }}>
                        {[0,1,2,3].map(i => (
                          <div key={i} style={{
                            flex:1, height:3, borderRadius:3,
                            background: i < strength ? strengthMeta[strength-1].bar : "#E2E8F0",
                            transition:"background 0.3s",
                            boxShadow: i < strength ? `0 0 6px ${strengthMeta[strength-1].bar}55` : "none",
                          }}/>
                        ))}
                      </div>
                      {strength > 0 && (
                        <div style={{
                          display:"inline-flex", alignItems:"center", gap:5,
                          fontSize:10, color: strengthMeta[strength-1].color,
                          background: strengthMeta[strength-1].bg,
                          borderRadius:20, padding:"2px 8px",
                          fontFamily:"'Plus Jakarta Sans',sans-serif", fontWeight:600,
                        }}>
                          ◆ {strengthMeta[strength-1].label} password
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Divider */}
              <div style={{ height:1, background:"#F1F5F9", margin:"4px 0 14px" }}/>

              {/* Google */}
              <div style={{ marginBottom: 14 }}>
                {process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? (
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={googleLoading || loading}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                      padding: "11px 16px",
                      border: "1.5px solid #E2E8F0",
                      borderRadius: 8,
                      background: !termsAccepted ? "#F8FAFC" : "#fff",
                      cursor: !termsAccepted || googleLoading || loading ? "not-allowed" : "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      color: !termsAccepted ? "#94A3B8" : "#0F1923",
                      fontFamily: "'Plus Jakarta Sans',sans-serif",
                      opacity: googleLoading ? 0.7 : 1,
                      boxShadow: "0 1px 6px rgba(15,25,35,0.08)",
                      transition: "all 0.2s",
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 48 48" style={{ opacity: !termsAccepted ? 0.4 : 1 }}>
                      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.7 0 6.7 5.5 2.7 13.5l7.8 6C12.4 13.2 17.8 9.5 24 9.5z"/>
                      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.8-2.2 5.2-4.7 6.8l7.4 5.7c4.3-4 6.8-9.9 6.8-16.5z"/>
                      <path fill="#FBBC05" d="M10.5 28.5c-.5-1.5-.8-3-.8-4.5s.3-3 .8-4.5l-7.8-6C1 16.5 0 20.1 0 24s1 7.5 2.7 10.7l7.8-6.2z"/>
                      <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.4-5.7c-2.1 1.4-4.7 2.2-7.8 2.2-6.2 0-11.5-3.7-13.5-9l-7.8 6C6.7 42.5 14.7 48 24 48z"/>
                    </svg>
                    {googleLoading ? "Signing in..." : "Continue with Google"}
                  </button>
                ) : (
                  <div style={{
                    fontSize: 11,
                    color: "#94A3B8",
                    fontFamily: "'JetBrains Mono',monospace",
                    textAlign: "center",
                    padding: "10px 12px",
                    background: "#F8FAFC",
                    border: "1px dashed #E2E8F0",
                    borderRadius: 8,
                  }}>
                    Google login is not configured (missing <b>NEXT_PUBLIC_FIREBASE_API_KEY</b>).
                  </div>
                )}
              </div>

              {/* Divider */}
              <div style={{ height:1, background:"#F1F5F9", margin:"0 0 18px" }}/>

              {/* ── TERMS CHECKBOX ── */}
              <div style={{ marginBottom: 20 }}>
                <label style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  cursor: "pointer", userSelect: "none",
                }}>
                  <div
                    onClick={() => setTermsAccepted(v => !v)}
                    style={{
                      flexShrink: 0,
                      width: 18, height: 18, marginTop: 1,
                      borderRadius: 4,
                      border: `2px solid ${termsAccepted ? "#0D9E6E" : termsError ? "#D63B3B" : "#CBD5E1"}`,
                      background: termsAccepted ? "#0D9E6E" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.15s",
                      cursor: "pointer",
                    }}
                  >
                    {termsAccepted && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: "#4A5568", lineHeight: 1.6, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                    I agree to the{" "}
                    <Link href="/terms" target="_blank" style={{ color: "#0D9E6E", fontWeight: 700, textDecoration: "none", borderBottom: "1px solid rgba(13,158,110,0.35)" }}>
                      Terms &amp; Conditions
                    </Link>
                    {" "}and{" "}
                    <Link href="/privacy-policy" target="_blank" style={{ color: "#0D9E6E", fontWeight: 700, textDecoration: "none", borderBottom: "1px solid rgba(13,158,110,0.35)" }}>
                      Privacy Policy
                    </Link>
                    . Trading involves risk of loss.
                  </span>
                </label>
                {termsError && (
                  <div style={{
                    marginTop: 8, display: "flex", alignItems: "center", gap: 6,
                    fontSize: 11, color: "#D63B3B",
                    fontFamily: "'Plus Jakarta Sans',sans-serif",
                    background: "#FEF2F2", border: "1px solid #FECACA",
                    borderRadius: 6, padding: "6px 10px",
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    {termsError}
                  </div>
                )}
              </div>

              {/* CTA Button */}
              <button
                type="submit"
                disabled={loading || googleLoading}
                style={{
                  width:"100%", padding:"13px 0",
                  background: loading
                    ? "#F0FDF9"
                    : !termsAccepted
                      ? "#F1F5F9"
                      : "linear-gradient(135deg,#0D9E6E 0%,#22C78E 100%)",
                  border: loading ? "1.5px solid #A7F3D0" : !termsAccepted ? "1.5px solid #E2E8F0" : "none",
                  borderRadius:8,
                  color: loading ? "#0D9E6E" : !termsAccepted ? "#94A3B8" : "#FFFFFF",
                  fontSize:12, fontFamily:"'JetBrains Mono',monospace", fontWeight:700,
                  letterSpacing:"0.15em", cursor: loading || !termsAccepted ? "not-allowed" : "pointer",
                  transition:"all 0.25s",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:10,
                  boxShadow: loading || !termsAccepted ? "none" : "0 4px 20px rgba(13,158,110,0.35), 0 1px 4px rgba(13,158,110,0.2)",
                  position:"relative", overflow:"hidden",
                }}
                onMouseEnter={e => { if(!loading && termsAccepted) e.currentTarget.style.transform="translateY(-1px)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform="translateY(0)"; }}
              >
                {/* Shimmer */}
                {!loading && (
                  <div style={{
                    position:"absolute", inset:0,
                    background:"linear-gradient(105deg,transparent 40%,rgba(255,255,255,0.18) 50%,transparent 60%)",
                    animation:"shimmer 2.5s linear infinite",
                  }}/>
                )}
                {loading ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation:"spin 0.8s linear infinite" }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    ANALYZING...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
                      <polyline points="16 7 22 7 22 13"/>
                    </svg>
                    START JOURNALING
                  </>
                )}
              </button>

              <div style={{ textAlign:"center", marginTop:10 }}>
                <button type="button" onClick={testConnection} style={{ fontSize:10, color:"#94A3B8", background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>
                  Test Backend Connection
                </button>
              </div>

              {/* Sign in link */}
              <div style={{ textAlign:"center", marginTop:20, fontSize:12, color:"#94A3B8", fontFamily:"'Plus Jakarta Sans',sans-serif" }}>
                Already journaling?{" "}
                <span
                  style={{ color:"#D63B3B", cursor:"pointer", fontWeight:700, borderBottom:"1px solid rgba(214,59,59,0.3)", paddingBottom:1 }}
                  onClick={() => router.push("/login")}
                >
                  Sign in →
                </span>
              </div>
            </form>
          </div>

          {/* Footer badges */}
          <div style={{ marginTop:18, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span style={{ fontSize:10, color:"#CBD5E1", letterSpacing:"0.06em", fontFamily:"'JetBrains Mono',monospace" }}>256-BIT ENCRYPTED</span>
            </div>
            <div style={{ display:"flex", gap:14 }}>
              {["FOREX","CRYPTO","STOCKS","FUTURES"].map(m => (
                <span key={m} style={{ fontSize:9, color:"#CBD5E1", letterSpacing:"0.1em", fontFamily:"'JetBrains Mono',monospace" }}>{m}</span>
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
