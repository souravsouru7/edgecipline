"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { resetPassword } from "@/services/api";
import { useRouter } from "next/navigation";
import {
  readPasswordResetSession,
  clearPasswordResetSession,
} from "@/features/auth/lib/passwordResetSession";
import { firstPasswordProblem, passwordRuleState } from "@/features/auth/lib/passwordRules";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import AuthShell, { AuthNotice } from "@/features/auth/components/AuthShell";
import { Button, Field, Input, Placeholder } from "@/features/shared/components/ui";

function ResetPasswordContent() {
  const router = useRouter();

  // null = still reading sessionStorage, false = nothing valid to reset with.
  const [session, setSession] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const redirectTimer = useRef(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => () => clearTimeout(redirectTimer.current), []);

  useEffect(() => {
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
      redirectTimer.current = setTimeout(() => router.replace("/login"), 2500);
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
    return (
      <AuthShell aside={false} title="Choose a new password">
        <Placeholder height={44} />
        <Placeholder height={44} style={{ marginTop: 16 }} />
      </AuthShell>
    );
  }

  if (message) {
    return (
      <AuthShell aside={false} title="Password changed">
        <AuthNotice tone="success">{message}</AuthNotice>
        <p className="ec-auth__text">
          For your security, every device that was signed in has been signed out. Sign in again with your new password.
        </p>
        <Button as={Link} href="/login" block size="lg">Go to sign in</Button>
      </AuthShell>
    );
  }

  // No usable token: opened directly, refreshed after the token was spent,
  // reopened in another tab, or left here past the 10-minute window.
  if (!session) {
    return (
      <AuthShell aside={false} title="This reset link has expired">
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        <p className="ec-auth__text">
          Reset codes work once and expire after 10 minutes. Ask for a new code to continue.
        </p>
        <Button as={Link} href="/forgot-password" block size="lg">Send a new code</Button>
        <p className="ec-auth__switch"><Link href="/login" className="ec-auth__link">Back to sign in</Link></p>
      </AuthShell>
    );
  }

  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;

  return (
    <AuthShell aside={false} title="Choose a new password">
      <p className="ec-auth__sub">For <strong>{session.email}</strong>.</p>

      <form onSubmit={handleSubmit} noValidate className="ec-auth__form">
        <div className="ec-auth__pw">
          <Field label="New password" required>
            <Input
              type={showPass ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Create a password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
              disabled={loading}
              autoFocus
            />
          </Field>
          <button type="button" className="ec-auth__pw-toggle" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? "Hide passwords" : "Show passwords"} aria-pressed={showPass}>
            {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>

        {password.length > 0 && (
          <ul className="ec-auth__rules" aria-label="Password requirements">
            {rules.map((rule) => (
              <li key={rule.id} className={rule.met ? "is-met" : undefined}>
                <span aria-hidden="true">{rule.met ? "✓" : "○"}</span> {rule.label}
                <span className="ec-sr-only">{rule.met ? " (done)" : " (not yet)"}</span>
              </li>
            ))}
          </ul>
        )}

        <Field label="Confirm new password" required error={mismatch ? "These don't match yet." : undefined}>
          <Input
            type={showPass ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Type it again"
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(""); }}
            disabled={loading}
          />
        </Field>

        {error && <AuthNotice tone="error">{error}</AuthNotice>}

        <Button type="submit" block size="lg" loading={loading}>
          {loading ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  );
}
