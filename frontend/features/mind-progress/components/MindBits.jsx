"use client";

// Small presentational pieces shared by the card, the reward sheet and the
// progress page. All copy comes from the server (built from the trader's own
// data); these only lay it out.

const cx = (...p) => p.filter(Boolean).join(" ");

export function DeltaChip({ delta, held = false, size = "md" }) {
  if (held || delta === 0 || delta == null) {
    return <span className={cx("ec-mind__delta", "ec-mind__delta--flat", size === "sm" && "ec-mind__delta--sm")}>held</span>;
  }
  const up = delta > 0;
  return (
    <span
      className={cx("ec-mind__delta", up ? "ec-mind__delta--up" : "ec-mind__delta--down", size === "sm" && "ec-mind__delta--sm")}
      aria-label={`${up ? "up" : "down"} ${Math.abs(delta)} today`}
    >
      {up ? "▲" : "▼"} {up ? "+" : "−"}{Math.abs(delta)}
    </span>
  );
}

export function LevelBar({ level }) {
  if (!level) return null;
  const next = level.next;
  return (
    <div className="ec-mind__level">
      <div className="ec-mind__level-row">
        <span className="ec-mind__level-name">
          <span aria-hidden="true">{level.emoji}</span> Lv {level.level} · {level.name}
        </span>
        {next ? (
          <span className="ec-mind__level-next">
            {next.pointsTo === 0 ? "Next up" : `${next.pointsTo} pt${next.pointsTo === 1 ? "" : "s"} to`} {next.emoji} {next.name}
          </span>
        ) : (
          <span className="ec-mind__level-next">Top level 👑</span>
        )}
      </div>
      <div
        className="ec-mind__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={level.progressPct}
        aria-label={next ? `Progress to ${next.name}` : "Top level reached"}
      >
        <span style={{ width: `${level.progressPct}%` }} />
      </div>
    </div>
  );
}

export function UnlockDots({ have = 0, need = 3 }) {
  return (
    <div className="ec-mind__dots" role="img" aria-label={`${Math.min(have, need)} of ${need} journal days`}>
      {Array.from({ length: need }, (_, i) => (
        <span key={i} className={cx("ec-mind__dot", i < have && "ec-mind__dot--on")} />
      ))}
    </div>
  );
}

export function ReasonList({ reasons = [] }) {
  if (!reasons.length) return null;
  return (
    <ul className="ec-mind__reasons">
      {reasons.map((r, i) => (
        <li key={`${r.type}-${i}`} className={r.sign < 0 ? "is-down" : "is-up"}>
          {r.points != null && r.points !== 0 && (
            <span className="ec-mind__pts">{r.points > 0 ? `+${r.points}` : `−${Math.abs(r.points)}`}</span>
          )}
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** 7 pips for a weekly focus: clean / slip / no activity yet. */
export function TargetPips({ target }) {
  if (!target) return null;
  const days = [];
  const [y, m, d] = target.startDay.split("-").map(Number);
  for (let i = 0; i < 7; i += 1) {
    const key = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    days.push(target.dayResults?.[key] || "none");
  }
  return (
    <div className="ec-mind__pips" role="img" aria-label={`${target.cleanDays} of ${target.goal} clean days`}>
      {days.map((state, i) => <span key={i} className={`ec-mind__pip ec-mind__pip--${state}`} />)}
    </div>
  );
}
