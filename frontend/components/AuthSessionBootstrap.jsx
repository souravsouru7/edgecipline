"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import AppLoadingShell from "@/components/AppLoadingShell";
import { getValidToken, hydrateAuthToken } from "@/utils/auth";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";
import { hideNativeSplash } from "@/utils/nativeSplash";

const STARTUP_REVEAL_TIMEOUT_MS = 1400;

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
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const pathname = usePathname();
  const pathnameRef = useRef(pathname || "");

  pathnameRef.current = pathname || "";

  useEffect(() => {
    let active = true;
    let nativeListener = null;
    let resumeInFlight = null;
    let revealTimer = null;
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
      setReady(true);
      hideNativeSplash();
      if (reason === "timeout") {
        console.warn("AUTH_STARTUP_SOFT_TIMEOUT", {
          timeoutMs: STARTUP_REVEAL_TIMEOUT_MS,
          platform: window.Capacitor?.isNativePlatform?.() ? "capacitor" : "web",
        });
      }
    };
    const hideProtectedApp = () => {
      if (!active || !isProtectedRoute()) return;
      readyRef.current = false;
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
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      nativeListener?.remove?.();
    };
  }, []);

  if (!ready) {
    return (
      <AppLoadingShell
        title="Restoring Edgecipline"
        subtitle="Checking your secure session"
        dense
      />
    );
  }

  return children;
}
