"use client";

import ErrorBoundary from "@/components/ErrorBoundary";
import DisciplineView from "@/features/discipline/components/DisciplineView";

export default function IndianDisciplinePage() {
  return (
    <ErrorBoundary>
      <DisciplineView market="Indian_Market" />
    </ErrorBoundary>
  );
}
