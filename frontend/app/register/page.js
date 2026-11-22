"use client";

import { useState, useEffect, useRef } from "react";
import { googleLogin, appleLogin, registerUser, testConnection as apiTestConnection } from "@/services/api";
import {
  signInWithFirebaseGoogle,
  signInWithFirebaseApple,
  isAppleSignInAvailable,
  handleFirebaseRedirectResult,
  getGoogleAuthErrorMessage,
  getAppleAuthErrorMessage,
  isAuthCancellation,
  clearRedirectPending,
  signOutFirebase,
} from "@/services/firebaseAuth";
import { clearAuthToken, setAuthToken } from "@/utils/auth";
import { useToast } from "@/features/shared/components/ui/Toast";
import { getUserMessage, reportUserError } from "@/utils/userMessage";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import AuthShell, { AuthNotice } from "@/features/auth/components/AuthShell";
import { AppleButton, EmailButton, EmailReveal, GoogleButton, OrDivider } from "@/features/auth/components/SocialButtons";
import { Button, Field, Input } from "@/features/shared/components/ui";
import { firstPasswordProblem, isValidEmail, passwordRuleState } from "@/features/auth/lib/passwordRules";

function resetFreshStartState() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("currentMarket");
    sessionStorage.removeItem("auth_redirect");
  } catch {
    // Ignore storage failures.
  }
}

/* ─────────────────────────────────────────
   MAIN REGISTER PAGE
───────────────────────────────────────── */
export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm]         = useState({ name:"", email:"", password:"" });
  const [loading, setLoading]   = useState(false);
  const { addToast } = useToast();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  // Resolved after mount, so the button is absent from the prerendered HTML and
  // there is no hydration mismatch.
  const [showAppleSignIn, setShowAppleSignIn] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [formError, setFormError] = useState("");
  const termsRef = useRef(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError]       = useState("");
  // The email form sits behind "Sign up with email", as on the sign-in page.
  const [emailOpen, setEmailOpen]         = useState(false);
  const [openedByTap, setOpenedByTap]     = useState(false);

  useEffect(() => {

    setShowAppleSignIn(isAppleSignInAvailable());

    // Pick up the idToken after a mobile redirect sign-in. One read serves both
    // providers — getRedirectResult() is consumed once per page load — and the
    // result says which endpoint to exchange it at.
    handleFirebaseRedirectResult()
      .then(redirect => {
        if (!redirect?.idToken) return undefined;
        return redirect.providerId === "apple.com"
          ? appleLogin(redirect.idToken)
          : googleLogin(redirect.idToken);
      })
      .then(async data => {
        if (!data?.token) return;
        resetFreshStartState();
        await setAuthToken(data.token);
        router.push(data.requiresTermsAcceptance ? "/accept-terms" : "/onboarding");
      })
      .catch(err => {
        if (isAuthCancellation(err)) return;
        addToast(
          reportUserError("register_redirect_exchange_failed", err, getGoogleAuthErrorMessage(err)),
          "error"
        );
      });
  }, [router]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    if (formError) setFormError("");
  };

  // A Google/Apple tap without consent sets termsError; bring the checkbox into
  // view, since on a phone it can be below the fold.
  useEffect(() => {
    if (!termsError) return;
    termsRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    termsRef.current?.focus?.({ preventScroll: true });
  }, [termsError]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    // Mirror the server's rules here so a bad password is caught before the
    // round trip. The old strength meter checked different rules (no
    // lowercase, any symbol), so "Strong" passwords could still be refused.
    if (!form.name.trim()) { setFormError("Enter your name."); return; }
    if (!isValidEmail(form.email)) { setFormError("Enter a valid email address."); return; }
    const pwProblem = firstPasswordProblem(form.password);
    if (pwProblem) { setFormError(pwProblem); return; }
    setFormError("");
    if (!termsAccepted) {
      setTermsError("You must accept the Terms & Privacy Policy to continue");
      return;
    }
    setTermsError("");
    setLoading(true);
    try {
      const data = await registerUser({
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
      if (data.token) {
        resetFreshStartState();
        await setAuthToken(data.token);
        if (data.requiresTermsAcceptance) {
          router.push("/accept-terms");
        } else {
          router.push("/onboarding");
        }
      } else {
        addToast(getUserMessage(data, "We couldn't create your account. Please try again."), "error");
      }
    } catch (err) {
      // Was "Registration Error: " + (err.message || JSON.stringify(err)) —
      // which on an unexpected shape printed a serialised error object. A 409
      // here is the common real case and deserves its own sentence.
      const fallback = err?.status === 409
        ? "An account with this email already exists. Sign in instead."
        : "We couldn't create your account. Please try again.";
      addToast(reportUserError("registration_failed", err, fallback), "error");
    } finally {
      setLoading(false);
    }
  };

  // Development diagnostic. It names the API host, which is not something to put
  // in front of a user, so both the handler and its button are gated on
  // NODE_ENV — the button was previously visible on the production register page.
  const testConnection = async () => {
    if (process.env.NODE_ENV === "production") return;
    try {
      await apiTestConnection();
      addToast("Backend reachable: " + process.env.NEXT_PUBLIC_API_URL, "success");
    } catch (err) {
      addToast("Backend unreachable: " + (err?.message || "unknown"), "error");
    }
  };

  // Mirrors handleGoogleSignIn, including the terms gate: account creation on
  // this page requires consent first, whichever provider does the signing in.
  const handleAppleSignIn = async () => {
    if (!termsAccepted) {
      setTermsError("You must accept the Terms & Privacy Policy to continue");
      return;
    }
    if (appleLoading) return;
    setTermsError("");
    setAppleLoading(true);
    try {
      const idToken = await signInWithFirebaseApple();
      // null means a web redirect was started; the effect above finishes it.
      if (!idToken) return;
      const data = await appleLogin(idToken);
      if (data.token) {
        resetFreshStartState();
        await setAuthToken(data.token);
        router.push(data.requiresTermsAcceptance ? "/accept-terms" : "/onboarding");
      } else {
        addToast(getUserMessage(data, "Could not complete Sign in with Apple."), "error");
      }
    } catch (err) {
      // Dismissing the Apple sheet is not an error worth reporting.
      if (isAuthCancellation(err)) return;
      clearRedirectPending();
      await clearAuthToken().catch(() => {});
      await signOutFirebase().catch(() => {});
      addToast(
        reportUserError("register_apple_failed", err, getAppleAuthErrorMessage(err)),
        "error"
      );
    } finally {
      setAppleLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!termsAccepted) {
      setTermsError("You must accept the Terms & Privacy Policy to continue");
      return;
    }
    if (googleLoading) return;
    setTermsError("");
    setGoogleLoading(true);
    try {
      const idToken = await signInWithFirebaseGoogle();
      if (!idToken) return;
      const data = await googleLogin(idToken);
      if (data.token) {
        resetFreshStartState();
        await setAuthToken(data.token);
        if (data.requiresTermsAcceptance) {
          router.push("/accept-terms");
        } else {
          router.push("/onboarding");
        }
      } else {
        addToast(getUserMessage(data, "Could not complete Google sign-in."), "error");
      }
    } catch (err) {
      clearRedirectPending();
      await clearAuthToken().catch(() => {});
      await signOutFirebase().catch(() => {});
      addToast(
        reportUserError("register_google_failed", err, getGoogleAuthErrorMessage(err)),
        "error"
      );
    } finally {
      setGoogleLoading(false);
    }
  };

  const rules = passwordRuleState(form.password);
  const anyLoading = loading || googleLoading || appleLoading;
  const googleConfigured = Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const hasProvider = googleConfigured || showAppleSignIn;
  // Never hide a form that has something in it, or the only way to sign up.
  const showEmailForm = emailOpen || !hasProvider || Boolean(formError)
    || Boolean(form.name || form.email || form.password);

  return (
    <AuthShell
      hero
      title="Start trading with a plan."
      subtitle="Free to start. Your first strategy takes about five minutes."
    >
      <div className="ec-auth__social">
        {showAppleSignIn && (
          <AppleButton onClick={handleAppleSignIn} disabled={anyLoading} loading={appleLoading} />
        )}
        {googleConfigured && (
          <GoogleButton onClick={handleGoogleSignIn} disabled={anyLoading} loading={googleLoading} label="Sign up with Google" />
        )}
        {!showEmailForm && (
          <EmailButton
            label="Sign up with email"
            onClick={() => { setOpenedByTap(true); setEmailOpen(true); }}
            disabled={anyLoading}
          />
        )}
      </div>

      {showEmailForm && (
        <EmailReveal focusOnOpen={openedByTap}>
          {hasProvider && <OrDivider label="or sign up with email" />}

          <form onSubmit={handleSubmit} noValidate className="ec-auth__form">
            <Field label="Name" required>
              <Input name="name" type="text" autoComplete="name" placeholder="Your name" value={form.name} onChange={handleChange} suppressHydrationWarning />
            </Field>
            <Field label="Email" required>
              <Input name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" value={form.email} onChange={handleChange} suppressHydrationWarning />
            </Field>
            <div className="ec-auth__pw">
              <Field label="Password" required>
                <Input name="password" type={showPass ? "text" : "password"} autoComplete="new-password" placeholder="Create a password" value={form.password} onChange={handleChange} suppressHydrationWarning />
              </Field>
              <button type="button" className="ec-auth__pw-toggle" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? "Hide password" : "Show password"} aria-pressed={showPass}>
                {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {form.password.length > 0 && (
              <ul className="ec-auth__rules" aria-label="Password requirements">
                {rules.map((rule) => (
                  <li key={rule.id} className={rule.met ? "is-met" : undefined}>
                    <span aria-hidden="true">{rule.met ? "✓" : "○"}</span> {rule.label}
                    <span className="ec-sr-only">{rule.met ? " (done)" : " (not yet)"}</span>
                  </li>
                ))}
              </ul>
            )}

            <label className={`ec-auth__check${termsError ? " is-invalid" : ""}`}>
              <input
                ref={termsRef}
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => { setTermsAccepted(e.target.checked); setTermsError(""); }}
                aria-invalid={termsError ? true : undefined}
                aria-describedby={termsError ? "terms-error" : undefined}
              />
              <span>
                I agree to the <Link href="/terms" target="_blank" className="ec-auth__link">Terms</Link> and{" "}
                <Link href="/privacy-policy" target="_blank" className="ec-auth__link">Privacy Policy</Link>.
              </span>
            </label>
            {termsError && <p id="terms-error" className="ec-auth__field-error" role="alert">Tick the box to agree to the Terms and Privacy Policy first.</p>}

            {formError && <AuthNotice tone="error">{formError}</AuthNotice>}

            <Button type="submit" block size="lg" loading={loading} disabled={anyLoading} suppressHydrationWarning>
              {loading ? "Creating account…" : "Create account"}
            </Button>

            {process.env.NODE_ENV !== "production" && (
              <button type="button" onClick={testConnection} className="ec-auth__devlink">Test backend connection</button>
            )}
          </form>
        </EmailReveal>
      )}

      <p className="ec-auth__switch">
        Already have an account? <Link href="/login" className="ec-auth__link">Sign in</Link>
      </p>
    </AuthShell>
  );
}
