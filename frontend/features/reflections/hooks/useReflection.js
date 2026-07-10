"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getReflectionSummary,
  getTodayReflection,
  listReflections,
  skipReflection,
  submitReflection,
} from "@/features/reflections/api/reflectionApi";

const REFLECTION_KEY = ["reflection"];

// Helper used by every mutation so all reflection-dependent caches refresh in
// one place — keeps the dashboard widget, history page, and badge counts in
// sync without per-call repetition.
function invalidateAll(queryClient) {
  queryClient.invalidateQueries({ queryKey: REFLECTION_KEY });
  queryClient.invalidateQueries({ queryKey: ["dashboard", "snapshot"] });
}

export function useTodayReflection() {
  return useQuery({
    queryKey: [...REFLECTION_KEY, "today"],
    queryFn: ({ signal }) => getTodayReflection(signal),
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useReflectionSummary() {
  return useQuery({
    queryKey: [...REFLECTION_KEY, "summary"],
    queryFn: ({ signal }) => getReflectionSummary(signal),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useReflectionHistory(days = 14) {
  return useQuery({
    queryKey: [...REFLECTION_KEY, "history", days],
    queryFn: ({ signal }) => listReflections(days, signal),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useSubmitReflection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitReflection,
    onSuccess: () => invalidateAll(qc),
  });
}

export function useSkipReflection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: skipReflection,
    onSuccess: () => invalidateAll(qc),
  });
}
