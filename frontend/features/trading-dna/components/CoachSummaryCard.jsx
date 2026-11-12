"use client";

import { MessageCircle } from "lucide-react";
import { Card, CardHeader } from "@/features/shared/components/ui";

export default function CoachSummaryCard({ summary, confidenceNote }) {
  if (!summary && !confidenceNote) return null;

  return (
    <Card>
      <CardHeader title={<span className="ec-dna__title-icon"><MessageCircle size={16} aria-hidden="true" className="ec-tone--info" /> Coach summary</span>} />
      {summary ? <p className="ec-dna__prose">{summary}</p> : null}
      {confidenceNote ? <p className="ec-dna__note">{confidenceNote}</p> : null}
    </Card>
  );
}
