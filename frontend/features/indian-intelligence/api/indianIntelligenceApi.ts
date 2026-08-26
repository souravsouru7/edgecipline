import apiClient from "@/services/apiClient";

export type IndianInstrumentType = "ALL" | "OPTION" | "EQUITY";

export interface ConfidenceLevel {
  key: string;
  label: string;
  score: number;
  sampleSize: number;
}

export interface InsightStats {
  sampleSize: number;
  pnlReadyTrades: number;
  netPnl: number;
  avgNetPnl: number;
  winRate: number;
}

export interface IndianInsight {
  id: string;
  category: "strength" | "leak";
  theme: string;
  dimension: string;
  key: string;
  title: string;
  evidence: string;
  action: string;
  financialImpact: number;
  sampleSize: number;
  stats: InsightStats;
  confidence: ConfidenceLevel;
  coverage: number;
  priority: number;
}

export interface Guardrail {
  id: string;
  sourceInsightId: string;
  title: string;
  action: string;
  priority: number;
  confidence: ConfidenceLevel;
}

export interface UnlockRequirement {
  field: string;
  current?: number;
  target?: number;
  remaining?: number;
  currentPercentage?: number;
  targetPercentage?: number;
}

export interface IndianIntelligenceSummary {
  marketType: "Indian_Market";
  instrumentType: IndianInstrumentType;
  generatedAt: string;
  sample: {
    totalTrades: number;
    pnlReadyTrades: number;
    netPnl: number;
    from: string | null;
    to: string | null;
  };
  confidence: ConfidenceLevel;
  doNow: IndianInsight | null;
  strengths: IndianInsight[];
  leaks: IndianInsight[];
  guardrails: Guardrail[];
  progress: {
    comparedTrades: { recent: number; previous: number };
    planAdherence: { currentPct: number | null; previousPct: number | null; changePct: number | null };
    netPnl: { current: number; previous: number | null; change: number | null };
  };
  dataQuality: {
    overallPercentage: number;
    coverage: Record<string, { count: number; percentage: number }>;
    suppressedSignals: Array<{ dimension: string; key: string; sampleSize: number; reason: string }>;
  };
  unlockRequirements: UnlockRequirement[];
}

export async function getIndianIntelligenceSummary(
  instrumentType: IndianInstrumentType,
  signal?: AbortSignal,
): Promise<IndianIntelligenceSummary> {
  return apiClient.get("/indian/intelligence/summary", {
    params: { instrumentType },
    signal,
  }) as Promise<IndianIntelligenceSummary>;
}
