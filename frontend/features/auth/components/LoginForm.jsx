"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { Button, Field, Input } from "@/features/shared/components/ui";
import { AppleButton, EmailButton, EmailReveal, GoogleButton, OrDivider } from "./SocialButtons";
import { AuthNotice } from "./AuthShell";

/**
 * Sign-in form. All logic comes from useLogin() and is passed in as props;
 * this file is presentation only.
 */
export default function LoginForm({
  form, handleChange,
  setFocused,
  loading, googleLoading,
  appleLoading, showAppleSignIn,
  showPass, setShowPass,
  shake,
  inAppBrowser,
  handleSubmit,
  handleGoogleSignIn,
  handleAppleSignIn,
}) {
  const isAnyLoading = loading || googleLoading || appleLoading;
  const googleConfigured = Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const hasProvider = googleConfigured || showAppleSignIn;

  // The email form sits behind "Continue with email" so the first screen is
  // just the sign-in choices. It starts open when there's no other way in, or
  // an email is already filled in (e.g. arriving from a reset link).
  const [emailOpen, setEmailOpen] = useState(() => !hasProvider || inAppBrowser || Boolean(form.email));
  const [openedByTap, setOpenedByTap] = useState(false);
  useEffect(() => {
    if (form.email || inAppBrowser) setEmailOpen(true);
  }, [form.email, inAppBrowser]);

  return (
    <div className={shake ? "ec-auth__shake" : undefined}>
      <div className="ec-auth__social">
        {inAppBrowser && (
          <AuthNotice tone="info" title="Google sign-in doesn't work in this view">
            Open this page in Chrome or Safari (not an in-app browser or a home-screen shortcut), then try again. Email sign-in below still works.
          </AuthNotice>
        )}
        {/* Apple first on iPhone, where it's the native choice. Shown only where
            it can complete (native iOS today). */}
        {showAppleSignIn && (
          <AppleButton onClick={handleAppleSignIn} disabled={isAnyLoading} loading={appleLoading} />
        )}
        {googleConfigured ? (
          <GoogleButton
            onClick={handleGoogleSignIn}
            disabled={isAnyLoading || inAppBrowser}
            loading={googleLoading}
            label={inAppBrowser ? "Open in your browser to use Google" : "Continue with Google"}
          />
        ) : process.env.NODE_ENV !== "production" ? (
          <AuthNotice tone="info">Google sign-in isn&apos;t configured (NEXT_PUBLIC_FIREBASE_API_KEY is missing).</AuthNotice>
        ) : null}
        {!emailOpen && (
          <EmailButton onClick={() => { setOpenedByTap(true); setEmailOpen(true); }} disabled={isAnyLoading} />
        )}
      </div>

      {emailOpen && (
        <EmailReveal focusOnOpen={openedByTap}>
          {hasProvider && <OrDivider label="or use your email" />}

          <form onSubmit={handleSubmit} className="ec-auth__form">
            <Field label="Email" required>
              <Input
                suppressHydrationWarning
                type="email"
                name="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={handleChange}
                onFocus={() => setFocused?.("email")}
                onBlur={() => setFocused?.(null)}
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>

            {/* The toggle sits beside the Field, not inside it, so the label stays
                wired to the input itself. */}
            <div className="ec-auth__pw">
              <Field label="Password" required>
                <Input
                  suppressHydrationWarning
                  type={showPass ? "text" : "password"}
                  name="password"
                  placeholder="Your password"
                  value={form.password}
                  onChange={handleChange}
                  onFocus={() => setFocused?.("password")}
                  onBlur={() => setFocused?.(null)}
                  autoComplete="current-password"
                />
              </Field>
              <button
                type="button"
                className="ec-auth__pw-toggle"
                onClick={() => setShowPass((p) => !p)}
                aria-label={showPass ? "Hide password" : "Show password"}
                aria-pressed={showPass}
                suppressHydrationWarning
              >
                {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            <div className="ec-auth__row-end">
              <Link href={form.email ? `/forgot-password?email=${encodeURIComponent(form.email.trim())}` : "/forgot-password"} className="ec-auth__link">
                Forgot password?
              </Link>
            </div>

            <Button type="submit" block size="lg" loading={loading} disabled={isAnyLoading} suppressHydrationWarning>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </EmailReveal>
      )}

      <p className="ec-auth__switch">
        New to Edgecipline? <Link href="/register" className="ec-auth__link">Create an account</Link>
      </p>
    </div>
  );
}
