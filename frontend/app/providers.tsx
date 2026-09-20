"use client";

import { Suspense, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  PERSISTED_CACHE_BUSTER,
  PERSISTED_CACHE_MAX_AGE_MS,
  getQueryPersister,
  shouldPersistQuery,
} from "@/utils/persistedQueryCache";
import { MarketProvider } from "@/context/MarketContext";
import { ToastProvider } from "@/features/shared/components/ui/Toast";
import ErrorBoundary from "@/components/ErrorBoundary";
import EnvironmentGuard from "@/components/EnvironmentGuard";
import PushNotificationBootstrap from "@/components/PushNotificationBootstrap";
import PlayBillingBootstrap from "@/components/PlayBillingBootstrap";
import AuthSessionBootstrap from "@/components/AuthSessionBootstrap";
import RouteTransitionProgress from "@/components/RouteTransitionProgress";
import AttributionCapture from "@/features/promotions/components/AttributionCapture";
import NativeBackButton from "@/components/NativeBackButton";
import PageTransition from "@/components/PageTransition";
import OfflineBanner from "@/components/OfflineBanner";
import { useEffect } from "react";
import { initNetworkStatus } from "@/utils/networkStatus";
import { initKeyboardBehaviour } from "@/utils/keyboardBehaviour";
import { applySystemBars } from "@/features/shared/hooks/useSystemBars";
// One-time client bootstrap for the native shell. Each call is idempotent
// and a no-op on the web, so this is safe under React StrictMode.
function useNativeShellBootstrap() {
  useEffect(() => {
    const cap = (window as Window & { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    const platform: string = cap?.getPlatform?.() || "web";
    // Lets CSS special-case the Android WebView (e.g. no backdrop blur on
    // scrolling surfaces) without runtime style branching in components.
    document.documentElement.dataset.platform = platform;
    void initNetworkStatus();
    void initKeyboardBehaviour();
    void applySystemBars("light");
  }, []);
}

export default function Providers({ children }: { children: React.ReactNode }) {
  useNativeShellBootstrap();
  // We Create the QueryClient inside the state to ensure it is only initialized once
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 60 * 1000,
            // Must be >= the persister's maxAge, otherwise restored entries are
            // garbage-collected before the screen that needs them mounts.
            gcTime: PERSISTED_CACHE_MAX_AGE_MS,
            retry: 1,
            refetchOnReconnect: false,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  // Persist read-heavy queries to storage so a returning user paints the last
  // dashboard/trades instantly and refetches in the background. Falls back to
  // the plain provider when storage is unavailable (private mode, quota).
  const [persister] = useState(() => getQueryPersister());
  const persistOptions = persister
    ? {
        persister,
        maxAge: PERSISTED_CACHE_MAX_AGE_MS,
        buster: PERSISTED_CACHE_BUSTER,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }
    : null;

  return (
    <ErrorBoundary>
      <EnvironmentGuard>
        {persistOptions ? (
          <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <MarketProvider>
            <ToastProvider>
              <AuthSessionBootstrap>
                <Suspense fallback={null}>
                  <RouteTransitionProgress />
                </Suspense>
                <PushNotificationBootstrap />
                <NativeBackButton />
                <OfflineBanner />
                {/* Reconciles Google Play purchases on launch/resume. Renders
                    nothing, and no-ops entirely off native Android. */}
                <PlayBillingBootstrap />
                <Suspense fallback={null}>
                  <AttributionCapture />
                </Suspense>
                <PageTransition>{children}</PageTransition>
              </AuthSessionBootstrap>
            </ToastProvider>
          </MarketProvider>
          </PersistQueryClientProvider>
        ) : (
          <QueryClientProvider client={queryClient}>
          <MarketProvider>
            <ToastProvider>
              <AuthSessionBootstrap>
                <Suspense fallback={null}>
                  <RouteTransitionProgress />
                </Suspense>
                <PushNotificationBootstrap />
                <NativeBackButton />
                <OfflineBanner />
                {/* Reconciles Google Play purchases on launch/resume. Renders
                    nothing, and no-ops entirely off native Android. */}
                <PlayBillingBootstrap />
                <Suspense fallback={null}>
                  <AttributionCapture />
                </Suspense>
                <PageTransition>{children}</PageTransition>
              </AuthSessionBootstrap>
            </ToastProvider>
          </MarketProvider>
          </QueryClientProvider>
        )}
      </EnvironmentGuard>
    </ErrorBoundary>
  );
}
