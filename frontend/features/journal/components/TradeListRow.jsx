"use client";

import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, MoreHorizontal, Pencil, Eye, Trash2 } from "lucide-react";
import { Money } from "@/features/shared/components/ui";
import { getTradeMoment } from "../utils/groupByDay";
import {
  tradeSymbol, tradeSide, tradeSetupLabel, tradeScore, tradeMistake, tradeProfit, isEquityTrade,
} from "../utils/tradeDisplay";

function scoreTone(score) {
  if (score >= 70) return "profit";
  if (score >= 50) return "warning";
  return "loss";
}

function RowMenu({ viewHref, editHref, onDelete, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="ec-jrow__menu" ref={ref}>
      <button
        type="button"
        className="ec-jrow__more ec-focusable"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="ec-jrow__pop" role="menu">
          <Link role="menuitem" href={viewHref} className="ec-jrow__item" onClick={() => setOpen(false)}>
            <Eye size={15} aria-hidden="true" /> View
          </Link>
          <Link role="menuitem" href={editHref} className="ec-jrow__item" onClick={() => setOpen(false)}>
            <Pencil size={15} aria-hidden="true" /> Edit
          </Link>
          <button
            role="menuitem"
            type="button"
            className="ec-jrow__item ec-jrow__item--danger"
            onClick={() => { setOpen(false); onDelete(); }}
          >
            <Trash2 size={15} aria-hidden="true" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

function TradeListRow({ trade, indian, onDelete, isDeleting }) {
  const root = indian ? "/indian-market/trades" : "/trades";
  const viewHref = `${root}/view?id=${trade._id}`;
  const editHref = `${root}/edit?id=${trade._id}`;
  const symbol = tradeSymbol(trade, indian);
  const side = tradeSide(trade);
  const setup = tradeSetupLabel(trade);
  const score = tradeScore(trade);
  const mistake = tradeMistake(trade);
  const profit = tradeProfit(trade);
  const moment = getTradeMoment(trade);
  const time = moment?.hasTime
    ? moment.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const tone = profit === null ? "flat" : profit > 0 ? "up" : profit < 0 ? "down" : "flat";
  const kind = indian ? (isEquityTrade(trade) ? "Stock" : trade.optionType || null) : null;

  return (
    <div className={`ec-jrow ec-jrow--${tone}${isDeleting ? " is-deleting" : ""}`}>
      <Link href={viewHref} className="ec-jrow__main ec-focusable" aria-label={`${symbol}, open trade`}>
        <span className={`ec-jrow__icon ec-jrow__icon--${side?.long === false ? "short" : "long"}`} aria-hidden="true">
          {side?.long === false ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
        </span>
        <span className="ec-jrow__body">
          <span className="ec-jrow__top">
            <span className="ec-jrow__symbol">{symbol}</span>
            {mistake && <span className="ec-badge ec-badge--warning ec-jrow__mistake ec-jrow__mistake--top">{mistake}</span>}
          </span>
          <span className="ec-jrow__meta">
            {/* On phones the mistake moves here, where the line has room. */}
            {mistake && <span className="ec-badge ec-badge--warning ec-jrow__mistake ec-jrow__mistake--meta" aria-hidden="true">{mistake}</span>}
            {/* The arrow icon already shows the direction on phones. */}
            {side && <span className="ec-jrow__side">{side.label}</span>}
            {kind && <span>{kind}</span>}
            {setup && <span className="ec-jrow__setup">{setup}</span>}
            {score !== null && (
              <span className={`ec-jrow__score ec-jrow__score--${scoreTone(score)}`} title="Checklist score">{score}%</span>
            )}
            {time && <span className="ec-jrow__time">{time}</span>}
          </span>
        </span>
        <span className="ec-jrow__pnl">
          {profit === null
            ? <span className="ec-jrow__pending">Open</span>
            : <Money value={profit} currency={indian ? "INR" : "USD"} decimals={2} signed />}
        </span>
      </Link>
      <RowMenu viewHref={viewHref} editHref={editHref} onDelete={() => onDelete(trade)} label={symbol} />
    </div>
  );
}

export default memo(TradeListRow);
