"use client";

import { initializeApp, getApp, getApps } from "firebase/app";
import {
  GoogleAuthProvider,
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

// Native Google Sign-In via @capacitor-firebase/authentication
const signInWithNativeGoogle = async () => {
  let FirebaseAuthentication;
  try {
    const mod = await import("@capacitor-firebase/authentication");
    FirebaseAuthentication = mod.FirebaseAuthentication;
  } catch {
    throw new Error("@capacitor-firebase/authentication plugin is not installed. Run: npm install @capacitor-firebase/authentication && npx cap sync");
  }

  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;

  if (!idToken) {
    throw new Error(
      "Google Sign-In returned no ID token. " +
      "Make sure your SHA-1 fingerprint is added in Firebase Console and google-services.json is up to date."
    );
  }

  // Exchange Google ID token for Firebase ID token so backend always gets a Firebase token
  const auth = await getFirebaseAuth();
  const credential = GoogleAuthProvider.credential(idToken);
  const firebaseResult = await signInWithCredential(auth, credential);
  return firebaseResult.user.getIdToken();
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
  return /popup|unsupported|cancelled-popup-request|popup-closed-by-user/i.test(text);
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

export const getGoogleAuthErrorMessage = (err) => {
  const text = getFirebaseErrorText(err);
  if (/popup-closed-by-user|cancelled-popup-request/i.test(text)) {
    return "Google sign-in was closed before it finished. Try again, or allow popups for localhost:3000.";
  }
  if (/popup-blocked/i.test(text)) {
    return "Google sign-in popup was blocked. Allow popups for localhost:3000 and try again.";
  }
  if (/disallowed_useragent/i.test(text)) {
    return "Google blocked this browser. Open the site in Chrome or Safari and try again.";
  }
  if (/network-request-failed/i.test(text)) {
    return "Google sign-in could not reach Firebase. Check your internet connection and try again.";
  }
  return err?.message || "Could not connect to Google.";
};

export const handleGoogleRedirectResult = async () => {
  if (typeof window === "undefined") return null;
  // Always attempt to recover redirect results on client.
  // Mobile/in-app browsers can lose storage flags; gating on a flag causes missed results.

  try {
    const auth = await getFirebaseAuth();
    const result = await getRedirectResult(auth);
    clearRedirectPending();
    if (!result) return null;
    return result.user.getIdToken();
  } catch (err) {
    clearRedirectPending();
    console.error("[GoogleAuth] redirect result error:", err);
    throw err;
  }
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

export const signOutFirebase = async () => {
  try {
    const auth = await getFirebaseAuth();
    await signOut(auth);
  } catch (err) {
    console.warn("[GoogleAuth] signOut failed:", err?.message || err);
  }
};
