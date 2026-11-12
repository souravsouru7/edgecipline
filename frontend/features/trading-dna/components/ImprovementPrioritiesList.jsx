"use client";

import { Target } from "lucide-react";
import { Card, CardHeader } from "@/features/shared/components/ui";

export default function ImprovementPrioritiesList({ items = [] }) {
  if (!items.length) return null;

  return (
    <Card>
      <CardHeader
        title={<span className="ec-dna__title-icon"><Target size={16} aria-hidden="true" className="ec-tone--good" /> What to work on</span>}
        subtitle="In order: the first one should make the biggest difference"
      />
      <ol className="ec-dna__steps">
        {items.map((entry, i) => (
          <li key={`${entry.priority || "priority"}-${i}`} className="ec-dna__step">
            <span className="ec-dna__step-num" aria-hidden="true">{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <p className="ec-dna__item-title">{entry.priority}</p>
              {entry.action ? <p className="ec-dna__item-text">{entry.action}</p> : null}
              {entry.expectedImpact ? (
                <p className="ec-dna__item-text">
                  <span className="ec-dna__label">Expected impact</span>{" "}
                  <span className="ec-tone--good">{entry.expectedImpact}</span>
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
