"use client";

import { EyeOff } from "lucide-react";
import { Card, CardHeader } from "@/features/shared/components/ui";

export default function BlindSpotsList({ items = [] }) {
  if (!items.length) return null;

  return (
    <Card>
      <CardHeader
        title={<span className="ec-dna__title-icon"><EyeOff size={16} aria-hidden="true" className="ec-tone--warn" /> Blind spots</span>}
        subtitle="Habits that are easy to miss in the moment"
      />
      <ul className="ec-dna__items">
        {items.map((entry, i) => (
          <li key={`${entry.title || "blind"}-${i}`} className="ec-dna__item ec-dna__item--warn">
            <p className="ec-dna__item-title">{entry.title}</p>
            {entry.why ? <p className="ec-dna__item-text">{entry.why}</p> : null}
            {entry.watchFor ? (
              <p className="ec-dna__item-text"><span className="ec-dna__label">Watch for</span> {entry.watchFor}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
