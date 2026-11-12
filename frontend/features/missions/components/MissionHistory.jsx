"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { Button, EmptyState, ErrorState, Placeholder } from "@/features/shared/components/ui";
import { useMissionHistory } from "@/features/missions/hooks/useMissions";
import MissionCard from "./MissionCard";

export default function MissionHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useMissionHistory({ page, limit: 10 });

  const items = data?.data || [];
  const totalPages = Math.max(1, data?.pagination?.totalPages || 1);

  if (isLoading) {
    return (
      <div className="ec-disc__stack" aria-busy="true">
        <Placeholder height={84} radius={14} />
        <Placeholder height={84} radius={14} />
      </div>
    );
  }
  if (isError) return <ErrorState title="Couldn't load history" onRetry={() => refetch()} />;
  if (items.length === 0) {
    return <EmptyState icon={<History size={22} />} title="No history yet" body="Completed and skipped missions show up here." />;
  }

  return (
    <div>
      <div className="ec-disc__stack" style={{ gap: 10 }}>
        {items.map((m) => <MissionCard key={m.id} mission={m} showActions={false} />)}
      </div>
      {totalPages > 1 && (
        <nav className="ec-mission__pager" aria-label="History pages">
          <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
          <span>{page} of {totalPages}</span>
          <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
        </nav>
      )}
    </div>
  );
}
