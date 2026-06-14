"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getProfile, loginUser, googleLogin } from "@/services/api";
import { getDashboardSnapshot } from "@/features/dashboard/api/dashboardApi";
import { clearAuthToken, getValidToken, hydrateAuthToken, setAuthToken } from "@/utils/auth";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";
import {
  signInWithFirebaseGoogle,
  handleGoogleRedirectResult,
  recoverFirebaseSessionIdToken,
  hasRedirectPending,
  clearRedirectPending,
} from "@/services/firebaseAuth";
import {
  ensurePushRegistration,
  initializePushNotifications,
  onUserLoggedIn,
} from "@/services/pushNotifications";

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
        let idToken = await handleGoogleRedirectResult();
        if (!idToken) {
          if (wasPending) {
            // Only recover a persisted Firebase session when the user explicitly
            // initiated a Google OAuth redirect. Without a pending redirect flag,
            // silently recovering a stale Firebase session would auto-login the user
            // and redirect them away from the login form without their intent.
            const recovered = await recoverFirebaseSessionIdToken();
            if (!recovered) {
              clearRedirectPending();
              alert("Google Sign-In was interrupted or failed. Please try again or use a different browser.");
            }
            idToken = recovered;
          }
        }
        if (idToken) {
          const data = await googleLogin(idToken);
          if (data && !cancelled) {
            handleAuthSuccess(data);
            return;
          }
        }
      } catch (err) {
        clearRedirectPending();
        alert("Google login failed: " + (err?.message || err));
      }
      showForm();
    };

    const restoreSession = async () => {
      // Step 1: valid access token in memory
      const token = getValidToken() || await hydrateAuthToken();
      if (token) {
        try {
          const profile = await getProfile();
          if (!cancelled) router.push(profile?.requiresTermsAcceptance ? "/accept-terms" : "/dashboard");
          return;
        } catch (err) {
          const status = err?.status;
          if (status === 401 || status === 403) {
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
          const profile = await getProfile();
          if (profile?.requiresTermsAcceptance) {
            router.push("/accept-terms");
          } else if (savedRedirect) {
            sessionStorage.removeItem("auth_redirect");
            router.push(savedRedirect);
          } else {
            router.push("/dashboard");
          }
        } catch {
          router.push(savedRedirect || "/dashboard");
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
      alert(data?.message || "Login failed");
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

    // Warm the dashboard cache while the router transitions — by the time the
    // dashboard mounts, this request is already in-flight (or done) and
    // useQuery dedups onto it. Eliminates the post-login white flash.
    queryClient.prefetchQuery({
      queryKey: ["dashboard", "snapshot"],
      queryFn: ({ signal }) => getDashboardSnapshot(signal),
      staleTime: 2 * 60 * 1000,
    }).catch(() => {});

    if (data.requiresTermsAcceptance) {
      router.push("/accept-terms");
      return;
    }

    // Restore destination saved by useRequireAuth (e.g. notification deep-link)
    const savedRedirect = typeof window !== "undefined"
      ? sessionStorage.getItem("auth_redirect")
      : null;
    if (savedRedirect) {
      sessionStorage.removeItem("auth_redirect");
      router.push(savedRedirect);
    } else {
      router.push("/dashboard");
    }
  };

  // Email/password login
  const loginMutation = useMutation({
    mutationFn: (credentials) => loginUser(credentials),
    onSuccess: handleAuthSuccess,
    onError: (err) => {
      triggerShake();
      alert("Login Error: " + (err.message || "Check your credentials."));
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
    onSuccess: (data) => {
      if (!data) return;
      handleAuthSuccess(data);
    },
    onError: (err) => {
      triggerShake();
      const msg = String(err?.message || "");
      if (/disallowed_useragent/i.test(msg) || err?.code === "DISALLOWED_USER_AGENT") {
        alert(
          "Google blocked this browser (Error 403: disallowed_useragent).\n\n" +
            "Fix: open the site in Safari (iPhone) or update Chrome + System WebView + Play Services (Android), then try again."
        );
        return;
      }
      alert("Google login failed: " + (msg || "Could not connect to Google."));
    },
  });

  const handleChange = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    loginMutation.mutate(form);
  };

  const handleGoogleSignIn = () => {
    googleMutation.mutate();
  };

  return {
    form,
    handleChange,
    focused,
    setFocused,
    loading: loginMutation.isPending,
    googleLoading: googleMutation.isPending,
    showPass,
    setShowPass,
    mounted,
    shake,
    inAppBrowser,
    authDebugInfo,
    handleSubmit,
    handleGoogleSignIn,
  };
}
