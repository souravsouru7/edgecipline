"use client";

import { ArrowRight, Repeat } from "lucide-react";
import { Card, CardHeader } from "@/features/shared/components/ui";

export default function BehaviorPatternsCard({ items = [] }) {
  if (!items.length) return null;

  return (
    <Card>
      <CardHeader
        title={<span className="ec-dna__title-icon"><Repeat size={16} aria-hidden="true" className="ec-tone--info" /> Patterns in how you trade</span>}
        subtitle="What sets each one off, and what it leads to"
      />
      <ul className="ec-dna__patterns">
        {items.map((entry, i) => (
          <li key={`${entry.pattern || "pattern"}-${i}`} className="ec-dna__pattern">
            <p className="ec-dna__item-title">{entry.pattern}</p>
            {entry.trigger || entry.consequence ? (
              <div className="ec-dna__flow">
                {entry.trigger ? (
                  <div className="ec-dna__flow-step">
                    <span className="ec-dna__label">Trigger</span>
                    <p className="ec-dna__item-text">{entry.trigger}</p>
                  </div>
                ) : null}
                {entry.trigger && entry.consequence ? (
                  <ArrowRight size={14} aria-hidden="true" className="ec-dna__flow-arrow" />
                ) : null}
                {entry.consequence ? (
                  <div className="ec-dna__flow-step">
                    <span className="ec-dna__label">Result</span>
                    <p className="ec-dna__item-text">{entry.consequence}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
