"use client";

import { useSyncExternalStore } from "react";
import { isOnline, subscribeNetworkStatus } from "@/utils/networkStatus";

// `true` while the device reports connectivity. Server render assumes online
// so the static export never bakes an offline banner into the HTML.
export function useNetworkStatus() {
  return useSyncExternalStore(subscribeNetworkStatus, isOnline, () => true);
}
