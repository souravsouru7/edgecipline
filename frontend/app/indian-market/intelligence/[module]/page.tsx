import { notFound } from "next/navigation";
import IndianIntelligenceModule from "@/features/indian-intelligence/components/IndianIntelligenceModule";
import CoachFeedRedirect from "@/features/dashboard/components/CoachFeedRedirect";
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
  // Still generated so old links resolve, but the feed itself lives on Home.
  if (module === "ai-coach") return <CoachFeedRedirect indian />;
  return <IndianIntelligenceModule module={module} />;
}
