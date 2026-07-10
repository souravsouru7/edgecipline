"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MarketProvider } from "@/context/MarketContext";
import { ToastProvider } from "@/features/shared/components/ui/Toast";
import ErrorBoundary from "@/components/ErrorBoundary";
import EnvironmentGuard from "@/components/EnvironmentGuard";
import PushNotificationBootstrap from "@/components/PushNotificationBootstrap";
import AuthSessionBootstrap from "@/components/AuthSessionBootstrap";
export default function Providers({ children }: { children: React.ReactNode }) {
  // We Create the QueryClient inside the state to ensure it is only initialized once
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 60 * 1000,
            gcTime: 30 * 60 * 1000,
            retry: 1,
            refetchOnReconnect: false,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <ErrorBoundary>
      <EnvironmentGuard>
        <QueryClientProvider client={queryClient}>
          <MarketProvider>
            <ToastProvider>
              <AuthSessionBootstrap>
                <PushNotificationBootstrap />
                {children}
              </AuthSessionBootstrap>
            </ToastProvider>
          </MarketProvider>
        </QueryClientProvider>
      </EnvironmentGuard>
    </ErrorBoundary>
  );
}
