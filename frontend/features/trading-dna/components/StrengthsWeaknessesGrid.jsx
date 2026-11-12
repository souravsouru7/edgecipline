"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardHeader } from "@/features/shared/components/ui";

function Column({ tone, title, subtitle, Icon, items, emptyLabel }) {
  return (
    <Card className="ec-dna__col">
      <CardHeader
        title={<span className="ec-dna__title-icon"><Icon size={16} aria-hidden="true" className={`ec-tone--${tone}`} /> {title}</span>}
        subtitle={subtitle}
      />
      {items?.length ? (
        <ul className="ec-dna__items">
          {items.map((entry, i) => (
            <li key={`${entry.title || "item"}-${i}`} className={`ec-dna__item ec-dna__item--${tone}`}>
              <p className="ec-dna__item-title">{entry.title}</p>
              {entry.evidence ? <p className="ec-dna__item-text">{entry.evidence}</p> : null}
              {entry.metric ? <p className={`ec-dna__metric ec-tone--${tone}`}>{entry.metric}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ec-dna__empty">{emptyLabel}</p>
      )}
    </Card>
  );
}

export default function StrengthsWeaknessesGrid({ strengths = [], weaknesses = [] }) {
  return (
    <div className="ec-dna__pair">
      <Column
        tone="good"
        title="What's working"
        subtitle="Keep doing these"
        Icon={TrendingUp}
        items={strengths}
        emptyLabel="No clear strengths yet. Log more trades to show where your edge is."
      />
      <Column
        tone="bad"
        title="What's costing you"
        subtitle="Where the money leaks"
        Icon={TrendingDown}
        items={weaknesses}
        emptyLabel="Nothing flagged in this window."
      />
    </div>
  );
}
