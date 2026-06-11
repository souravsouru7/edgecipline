"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearAuthToken, getValidToken, hydrateAuthToken } from "@/utils/auth";
import Link from "next/link";
import { acceptTerms, logoutUser } from "@/services/api";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";

/**
 * /accept-terms
 *
 * Shown when an authenticated user (existing or new Google sign-in) has not yet
 * accepted the current version of the Terms & Conditions / Privacy Policy.
 * The backend already issued a valid JWT - the user cannot reach the dashboard
 * until this step is completed.
 */
export default function AcceptTermsPage() {
  const router = useRouter();

  const [mounted, setMounted]         = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(true);
  const [termsError, setTermsError]   = useState("");
  const [loading, setLoading]         = useState(false);
  const [success, setSuccess]         = useState(false);

  useEffect(() => {
    let cancelled = false;

    setMounted(true);
    const ensureSession = async () => {
      // If there is no access token, try the httpOnly refresh cookie before sending to login.
      const token = getValidToken() || await hydrateAuthToken();
      if (token) return;

      let refreshed = null;
      try {
        refreshed = await silentRefresh();
      } catch (err) {
        if (isAuthRefreshTransientError(err)) {
          console.warn("[Auth] accept terms preserved session after transient refresh failure", {
            at: new Date().toISOString(),
            status: err.status || 0,
          });
          return;
        }
        throw err;
      }
      if (!refreshed && !cancelled) router.replace("/login");
    };

    ensureSession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleAccept = async () => {
    if (!termsAccepted) {
      setTermsError("You must accept the Terms & Privacy Policy to continue");
      return;
    }
    setTermsError("");
    setLoading(true);
    try {
      await acceptTerms();
      setSuccess(true);
      setTimeout(() => router.push("/dashboard"), 1200);
    } catch (err) {
      setTermsError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F0EEE9",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      color: "#0F1923",
      padding: "24px 20px",
      position: "relative",
      overflow: "hidden",
    }}>
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* Subtle background glows */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: -80, left: -80, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle,rgba(13,158,110,0.07) 0%,transparent 70%)" }} />
        <div style={{ position: "absolute", bottom: -80, right: -60, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle,rgba(184,134,11,0.05) 0%,transparent 70%)" }} />
      </div>

      {/* Card */}
      <div style={{
        position: "relative", zIndex: 1,
        width: "100%", maxWidth: 480,
        background: "#FFFFFF",
        borderRadius: 20,
        border: "1px solid #E2E8F0",
        boxShadow: "0 8px 40px rgba(15,25,35,0.1), 0 2px 8px rgba(15,25,35,0.05)",
        overflow: "hidden",
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(20px)",
        transition: "all 0.5s cubic-bezier(0.22,1,0.36,1)",
      }}>
        {/* Top accent bar */}
        <div style={{ height: 3, background: "linear-gradient(90deg,#0D9E6E 0%,#22C78E 50%,#B8860B 100%)" }} />

        {/* Header */}
        <div style={{ padding: "32px 32px 24px", borderBottom: "1px solid #F1F5F9", textAlign: "center" }}>
          {/* Shield icon */}
          <div style={{
            width: 64, height: 64, margin: "0 auto 20px",
            background: "#ECFDF5", borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid #A7F3D0",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <polyline points="9 12 11 14 15 10"/>
            </svg>
          </div>

          <h1 style={{
            fontSize: 22, fontWeight: 800, color: "#0F1923",
            lineHeight: 1.2, marginBottom: 10, letterSpacing: "-0.02em",
          }}>
            One quick step before you continue
          </h1>
          <p style={{ fontSize: 13, color: "#64748B", lineHeight: 1.7, maxWidth: 360, margin: "0 auto" }}>
            We&apos;ve updated our Terms &amp; Conditions and Privacy Policy. Please review and accept them to access your journal.
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: "28px 32px" }}>

          {/* Policy summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
            {[
              {
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
                title: "Terms & Conditions",
                desc: "Usage rules, trading disclaimer, subscription terms, and liability limits.",
                href: "/terms",
              },
              {
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
                title: "Privacy Policy",
                desc: "How we collect, store, and protect your personal and trading data.",
                href: "/privacy-policy",
              },
            ].map((card) => (
              <Link key={card.title} href={card.href} target="_blank" style={{ textDecoration: "none" }}>
                <div style={{
                  background: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  borderRadius: 12,
                  padding: "14px",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#A7F3D0"; e.currentTarget.style.background = "#F0FDF9"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#E2E8F0"; e.currentTarget.style.background = "#F8FAFC"; }}
                >
                  <div style={{ marginBottom: 8 }}>{card.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0F1923", marginBottom: 4 }}>{card.title}</div>
                  <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.5 }}>{card.desc}</div>
                  <div style={{ marginTop: 8, fontSize: 10, color: "#0D9E6E", fontFamily: "'JetBrains Mono'", fontWeight: 700, letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 4 }}>
                    READ &gt;
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Key points */}
          <div style={{
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderLeft: "3px solid #B8860B",
            borderRadius: "0 10px 10px 0",
            padding: "12px 16px",
            marginBottom: 24,
            fontSize: 12,
            color: "#92400E",
            lineHeight: 1.7,
          }}>
            <strong>Key points:</strong> Edge Discipline does not provide financial advice or profit guarantees.
            You are fully responsible for your own trading decisions. All AI features are for informational
            and journaling purposes only.
          </div>

          {/* Checkbox */}
          <div style={{ marginBottom: 24 }}>
            <label style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              cursor: "pointer", userSelect: "none",
            }}>
              <div
                onClick={() => { setTermsAccepted(v => !v); setTermsError(""); }}
                style={{
                  flexShrink: 0,
                  width: 20, height: 20, marginTop: 1,
                  borderRadius: 5,
                  border: `2px solid ${termsAccepted ? "#0D9E6E" : termsError ? "#D63B3B" : "#CBD5E1"}`,
                  background: termsAccepted ? "#0D9E6E" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                  cursor: "pointer",
                  boxShadow: termsAccepted ? "0 0 0 3px rgba(13,158,110,0.12)" : "none",
                }}
              >
                {termsAccepted && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
              <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                I have read and agree to the{" "}
                <Link href="/terms" target="_blank" style={{ color: "#0D9E6E", fontWeight: 700, textDecoration: "none", borderBottom: "1px solid rgba(13,158,110,0.35)" }}>
                  Terms &amp; Conditions
                </Link>
                {" "}and{" "}
                <Link href="/privacy-policy" target="_blank" style={{ color: "#0D9E6E", fontWeight: 700, textDecoration: "none", borderBottom: "1px solid rgba(13,158,110,0.35)" }}>
                  Privacy Policy
                </Link>
              </span>
            </label>

            {termsError && (
              <div style={{
                marginTop: 10, display: "flex", alignItems: "center", gap: 6,
                fontSize: 12, color: "#D63B3B",
                fontFamily: "'Plus Jakarta Sans',sans-serif",
                background: "#FEF2F2", border: "1px solid #FECACA",
                borderRadius: 8, padding: "8px 12px",
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {termsError}
              </div>
            )}
          </div>

          {/* Accept button */}
          {success ? (
            <div style={{
              width: "100%", padding: "14px",
              background: "#ECFDF5", border: "1.5px solid #A7F3D0", borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              fontSize: 13, fontWeight: 700, color: "#0D9E6E",
              fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              ACCEPTED - REDIRECTING...
            </div>
          ) : (
            <button
              onClick={handleAccept}
              disabled={loading}
              style={{
                width: "100%", padding: "14px",
                background: loading
                  ? "#F0FDF9"
                  : !termsAccepted
                    ? "#F1F5F9"
                    : "linear-gradient(135deg,#0D9E6E 0%,#22C78E 100%)",
                border: loading ? "1.5px solid #A7F3D0" : !termsAccepted ? "1.5px solid #E2E8F0" : "none",
                borderRadius: 10,
                color: loading ? "#0D9E6E" : !termsAccepted ? "#94A3B8" : "#FFFFFF",
                fontSize: 13, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
                letterSpacing: "0.12em", cursor: loading || !termsAccepted ? "not-allowed" : "pointer",
                transition: "all 0.25s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                boxShadow: !termsAccepted || loading ? "none" : "0 4px 20px rgba(13,158,110,0.35)",
              }}
              onMouseEnter={e => { if (!loading && termsAccepted) e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
            >
              {loading ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  SAVING...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    <polyline points="9 12 11 14 15 10"/>
                  </svg>
                  ACCEPT &amp; CONTINUE TO JOURNAL
                </>
              )}
            </button>
          )}

          {/* Decline / logout */}
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button
              type="button"
              onClick={async () => {
                try {
                  await logoutUser();
                } catch {
                  // Still clear client state and leave the gate if the network is unavailable.
                } finally {
                  await clearAuthToken();
                  router.replace("/login");
                }
              }}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 12, color: "#94A3B8",
                fontFamily: "'Plus Jakarta Sans',sans-serif",
                textDecoration: "underline",
              }}
            >
              Decline and log out
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 32px",
          background: "#F8FAFC",
          borderTop: "1px solid #F1F5F9",
          textAlign: "center",
        }}>
          <span style={{ fontSize: 10, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}>
            EDGE DISCIPLINE · TERMS VERSION v1.0 · 2026
          </span>
        </div>
      </div>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing:border-box; margin:0; padding:0; }
      `}</style>
    </div>
  );
}
