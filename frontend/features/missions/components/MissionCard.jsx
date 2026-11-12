"use client";

import { useId, useState } from "react";
import { success as hapticSuccess } from "@/utils/haptics";
import { ChevronDown, Award } from "lucide-react";
import { Button } from "@/features/shared/components/ui";
import { useAcceptMission, useArchiveMission } from "@/features/missions/hooks/useMissions";
import { CATEGORY_COLOR, CategoryBadge, DifficultyDot, ProgressBar, ProgressLabel } from "./MissionProgress";

const STATUS = {
  available: { label: "Recommended", tone: "info" },
  active: { label: "Active", tone: "good" },
  completed: { label: "Complete", tone: "good" },
  archived: { label: "Archived", tone: "muted" },
  expired: { label: "Expired", tone: "warn" },
};

function StatusChip({ status }) {
  const { label, tone } = STATUS[status] || STATUS.archived;
  return <span className={`ec-mission__chip ec-mission__chip--${tone}`}>{label}</span>;
}

export default function MissionCard({ mission, showActions = true }) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const accept = useAcceptMission();
  const archive = useArchiveMission();

  if (!mission) return null;

  const {
    id, status, name, description, category, difficulty, progressMode, unit,
    currentProgress, target, progressPercent, coachMessage, reward, recommendationReason,
  } = mission;

  const accent = CATEGORY_COLOR[category] || "var(--lg-sub, #64748B)";
  const isActive = status === "active";
  const isAvailable = status === "available";
  const isComplete = status === "completed";
  const busy = accept.isPending || archive.isPending;

  return (
    <article className={`ec-mission${isActive ? " is-active" : ""}`} style={{ "--mission-accent": accent }}>
      <button
        type="button"
        className="ec-mission__head ec-focusable"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((e) => !e)}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="ec-mission__tags">
            <CategoryBadge category={category} />
            <DifficultyDot difficulty={difficulty} />
            <StatusChip status={status} />
          </span>
          <span className="ec-mission__name">{name}</span>
        </span>
        <ChevronDown size={18} className="ec-mission__chev" aria-hidden="true" />
      </button>

      {isActive && (
        <div className="ec-mission__progress">
          <div className="ec-mission__progress-row">
            <ProgressLabel current={currentProgress} target={target} unit={unit} progressMode={progressMode} />
            <strong style={{ color: accent }}>{progressPercent ?? 0}%</strong>
          </div>
          <ProgressBar percent={progressPercent} color={accent} />
        </div>
      )}

      {isComplete && reward && (
        <div className="ec-mission__reward">
          <Award size={18} aria-hidden="true" />
          <div>
            <div className="ec-mission__reward-title">{reward.badgeLabel}</div>
            {reward.completionMessage && <div className="ec-mission__reward-text">{reward.completionMessage}</div>}
          </div>
        </div>
      )}

      {expanded && (
        <div id={bodyId} className="ec-mission__body">
          {description && <p className="ec-mission__desc">{description}</p>}

          {coachMessage && (
            <div className="ec-mission__coach">
              <div className="ec-mission__coach-label">Coach</div>
              <div>{coachMessage}</div>
            </div>
          )}

          {recommendationReason && isAvailable && <p className="ec-mission__why">{recommendationReason}</p>}

          {showActions && (isAvailable || isActive) && (
            <div className="ec-mission__actions">
              {isAvailable && (
                <Button size="sm" onClick={() => accept.mutate(id, { onSuccess: () => { void hapticSuccess(); } })} loading={accept.isPending} disabled={busy}>
                  Accept mission
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => archive.mutate(id)} loading={archive.isPending} disabled={busy}>
                Skip
              </Button>
            </div>
          )}
          {(accept.isError || archive.isError) && (
            <p className="ec-streak__err" role="alert">{"That didn't go through. Try again."}</p>
          )}
        </div>
      )}
    </article>
  );
}
