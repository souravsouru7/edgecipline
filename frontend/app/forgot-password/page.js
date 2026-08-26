"use client";

import { useState, useEffect } from "react";
import { forgotPassword } from "@/services/api";
import { useRouter } from "next/navigation";
import { isValidEmail } from "@/features/auth/lib/passwordRules";
import Link from "next/link";

/* ─────────────────────────────────────────
   Reuse styling logic from Login for consistency
───────────────────────────────────────── */

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

function getResetErrorCopy(err) {
  const code = err?.data?.errorCode || err?.code || "";
  const status = Number(err?.status || 0);

  if (code === "ACCOUNT_NOT_FOUND") {
    return {
      code,
      message: "No Edgecipline account was found with this email.",
      action: "Check for a typo or create a new account.",
    };
  }
  if (code === "GOOGLE_ACCOUNT") {
    return {
      code,
      message: "This account signs in with Google.",
      action: "Use Continue with Google on the login screen.",
    };
  }
  if (status === 429 || code === "RATE_LIMITED") {
    const retryAfter = Number(err?.data?.retryAfterSeconds || err?.retryAfterSeconds || 0);
    return {
      code: "RATE_LIMITED",
      message: "Too many reset requests.",
      action: retryAfter
        ? `Try again in about ${Math.ceil(retryAfter / 60)} minute${retryAfter > 60 ? "s" : ""}.`
        : "Please wait a minute before trying again.",
    };
  }
  if (code === "EMAIL_DELIVERY_FAILED") {
    return {
      code,
      message: "We could not send the reset code right now.",
      action: "Please wait a moment and try again.",
    };
  }
  // Distinct from the one above on purpose: the server has told us the mail
  // provider is refusing every send, so "try again" is advice that cannot work.
  if (code === "EMAIL_DELIVERY_UNAVAILABLE") {
    const operatorHint = err?.data?.details?.operatorHint;
    return {
      code,
      message: "Password reset email isn't working right now.",
      action: operatorHint || "This is on our side — retrying won't help. Contact support and we'll reset it for you.",
    };
  }
  if (err?.message?.includes("Network error")) {
    return {
      code,
      message: "We could not reach Edgecipline.",
      action: "Check your connection and try again.",
    };
  }
  if (err?.message?.includes("timed out")) {
    return {
      code,
      message: "The request took too long.",
      action: "Please try again in a moment.",
    };
  }
  return {
    code,
    message: err?.message && err.message !== "Something went wrong"
      ? err.message
      : "We could not start password reset right now.",
    action: "Please try again. If it keeps happening, contact support.",
  };
}

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState("");
  const [errorHelp, setErrorHelp] = useState("");
  // Distinguishes "no such account" from a generic failure so the screen can
  // offer the right way out (register) instead of a retry that cannot work.
  const [errorCode, setErrorCode] = useState("");
  // Set only after the API actually answers 2xx, and it holds the server's own
  // wording — the screen never claims delivery the backend did not confirm.
  const [notice, setNotice] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");

  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    const trimmed = email.trim();
    setError("");
    setErrorHelp("");
    setErrorCode("");
    setNotice("");

    if (!trimmed) {
      setError("Enter your email address.");
      return;
    }
    if (!isValidEmail(trimmed)) {
      setError("That doesn't look like a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const data = await forgotPassword(trimmed);
      // Reached only on 2xx — the API confirmed the code went out.
      setNotice(data?.message || "OTP sent successfully. Please check your email.");
      setSubmittedEmail(trimmed);
      setTimeout(() => {
        router.push(`/verify-otp?email=${encodeURIComponent(trimmed)}`);
      }, 1200);
    } catch (err) {
      const copy = getResetErrorCopy(err);
      setError(copy.message);
      setErrorHelp(copy.action);
      setErrorCode(copy.code);
    } finally {
      setLoading(false);
    }
  };

  const startOver = () => {
    setNotice("");
    setSubmittedEmail("");
    setError("");
    setErrorHelp("");
    setErrorCode("");
  };

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

        <div style={{ padding: "32px" }}>
          {notice ? (
            <>
              <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 10 }}>Check your inbox</h2>

              <div
                role="status"
                style={{ background: "#F0FDF4", color: "#0D6E52", padding: "12px 14px", borderRadius: 8, fontSize: 13, lineHeight: 1.55, marginBottom: 16, border: "1px solid #DCFCE7" }}
              >
                {notice}
              </div>

              <p style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6, marginBottom: 20 }}>
                Sent to <b style={{ color: "#0F1923" }}>{submittedEmail}</b>. The code expires in
                10 minutes — check your spam folder if it isn&apos;t there in a minute.
              </p>

              <Link
                href={`/verify-otp?email=${encodeURIComponent(submittedEmail)}`}
                style={{
                  display: "block", textAlign: "center", width: "100%", boxSizing: "border-box",
                  padding: "13px", borderRadius: 8, textDecoration: "none",
                  background: "linear-gradient(135deg,#0D9E6E 0%,#22C78E 100%)",
                  color: "#FFFFFF", fontSize: 12, fontWeight: 700,
                }}
              >
                ENTER CODE
              </Link>

              <button
                type="button"
                onClick={startOver}
                style={{
                  width: "100%", marginTop: 10, padding: "12px",
                  background: "transparent", border: "1.5px solid #E2E8F0",
                  borderRadius: 8, color: "#4A5568", fontSize: 12, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Use a different email
              </button>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 10 }}>Forgot Password</h2>
              <p style={{ fontSize: 13, color: "#94A3B8", marginBottom: 24, lineHeight: 1.5 }}>
                Enter your email address. If it has an Edgecipline account with a password,
                we&apos;ll send a 6-digit code to reset it.
              </p>

              <form onSubmit={handleSubmit} noValidate>
                <div style={{ marginBottom: 20 }}>
                  <label htmlFor="reset-email" style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 7, color: "#4A5568" }}>
                    Email Address
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) {
                        setError("");
                        setErrorHelp("");
                      }
                    }}
                    disabled={loading}
                    aria-invalid={Boolean(error)}
                    style={{
                      ...inputStyle,
                      borderColor: error ? "#FCA5A5" : inputStyle.border.split(" ").at(-1),
                      background: error ? "#FFFBFB" : inputStyle.background,
                    }}
                  />
                </div>

                {error && (
                  <div
                    role="alert"
                    style={{ background: "#FEF2F2", color: "#D63B3B", padding: "10px", borderRadius: 6, fontSize: 12, lineHeight: 1.55, marginBottom: 16, border: "1px solid #FEE2E2" }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: errorHelp ? 3 : 0 }}>{error}</div>
                    {errorHelp && <div>{errorHelp}</div>}
                    {errorCode === "ACCOUNT_NOT_FOUND" && (
                      <>
                        {" "}
                        <Link href="/register" style={{ color: "#D63B3B", fontWeight: 700 }}>
                          Create one
                        </Link>
                      </>
                    )}
                    {errorCode === "GOOGLE_ACCOUNT" && (
                      <>
                        {" "}
                        <Link href="/login" style={{ color: "#D63B3B", fontWeight: 700 }}>
                          Go to sign in
                        </Link>
                      </>
                    )}
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
                  {loading ? "SENDING CODE..." : "SEND CODE"}
                </button>
              </form>
            </>
          )}

          <div style={{ textAlign: "center", marginTop: 20, fontSize: 12 }}>
            <Link href="/login" style={{ color: "#94A3B8", textDecoration: "none" }}>
              ← Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
