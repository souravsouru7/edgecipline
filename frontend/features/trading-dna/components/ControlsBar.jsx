"use client";

import { SegmentedControl } from "@/features/shared/components/ui";
import RegenerateButton from "./RegenerateButton";
import ShareButton from "./ShareButton";

export const DNA_PERIODS = [
  { value: "30d", label: "30 days", long: "last 30 days" },
  { value: "90d", label: "90 days", long: "last 90 days" },
  { value: "365d", label: "1 year", long: "last year" },
];

/**
 * Window picker + report actions. The market comes from the header's market
 * switcher, the same as every other page.
 */
export default function ControlsBar({
  period,
  onPeriodChange,
  onRegenerate,
  onShare,
  isRegenerating,
  canShare = false,
  canRegenerate = true,
}) {
  return (
    <div className="ec-disc__filters">
      <SegmentedControl
        label="Report window"
        value={period}
        onChange={onPeriodChange}
        options={DNA_PERIODS.map(({ value, label }) => ({ value, label }))}
      />
      <div className="ec-dna__actions">
        {canShare ? <ShareButton onClick={onShare} disabled={isRegenerating} /> : null}
        {canRegenerate ? <RegenerateButton onClick={onRegenerate} isRegenerating={isRegenerating} /> : null}
      </div>
    </div>
  );
}
