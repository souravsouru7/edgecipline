"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasValidAuthToken } from "@/utils/auth";
import {
  cancelMindTarget,
  getMindCard,
  getMindProgress,
  getMindTargetSuggestions,
  markMindWinsSeen,
  setMindTarget,
} from "@/features/mind-progress/api/mindProgressApi";

export const MIND_KEY = ["mindProgress"];

export function useMindCard({ enabled = true } = {}) {
  return useQuery({
    queryKey: [...MIND_KEY, "card"],
    queryFn: ({ signal }) => getMindCard(signal),
    staleTime: 15 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
    enabled: enabled && hasValidAuthToken(),
  });
}

export function useMindProgressPage() {
  return useQuery({
    queryKey: [...MIND_KEY, "page"],
    queryFn: ({ signal }) => getMindProgress(signal),
    staleTime: 15 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled: hasValidAuthToken(),
  });
}

export function useMindTargetSuggestions({ enabled = true } = {}) {
  return useQuery({
    queryKey: [...MIND_KEY, "suggestions"],
    queryFn: ({ signal }) => getMindTargetSuggestions(signal),
    staleTime: 60 * 1000,
    enabled: enabled && hasValidAuthToken(),
  });
}

function useInvalidateMind() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: MIND_KEY });
}

export function useSetMindTarget() {
  const invalidate = useInvalidateMind();
  return useMutation({ mutationFn: setMindTarget, onSuccess: invalidate });
}

export function useCancelMindTarget() {
  const invalidate = useInvalidateMind();
  return useMutation({ mutationFn: cancelMindTarget, onSuccess: invalidate });
}

export function useMarkMindWinsSeen() {
  const invalidate = useInvalidateMind();
  return useMutation({ mutationFn: markMindWinsSeen, onSuccess: invalidate });
}
