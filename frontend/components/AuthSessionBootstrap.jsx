"use client";

import { useEffect, useState } from "react";
import { getValidToken, hydrateAuthToken } from "@/utils/auth";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";

export default function AuthSessionBootstrap({ children }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    let nativeListener = null;
    let resumeInFlight = null;

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
          return token;
        } catch (error) {
          if (isAuthRefreshTransientError(error)) {
            console.warn("AUTH_REFRESH_FAILED", { trigger, transient: true, status: error.status || 0 });
            return null;
          }
          console.warn("AUTH_HYDRATE_EMPTY", { trigger, terminal: true });
          return null;
        } finally {
          resumeInFlight = null;
        }
      })();
      return resumeInFlight;
    };

    restore("startup").finally(() => {
      if (active) setReady(true);
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") void restore("resume");
    };
    document.addEventListener("visibilitychange", onVisible);

    const appPlugin = window.Capacitor?.Plugins?.App;
    if (appPlugin?.addListener) {
      Promise.resolve(appPlugin.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void restore("resume");
      })).then((listener) => { nativeListener = listener; }).catch(() => {});
    }

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      nativeListener?.remove?.();
    };
  }, []);

  if (!ready) {
    return <div role="status" aria-label="Restoring session" style={{ minHeight: "100vh", background: "#F4F2EE" }} />;
  }

  return children;
}
