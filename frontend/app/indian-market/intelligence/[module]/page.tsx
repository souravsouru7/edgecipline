import { notFound } from "next/navigation";
import IndianIntelligenceModule from "@/features/indian-intelligence/components/IndianIntelligenceModule";
import {
  INDIAN_INTELLIGENCE_MODULES,
  isIndianIntelligenceModule,
} from "@/features/indian-intelligence/modules";

interface PageProps {
  params: Promise<{ module: string }>;
}

export function generateStaticParams() {
  return INDIAN_INTELLIGENCE_MODULES.map((module) => ({ module }));
}

export default async function IndianIntelligenceModulePage({ params }: PageProps) {
  const { module } = await params;
  if (!isIndianIntelligenceModule(module)) notFound();
  return <IndianIntelligenceModule module={module} />;
}
