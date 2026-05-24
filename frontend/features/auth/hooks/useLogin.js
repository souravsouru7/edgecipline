"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { loginUser, googleLogin } from "@/services/api";
import {
  signInWithFirebaseGoogle,
  handleGoogleRedirectResult,
  recoverFirebaseSessionIdToken,
  hasRedirectPending,
  clearRedirectPending,
} from "@/services/firebaseAuth";
import { initializePushNotifications } from "@/services/pushNotifications";

const isInAppBrowser = () => {
  if (typeof window === "undefined") return false;
  // Capacitor Android uses a native WebView whose UA contains "; wv)" — but it handles
  // Google Sign-In natively via @capacitor-firebase/authentication, so it is never blocked.
  if (window.Capacitor) return false;
  // iOS "Add to Home Screen" / PWA standalone runs in a browser-less WebView shell.
  // Google OAuth often blocks embedded agents there (disallowed_useragent).
  const isStandalone =
    (typeof navigator !== "undefined" && navigator.standalone === true) ||
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);

  const ua = navigator.userAgent || "";
  // Common embedded/in-app browsers that Google blocks for OAuth (disallowed_useragent).
  const isEmbeddedUa = /(FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|TikTok|Pinterest|GSA\/|; wv\)|WebView)/i.test(ua);
  return isStandalone || isEmbeddedUa;
};

const getAuthDebugInfo = () => {
  if (typeof window === "undefined") return null;
  const ua = navigator.userAgent || "";
  const isStandalone =
    (typeof navigator !== "undefined" && navigator.standalone === true) ||
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
  const isEmbeddedUa = /(FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|TikTok|Pinterest|GSA\/|; wv\)|WebView)/i.test(ua);
  const isAndroidWv = /; wv\)/i.test(ua) || /\bVersion\/\d+\.\d+.*Chrome\/\d+.*Mobile\b/i.test(ua) && /\bSafari\/\d+/i.test(ua) === false;
  return {
    isStandalone,
    isEmbeddedUa,
    isAndroidWv,
    platform: navigator.platform || "",
    vendor: navigator.vendor || "",
    ua,
  };
};

/**
 * useLogin
 * Manages login form state, terms acceptance gate, and authentication mutations.
 */
export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // 1. Local UI State
  const [form, setForm]               = useState({ email: "", password: "" });
  const [focused, setFocused]         = useState(null);
  const [showPass, setShowPass]       = useState(false);
  const [mounted, setMounted]         = useState(false);
  const [shake, setShake]             = useState(false);
  const [inAppBrowser, setInAppBrowser] = useState(false);
  const [authDebugInfo, setAuthDebugInfo] = useState(null);

  // Terms were accepted at registration — login never re-checks them

  useEffect(() => {
    setMounted(true);
    setInAppBrowser(isInAppBrowser());
    setAuthDebugInfo(getAuthDebugInfo());
    const token = typeof window !== "undefined" && localStorage.getItem("token");
    if (token) { router.push("/dashboard"); return; }

    // Pick up the idToken after a mobile redirect Google sign-in.
    // Fallback to an existing Firebase session when redirect result is empty.
    const wasPending = hasRedirectPending();
    handleGoogleRedirectResult()
      .then(async (idToken) => {
        if (idToken) return idToken;
        const recovered = await recoverFirebaseSessionIdToken();
        if (!recovered && wasPending) {
          clearRedirectPending();
          alert("Google Sign-In was interrupted or failed. Please try again or use a different browser.");
        }
        return recovered;
      })
      .then(idToken => { if (idToken) return googleLogin(idToken); })
      .then(data => { if (data) handleAuthSuccess(data); })
      .catch(err => {
        clearRedirectPending();
        alert("Google login failed: " + (err?.message || err));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  /** Shared post-auth redirect: if backend signals terms not yet accepted,
   *  store the token and go to /accept-terms; otherwise go straight to dashboard. */
  const handleAuthSuccess = async (data) => {
    if (!data.token) {
      triggerShake();
      alert(data.message || "Login failed");
      return;
    }
    localStorage.setItem("token", data.token);
    initializePushNotifications().catch((error) => {
      console.error("Push notification setup failed after login", error);
    });
    queryClient.clear();
    if (data.requiresTermsAcceptance) {
      router.push("/accept-terms");
    } else {
      router.push("/dashboard");
    }
  };

  // 3. Email/Password Login Mutation
  const loginMutation = useMutation({
    mutationFn: (credentials) => loginUser(credentials),
    onSuccess: handleAuthSuccess,
    onError: (err) => {
      triggerShake();
      alert("Login Error: " + (err.message || "Check your credentials."));
    },
  });

  // 4. Google Sign-In Mutation
  const googleMutation = useMutation({
    mutationFn: async () => {
      if (isInAppBrowser()) {
        const e = new Error("Google login is blocked inside in-app browsers. Please open this page in Chrome/Safari and try again.");
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
    form, handleChange,
    focused, setFocused,
    loading: loginMutation.isPending,
    googleLoading: googleMutation.isPending,
    showPass, setShowPass,
    mounted, shake,
    inAppBrowser,
    authDebugInfo,
    handleSubmit,
    handleGoogleSignIn,
  };
}
