"use client";

import ErrorBoundary from "@/components/ErrorBoundary";
import DisciplineView from "@/features/discipline/components/DisciplineView";

export default function DisciplinePage() {
  return (
    <ErrorBoundary>
      <DisciplineView market="Forex" />
    </ErrorBoundary>
  );
}
