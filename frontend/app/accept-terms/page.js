"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { clearAuthToken, getValidToken, hydrateAuthToken } from "@/utils/auth";
import Link from "next/link";
import { acceptTerms, logoutUser } from "@/services/api";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";
import { onUserLoggedOut } from "@/services/pushNotifications";
import { resolveLandingPath } from "@/features/auth/hooks/useLogin";
import AuthShell, { AuthNotice } from "@/features/auth/components/AuthShell";
import { Button } from "@/features/shared/components/ui";
import { FileText, ShieldCheck } from "lucide-react";

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
  const queryClient = useQueryClient();

  const [mounted, setMounted]         = useState(false);
  // Unticked by default: consent has to be an active choice (it was
  // pre-ticked, which doesn't count as consent).
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [leaving, setLeaving] = useState(false);
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
      queryClient.setQueryData(["userProfile"], (current) => ({
        ...(current || {}),
        requiresTermsAcceptance: undefined,
      }));
      queryClient.removeQueries({ queryKey: ["dashboard"], exact: false });
      await queryClient.invalidateQueries({ queryKey: ["userProfile"] });
      setSuccess(true);
      // A brand-new Google/Apple account arrives here before onboarding; it
      // used to be sent straight to the dashboard and skip setup entirely.
      // Same landing rule as sign-in: onboarding until it's done.
      const landing = await resolveLandingPath().catch(() => ({ path: "/dashboard" }));
      router.replace(landing?.path || "/dashboard");
    } catch (err) {
      setTermsError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const decline = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await onUserLoggedOut();
      await logoutUser();
    } catch {
      // Still clear client state and leave the gate if the network is unavailable.
    } finally {
      await clearAuthToken();
      router.replace("/login");
    }
  };

  if (!mounted) return null;

  return (
    <AuthShell
      aside={false}
      title="Before you continue"
      subtitle="Please read and accept our Terms and Privacy Policy to use your account."
    >
      <div className="ec-auth__docs">
        <Link href="/terms" target="_blank" className="ec-auth__doc">
          <FileText size={18} aria-hidden="true" />
          <span>
            <strong>Terms &amp; Conditions</strong>
            <span>How the app may be used, the trading disclaimer, subscriptions and liability.</span>
          </span>
        </Link>
        <Link href="/privacy-policy" target="_blank" className="ec-auth__doc">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            <strong>Privacy Policy</strong>
            <span>What data we collect, how it&apos;s stored and protected, and your rights.</span>
          </span>
        </Link>
      </div>

      <AuthNotice tone="info" title="In short">
        Edgecipline is a journal and coaching tool, not financial advice, and it doesn&apos;t promise profits.
        Your trading decisions are your own. AI features are for information and journaling only.
      </AuthNotice>

      <label className={`ec-auth__check${termsError ? " is-invalid" : ""}`}>
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={(e) => { setTermsAccepted(e.target.checked); setTermsError(""); }}
          aria-invalid={termsError ? true : undefined}
          aria-describedby={termsError ? "accept-terms-error" : undefined}
          disabled={loading || success}
        />
        <span>
          I&apos;ve read and agree to the <Link href="/terms" target="_blank" className="ec-auth__link">Terms &amp; Conditions</Link> and{" "}
          <Link href="/privacy-policy" target="_blank" className="ec-auth__link">Privacy Policy</Link>.
        </span>
      </label>
      {termsError && <p id="accept-terms-error" className="ec-auth__field-error" role="alert">{termsError}</p>}

      {success ? (
        <AuthNotice tone="success">Thanks. Taking you in…</AuthNotice>
      ) : (
        <Button block size="lg" onClick={handleAccept} loading={loading} disabled={leaving}>
          {loading ? "Saving…" : "Accept and continue"}
        </Button>
      )}

      <p className="ec-auth__switch">
        <button type="button" className="ec-auth__textbtn" onClick={decline} disabled={leaving || loading}>
          {leaving ? "Signing out…" : "Decline and sign out"}
        </button>
      </p>
    </AuthShell>
  );
}
