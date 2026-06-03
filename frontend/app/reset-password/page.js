"use client";

import { useState, useEffect, Suspense } from "react";
import { resetPassword } from "@/services/api";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const resetToken = searchParams.get("resetToken") || "";
  
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await resetPassword(email, resetToken, password);
      setMessage("Password reset successful! Redirecting to login...");
      setTimeout(() => router.push("/login"), 2000);
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
          <h2 style={{ fontSize:24, fontWeight:800, marginBottom:10 }}>Reset Password</h2>
          <p style={{ fontSize:13, color:"#94A3B8", marginBottom:24, lineHeight:1.5 }}>
            Create a new password for your account.
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom:18 }}>
              <label style={{ display:"block", fontSize:11, fontWeight:600, marginBottom:7, color:"#4A5568" }}>
                New Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

            <div style={{ marginBottom:20 }}>
              <label style={{ display:"block", fontSize:11, fontWeight:600, marginBottom:7, color:"#4A5568" }}>
                Confirm New Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
              {loading ? "RESETTING..." : "RESET PASSWORD"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}
