"use client";

import Link from "next/link";
import { ArrowLeft, ArrowDownRight, ArrowUpRight, Pencil, SearchX } from "lucide-react";
import { Button, Card, EmptyState, Money, Placeholder } from "@/features/shared/components/ui";

// Building blocks for the trade detail pages (Forex and Indian market).

export function DetailTopBar({ backHref, editHref }) {
  return (
    <div className="ec-detail__top">
      <Link href={backHref} className="ec-psy__back ec-focusable" style={{ marginBottom: 0 }}>
        <ArrowLeft size={16} aria-hidden="true" /> Journal
      </Link>
      {editHref && (
        <Button as={Link} href={editHref} variant="secondary" size="sm" icon={<Pencil size={15} />}>Edit trade</Button>
      )}
    </div>
  );
}

export function DetailLoading() {
  return (
    <div style={{ display: "grid", gap: 12 }} aria-busy="true">
      <Placeholder height={180} radius={18} />
      <div className="ec-detail__kpis">
        {[0, 1, 2, 3].map((i) => <Placeholder key={i} height={88} radius={16} />)}
      </div>
      <Placeholder height={260} radius={16} />
    </div>
  );
}

export function DetailNotFound({ status, backHref }) {
  return (
    <Card>
      <EmptyState
        icon={<SearchX size={22} />}
        title="Trade not found"
        body={status === 404 ? "This trade no longer exists. It may have been deleted." : "This trade couldn't be loaded. Check your connection and try again."}
        action={<Button as={Link} href={backHref} variant="secondary">Back to journal</Button>}
      />
    </Card>
  );
}

/**
 * The headline: symbol, side, date, P&L.
 * meta: small text items under the symbol; badges: nodes beside the side.
 */
export function DetailHero({ symbol, long, sideLabel, dateText, profit, currency, profitLabel = "P&L", sub, meta = [], badges = null }) {
  const has = profit !== null && profit !== undefined && Number.isFinite(Number(profit));
  const tone = !has ? "flat" : Number(profit) > 0 ? "up" : Number(profit) < 0 ? "down" : "flat";
  return (
    <section className={`ec-card ec-detail__hero ec-detail__hero--${tone}`}>
      <div className="ec-detail__hero-main">
        <span className={`ec-jrow__icon ec-jrow__icon--${long === false ? "short" : "long"} ec-detail__hero-icon`} aria-hidden="true">
          {long === false ? <ArrowDownRight size={22} /> : <ArrowUpRight size={22} />}
        </span>
        <div style={{ minWidth: 0 }}>
          <h1 className="ec-detail__symbol">{symbol}</h1>
          <div className="ec-detail__hero-tags">
            {sideLabel && <span className={`ec-badge ${long === false ? "ec-badge--loss" : "ec-badge--profit"}`}>{sideLabel}</span>}
            {badges}
          </div>
          {(dateText || meta.length > 0) && (
            <p className="ec-detail__hero-meta">{[dateText, ...meta].filter(Boolean).join(" · ")}</p>
          )}
        </div>
      </div>
      <div className="ec-detail__hero-pnl">
        <span className="ec-dash__eyebrow" style={{ margin: 0 }}>{profitLabel}</span>
        <span className="ec-detail__pnl">
          {has ? <Money value={Number(profit)} currency={currency} decimals={2} signed /> : <span className="ec-pnl--flat">Open</span>}
        </span>
        {sub && <span className="ec-detail__pnl-sub">{sub}</span>}
      </div>
    </section>
  );
}

export function DetailSection({ title, children, action = null }) {
  return (
    <section className="ec-card ec-detail__section">
      <div className="ec-detail__section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Label/value rows. Rows with an empty value are skipped.
export function DetailRows({ rows }) {
  const shown = rows.filter((r) => r && r.value !== null && r.value !== undefined && r.value !== "");
  if (!shown.length) return <p className="ec-detail__empty">Nothing recorded.</p>;
  return (
    <dl className="ec-detail__rows">
      {shown.map((r) => (
        <div key={r.label} className="ec-detail__row">
          <dt>{r.label}</dt>
          <dd className={[r.tone ? `ec-detail__tone--${r.tone}` : "", r.mono ? "ec-num" : ""].join(" ")}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PriceLadder({ entry, exit, stopLoss, takeProfit, long }) {
  const cell = (label, value, tone) => (
    <div className={`ec-detail__price${tone ? ` ec-detail__price--${tone}` : ""}`}>
      <span>{label}</span>
      <strong className="ec-num">{value === null || value === undefined || value === "" ? "—" : value}</strong>
    </div>
  );
  return (
    <div className="ec-detail__prices">
      {cell("Entry", entry)}
      {cell("Exit", exit, exit != null && entry != null && exit !== "" ? ((Number(exit) - Number(entry)) * (long === false ? -1 : 1) >= 0 ? "up" : "down") : null)}
      {cell("Stop loss", stopLoss, "down")}
      {cell("Take profit", takeProfit, "up")}
    </div>
  );
}

export function scoreTone(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  return n >= 70 ? "up" : n >= 40 ? "warn" : "down";
}

export function ScoreMeter({ score, label = "Checklist score" }) {
  const n = Math.max(0, Math.min(100, Math.round(Number(score))));
  return (
    <div className={`ec-detail__meter ec-detail__tone--${scoreTone(n)}`}>
      <div className="ec-detail__meter-head"><span>{label}</span><strong className="ec-num">{n}%</strong></div>
      <div className="ec-check__meter"><span style={{ width: `${n}%`, background: "currentColor" }} /></div>
    </div>
  );
}

export function MoodDots({ value }) {
  const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  const labels = ["", "Stressed", "Anxious", "Neutral", "Good", "Peak"];
  return (
    <span className="ec-detail__mood" aria-label={`Mood ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= n ? "is-on" : ""} />)}
      <em>{labels[n] || `${n}/5`}</em>
    </span>
  );
}

export function TagList({ tags, tone }) {
  if (!tags?.length) return null;
  return (
    <div className="ec-detail__tags">
      {tags.map((t, i) => <span key={`${t}-${i}`} className={`ec-badge${tone ? ` ec-badge--${tone}` : ""}`}>{t}</span>)}
    </div>
  );
}

export function RuleResults({ rules }) {
  const active = (rules || []).filter((r) => r?.label && String(r.label).trim());
  if (!active.length) return null;
  return (
    <ul className="ec-detail__rules">
      {active.map((r, i) => (
        <li key={i} className={r.followed ? "is-on" : ""}>
          <span className="ec-check__box" aria-hidden="true">{r.followed ? "✓" : ""}</span>
          <span>{r.label}</span>
          <span className="ec-sr">{r.followed ? "followed" : "not followed"}</span>
        </li>
      ))}
    </ul>
  );
}

export function Quote({ children }) {
  return <p className="ec-detail__quote">{children}</p>;
}
