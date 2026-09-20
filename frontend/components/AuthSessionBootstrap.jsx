"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import BrandOpener, { OPENER_EXIT_MS } from "@/components/BrandOpener";
import { getValidToken, hydrateAuthToken } from "@/utils/auth";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";
import { hideNativeSplash } from "@/utils/nativeSplash";
import { isStartupContentReady, isStartupGatedRoute, subscribeStartupGate } from "@/utils/startupGate";
import { hasPersistedStartupContent } from "@/utils/persistedQueryCache";

const STARTUP_REVEAL_TIMEOUT_MS = 1400;
// Native only: the AndroidX splash has already shown this logo statically, so
// the web opener continuing for a beat is what makes the hand-off read as one
// motion rather than a flash. On the web there is no native splash and any
// hold is pure delay, so it is zero there.
const OPENER_MIN_HOLD_NATIVE_MS = 520;
// On a gated route (see utils/startupGate) the opener also waits for the first
// screen's data. This is the ceiling on that wait: past it the app reveals
// with its own loading state rather than leaving the user staring at a logo
// on a very slow connection.
const STARTUP_CONTENT_TIMEOUT_MS = 10000;

// Routes an unauthenticated visitor may reach. Anything not listed here gets
// redirected to /login when session restore comes back empty.
//
// The legal/support group is not optional polish — these URLs are submitted to
// the stores and are opened cold, in a browser, with no session:
//
//   /privacy-policy  Play Console + App Store Connect both require a reachable
//                    privacy policy URL, and Play flags the listing if it stops
//                    resolving.
//   /delete-account  Play's User Data policy requires a public account-deletion
//                    URL alongside the in-app path.
//   /terms           Linked from the store listing and from /accept-terms.
//   /support         Apple requires a working support URL.
//
// Bouncing a reviewer from any of these to a login screen reads as "the URL
// does not work" and fails review.
//
// /admin is listed for a different reason: it is not public, it just isn't
// ours to guard. The admin panel runs on a separate auth system — the
// admin_sid httpOnly cookie signed with ADMIN_JWT_SECRET, enforced by
// adminAuth on the API and by the guard in app/admin/layout.js. This
// bootstrap only knows about the user session, so without this entry it finds
// no user token on /admin/login and hard-redirects the admin to /login before
// they can sign in at all.
const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-otp",
  "/privacy-policy",
  "/terms",
  "/delete-account",
  "/support",
  "/admin",
  "/r",
];

export default function AuthSessionBootstrap({ children }) {
  // `ready`  — session restored; children mount so the first screen can start
  //            fetching underneath the opener.
  // `shown`  — the opener has started its exit; false again only for bfcache
  //            restores. Overlay stays mounted for OPENER_EXIT_MS after this
  //            flips so it can crossfade over the app rather than cut.
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);
  const [exiting, setExiting] = useState(false);
  const readyRef = useRef(false);
  const mountedAtRef = useRef(0);
  const pathname = usePathname();
  const pathnameRef = useRef(pathname || "");

  pathnameRef.current = pathname || "";

  useEffect(() => {
    let active = true;
    let nativeListener = null;
    let resumeInFlight = null;
    let revealTimer = null;
    let holdTimer = null;
    let exitTimer = null;
    let contentTimer = null;
    let unsubscribeGate = null;
    mountedAtRef.current = performance.now();
    const isProtectedRoute = () => !PUBLIC_PATH_PREFIXES.some((prefix) => pathnameRef.current === prefix || pathnameRef.current.startsWith(`${prefix}/`));
    const redirectToLogin = () => {
      if (typeof window === "undefined") return;
      if (!isProtectedRoute()) return;
      if (window.location.pathname === "/login") return;
      window.location.replace("/login");
    };

    const revealApp = (reason) => {
      if (!active || readyRef.current) return;
      readyRef.current = true;
      if (reason === "timeout") {
        console.warn("AUTH_STARTUP_SOFT_TIMEOUT", {
          timeoutMs: STARTUP_REVEAL_TIMEOUT_MS,
          platform: window.Capacitor?.isNativePlatform?.() ? "capacitor" : "web",
        });
      }
      // Mount the app now so a gated first screen can fetch behind the opener.
      setReady(true);
      hideNativeSplash();

      const dismiss = () => {
        if (!active) return;
        const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
        const elapsed = performance.now() - mountedAtRef.current;
        // With a persisted dashboard snapshot the first screen paints from
        // storage in the same frame the app mounts, so the opener only needs
        // its own crossfade — holding it longer would be the wait we removed.
        const cachedFirstScreen = hasPersistedStartupContent();
        const hold = isNative && !cachedFirstScreen ? Math.max(0, OPENER_MIN_HOLD_NATIVE_MS - elapsed) : 0;
        holdTimer = window.setTimeout(() => {
          if (!active) return;
          setShown(true);
          setExiting(true);
          exitTimer = window.setTimeout(() => {
            if (active) setExiting(false);
          }, OPENER_EXIT_MS);
        }, hold);
      };

      if (!isStartupGatedRoute(pathnameRef.current) || isStartupContentReady()) {
        dismiss();
        return;
      }
      // Gated route: wait for the first screen's content, with a ceiling.
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        unsubscribeGate?.();
        if (contentTimer) window.clearTimeout(contentTimer);
        dismiss();
      };
      unsubscribeGate = subscribeStartupGate(settle);
      contentTimer = window.setTimeout(() => {
        console.warn("STARTUP_CONTENT_TIMEOUT", { timeoutMs: STARTUP_CONTENT_TIMEOUT_MS, pathname: pathnameRef.current });
        settle();
      }, STARTUP_CONTENT_TIMEOUT_MS);
    };
    const hideProtectedApp = () => {
      if (!active || !isProtectedRoute()) return;
      readyRef.current = false;
      mountedAtRef.current = performance.now();
      setExiting(false);
      setShown(false);
      setReady(false);
    };

    const restore = async (trigger) => {
      if (resumeInFlight) return resumeInFlight;
      resumeInFlight = (async () => {
        console.info(trigger === "resume" ? "AUTH_RESUME_REFRESH" : "AUTH_HYDRATE_START", {
          platform: window.Capacitor?.isNativePlatform?.() ? "capacitor" : "web",
          visibility: document.visibilityState,
        });
        try {
          const hydrated = getValidToken() || await hydrateAuthToken();
          const token = hydrated || await silentRefresh();
          console.info(token ? "AUTH_HYDRATE_SUCCESS" : "AUTH_HYDRATE_EMPTY", { trigger });
          return { token: token || null, transient: false };
        } catch (error) {
          if (isAuthRefreshTransientError(error)) {
            console.warn("AUTH_REFRESH_FAILED", { trigger, transient: true, status: error.status || 0 });
            return { token: null, transient: true };
          }
          console.warn("AUTH_HYDRATE_EMPTY", { trigger, terminal: true });
          return { token: null, transient: false };
        } finally {
          resumeInFlight = null;
        }
      })();
      return resumeInFlight;
    };

    revealTimer = window.setTimeout(() => revealApp("timeout"), STARTUP_REVEAL_TIMEOUT_MS);
    restore("startup").then(({ token, transient }) => {
      if (!token && !transient) {
        redirectToLogin();
      }
    }).finally(() => {
      if (revealTimer) {
        window.clearTimeout(revealTimer);
        revealTimer = null;
      }
      revealApp("auth-ready");
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void restore("resume").then(({ token, transient }) => {
          if (!token && !transient) redirectToLogin();
        });
      }
    };
    const onPageShow = (event) => {
      if (!event?.persisted) return;
      hideProtectedApp();
      void restore("pageshow").then(({ token, transient }) => {
        if (!token && !transient) redirectToLogin();
        if (token || transient) revealApp("pageshow-auth-ready");
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);

    const appPlugin = window.Capacitor?.Plugins?.App;
    if (appPlugin?.addListener) {
      Promise.resolve(appPlugin.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          void restore("resume").then(({ token, transient }) => {
            if (!token && !transient) redirectToLogin();
          });
        }
      })).then((listener) => { nativeListener = listener; }).catch(() => {});
    }

    return () => {
      active = false;
      if (revealTimer) window.clearTimeout(revealTimer);
      if (holdTimer) window.clearTimeout(holdTimer);
      if (exitTimer) window.clearTimeout(exitTimer);
      if (contentTimer) window.clearTimeout(contentTimer);
      unsubscribeGate?.();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      nativeListener?.remove?.();
    };
  }, []);

  return (
    <>
      {ready ? children : null}
      {(!shown || exiting) && <BrandOpener exiting={exiting} />}
    </>
  );
}
