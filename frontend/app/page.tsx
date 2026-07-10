"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getProfile } from "@/services/api";
import { getValidToken, hydrateAuthToken } from "@/utils/auth";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";

type UserProfile = {
  requiresTermsAcceptance?: boolean;
};

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const routeByAuth = async () => {
      try {
        if (!(getValidToken() || await hydrateAuthToken() || await silentRefresh())) {
          router.replace("/login");
          return;
        }

        const profile = (await getProfile()) as UserProfile;
        if (!cancelled) router.replace(profile?.requiresTermsAcceptance ? "/accept-terms" : "/dashboard");
      } catch (err: unknown) {
        const apiError = err as { data?: { errorCode?: string } };
        if (apiError.data?.errorCode === "TERMS_NOT_ACCEPTED") {
          if (!cancelled) router.replace("/accept-terms");
          return;
        }
        if (isAuthRefreshTransientError(err)) {
          return;
        }
        const status = (err as { status?: number }).status;
        const errorCode = apiError.data?.errorCode;
        const terminalAuthFailure = status === 401 && [
          "AUTH_REQUIRED",
          "INVALID_TOKEN",
          "TOKEN_INVALIDATED",
          "REFRESH_TOKEN_EXPIRED",
          "TOKEN_REPLAY_DETECTED",
        ].includes(String(errorCode || ""));
        if (terminalAuthFailure && !cancelled) router.replace("/login");
      }
    };

    routeByAuth();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#F0EEE9",
        color: "#0F1923",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <img
          src="/mainlogo1.png"
          alt="Edgecipline"
          style={{
            width: 180,
            maxWidth: "70vw",
            height: "auto",
            objectFit: "contain",
            display: "block",
            margin: "0 auto",
          }}
        />
      </div>
    </main>
  );
}
