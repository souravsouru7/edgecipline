"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { forgotPassword } from "@/services/api";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidEmail } from "@/features/auth/lib/passwordRules";
import Link from "next/link";
import AuthShell, { AuthNotice } from "@/features/auth/components/AuthShell";
import { Button, Field, Input } from "@/features/shared/components/ui";

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

function ForgotPasswordContent() {
  const router = useRouter();
  const search = useSearchParams();
  // Prefilled from the sign-in screen, or from "Send a new code" on the
  // code screen, so nobody retypes an address we already have.
  const [email, setEmail] = useState(() => (search.get("email") || "").trim());
  const [loading, setLoading] = useState(false);
  const redirectTimer = useRef(null);
  const [error, setError] = useState("");
  const [errorHelp, setErrorHelp] = useState("");
  // Distinguishes "no such account" from a generic failure so the screen can
  // offer the right way out (register) instead of a retry that cannot work.
  const [errorCode, setErrorCode] = useState("");
  // Set only after the API actually answers 2xx, and it holds the server's own
  // wording — the screen never claims delivery the backend did not confirm.
  const [notice, setNotice] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");

  useEffect(() => () => clearTimeout(redirectTimer.current), []);

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
      // Cancelled by "Use a different email" and on leaving the page; it used
      // to fire regardless, so changing the address was impossible.
      clearTimeout(redirectTimer.current);
      redirectTimer.current = setTimeout(() => {
        router.push(`/verify-otp?email=${encodeURIComponent(trimmed)}`);
      }, 2500);
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
    clearTimeout(redirectTimer.current);
    setNotice("");
    setSubmittedEmail("");
    setError("");
    setErrorHelp("");
    setErrorCode("");
  };

  if (notice) {
    return (
      <AuthShell aside={false} title="Check your inbox">
        <AuthNotice tone="success">{notice}</AuthNotice>
        <p className="ec-auth__text">
          We sent a 6-digit code to <strong>{submittedEmail}</strong>. It expires in 10 minutes;
          check your spam folder if it isn&apos;t there in a minute. Taking you to the code screen…
        </p>
        <div className="ec-auth__stack">
          <Button as={Link} href={`/verify-otp?email=${encodeURIComponent(submittedEmail)}`} block size="lg">
            Enter the code
          </Button>
          <Button variant="secondary" block onClick={startOver}>Use a different email</Button>
        </div>
        <p className="ec-auth__switch"><Link href="/login" className="ec-auth__link">Back to sign in</Link></p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      aside={false}
      title="Reset your password"
      subtitle="Enter your account email. If it signs in with a password, we'll send a 6-digit code to reset it."
    >
      <form onSubmit={handleSubmit} noValidate className="ec-auth__form">
        <Field label="Email" required error={error && !errorHelp ? error : undefined}>
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) {
                setError("");
                setErrorHelp("");
              }
            }}
            disabled={loading}
          />
        </Field>

        {error && errorHelp && (
          <AuthNotice tone="error" title={error}>
            {errorHelp}
            {errorCode === "ACCOUNT_NOT_FOUND" && (
              <> <Link href="/register" className="ec-auth__link">Create an account</Link></>
            )}
            {errorCode === "GOOGLE_ACCOUNT" && (
              <> <Link href="/login" className="ec-auth__link">Go to sign in</Link></>
            )}
            {errorCode === "EMAIL_DELIVERY_UNAVAILABLE" && (
              <> <Link href="/support" className="ec-auth__link">Contact support</Link></>
            )}
          </AuthNotice>
        )}

        <Button type="submit" block size="lg" loading={loading}>
          {loading ? "Sending code…" : "Send code"}
        </Button>
      </form>
      <p className="ec-auth__switch"><Link href="/login" className="ec-auth__link">Back to sign in</Link></p>
    </AuthShell>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordContent />
    </Suspense>
  );
}
