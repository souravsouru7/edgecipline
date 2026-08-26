"use client";

import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import {
  getIndianIntelligenceSummary,
  type IndianInstrumentType,
} from "../api/indianIntelligenceApi";

export function useIndianIntelligence(instrumentType: IndianInstrumentType) {
  const { ready } = useRequireAuth();

  return useQuery({
    queryKey: ["indian-intelligence", "summary", instrumentType],
    queryFn: ({ signal }) => getIndianIntelligenceSummary(instrumentType, signal),
    enabled: ready,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
