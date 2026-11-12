"use client";

import { useState, Suspense } from "react";
import { verifyOTP } from "@/services/api";
import { useRouter, useSearchParams } from "next/navigation";
import { savePasswordResetSession } from "@/features/auth/lib/passwordResetSession";
import Link from "next/link";
import AuthShell, { AuthNotice } from "@/features/auth/components/AuthShell";
import { Button, Field, Input } from "@/features/shared/components/ui";

function VerifyOTPContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") || "").trim();

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [failedAttempts, setFailedAttempts] = useState(0);
  // Server says the account is locked out — no point letting them keep typing.
  const [lockedOut, setLockedOut] = useState(false);

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

  const newCodeHref = email ? `/forgot-password?email=${encodeURIComponent(email)}` : "/forgot-password";

  // Arriving here with no email (direct link, or a lost query string): there
  // is nothing to verify against.
  if (!email) {
    return (
      <AuthShell aside={false} title="Enter your code" subtitle="We don't know which account this code is for. Start the reset again and we'll bring you straight back here.">
        <Button as={Link} href="/forgot-password" block size="lg">Start over</Button>
        <p className="ec-auth__switch"><Link href="/login" className="ec-auth__link">Back to sign in</Link></p>
      </AuthShell>
    );
  }

  const disabled = loading || lockedOut || otp.length !== 6;

  return (
    <AuthShell aside={false} title="Enter your code">
      <p className="ec-auth__sub">
        We sent a 6-digit code to <strong>{email}</strong>. It expires 10 minutes after it was sent.
      </p>

      <form onSubmit={handleSubmit} className="ec-auth__form">
        <Field label="6-digit code" required>
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className="ec-auth__otp"
            value={otp}
            onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "").slice(0, 6)); if (error) setError(""); }}
            disabled={loading || lockedOut}
            autoFocus
          />
        </Field>

        {error && <AuthNotice tone="error">{error}</AuthNotice>}

        {failedAttempts > 0 && !lockedOut && (
          <p className="ec-auth__hint">
            Use the code from the most recent email; asking for a new one replaces the old code.
            After 3 wrong tries, checking locks for 30 minutes.
          </p>
        )}

        <Button type="submit" block size="lg" loading={loading} disabled={disabled}>
          {loading ? "Checking…" : "Verify code"}
        </Button>
      </form>

      <p className="ec-auth__switch">
        Didn&apos;t get it? <Link href={newCodeHref} className="ec-auth__link">Send a new code</Link>
      </p>
      <p className="ec-auth__switch ec-auth__switch--tight"><Link href="/login" className="ec-auth__link ec-auth__link--muted">Back to sign in</Link></p>
    </AuthShell>
  );
}

export default function VerifyOTPPage() {
  return (
    <Suspense>
      <VerifyOTPContent />
    </Suspense>
  );
}
