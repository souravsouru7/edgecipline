
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStreaks, markNoTradeToday, recomputeStreaks } from "@/features/streaks/api/streaksApi";

const STREAK_KEY = ["streaks", "detail"];

export function useStreaks(days = 90) {
  return useQuery({
    queryKey: [...STREAK_KEY, days],
    queryFn: ({ signal }) => getStreaks(days, signal),
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useMarkNoTradeToday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markNoTradeToday,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["streaks"] });
      // Dashboard snapshot also surfaces the streak chip — refresh it so the
      // hero reflects today's mark immediately, no refetch lag.
      qc.invalidateQueries({ queryKey: ["dashboard", "snapshot"] });
    },
  });
}

export function useRecomputeStreaks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recomputeStreaks,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["streaks"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "snapshot"] });
    },
  });
}
