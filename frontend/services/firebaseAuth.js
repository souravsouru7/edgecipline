"use client";

import { initializeApp, getApp, getApps } from "firebase/app";
import {
  GoogleAuthProvider,
  OAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  getRedirectResult,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  setPersistence,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import { validateEnvironment } from "@/config/environment";
import { isIOSNative } from "@/utils/platform";

// L12: Map config keys → env var names so the error message is actionable.
const FIREBASE_ENV_MAP = {
  apiKey:            'NEXT_PUBLIC_FIREBASE_API_KEY',
  authDomain:        'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId:         'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket:     'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId:             'NEXT_PUBLIC_FIREBASE_APP_ID',
};

const getFirebaseConfig = () => {
  const environment = validateEnvironment();
  const config = {
    apiKey:            environment.firebaseApiKey,
    authDomain:        environment.firebaseAuthDomain,
    projectId:         environment.firebaseProjectId,
    storageBucket:     environment.firebaseStorageBucket,
    messagingSenderId: environment.firebaseMessagingSenderId,
    appId:             environment.firebaseAppId,
  };

  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const missing = required
    .filter((k) => !config[k])
    .map((k) => FIREBASE_ENV_MAP[k]);

  if (missing.length > 0) {
    throw new Error(
      `Firebase is not configured. Missing environment variable(s): ${missing.join(', ')}`
    );
  }

  return config;
};

const getFirebaseApp = () => {
  if (getApps().length > 0) return getApp();
  return initializeApp(getFirebaseConfig());
};

let isPersistenceSet = false;

const getFirebaseAuth = async () => {
  const auth = getAuth(getFirebaseApp());
  if (!isCapacitorApp() && !isPersistenceSet && !hasRedirectPending()) {
    isPersistenceSet = true;
    // Some mobile browsers / in-app browsers can block persistence APIs (IndexedDB/localStorage)
    // during OAuth redirects. Try progressively weaker persistence modes.
    const persistences = [
      browserLocalPersistence,
      indexedDBLocalPersistence,
      browserSessionPersistence,
      inMemoryPersistence,
    ];
    for (const p of persistences) {
      try {
        await setPersistence(auth, p);
        break;
      } catch (err) {
        // Non-fatal: keep trying the next persistence strategy.
        console.warn("[GoogleAuth] setPersistence failed, trying fallback:", err?.message || err);
      }
    }
  }
  return auth;
};

const APPLE_PROVIDER_ID = "apple.com";

// Web Sign in with Apple needs an Apple **Services ID** plus a Return URL
// registered with Apple and pasted into the Firebase console — none of which
// exists yet. Native iOS needs no such setup, so Apple ships there first and the
// web button stays hidden until this flag is turned on. Showing a button that
// cannot complete is worse than not offering it.
const APPLE_WEB_ENABLED =
  String(process.env.NEXT_PUBLIC_APPLE_AUTH_WEB_ENABLED || "").trim() === "true";

const isCapacitorApp = () => typeof window !== "undefined" && !!window.Capacitor;
const isCapacitorAndroid = () => isCapacitorApp() && window.Capacitor?.getPlatform?.() === "android";

const isMobileBrowser = () => {
  if (typeof window === "undefined" || isCapacitorApp()) return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

const isIOSBrowser = () => {
  if (typeof window === "undefined" || isCapacitorApp()) return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
};

// ---------------------------------------------------------------------------
// Native sign-in plumbing, shared by every provider
// ---------------------------------------------------------------------------

const loadNativeFirebaseAuth = async () => {
  try {
    const mod = await import("@capacitor-firebase/authentication");
    return mod.FirebaseAuthentication;
  } catch {
    throw new Error("@capacitor-firebase/authentication plugin is not installed. Run: npm install @capacitor-firebase/authentication && npx cap sync");
  }
};

/**
 * Signs the JS Firebase SDK in with a provider credential and returns its ID
 * token — the single thing the backend ever accepts.
 *
 * Needed on native even though the plugin already signed in the *native*
 * Firebase SDK: the `firebase` npm package running inside the WebView is a
 * separate instance, and `/auth/google` and `/auth/apple` both verify a Firebase
 * ID token with the Admin SDK. So every provider funnels through here.
 */
const exchangeForFirebaseIdToken = async (credential) => {
  const auth = await getFirebaseAuth();
  const firebaseResult = await signInWithCredential(auth, credential);
  return firebaseResult.user.getIdToken();
};

// Native Google Sign-In via @capacitor-firebase/authentication
const signInWithNativeGoogle = async () => {
  const FirebaseAuthentication = await loadNativeFirebaseAuth();

  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;

  if (!idToken) {
    throw new Error(
      "Google Sign-In returned no ID token. " +
      "Make sure your SHA-1 fingerprint is added in Firebase Console and google-services.json is up to date."
    );
  }

  return exchangeForFirebaseIdToken(GoogleAuthProvider.credential(idToken));
};

// Native Sign in with Apple via @capacitor-firebase/authentication.
//
// Apple's identity token is bound to a nonce the plugin generates, so rebuilding
// the credential on the JS side needs that same RAW nonce back — Firebase hashes
// it itself. Omit it when the plugin did not supply one rather than sending
// `undefined`, which fails verification instead of being ignored.
const signInWithNativeApple = async () => {
  const FirebaseAuthentication = await loadNativeFirebaseAuth();

  const result = await FirebaseAuthentication.signInWithApple();
  const idToken = result.credential?.idToken;
  const rawNonce = result.credential?.nonce;

  if (!idToken) {
    throw new Error(
      "Sign in with Apple returned no identity token. " +
      "Check that the Sign In with Apple capability is enabled on the App ID and " +
      "that Apple is enabled as a provider in the Firebase console."
    );
  }

  const credential = new OAuthProvider(APPLE_PROVIDER_ID).credential({
    idToken,
    ...(rawNonce ? { rawNonce } : {}),
  });
  return exchangeForFirebaseIdToken(credential);
};

const REDIRECT_PENDING_KEY = "firebase_google_redirect_pending";
export const setRedirectPending = () => {
  try { sessionStorage.setItem(REDIRECT_PENDING_KEY, "1"); } catch { /* ignore */ }
  try { localStorage.setItem(REDIRECT_PENDING_KEY, "1"); } catch { /* ignore */ }
};
export const hasRedirectPending = () => {
  try {
    if (sessionStorage.getItem(REDIRECT_PENDING_KEY)) return true;
  } catch { /* ignore */ }
  try {
    if (localStorage.getItem(REDIRECT_PENDING_KEY)) return true;
  } catch { /* ignore */ }
  return false;
};
export const clearRedirectPending = () => {
  try { sessionStorage.removeItem(REDIRECT_PENDING_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(REDIRECT_PENDING_KEY); } catch { /* ignore */ }
};

const getFirebaseErrorText = (err) => [
  err?.code,
  err?.customData?.code,
  err?.message,
].filter(Boolean).join(" ");

const shouldUseRedirectFallback = (err) => {
  const text = getFirebaseErrorText(err);
  return /popup-blocked|operation-not-supported-in-this-environment|unsupported|web-storage-unsupported/i.test(text);
};

const signInWithWebGoogle = async () => {
  const auth = await getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.addScope("email");
  provider.addScope("profile");
  provider.setCustomParameters({ prompt: "select_account" });

  // Always attempt popup first, even on mobile browsers, as redirect flows 
  // are often blocked by third-party cookie restrictions or cause reloads.
  try {
    const result = await signInWithPopup(auth, provider);
    if (!isCapacitorApp()) {
      try { await setPersistence(auth, browserLocalPersistence); } catch { /* non-fatal */ }
    }
    return result.user.getIdToken();
  } catch (err) {
    // If popup is blocked or unsupported, fallback to redirect
    if (shouldUseRedirectFallback(err)) {
      setRedirectPending();
      try {
        await signInWithRedirect(auth, provider);
      } catch (redirectErr) {
        clearRedirectPending();
        throw redirectErr;
      }
      return null;
    }
    throw err;
  }
};

/**
 * Did the user simply back out?
 *
 * Covers Firebase's web popup codes and the native codes Apple and Google
 * surface through the Capacitor plugin. ASAuthorizationError 1001 is
 * "the user canceled the authorization attempt" — the Apple sheet being
 * dismissed, which is not an error worth showing anybody.
 */
export const isAuthCancellation = (err) => {
  const text = getFirebaseErrorText(err);
  if (/popup-closed-by-user|cancelled-popup-request|user-cancelled|user_cancelled/i.test(text)) return true;
  if (/canceled|cancelled/i.test(text)) return true;
  // Native iOS error codes come through as strings on the plugin's error object.
  if (String(err?.code) === "1001") return true;
  return false;
};

/** A sentence to show a user whose Apple sign-in failed. Never a raw error. */
export const getAppleAuthErrorMessage = (err) => {
  const text = getFirebaseErrorText(err);
  if (/network-request-failed|network error/i.test(text)) {
    return "Sign in with Apple could not reach Apple. Check your internet connection and try again.";
  }
  if (/account-exists-with-different-credential/i.test(text)) {
    return "This email is already registered with a different sign-in method. Use that method instead.";
  }
  if (/invalid-credential|invalid-nonce/i.test(text)) {
    return "Apple could not verify this sign-in. Please try again.";
  }
  if (/operation-not-allowed|configuration-not-found/i.test(text)) {
    // Apple provider not enabled in Firebase, or the Services ID is missing.
    return "Sign in with Apple is not available right now. Please use another sign-in method.";
  }
  return "Could not complete Sign in with Apple. Please try again.";
};

/**
 * A sentence to show a user whose Google sign-in failed.
 *
 * Previously this leaked `localhost:3000` into two messages and told people to
 * "allow popups" or to "open the site in Chrome or Safari" — a dev hostname and
 * browser instructions, inside an app with no address bar and no popups. It also
 * fell through to `err.message`, which is how raw Firebase codes reached the UI.
 *
 * Browser-specific advice is now gated on actually being in a browser, and the
 * fallback is written copy rather than whatever the SDK threw.
 */
export const getGoogleAuthErrorMessage = (err) => {
  const text = getFirebaseErrorText(err);
  const inBrowser = !isCapacitorApp();

  if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/i.test(text)) {
    return "Google sign-in was cancelled.";
  }
  if (/popup-blocked/i.test(text)) {
    // Only a browser has popups to block; in the app this path means the web
    // fallback ran, and there is nothing for the user to allow.
    return inBrowser
      ? "Google sign-in was blocked by your browser. Allow pop-ups for this site and try again."
      : "Google sign-in could not be completed. Please try again.";
  }
  if (/disallowed_useragent/i.test(text)) {
    return inBrowser
      ? "Google does not allow sign-in from this browser. Open Edgecipline in Chrome or Safari and try again."
      : "Google sign-in could not be completed. Please try again.";
  }
  if (/network-request-failed/i.test(text)) {
    return "Google sign-in could not connect. Check your internet connection and try again.";
  }
  if (/account-exists-with-different-credential/i.test(text)) {
    return "This email is already registered with a different sign-in method. Use that method instead.";
  }
  if (/too-many-requests/i.test(text)) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (/operation-not-allowed|configuration-not-found/i.test(text)) {
    return "Google sign-in is not available right now. Please use another sign-in method.";
  }
  // No err.message fallback: that is what put raw Firebase codes on screen.
  return "Could not complete Google sign-in. Please try again.";
};

/**
 * Picks up whatever OAuth redirect just completed.
 *
 * getRedirectResult() consumes the pending result, so it can only be read ONCE
 * per page load — which is why this is provider-agnostic rather than one
 * function per provider. The caller routes on `providerId`: a Google token goes
 * to /auth/google and an Apple token to /auth/apple, and sending either to the
 * wrong endpoint is rejected by the backend's provider check.
 *
 * @returns {Promise<{idToken: string, providerId: string|null}|null>} null when
 * no redirect was pending.
 */
export const handleFirebaseRedirectResult = async () => {
  if (typeof window === "undefined") return null;
  // Always attempt to recover redirect results on client.
  // Mobile/in-app browsers can lose storage flags; gating on a flag causes missed results.

  try {
    const auth = await getFirebaseAuth();
    const result = await getRedirectResult(auth);
    clearRedirectPending();
    if (!result) return null;
    return {
      idToken: await result.user.getIdToken(),
      // The provider that actually signed in, not the one we hoped for.
      providerId:
        result.providerId ||
        result.user?.providerData?.[0]?.providerId ||
        null,
    };
  } catch (err) {
    clearRedirectPending();
    // No token, no code, no credential — just the failure shape.
    console.error("[FirebaseAuth] redirect result error:", err?.code || err?.message || "unknown");
    throw err;
  }
};

/**
 * Google-only view of the redirect result, kept for the existing call sites.
 *
 * Returns null for a non-Google redirect instead of handing an Apple token to
 * /auth/google, which the backend rejects as an unsupported provider.
 */
export const handleGoogleRedirectResult = async () => {
  const result = await handleFirebaseRedirectResult();
  if (!result) return null;
  if (result.providerId && result.providerId !== "google.com") return null;
  return result.idToken;
};

export const recoverFirebaseSessionIdToken = async () => {
  const auth = await getFirebaseAuth();
  return new Promise((resolve, reject) => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      unsubscribe();
      if (!user) {
        resolve(null);
      } else {
        try {
          resolve(await user.getIdToken());
        } catch (err) {
          reject(err);
        }
      }
    });
  });
};

export const signInWithFirebaseGoogle = async () => {
  if (isCapacitorAndroid() || isCapacitorApp()) {
    return signInWithNativeGoogle();
  }
  return signInWithWebGoogle();
};

// Web Sign in with Apple. Mirrors signInWithWebGoogle, including the popup ->
// redirect fallback, so an embedded or storage-restricted browser behaves the
// same way for both providers.
const signInWithWebApple = async () => {
  const auth = await getFirebaseAuth();
  const provider = new OAuthProvider(APPLE_PROVIDER_ID);
  // Apple returns name and email ONLY on the first authorization, and only for
  // the scopes asked for here. Dropping either means never getting it at all.
  provider.addScope("email");
  provider.addScope("name");

  try {
    const result = await signInWithPopup(auth, provider);
    try { await setPersistence(auth, browserLocalPersistence); } catch { /* non-fatal */ }
    return result.user.getIdToken();
  } catch (err) {
    if (shouldUseRedirectFallback(err)) {
      setRedirectPending();
      try {
        await signInWithRedirect(auth, provider);
      } catch (redirectErr) {
        clearRedirectPending();
        throw redirectErr;
      }
      return null;
    }
    throw err;
  }
};

/**
 * Sign in with Apple, returning a Firebase ID token for the backend.
 *
 * Returns null when a web redirect was started — the token arrives on the next
 * page load via handleFirebaseRedirectResult(), exactly as for Google.
 */
export const signInWithFirebaseApple = async () => {
  if (isCapacitorApp()) return signInWithNativeApple();
  return signInWithWebApple();
};

/**
 * Whether a Sign in with Apple button should be rendered at all.
 *
 * Native iOS: yes. That is also an App Store requirement — Guideline 4.8 makes
 * Sign in with Apple mandatory once the app offers another third-party login,
 * which this app does (Google).
 *
 * Native Android: no. Apple on Android would run Apple's web flow, which needs
 * the Services ID below and gains nothing for Android users.
 *
 * Web: only behind NEXT_PUBLIC_APPLE_AUTH_WEB_ENABLED, see APPLE_WEB_ENABLED.
 *
 * SSR-safe: false on the server, where there is no platform to inspect.
 */
export const isAppleSignInAvailable = () => {
  if (typeof window === "undefined") return false;
  if (isIOSNative()) return true;
  if (isCapacitorApp()) return false;
  return APPLE_WEB_ENABLED;
};

export const signOutFirebase = async () => {
  try {
    const auth = await getFirebaseAuth();
    await signOut(auth);
  } catch (err) {
    console.warn("[GoogleAuth] signOut failed:", err?.message || err);
  }
};
