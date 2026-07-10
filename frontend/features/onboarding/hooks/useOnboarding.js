"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  completeOnboarding,
  generateFirstInsight,
  getOnboardingState,
  seedOnboardingSetup,
  selectOnboardingMarket,
  selectOnboardingStyle,
  skipFirstTrade,
} from "@/features/onboarding/api/onboardingApi";

const STATE_KEY = ["onboarding", "state"];

// Every mutation invalidates the same caches: the onboarding state itself,
// the dashboard snapshot (so the getting-started card refreshes immediately),
// and the auth /me/preferences in case the user's market or completion flag
// is mirrored anywhere.
function invalidateAll(qc) {
  qc.invalidateQueries({ queryKey: ["onboarding"] });
  qc.invalidateQueries({ queryKey: ["dashboard", "snapshot"] });
  qc.invalidateQueries({ queryKey: ["auth", "preferences"] });
}

export function useOnboardingState() {
  return useQuery({
    queryKey: STATE_KEY,
    queryFn: ({ signal }) => getOnboardingState(signal),
    staleTime: 15 * 1000,
  });
}

export function useSelectMarket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: selectOnboardingMarket,
    onSuccess: (data) => {
      qc.setQueryData(STATE_KEY, data);
      invalidateAll(qc);
    },
  });
}

export function useSelectStyle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: selectOnboardingStyle,
    onSuccess: (data) => {
      qc.setQueryData(STATE_KEY, data);
      invalidateAll(qc);
    },
  });
}

export function useSeedSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: seedOnboardingSetup,
    onSuccess: (data) => {
      qc.setQueryData(STATE_KEY, data);
      invalidateAll(qc);
    },
  });
}

export function useSkipFirstTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: skipFirstTrade,
    onSuccess: (data) => {
      qc.setQueryData(STATE_KEY, data);
      invalidateAll(qc);
    },
  });
}

export function useGenerateFirstInsight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: generateFirstInsight,
    onSuccess: (data) => {
      // Insight responses include the funnel state too — refresh both caches.
      qc.setQueryData(STATE_KEY, data);
      invalidateAll(qc);
    },
  });
}

export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: completeOnboarding,
    onSuccess: (data) => {
      qc.setQueryData(STATE_KEY, data);
      invalidateAll(qc);
    },
  });
}
