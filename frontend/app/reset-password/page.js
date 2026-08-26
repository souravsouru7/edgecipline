"use client";

import { useState, useEffect, Suspense } from "react";
import { resetPassword } from "@/services/api";
import { useRouter } from "next/navigation";
import {
  readPasswordResetSession,
  clearPasswordResetSession,
} from "@/features/auth/lib/passwordResetSession";
import { firstPasswordProblem, passwordRuleState } from "@/features/auth/lib/passwordRules";
import Link from "next/link";

const card = {
  width: "100%", maxWidth: 400,
  background: "#FFFFFF", borderRadius: 16, overflow: "hidden",
  border: "1px solid #E2E8F0",
  boxShadow: "0 8px 40px rgba(15,25,35,0.1)",
};

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "#F8FAFC",
  border: "1.5px solid #E2E8F0",
  borderRadius: 8, padding: "12px",
  fontSize: 13, fontFamily: "'JetBrains Mono',monospace",
  outline: "none", transition: "all 0.2s",
};

function ResetPasswordContent() {
  const router = useRouter();

  // null = still reading sessionStorage, false = nothing valid to reset with.
  const [session, setSession] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setMounted(true);
    // Written by /verify-otp after the code checked out. Reading it here (not
    // during render) keeps server and first client render identical.
    setSession(readPasswordResetSession() || false);
  }, []);

  const rules = passwordRuleState(password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || !session) return;

    setError("");

    const problem = firstPasswordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const data = await resetPassword(session.email, session.resetToken, password);
      // The token is single-use and now spent — drop our copy either way.
      clearPasswordResetSession();
      setSession(false);
      setMessage(data?.message || "Password reset successful. Redirecting to login...");
      setTimeout(() => router.replace("/login"), 2000);
    } catch (err) {
      // A rejected token can never succeed on retry; send them back to the start
      // rather than leaving them re-submitting a dead form.
      if (err?.status === 400 && /reset token/i.test(err?.message || "")) {
        clearPasswordResetSession();
        setSession(false);
      }
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (session === null && !message) {
    return <Shell mounted={mounted}><p style={{ fontSize: 13, color: "#94A3B8" }}>Loading…</p></Shell>;
  }

  if (message) {
    return (
      <Shell mounted={mounted}>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 10 }}>Password Reset</h2>
        <div
          role="status"
          style={{ background: "#F0FDF4", color: "#0D6E52", padding: "12px 14px", borderRadius: 8, fontSize: 13, lineHeight: 1.55, marginBottom: 18, border: "1px solid #DCFCE7" }}
        >
          {message}
        </div>
        <p style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6, marginBottom: 18 }}>
          For your security, every device that was signed in has been signed out.
          Use your new password to sign in again.
        </p>
        <Link
          href="/login"
          style={{
            display: "block", textAlign: "center", padding: "13px", borderRadius: 8,
            background: "linear-gradient(135deg,#0D9E6E 0%,#22C78E 100%)",
            color: "#FFFFFF", fontSize: 12, fontWeight: 700, textDecoration: "none",
          }}
        >
          GO TO LOGIN
        </Link>
      </Shell>
    );
  }

  // No usable token: opened directly, refreshed after the token was spent,
  // reopened in another tab, or sat here past the 10-minute window.
  if (!session) {
    return (
      <Shell mounted={mounted}>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 10 }}>Reset Password</h2>
        {error && (
          <div
            role="alert"
            style={{ background: "#FEF2F2", color: "#D63B3B", padding: "10px", borderRadius: 6, fontSize: 12, marginBottom: 14, border: "1px solid #FEE2E2" }}
          >
            {error}
          </div>
        )}
        <p style={{ fontSize: 13, color: "#64748B", marginBottom: 20, lineHeight: 1.55 }}>
          This reset session is no longer valid — codes and reset links are single-use and
          expire after 10 minutes. Request a new code to continue.
        </p>
        <Link
          href="/forgot-password"
          style={{
            display: "block", textAlign: "center", padding: "13px", borderRadius: 8,
            background: "linear-gradient(135deg,#0D9E6E 0%,#22C78E 100%)",
            color: "#FFFFFF", fontSize: 12, fontWeight: 700, textDecoration: "none",
          }}
        >
          REQUEST A NEW CODE
        </Link>
        <div style={{ textAlign: "center", marginTop: 18, fontSize: 12 }}>
          <Link href="/login" style={{ color: "#94A3B8", textDecoration: "none" }}>← Back to Login</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell mounted={mounted}>
      <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 10 }}>Reset Password</h2>
      <p style={{ fontSize: 13, color: "#94A3B8", marginBottom: 24, lineHeight: 1.5 }}>
        Create a new password for <b style={{ color: "#0F1923" }}>{session.email}</b>.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ marginBottom: 18 }}>
          <label htmlFor="new-password" style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 7, color: "#4A5568" }}>
            New Password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
            disabled={loading}
            style={inputStyle}
          />
        </div>

        {password.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 18px", display: "grid", gap: 4 }}>
            {rules.map((rule) => (
              <li key={rule.id} style={{ fontSize: 11, color: rule.met ? "#0D9E6E" : "#94A3B8" }}>
                {rule.met ? "✓" : "○"} {rule.label}
              </li>
            ))}
          </ul>
        )}

        <div style={{ marginBottom: 20 }}>
          <label htmlFor="confirm-password" style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 7, color: "#4A5568" }}>
            Confirm New Password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(""); }}
            disabled={loading}
            style={inputStyle}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{ background: "#FEF2F2", color: "#D63B3B", padding: "10px", borderRadius: 6, fontSize: 12, marginBottom: 16, border: "1px solid #FEE2E2" }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%", padding: "13px",
            background: loading ? "#F0FDF9" : "linear-gradient(135deg,#0D9E6E 0%,#22C78E 100%)",
            border: loading ? "1.5px solid #A7F3D0" : "none",
            borderRadius: 8, color: loading ? "#0D9E6E" : "#FFFFFF",
            fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
            transition: "all 0.2s",
          }}
        >
          {loading ? "RESETTING..." : "RESET PASSWORD"}
        </button>
      </form>
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}
