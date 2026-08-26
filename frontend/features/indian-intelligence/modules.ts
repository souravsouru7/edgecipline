// Kept out of the "use client" component module on purpose: the static-export
// route at app/indian-market/intelligence/[module]/page.tsx reads this list
// from the server during generateStaticParams, and Next replaces a client
// module's exports with reference proxies when a server component imports
// them (the array arrives as an object, so .map/.includes blow up).
export const INDIAN_INTELLIGENCE_MODULES = [
  "trading-dna",
  "patterns",
  "risk-patterns",
  "psychology-cost",
  "self-awareness",
  "ai-coach",
] as const;

export type IndianIntelligenceModuleSlug = (typeof INDIAN_INTELLIGENCE_MODULES)[number];

export function isIndianIntelligenceModule(value: string): value is IndianIntelligenceModuleSlug {
  return (INDIAN_INTELLIGENCE_MODULES as readonly string[]).includes(value);
}
