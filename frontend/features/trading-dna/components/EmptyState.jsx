"use client";

import Link from "next/link";
import { Dna } from "lucide-react";
import { Button, EmptyState as StateEmpty } from "@/features/shared/components/ui";
import { marketRoutes } from "@/features/shared/navigation";

/**
 * No report yet for this market + window. While the first one is being
 * generated (it can take a minute) the same slot explains the wait.
 */
export default function EmptyState({ onGenerate, isGenerating, market, periodLabel }) {
  const r = marketRoutes(market);

  if (isGenerating) {
    return (
      <div className="ec-card">
        <StateEmpty
          icon={<Dna size={22} />}
          title="Reading your trades…"
          body="The coach is working through your trades for this window. This can take up to a minute; you can leave this page and come back."
        />
      </div>
    );
  }

  return (
    <div className="ec-card">
      <StateEmpty
        icon={<Dna size={22} />}
        title="No Trading DNA for this window yet"
        body={`Build one from your trades over the ${periodLabel || "selected window"}: your trading style, what's working, blind spots, and the single change that would help most.`}
        action={
          <>
            <Button onClick={onGenerate}>Build my Trading DNA</Button>
            <Button as={Link} href={r.addTrade} variant="ghost">Log a trade first</Button>
          </>
        }
      />
    </div>
  );
}
