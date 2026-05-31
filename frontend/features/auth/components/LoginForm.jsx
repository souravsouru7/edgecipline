"use client";

import Link from "next/link";

/**
 * LoginForm
 * The full login card: header, Google button, email/password fields, submit.
 * All logic comes from useLogin() and is passed as props.
 */
export default function LoginForm({
  form, handleChange,
  focused, setFocused,
  loading, googleLoading,
  showPass, setShowPass,
  mounted, shake,
  inAppBrowser,
  authDebugInfo,
  handleSubmit,
  handleGoogleSignIn,
  testConnection,
}) {
  const fields = [
    {
      name: "email", type: "email",
      label: "Email Address", placeholder: "your@email.com",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>,
    },
    {
      name: "password", type: showPass ? "text" : "password",
      label: "Password", placeholder: "Enter your password",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    },
  ];

  const isAnyLoading = loading || googleLoading;

  return (
    <div style={{ background: "#FFFFFF", borderRadius: 16, overflow: "hidden", border: "1px solid #E2E8F0", boxShadow: "0 8px 40px rgba(15,25,35,0.1), 0 2px 8px rgba(15,25,35,0.05)", animation: shake ? "shake 0.5s ease-in-out" : "none" }}>
      {/* Top accent */}
      <div style={{ height: 3, background: "linear-gradient(90deg,#0D9E6E 0%,#0D9E6E55 40%,#D63B3B55 60%,#D63B3B 100%)" }} />

      {/* Card header */}
      <div style={{ padding: "26px 28px 20px", borderBottom: "1px solid #F1F5F9" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 24, fontWeight: 800, color: "#0F1923", lineHeight: 1.15, margin: 0, marginBottom: 6, letterSpacing: "-0.02em" }}>
              Welcome back,<br /><span style={{ color: "#0D9E6E" }}>Trader</span>
            </h2>
            <p style={{ fontSize: 11, color: "#94A3B8", margin: 0, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}>YOUR AI JOURNAL AWAITS</p>
          </div>
          {/* Candle icon cluster */}
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
            <rect x="4"  y="14" width="8" height="14" fill="rgba(13,158,110,0.85)" rx="1"/><line x1="8"  y1="7"  x2="8"  y2="14" stroke="rgba(13,158,110,0.85)" strokeWidth="1.5"/><line x1="8"  y1="28" x2="8"  y2="36" stroke="rgba(13,158,110,0.85)" strokeWidth="1.5"/>
            <rect x="17" y="10" width="8" height="10" fill="rgba(214,59,59,0.85)"  rx="1"/><line x1="21" y1="3"  x2="21" y2="10" stroke="rgba(214,59,59,0.85)"  strokeWidth="1.5"/><line x1="21" y1="20" x2="21" y2="28" stroke="rgba(214,59,59,0.85)"  strokeWidth="1.5"/>
            <rect x="30" y="12" width="8" height="16" fill="rgba(13,158,110,0.85)" rx="1"/><line x1="34" y1="5"  x2="34" y2="12" stroke="rgba(13,158,110,0.85)" strokeWidth="1.5"/><line x1="34" y1="28" x2="34" y2="38" stroke="rgba(13,158,110,0.85)" strokeWidth="1.5"/>
            <circle cx="22" cy="41" r="2.5" fill="#0D9E6E" opacity="0.7"/><circle cx="22" cy="41" r="4.5" stroke="#0D9E6E" strokeWidth="0.8" opacity="0.25"/>
          </svg>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 16, flexWrap: "wrap" }}>
          {[{ label: "Resume Journal", icon: "📓" }, { label: "AI Insights", icon: "🤖" }, { label: "Trade History", icon: "📊" }].map(f => (
            <div key={f.label} style={{ fontSize: 10, color: "#0D9E6E", fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 600, background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 20, padding: "4px 10px", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 11 }}>{f.icon}</span> {f.label}
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ padding: "26px 28px" }}>
        {fields.map((field, idx) => (
          <div key={field.name} style={{ marginBottom: 18, opacity: mounted ? 1 : 0, transform: mounted ? "translateX(0)" : "translateX(-10px)", transition: `all 0.5s ${0.1 + idx * 0.1}s` }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 7, color: focused === field.name ? "#0D9E6E" : "#4A5568", transition: "color 0.2s", fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: "0.01em" }}>
              {field.label}
            </label>
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: focused === field.name ? "#0D9E6E" : "#CBD5E1", transition: "color 0.2s", pointerEvents: "none" }}>{field.icon}</div>
              <input
                suppressHydrationWarning
                type={field.type} name={field.name}
                placeholder={field.placeholder}
                value={form[field.name]}
                onChange={handleChange}
                onFocus={() => setFocused(field.name)}
                onBlur={() => setFocused(null)}
                style={{ width: "100%", boxSizing: "border-box", background: focused === field.name ? "#F0FDF9" : "#F8FAFC", border: `1.5px solid ${focused === field.name ? "#0D9E6E" : "#E2E8F0"}`, borderRadius: 8, padding: "12px 40px 12px 38px", color: "#0F1923", fontSize: 13, fontFamily: "'JetBrains Mono',monospace", outline: "none", transition: "all 0.2s", boxShadow: focused === field.name ? "0 0 0 3px rgba(13,158,110,0.1)" : "none" }}
              />
              {field.name === "password" && (
                <button suppressHydrationWarning type="button" onClick={() => setShowPass(p => !p)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 0, color: showPass ? "#0D9E6E" : "#CBD5E1" }}>
                  {showPass ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              )}
              {field.name === "email" && form.email && (
                <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              )}
            </div>
          </div>
        ))}

        <div style={{ textAlign: "right", marginTop: -8, marginBottom: 20 }}>
          <Link href="/forgot-password" style={{ fontSize: 11, color: "#D63B3B", cursor: "pointer", fontWeight: 600, fontFamily: "'Plus Jakarta Sans',sans-serif", borderBottom: "1px solid rgba(214,59,59,0.3)", paddingBottom: 1, textDecoration: "none" }}>
            Forgot password?
          </Link>
        </div>

        <div style={{ height: 1, background: "#F1F5F9", marginBottom: 16 }} />

        {/* Google */}
        <div style={{ marginBottom: 16 }}>
          {inAppBrowser && (
            <div style={{ marginBottom: 10, fontSize: 11, color: "#92400E", fontFamily: "'JetBrains Mono',monospace", textAlign: "left", padding: "10px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8 }}>
              Google login is blocked in embedded/standalone web views. Open this page in a normal <b>Chrome</b>/<b>Safari</b> tab (not “Add to Home Screen” / PWA mode) and try again.
            </div>
          )}

          {process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? (
            <button suppressHydrationWarning type="button" onClick={handleGoogleSignIn}
              disabled={isAnyLoading || inAppBrowser}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "11px 16px", border: "1.5px solid #E2E8F0", borderRadius: 8, background: "#fff", cursor: isAnyLoading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, color: "#0F1923", fontFamily: "'Plus Jakarta Sans',sans-serif", opacity: isAnyLoading ? 0.7 : 1, boxShadow: "0 1px 6px rgba(15,25,35,0.08)", transition: "all 0.2s" }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.7 0 6.7 5.5 2.7 13.5l7.8 6C12.4 13.2 17.8 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.8-2.2 5.2-4.7 6.8l7.4 5.7c4.3-4 6.8-9.9 6.8-16.5z"/>
                <path fill="#FBBC05" d="M10.5 28.5c-.5-1.5-.8-3-.8-4.5s.3-3 .8-4.5l-7.8-6C1 16.5 0 20.1 0 24s1 7.5 2.7 10.7l7.8-6.2z"/>
                <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.4-5.7c-2.1 1.4-4.7 2.2-7.8 2.2-6.2 0-11.5-3.7-13.5-9l-7.8 6C6.7 42.5 14.7 48 24 48z"/>
              </svg>
              {inAppBrowser ? "Open in browser to continue" : (googleLoading ? "Signing in..." : "Continue with Google")}
            </button>
          ) : (
            <div style={{ fontSize: 11, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", textAlign: "center", padding: "10px 12px", background: "#F8FAFC", border: "1px dashed #E2E8F0", borderRadius: 8 }}>
              Google login is not configured (missing <b>NEXT_PUBLIC_FIREBASE_API_KEY</b>).
            </div>
          )}
        </div>

        <div style={{ height: 1, background: "#F1F5F9", marginBottom: 16 }} />

        {/* Submit */}
        <button suppressHydrationWarning type="submit" disabled={loading}
          style={{ width: "100%", padding: "13px 0", background: loading ? "#F0FDF9" : "linear-gradient(135deg,#0D9E6E 0%,#22C78E 100%)", border: loading ? "1.5px solid #A7F3D0" : "none", borderRadius: 8, color: loading ? "#0D9E6E" : "#FFFFFF", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, letterSpacing: "0.15em", cursor: loading ? "not-allowed" : "pointer", transition: "all 0.25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: loading ? "none" : "0 4px 20px rgba(13,158,110,0.35)", position: "relative", overflow: "hidden" }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.transform = "translateY(-1px)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
        >
          {loading ? (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>AUTHENTICATING...</>
          ) : (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>ACCESS JOURNAL</>
          )}
        </button>



        <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#94A3B8", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
          New to Edgecipline?{" "}
          <Link href="/register" style={{ color: "#0D9E6E", fontWeight: 700, borderBottom: "1px solid rgba(13,158,110,0.3)", paddingBottom: 1, textDecoration: "none" }}>
            Create account →
          </Link>
        </div>
      </form>
    </div>
  );
}
