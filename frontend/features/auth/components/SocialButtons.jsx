"use client";

import { useEffect, useRef } from "react";
import { Mail } from "lucide-react";
import { Spinner } from "@/features/shared/components/ui/Spinner";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.7 0 6.7 5.5 2.7 13.5l7.8 6C12.4 13.2 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.8-2.2 5.2-4.7 6.8l7.4 5.7c4.3-4 6.8-9.9 6.8-16.5z" />
      <path fill="#FBBC05" d="M10.5 28.5c-.5-1.5-.8-3-.8-4.5s.3-3 .8-4.5l-7.8-6C1 16.5 0 20.1 0 24s1 7.5 2.7 10.7l7.8-6.2z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.4-5.7c-2.1 1.4-4.7 2.2-7.8 2.2-6.2 0-11.5-3.7-13.5-9l-7.8 6C6.7 42.5 14.7 48 24 48z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.73c.02 2.4 2.1 3.2 2.13 3.21-.02.06-.34 1.15-1.11 2.28-.67.98-1.36 1.95-2.46 1.97-1.07.02-1.42-.63-2.65-.63-1.23 0-1.61.61-2.63.65-1.05.04-1.85-1.05-2.52-2.02-1.46-2.11-2.58-5.97-1.08-8.58.74-1.3 2.07-2.12 3.51-2.14 1.04-.02 2.02.7 2.65.7.63 0 1.82-.86 3.07-.74.52.02 1.99.19 2.93 1.42-.08.05-1.73 1.01-1.71 3.01M14.9 4.6c.56-.68.94-1.62.84-2.56-.83.03-1.83.55-2.41 1.23-.52.6-.98 1.56-.86 2.48.92.07 1.87-.47 2.43-1.15" />
    </svg>
  );
}

/**
 * "Continue with Google" — Google's neutral button: white in light mode, the
 * dark variant in dark mode, the full-colour G in both.
 */
export function GoogleButton({ onClick, disabled, loading, label = "Continue with Google" }) {
  return (
    <button type="button" className="ec-social ec-social--google" onClick={onClick} disabled={disabled || loading} aria-busy={loading || undefined} suppressHydrationWarning>
      {loading ? <Spinner size="16px" /> : <GoogleMark />}
      <span>{loading ? "Signing in…" : label}</span>
    </button>
  );
}

/**
 * "Sign in with Apple" — Apple asks for black-on-white or white-on-black and
 * this exact wording, at the same size as the other sign-in options.
 */
export function AppleButton({ onClick, disabled, loading }) {
  return (
    <button type="button" className="ec-social ec-social--apple" onClick={onClick} disabled={disabled || loading} aria-busy={loading || undefined} aria-label="Sign in with Apple" suppressHydrationWarning>
      {loading ? <Spinner size="16px" /> : <AppleMark />}
      <span>{loading ? "Signing in…" : "Sign in with Apple"}</span>
    </button>
  );
}

/** "Continue with email" — opens the email form, same size as the providers. */
export function EmailButton({ onClick, disabled, label = "Continue with email" }) {
  return (
    <button type="button" className="ec-social ec-social--email" onClick={onClick} disabled={disabled} suppressHydrationWarning>
      <Mail size={18} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Wrapper for the email form once EmailButton has opened it. Animates in, and
 * when the user tapped to open it (`focusOnOpen`) puts the cursor in the first
 * field. Not used for a form that starts open — that would pop the keyboard
 * over the page on arrival.
 */
export function EmailReveal({ focusOnOpen = false, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (focusOnOpen) ref.current?.querySelector("input")?.focus({ preventScroll: true });
  }, [focusOnOpen]);
  return <div ref={ref} className="ec-auth__reveal">{children}</div>;
}

export function OrDivider({ label = "or" }) {
  return (
    <div className="ec-auth__or" role="separator">
      <span>{label}</span>
    </div>
  );
}
