"use client";

import { useState, useEffect } from "react";
import { forgotPassword } from "@/services/api";
import { useRouter } from "next/navigation";
import Link from "next/link";

/* ─────────────────────────────────────────
   Reuse styling logic from Login for consistency
───────────────────────────────────────── */

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await forgotPassword(email);
      // Backend always returns 200 with the same message (anti-enumeration).
      // Any 2xx response means the request was accepted — redirect regardless.
      setMessage("If this email is registered, an OTP has been sent. Redirecting...");
      setTimeout(() => {
        router.push(`/verify-otp?email=${encodeURIComponent(email)}`);
      }, 1500);
    } catch (err) {
      setError(err?.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight:"100vh", background:"#F0EEE9",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'Plus Jakarta Sans',sans-serif",
      color:"#0F1923", padding:"20px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      <div style={{
        width:"100%", maxWidth:400,
        background:"#FFFFFF", borderRadius:16, overflow:"hidden",
        border:"1px solid #E2E8F0",
        boxShadow:"0 8px 40px rgba(15,25,35,0.1)",
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(20px)",
        transition:"all 0.6s cubic-bezier(0.22,1,0.36,1)",
      }}>
        <div style={{ height:3, background:"#0D9E6E" }}/>
        
        <div style={{ padding:"32px" }}>
          <h2 style={{ fontSize:24, fontWeight:800, marginBottom:10 }}>Forgot Password</h2>
          <p style={{ fontSize:13, color:"#94A3B8", marginBottom:24, lineHeight:1.5 }}>
            Enter your email address and we'll send you a 6-digit OTP to reset your password.
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom:20 }}>
              <label style={{ display:"block", fontSize:11, fontWeight:600, marginBottom:7, color:"#4A5568" }}>
                Email Address
              </label>
              <input
                type="email"
                required
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width:"100%", boxSizing:"border-box",
                  background:"#F8FAFC",
                  border:"1.5px solid #E2E8F0",
                  borderRadius:8, padding:"12px",
                  fontSize:13, fontFamily:"'JetBrains Mono',monospace",
                  outline:"none", transition:"all 0.2s",
                }}
              />
            </div>

            {error && (
              <div style={{ background:"#FEF2F2", color:"#D63B3B", padding:"10px", borderRadius:6, fontSize:12, marginBottom:16, border:"1px solid #FEE2E2" }}>
                {error}
              </div>
            )}

            {message && (
              <div style={{ background:"#F0FDF4", color:"#0D9E6E", padding:"10px", borderRadius:6, fontSize:12, marginBottom:16, border:"1px solid #DCFCE7" }}>
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width:"100%", padding:"13px",
                background: loading ? "#F0FDF9" : "linear-gradient(135deg,#0D9E6E 0%,#22C78E 100%)",
                border: loading ? "1.5px solid #A7F3D0" : "none",
                borderRadius:8, color: loading ? "#0D9E6E" : "#FFFFFF",
                fontSize:12, fontWeight:700, cursor: loading ? "not-allowed" : "pointer",
                transition:"all 0.2s",
              }}
            >
              {loading ? "SENDING OTP..." : "SEND OTP"}
            </button>
          </form>

          <div style={{ textAlign:"center", marginTop:20, fontSize:12 }}>
            <Link href="/login" style={{ color:"#94A3B8", textDecoration:"none" }}>
              ← Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
