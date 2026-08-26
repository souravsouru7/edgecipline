"use client";

import { useState, useEffect, Suspense } from "react";
import { verifyOTP } from "@/services/api";
import { useRouter, useSearchParams } from "next/navigation";
import { savePasswordResetSession } from "@/features/auth/lib/passwordResetSession";
import Link from "next/link";

const card = {
  width: "100%", maxWidth: 400,
  background: "#FFFFFF", borderRadius: 16, overflow: "hidden",
  border: "1px solid #E2E8F0",
  boxShadow: "0 8px 40px rgba(15,25,35,0.1)",
};

function VerifyOTPContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") || "").trim();

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState("");
  const [failedAttempts, setFailedAttempts] = useState(0);
  // Server says the account is locked out — no point letting them keep typing.
  const [lockedOut, setLockedOut] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || lockedOut) return;

    setLoading(true);
    setError("");
    try {
      const data = await verifyOTP(email, otp);

      if (!data?.resetToken) {
        // 2xx without a token should not happen; treat it as a failure rather
        // than walking the user into a reset screen that cannot work.
        setError("We couldn't verify that code. Please request a new one.");
        return;
      }

      // Token goes to the next screen via sessionStorage, not the URL, so it
      // stays out of history, referrers and server logs.
      const stored = savePasswordResetSession({ email, resetToken: data.resetToken });
      if (!stored) {
        setError("Your browser is blocking session storage, which this step needs. Enable it and try again.");
        return;
      }
      router.replace("/reset-password");
    } catch (err) {
      setFailedAttempts((n) => n + 1);
      if (err?.status === 429) setLockedOut(true);
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Arriving here with no email (direct link, or a lost query string) — there
  // is nothing to verify against.
  if (!email) {
    return (
      <Shell mounted={mounted}>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 10 }}>Verify Code</h2>
        <p style={{ fontSize: 13, color: "#64748B", marginBottom: 20, lineHeight: 1.55 }}>
          We don&apos;t know which account this code is for. Start the reset again and
          we&apos;ll bring you straight back here.
        </p>
        <Link
          href="/forgot-password"
          style={{
            display: "block", textAlign: "center", padding: "13px", borderRadius: 8,
            background: "linear-gradient(135deg,#0D9E6E 0%,#22C78E 100%)",
            color: "#FFFFFF", fontSize: 12, fontWeight: 700, textDecoration: "none",
          }}
        >
          START OVER
        </Link>
      </Shell>
    );
  }

  return (
    <Shell mounted={mounted}>
      <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 10 }}>Verify Code</h2>
      <p style={{ fontSize: 13, color: "#94A3B8", marginBottom: 24, lineHeight: 1.5 }}>
        Enter the 6-digit code sent to<br />
        <b style={{ color: "#0F1923" }}>{email}</b><br />
        It expires 10 minutes after it was sent.
      </p>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 20 }}>
          <label htmlFor="otp" style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 7, color: "#4A5568" }}>
            6-Digit Code
          </label>
          <input
            id="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            placeholder="000000"
            value={otp}
            onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "")); if (error) setError(""); }}
            disabled={loading || lockedOut}
            aria-invalid={Boolean(error)}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "#F8FAFC",
              border: "1.5px solid #E2E8F0",
              borderRadius: 8, padding: "12px",
              fontSize: 24, fontFamily: "'JetBrains Mono',monospace",
              textAlign: "center", letterSpacing: "8px",
              outline: "none", transition: "all 0.2s",
            }}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{ background: "#FEF2F2", color: "#D63B3B", padding: "10px", borderRadius: 6, fontSize: 12, marginBottom: 12, border: "1px solid #FEE2E2" }}
          >
            {error}
          </div>
        )}

        {failedAttempts > 0 && !lockedOut && (
          <p style={{ fontSize: 11.5, color: "#64748B", lineHeight: 1.6, marginBottom: 16 }}>
            Check the code against the most recent email — asking for a new one replaces the
            previous code. You get 3 attempts before verification locks for 30 minutes.
          </p>
        )}

        <button
          type="submit"
          disabled={loading || lockedOut || otp.length !== 6}
          style={{
            width: "100%", padding: "13px",
            background: (loading || lockedOut || otp.length !== 6) ? "#E2E8F0" : "linear-gradient(135deg,#0D9E6E 0%,#22C78E 100%)",
            border: "none",
            borderRadius: 8, color: (loading || lockedOut || otp.length !== 6) ? "#94A3B8" : "#FFFFFF",
            fontSize: 12, fontWeight: 700,
            cursor: (loading || lockedOut || otp.length !== 6) ? "not-allowed" : "pointer",
            transition: "all 0.2s",
          }}
        >
          {loading ? "VERIFYING..." : "VERIFY CODE"}
        </button>
      </form>

      <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <Link href={`/forgot-password`} style={{ color: "#0D9E6E", textDecoration: "none", fontWeight: 600 }}>
          Send a new code
        </Link>
        <Link href="/login" style={{ color: "#94A3B8", textDecoration: "none" }}>
          ← Back to Login
        </Link>
      </div>
    </Shell>
  );
}

function Shell({ mounted, children }) {
  return (
    <div style={{
      minHeight: "100vh", background: "#F0EEE9",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923", padding: "20px",
    }}>
      <div style={{
        ...card,
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(20px)",
        transition: "all 0.6s cubic-bezier(0.22,1,0.36,1)",
      }}>
        <div style={{ height: 3, background: "#0D9E6E" }} />
        <div style={{ padding: "32px" }}>{children}</div>
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
