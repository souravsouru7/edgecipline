"use client";

import { Badge } from "@/features/shared/components/ui";
import { archetypeAccent, formatReportDate } from "./tokens";

export default function IdentityHero({ identity, sample, generatedAt }) {
  const archetype = identity?.archetype || null;
  const accent = archetypeAccent(archetype);
  const date = formatReportDate(generatedAt);

  return (
    <section className="ec-card ec-card--pad ec-dna__hero" style={{ "--dna-accent": accent }} aria-labelledby="dna-archetype">
      <p className="ec-dna__eyebrow">Your trading identity</p>
      <h2 id="dna-archetype" className="ec-dna__archetype">
        {archetype || "Still forming"}
      </h2>
      {identity?.tagline ? <p className="ec-dna__tagline">{identity.tagline}</p> : null}
      {identity?.oneLiner ? <p className="ec-dna__oneliner">{identity.oneLiner}</p> : null}
      {!archetype ? (
        <p className="ec-dna__oneliner">
          There isn&apos;t enough in this window to name a style yet. Log more trades, or try a longer window.
        </p>
      ) : null}

      <div className="ec-dna__meta">
        {sample?.totalTrades != null ? (
          <span>Based on <strong>{sample.totalTrades}</strong> {sample.totalTrades === 1 ? "trade" : "trades"}</span>
        ) : null}
        {date ? <span>Updated <strong>{date}</strong></span> : null}
        {sample?.lowSample ? <Badge tone="warning">Early read: small sample</Badge> : null}
      </div>
    </section>
  );
}
