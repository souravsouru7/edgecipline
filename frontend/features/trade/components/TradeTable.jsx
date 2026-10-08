"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Skeleton } from "@/features/shared";
import useIsNarrow from "@/features/shared/hooks/useIsNarrow";
import TradeRow from "./TradeRow";
import TradeCard from "./TradeCard";

const TABLE_HEADERS = ["DATE", "PAIR", "TYPE", "BASIS", "P&L", "ACTIONS"];
const DESKTOP_SKELETON_ROWS = Array.from({ length: 5 });
const MOBILE_SKELETON_ROWS = Array.from({ length: 3 });

// Measured from the rendered list; the virtualiser corrects itself per row, so
// these only have to be close enough to size the scrollbar before first paint.
const DESKTOP_ROW_PX = 57;
const MOBILE_CARD_PX = 104;

function TradeTable({ trades, loading, onDelete, deletingId }) {
  const isNarrow = useIsNarrow(640);
  const listRef = useRef(null);
  // Read on mount and on resize rather than during render: on the first pass
  // the node does not exist yet, and a stale offset puts the first rows
  // behind the page header.
  const [listTop, setListTop] = useState(0);

  useEffect(() => {
    const measure = () => setListTop(listRef.current?.offsetTop ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isNarrow, trades.length === 0]);

  // The page itself is the scroll container, so the virtualiser watches the
  // window. `scrollMargin` tells it how far down the document the list starts,
  // otherwise the first rows are positioned behind the header.
  const virtualizer = useWindowVirtualizer({
    count: trades.length,
    estimateSize: () => (isNarrow ? MOBILE_CARD_PX : DESKTOP_ROW_PX),
    overscan: 8,
    scrollMargin: listTop,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();
  // Rather than absolutely positioning rows (which a <table> fights), pad the
  // list with the height of everything scrolled past and everything still
  // below. The rows in between are the only ones in the DOM.
  const padTop = virtualItems.length ? virtualItems[0].start - listTop : 0;
  const padBottom = virtualItems.length
    ? totalHeight - virtualItems[virtualItems.length - 1].end
    : 0;

  const desktopRows = useMemo(
    () => virtualItems.map((virtualRow) => {
      const trade = trades[virtualRow.index];
      if (!trade) return null;
      return (
        // Table rows are a single line of fixed-height content, so the
        // estimate is exact and they need no per-row measurement. That also
        // keeps TradeRow a plain memo instead of a forwardRef.
        <TradeRow
          key={trade._id}
          trade={trade}
          onDelete={onDelete}
          idx={virtualRow.index}
          isDeleting={trade._id === deletingId}
        />
      );
    }),
    [virtualItems, trades, onDelete, deletingId, virtualizer],
  );

  const mobileCards = useMemo(
    () => virtualItems.map((virtualRow) => {
      const trade = trades[virtualRow.index];
      if (!trade) return null;
      return (
        <div key={trade._id} ref={virtualizer.measureElement} data-index={virtualRow.index}>
          <TradeCard trade={trade} onDelete={onDelete} idx={virtualRow.index} isDeleting={trade._id === deletingId} />
        </div>
      );
    }),
    [virtualItems, trades, onDelete, deletingId, virtualizer],
  );

  return (
    <div
      className="trade-table-container"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 2px 12px rgba(15,25,35,0.05)",
        position: "relative",
      }}
    >
      <div style={{ height: 3, background: "linear-gradient(90deg, #0D9E6E 0%, transparent 45%, transparent 55%, #D63B3B 100%)" }} />

      {loading ? (
        <div style={{ padding: "0" }}>
          <div className="hidden-mobile">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #E2E8F0" }}>
                  {TABLE_HEADERS.map((h, i) => (
                    <th key={h} style={{ padding: "14px 16px", textAlign: i === 5 ? "right" : "left" }}>
                      <Skeleton width="40px" height="10px" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DESKTOP_SKELETON_ROWS.map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F7FAFC" }}>
                    <td style={{ padding: "16px" }}><Skeleton width="70px" height="14px" /></td>
                    <td style={{ padding: "16px" }}><Skeleton width="80px" height="14px" /></td>
                    <td style={{ padding: "16px" }}><Skeleton width="40px" height="14px" /></td>
                    <td style={{ padding: "16px" }}><Skeleton width="60px" height="14px" /></td>
                    <td style={{ padding: "16px" }}><Skeleton width="50px" height="14px" /></td>
                    <td style={{ padding: "16px", textAlign: "right" }}><Skeleton width="30px" height="14px" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="show-mobile" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 12 }}>
            {MOBILE_SKELETON_ROWS.map((_, i) => (
              <Skeleton key={i} width="100%" height="80px" style={{ borderRadius: 12 }} />
            ))}
          </div>
        </div>
      ) : trades.length === 0 ? null : (
        // One variant, not both. This used to render a row AND a card for
        // every trade and hide one with CSS, doubling the nodes on screen.
        <div ref={listRef}>
          {isNarrow ? (
            <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 12 }}>
              {padTop > 0 && <div style={{ height: padTop }} aria-hidden />}
              {mobileCards}
              {padBottom > 0 && <div style={{ height: padBottom }} aria-hidden />}
            </div>
          ) : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #E2E8F0", background: "#F8F6F2" }}>
                    {TABLE_HEADERS.map((h, i) => (
                      <th key={h} style={{ padding: "14px 16px", fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", textAlign: i === 5 ? "right" : "left", fontWeight: 700 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Spacer rows stand in for everything scrolled past and
                      everything still below, so the scrollbar stays honest
                      while only the visible rows exist in the DOM. */}
                  {padTop > 0 && <tr style={{ height: padTop }} aria-hidden><td colSpan={TABLE_HEADERS.length} /></tr>}
                  {desktopRows}
                  {padBottom > 0 && <tr style={{ height: padBottom }} aria-hidden><td colSpan={TABLE_HEADERS.length} /></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .trade-table-container {
          transition: all 0.3s ease;
        }
        @keyframes tradeExit {
          0%   { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(40px); }
        }
        @media (max-width: 640px) {
          .hidden-mobile { display: none !important; }
          .show-mobile { display: flex !important; }
        }
        @media (min-width: 641px) {
          .show-mobile { display: none !important; }
          .hidden-mobile { display: block !important; }
        }
      `}</style>
    </div>
  );
}

export default memo(TradeTable);
