"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getActiveMissions,
  getMissionHistory,
  getMission,
  getMissionStats,
  getMissionTemplates,
  getBehaviorProfile,
  acceptMission,
  archiveMission,
  getRecommendations,
} from "@/features/missions/api/missionsApi";

export const MISSIONS_KEY = ["missions"];

export function useActiveMissions() {
  return useQuery({
    queryKey: [...MISSIONS_KEY, "active"],
    queryFn: ({ signal }) => getActiveMissions(signal),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useMissionHistory({ page = 1, limit = 20 } = {}) {
  return useQuery({
    queryKey: [...MISSIONS_KEY, "history", page, limit],
    queryFn: ({ signal }) => getMissionHistory({ page, limit }, signal),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useMissionById(id) {
  return useQuery({
    queryKey: [...MISSIONS_KEY, "detail", id],
    queryFn: ({ signal }) => getMission(id, signal),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
}

export function useMissionStats() {
  return useQuery({
    queryKey: [...MISSIONS_KEY, "stats"],
    queryFn: ({ signal }) => getMissionStats(signal),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useMissionTemplates({ category, difficulty } = {}) {
  return useQuery({
    queryKey: [...MISSIONS_KEY, "templates", category, difficulty],
    queryFn: ({ signal }) => getMissionTemplates({ category, difficulty }, signal),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

export function useBehaviorProfile({ lookback = 30 } = {}) {
  return useQuery({
    queryKey: [...MISSIONS_KEY, "profile", lookback],
    queryFn: ({ signal }) => getBehaviorProfile({ lookback }, signal),
    staleTime: 2 * 60 * 1000,
  });
}

export function useAcceptMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => acceptMission(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MISSIONS_KEY });
      qc.invalidateQueries({ queryKey: ["dashboard", "snapshot"] });
    },
  });
}

export function useArchiveMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => archiveMission(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MISSIONS_KEY });
    },
  });
}

export function useGetRecommendations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lookback = 30 } = {}) => getRecommendations({ lookback }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MISSIONS_KEY });
    },
  });
}
