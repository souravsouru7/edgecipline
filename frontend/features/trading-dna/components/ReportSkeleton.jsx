"use client";

import { Placeholder } from "@/features/shared/components/ui";

export default function ReportSkeleton() {
  return (
    <div className="ec-disc__stack" aria-busy="true" aria-label="Loading your Trading DNA">
      <div className="ec-card ec-card--pad">
        <Placeholder width="30%" height={12} />
        <Placeholder width="60%" height={32} style={{ marginTop: 14 }} />
        <Placeholder width="85%" height={14} style={{ marginTop: 14 }} />
        <Placeholder width="70%" height={14} style={{ marginTop: 8 }} />
      </div>
      <div className="ec-dna__pair">
        {[0, 1].map((i) => (
          <div key={i} className="ec-card ec-card--pad">
            <Placeholder width="40%" height={14} />
            <Placeholder height={56} style={{ marginTop: 14 }} />
            <Placeholder height={56} style={{ marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="ec-card ec-card--pad">
        <Placeholder width="35%" height={14} />
        <Placeholder height={180} style={{ marginTop: 14 }} />
      </div>
    </div>
  );
}
