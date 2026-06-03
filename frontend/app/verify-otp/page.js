"use client";

import { useState, useEffect, Suspense } from "react";
import { verifyOTP } from "@/services/api";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function VerifyOTPContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await verifyOTP(email, otp);
      // Backend returns { message, resetToken } on success.
      // resetToken is a short-lived opaque token that resetPassword validates.
      if (data?.resetToken) {
        router.push(
          `/reset-password?email=${encodeURIComponent(email)}&resetToken=${encodeURIComponent(data.resetToken)}`
        );
      } else {
        setError(data?.message || "Invalid OTP.");
      }
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
          <h2 style={{ fontSize:24, fontWeight:800, marginBottom:10 }}>Verify OTP</h2>
          <p style={{ fontSize:13, color:"#94A3B8", marginBottom:24, lineHeight:1.5 }}>
            Enter the 6-digit code sent to<br/><b style={{ color: "#0F1923" }}>{email}</b>
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom:20 }}>
              <label style={{ display:"block", fontSize:11, fontWeight:600, marginBottom:7, color:"#4A5568" }}>
                6-Digit OTP
              </label>
              <input
                type="text"
                required
                maxLength={6}
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                style={{
                  width:"100%", boxSizing:"border-box",
                  background:"#F8FAFC",
                  border:"1.5px solid #E2E8F0",
                  borderRadius:8, padding:"12px",
                  fontSize:24, fontFamily:"'JetBrains Mono',monospace",
                  textAlign: "center", letterSpacing: "8px",
                  outline:"none", transition:"all 0.2s",
                }}
              />
            </div>

            {error && (
              <div style={{ background:"#FEF2F2", color:"#D63B3B", padding:"10px", borderRadius:6, fontSize:12, marginBottom:16, border:"1px solid #FEE2E2" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              style={{
                width:"100%", padding:"13px",
                background: (loading || otp.length !== 6) ? "#E2E8F0" : "linear-gradient(135deg,#0D9E6E 0%,#22C78E 100%)",
                border: "none",
                borderRadius:8, color: (loading || otp.length !== 6) ? "#94A3B8" : "#FFFFFF",
                fontSize:12, fontWeight:700, cursor: (loading || otp.length !== 6) ? "not-allowed" : "pointer",
                transition:"all 0.2s",
              }}
            >
              {loading ? "VERIFYING..." : "VERIFY OTP"}
            </button>
          </form>

          <div style={{ textAlign:"center", marginTop:20, fontSize:12 }}>
            <Link href="/forgot-password" style={{ color:"#94A3B8", textDecoration:"none" }}>
              ← Use a different email
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyOTPPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <VerifyOTPContent />
    </Suspense>
  );
}
