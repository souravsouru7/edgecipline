"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Money, Placeholder } from "@/features/shared/components/ui";
import { groupTradesByDay } from "../utils/groupByDay";
import TradeListRow from "./TradeListRow";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function DayHeader({ item, indian, highlight }) {
  const parts = [`${item.count} ${item.count === 1 ? "trade" : "trades"}`];
  if (item.wins || item.losses) parts.push(`${item.wins}W ${item.losses}L`);
  return (
    <div className={`ec-jday${highlight ? " is-highlight" : ""}`} id={item.isToday ? "journal-today" : undefined}>
      <span className="ec-jday__label">{item.label}</span>
      <span className="ec-jday__meta">{parts.join(" · ")}</span>
      <span className="ec-jday__net">
        {item.net === null ? null : <Money value={item.net} currency={indian ? "INR" : "USD"} decimals={2} signed />}
      </span>
    </div>
  );
}

/**
 * Trades grouped by day, virtualised against the window so a long journal
 * keeps only the visible rows in the DOM (same approach as the old
 * TradeTable). Day headers are rows in the same list.
 *
 * scrollToToday: scroll to today's header once it exists (?filter=today).
 */
export default function JournalList({ trades, indian = false, loading, onDelete, deletingId, scrollToToday = false }) {
  const items = useMemo(() => groupTradesByDay(trades), [trades]);
  const listRef = useRef(null);
  const [listTop, setListTop] = useState(0);
  // Rows rise in once when the list first appears; switched off right after so
  // rows the virtualizer mounts while scrolling don't animate.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    if (loading) return undefined;
    const t = setTimeout(() => setIntro(false), 900);
    return () => clearTimeout(t);
  }, [loading]);
  const scrolledRef = useRef(false);

  useIsoLayoutEffect(() => {
    const measure = () => {
      const node = listRef.current;
      if (!node) return;
      setListTop(node.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    window.addEventListener("resize", measure);
    // Content above the list (banner, stats, wrapping filters) can move it.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [loading, items.length === 0]);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: (i) => (items[i]?.kind === "day" ? 48 : 72),
    overscan: 10,
    scrollMargin: listTop,
    getItemKey: (i) => items[i]?.key ?? i,
  });

  const todayIndex = items.findIndex((i) => i.kind === "day" && i.isToday);
  useEffect(() => {
    if (!scrollToToday || scrolledRef.current || loading || todayIndex < 0) return;
    scrolledRef.current = true;
    // Today is usually the first group: it's already in view, only highlight.
    if (todayIndex === 0) return;
    // Next frame: let the virtualiser measure the first rows. Then leave room
    // for the sticky page header, which would otherwise cover the day header.
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(todayIndex, { align: "start" });
      requestAnimationFrame(() => window.scrollBy(0, -96));
    });
  }, [scrollToToday, loading, todayIndex, virtualizer]);

  if (loading) {
    return (
      <div className="ec-jlist" aria-busy="true">
        <Placeholder height={20} width={160} radius={6} style={{ margin: "8px 4px 12px" }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <Placeholder key={i} height={64} radius={12} style={{ marginBottom: 8, display: "block" }} />
        ))}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const padTop = virtualItems.length ? virtualItems[0].start - listTop : 0;
  const padBottom = virtualItems.length ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <div className={`ec-jlist${intro ? " ec-stagger" : ""}`} ref={listRef}>
      {padTop > 0 && <div style={{ height: padTop }} aria-hidden="true" />}
      {virtualItems.map((v) => {
        const item = items[v.index];
        if (!item) return null;
        return (
          <div key={v.key} data-index={v.index} ref={virtualizer.measureElement}>
            {item.kind === "day" ? (
              <DayHeader item={item} indian={indian} highlight={scrollToToday && item.isToday} />
            ) : (
              <TradeListRow trade={item.trade} indian={indian} onDelete={onDelete} isDeleting={item.trade._id === deletingId} />
            )}
          </div>
        );
      })}
      {padBottom > 0 && <div style={{ height: padBottom }} aria-hidden="true" />}
    </div>
  );
}
