"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getProfile, loginUser, googleLogin, appleLogin } from "@/services/api";
import apiClient from "@/services/apiClient";
import { getDashboardSnapshot } from "@/features/dashboard/api/dashboardApi";
import { clearAuthToken, getValidToken, hydrateAuthToken, setAuthToken } from "@/utils/auth";
import { useToast } from "@/features/shared/components/ui/Toast";
import { getUserMessage, reportUserError } from "@/utils/userMessage";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";
import {
  signInWithFirebaseGoogle,
  signInWithFirebaseApple,
  isAppleSignInAvailable,
  handleFirebaseRedirectResult,
  recoverFirebaseSessionIdToken,
  hasRedirectPending,
  clearRedirectPending,
  getGoogleAuthErrorMessage,
  getAppleAuthErrorMessage,
  isAuthCancellation,
  signOutFirebase,
} from "@/services/firebaseAuth";
import {
  ensurePushRegistration,
  initializePushNotifications,
  onUserLoggedIn,
} from "@/services/pushNotifications";

// ---------------------------------------------------------------------------
// Post-login destination
// ---------------------------------------------------------------------------
// Asks the backend where this user belongs. The order matters:
//
//   1. Hit `/api/onboarding` first — this triggers the lazy backfill on the
//      server so any pre-existing account (created before the new funnel
//      shipped) gets its flags mirrored from its trades / setups before we
//      check them.
//   2. Use the detailed funnel or a stamped activation completion as the
//      gate to `/dashboard`; the legacy top-level bit is not enough by itself.
//   3. Fall back to `/auth/me/preferences` if the onboarding endpoint isn't
//      reachable (e.g. transient 5xx). Falls back to `/dashboard` on any
//      error — the redirect is opportunistic and must never block sign-in.
function hasCompletedActivation(state = {}) {
  const onboarding = state?.onboarding || {};
  return Boolean(
    state?.funnel?.isComplete ||
    (
      state?.isPreActivated &&
      (onboarding.completedAt || onboarding.tourCompleted)
    )
  );
}

// The onboarding page and OnboardingMarketGuard both read this key. Seeding it
// with the payload resolveLandingPath already fetched means the wizard paints
// its first real step immediately instead of after a second identical request.
function seedOnboardingCache(queryClient, state) {
  if (!state) return;
  queryClient.setQueryData(["onboarding", "state"], state);
}

function clearFreshStartClientState() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("currentMarket");
    sessionStorage.removeItem("auth_redirect");
  } catch {
    // Storage can be unavailable in private mode.
  }
}

// Returns { path, state } — `state` is the /onboarding payload this function
// already paid for, so the caller can seed React Query with it. Without that
// seed, /onboarding mounts with an empty cache and fetches the SAME endpoint a
// second time, and the user stares at a full-screen "Loading your onboarding…"
// for the length of that round-trip immediately after signing in.
async function resolveLandingPath() {
  try {
    const state = await apiClient.get("/onboarding");
    if (hasCompletedActivation(state)) return { path: "/dashboard", state };
    clearFreshStartClientState();
    return { path: "/onboarding", state };
  } catch {
    // Onboarding endpoint failed — try the lighter preferences endpoint so
    // existing users who don't hit /onboarding still skip the wizard.
    try {
      const prefs = await apiClient.get("/auth/me/preferences");
      const o = prefs?.onboarding || {};
      const corePassed =
        o.welcomeSeen && o.marketSelected &&
        o.setupAdded && (o.tradeAdded || o.tradeSkipped) && o.journalSeen;
      const hasCompletionStamp = Boolean(o.completedAt || o.tourCompleted);
      if (prefs?.isOnboardingCompleted && hasCompletionStamp) return { path: "/dashboard", state: null };
      if (corePassed) return { path: "/dashboard", state: null };
      clearFreshStartClientState();
      return { path: "/onboarding", state: null };
    } catch {
      return { path: "/dashboard", state: null };
    }
  }
}

// ---------------------------------------------------------------------------
// In-app / WebView browser detection
// ---------------------------------------------------------------------------

const isInAppBrowser = () => {
  if (typeof window === "undefined") return false;
  // Capacitor Android uses a native WebView that handles Google Sign-In natively
  // via @capacitor-firebase/authentication — never block it here.
  if (window.Capacitor) return false;

  const isStandalone =
    (typeof navigator !== "undefined" && navigator.standalone === true) ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches);

  const ua = navigator.userAgent || "";
  const isEmbeddedUa =
    /(FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|TikTok|Pinterest|GSA\/|; wv\)|WebView)/i.test(ua);

  return isStandalone || isEmbeddedUa;
};

const getAuthDebugInfo = () => {
  if (typeof window === "undefined") return null;
  const ua = navigator.userAgent || "";
  const isStandalone =
    (typeof navigator !== "undefined" && navigator.standalone === true) ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches);
  const isEmbeddedUa =
    /(FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|TikTok|Pinterest|GSA\/|; wv\)|WebView)/i.test(ua);
  return {
    isStandalone,
    isEmbeddedUa,
    platform: navigator.platform || "",
    vendor: navigator.vendor || "",
    ua,
  };
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useLogin
 *
 * Session restore order on page load:
 *  1. Valid access token in localStorage   → verify with /me, redirect to dashboard
 *  2. No/expired access token              → try POST /auth/refresh (httpOnly cookie)
 *     2a. Refresh succeeds                 → redirect to dashboard  (user stays logged in)
 *     2b. Refresh fails                    → proceed to Firebase redirect/session check
 *  3. Firebase pending redirect            → complete OAuth redirect, call /google, redirect
 *  4. Recovered Firebase session           → call /google, redirect
 *  5. Nothing found                        → show login form
 *
 * This order prevents the login form from flashing for users whose 15-minute
 * access token has expired but whose 30-day refresh cookie is still valid.
 */
export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // The app's own notification system, replacing the alert() dialogs this hook
  // used to raise. ToastProvider wraps every route from app/providers.tsx.
  const { addToast } = useToast();

  const [form, setForm]                   = useState({ email: "", password: "" });
  const [focused, setFocused]             = useState(null);
  const [showPass, setShowPass]           = useState(false);
  const [mounted, setMounted]             = useState(false);
  const [shake, setShake]                 = useState(false);
  const [inAppBrowser, setInAppBrowser]   = useState(false);
  const [authDebugInfo, setAuthDebugInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;

    setInAppBrowser(isInAppBrowser());
    setAuthDebugInfo(getAuthDebugInfo());

    const showForm = () => {
      if (!cancelled) setMounted(true);
    };

    const checkFirebaseSession = async () => {
      const wasPending = hasRedirectPending();
      try {
        // getRedirectResult() can only be read once per page load, so one call
        // serves both providers and the result says which one signed in.
        const redirect = await handleFirebaseRedirectResult();
        let idToken = redirect?.idToken || null;
        let providerId = redirect?.providerId || null;

        if (!idToken) {
          if (wasPending) {
            // Only recover a persisted Firebase session when the user explicitly
            // initiated an OAuth redirect. Without a pending redirect flag,
            // silently recovering a stale Firebase session would auto-login the user
            // and redirect them away from the login form without their intent.
            const recovered = await recoverFirebaseSessionIdToken();
            if (!recovered) {
              clearRedirectPending();
              // "use a different browser" is meaningless in the app, and this
              // path is reachable there via the web fallback.
              addToast("Sign-in didn't finish. Please try again.", "error");
            }
            idToken = recovered;
            // A recovered session carries no redirect result, so the provider is
            // unknown; Google is the only one that reaches this path today.
            providerId = providerId || "google.com";
          }
        }
        if (idToken) {
          const data = providerId === "apple.com"
            ? await appleLogin(idToken)
            : await googleLogin(idToken);
          if (data && !cancelled) {
            await handleAuthSuccess(data);
            return;
          }
        }
      } catch (err) {
        clearRedirectPending();
        addToast(
          reportUserError("auth_redirect_exchange_failed", err, getGoogleAuthErrorMessage(err)),
          "error"
        );
      }
      showForm();
    };

    const restoreSession = async () => {
      // Step 1: valid access token in memory
      const token = getValidToken() || await hydrateAuthToken();
      if (token) {
        try {
          const profile = await getProfile();
          if (!cancelled) {
            if (profile?.requiresTermsAcceptance) {
              router.push("/accept-terms");
            } else {
              const landing = await resolveLandingPath();
              seedOnboardingCache(queryClient, landing.state);
              router.push(landing.path);
            }
          }
          return;
        } catch (err) {
          const status = err?.status;
          if (err?.data?.errorCode === "TERMS_NOT_ACCEPTED") {
            if (!cancelled) router.push("/accept-terms");
            return;
          }
          if (status === 401) {
            // Server explicitly rejected the token — safe to clear it
            if (!cancelled) await clearAuthToken();
          } else if (status !== 429 && status != null) {
            // Unexpected server error with a valid token — don't clear.
            // Fall through: silentRefresh will confirm session is still alive.
          }
          // For 429: token is still valid, fall through to silentRefresh
          // which will obtain a fresh access token without clearing state.
        }
      }

      if (cancelled) return;

      // Step 2: try silent refresh — the httpOnly refresh cookie may still be valid
      // even though the access token has expired or was cleared above.
      let newToken = null;
      try {
        newToken = await silentRefresh();
      } catch (err) {
        if (isAuthRefreshTransientError(err)) {
          console.warn("[Auth] login restore preserved session after transient refresh failure", {
            at: new Date().toISOString(),
            status: err.status || 0,
          });
          showForm();
          return;
        }
        throw err;
      }
      if (newToken && !cancelled) {
        const savedRedirect = typeof window !== "undefined"
          ? sessionStorage.getItem("auth_redirect")
          : null;
        try {
          // Both requests answer independent questions; running them in
          // series added a whole round-trip to every restored session.
          const [profile, landing] = await Promise.all([
            getProfile(),
            resolveLandingPath(),
          ]);
          seedOnboardingCache(queryClient, landing.state);
          if (profile?.requiresTermsAcceptance) {
            router.push("/accept-terms");
          } else if (savedRedirect && landing.path !== "/onboarding") {
            sessionStorage.removeItem("auth_redirect");
            router.push(savedRedirect);
          } else {
            if (savedRedirect) sessionStorage.removeItem("auth_redirect");
            router.push(landing.path);
          }
        } catch {
          const landing = await resolveLandingPath();
          seedOnboardingCache(queryClient, landing.state);
          router.push(savedRedirect && landing.path !== "/onboarding" ? savedRedirect : landing.path);
          if (savedRedirect) sessionStorage.removeItem("auth_redirect");
        }
        return;
      }

      // Step 3+: fall through to Firebase session / OAuth redirect check
      if (!cancelled) await checkFirebaseSession();
    };

    restoreSession();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const handleAuthSuccess = async (data) => {
    if (!data?.token) {
      triggerShake();
      // data.message comes from the API and is already written for users, but
      // run it through the sanitiser so an unsanitised 500 cannot reach the UI.
      addToast(getUserMessage(data, "We couldn't sign you in. Please try again."), "error");
      return;
    }
    await setAuthToken(data.token);
    // Notify FCM state machine of the authenticated identity so it can
    // detect user switches on shared devices and force re-registration.
    // Fire-and-forget — login path must not block on FCM.
    const loggedInUserId = data.user?._id || data.user?.id || data.userId || null;
    onUserLoggedIn(loggedInUserId).catch(() => {});
    initializePushNotifications().catch(() => {});
    ensurePushRegistration().catch(() => {});
    queryClient.clear();

    if (data.requiresTermsAcceptance) {
      router.push("/accept-terms");
      return;
    }

    // Warm the dashboard cache only after terms are already accepted. If this
    // runs early, the terms gate returns 403 and triggers another redirect.
    queryClient.prefetchQuery({
      queryKey: ["dashboard", "snapshot"],
      queryFn: ({ signal }) => getDashboardSnapshot(signal),
      staleTime: 2 * 60 * 1000,
    }).catch(() => {});

    // Restore destination saved by useRequireAuth (e.g. notification deep-link)
    const savedRedirect = typeof window !== "undefined"
      ? sessionStorage.getItem("auth_redirect")
      : null;
    const landing = await resolveLandingPath();
    seedOnboardingCache(queryClient, landing.state);
    if (savedRedirect && landing.path !== "/onboarding") {
      sessionStorage.removeItem("auth_redirect");
      router.push(savedRedirect);
    } else {
      if (savedRedirect) sessionStorage.removeItem("auth_redirect");
      // New users go to /onboarding; returning users go straight to /dashboard.
      // resolveLandingPath() reads the user's onboarding state from the server.
      router.push(landing.path);
    }
  };

  // Email/password login
  const loginMutation = useMutation({
    mutationFn: (credentials) => loginUser(credentials),
    onSuccess: handleAuthSuccess,
    onError: (err) => {
      triggerShake();
      // Was "Login Error: " + err.message, which surfaced axios and backend
      // internals such as "Request failed with status 500". A 401 here means
      // the credentials were wrong, and saying so is more useful than a generic.
      const fallback = err?.status === 401
        ? "Incorrect email or password."
        : "We couldn't sign you in. Please try again.";
      addToast(reportUserError("login_failed", err, fallback), "error");
    },
  });

  // Google Sign-In
  const googleMutation = useMutation({
    mutationFn: async () => {
      if (isInAppBrowser()) {
        const e = new Error(
          "Google login is blocked inside in-app browsers. Please open this page in Chrome/Safari and try again."
        );
        e.code = "DISALLOWED_USER_AGENT";
        throw e;
      }
      const idToken = await signInWithFirebaseGoogle();
      if (!idToken) return null;
      return googleLogin(idToken);
    },
    onSuccess: async (data) => {
      if (!data) return;
      await handleAuthSuccess(data);
    },
    onError: (err) => {
      triggerShake();
      clearRedirectPending();
      clearAuthToken().catch(() => {});
      signOutFirebase().catch(() => {});
      // The disallowed_useragent branch used to print the raw Google error code
      // plus instructions to update the System WebView and Play Services —
      // developer triage steps, not something to put in front of a user.
      // getGoogleAuthErrorMessage() now covers that case with copy that only
      // mentions the browser when there actually is one.
      addToast(
        reportUserError("google_signin_failed", err, getGoogleAuthErrorMessage(err)),
        "error"
      );
    },
  });

  // Sign in with Apple. Everything after the Firebase token is the SAME path as
  // Google and email/password: handleAuthSuccess owns token persistence, the
  // query-cache reset, push registration, terms routing and onboarding routing.
  const appleMutation = useMutation({
    mutationFn: async () => {
      const idToken = await signInWithFirebaseApple();
      // null means a web redirect was started; the token is picked up on the
      // next page load by checkFirebaseSession().
      if (!idToken) return null;
      return appleLogin(idToken);
    },
    onSuccess: async (data) => {
      if (!data) return;
      await handleAuthSuccess(data);
    },
    onError: (err) => {
      // Backing out of the Apple sheet is not a failure. No shake, no alert.
      if (isAuthCancellation(err)) return;
      triggerShake();
      clearRedirectPending();
      clearAuthToken().catch(() => {});
      signOutFirebase().catch(() => {});
      // A server-side provider conflict already carries a sentence written for
      // users ("already registered with Google"); prefer it over generic copy.
      addToast(
        reportUserError("apple_signin_failed", err, getAppleAuthErrorMessage(err)),
        "error"
      );
    },
  });

  const handleChange = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const credentials = {
      email: form.email.trim(),
      password: form.password,
    };

    if (!credentials.email || !credentials.password) {
      triggerShake();
      addToast("Enter your email and password to continue.", "error");
      return;
    }

    loginMutation.mutate(credentials);
  };

  const handleGoogleSignIn = () => {
    if (googleMutation.isPending) return;
    googleMutation.mutate();
  };

  const handleAppleSignIn = () => {
    if (appleMutation.isPending) return;
    appleMutation.mutate();
  };

  return {
    form,
    handleChange,
    focused,
    setFocused,
    loading: loginMutation.isPending,
    googleLoading: googleMutation.isPending,
    appleLoading: appleMutation.isPending,
    // Resolved on the client only, so the button is absent from the prerendered
    // HTML and appears after mount — never a hydration mismatch.
    showAppleSignIn: mounted && isAppleSignInAvailable(),
    showPass,
    setShowPass,
    mounted,
    shake,
    inAppBrowser,
    authDebugInfo,
    handleSubmit,
    handleGoogleSignIn,
    handleAppleSignIn,
  };
}
