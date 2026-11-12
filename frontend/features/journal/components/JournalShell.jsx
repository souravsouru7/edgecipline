"use client";

import { Plus, Search, X, BookOpen, SearchX, PartyPopper } from "lucide-react";
import {
  Button, EmptyState, ErrorState, ResponsiveModal, SegmentedControl, StatCard,
} from "@/features/shared/components/ui";
import { useLogTrade } from "@/features/trade/components/LogTradeChooser";

export const PERIOD_OPTIONS = [
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "all", label: "All" },
];

export function JournalHeader({ subtitle }) {
  const { open } = useLogTrade();
  return (
    <div className="ec-journal__head">
      <div style={{ minWidth: 0 }}>
        <h1 className="ec-journal__title">Journal</h1>
        <p className="ec-journal__sub">{subtitle}</p>
      </div>
      <Button icon={<Plus size={16} />} onClick={open}>Log trade</Button>
    </div>
  );
}

export function OnboardingBanner() {
  return (
    <div className="ec-journal__banner" role="status">
      <span className="ec-journal__banner-icon" aria-hidden="true"><PartyPopper size={18} /></span>
      <div>
        <strong>Nice, you logged your first trade.</strong>
        <p>Every trade lives here, grouped by day. The more you log, the sharper your analytics and coach get.</p>
      </div>
    </div>
  );
}

// performance: { totalTrades, winRate, grossPnL } (server summary or local fallback)
export function JournalStats({ performance, currency, loading }) {
  const total = Number(performance?.totalTrades) || 0;
  const winRate = Number(performance?.winRate) || 0;
  const pnl = Number(performance?.grossPnL) || 0;
  const wins = Number(performance?.wins);
  return (
    <div className="ec-journal__stats">
      <StatCard label="Trades" value={total} loading={loading} />
      <StatCard
        label="Win rate"
        value={total ? `${winRate.toFixed(1)}%` : "—"}
        hint={total && Number.isFinite(wins) ? `${wins}W · ${Math.max(0, total - wins)}L` : undefined}
        loading={loading}
      />
      <StatCard label="Total P&L" value={pnl} kind="money" currency={currency} signed loading={loading} />
    </div>
  );
}

export function JournalToolbar({ period, onPeriod, filterOptions, filter, onFilter, search, onSearch, placeholder, children }) {
  return (
    <div className="ec-journal__toolbar">
      {children}
      <div className="ec-journal__filters">
        <SegmentedControl label="Period" options={PERIOD_OPTIONS} value={period} onChange={onPeriod} />
        <SegmentedControl label="Filter" options={filterOptions} value={filter} onChange={onFilter} />
      </div>
      <label className="ec-journal__search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          className="ec-journal__search-input"
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Search trades"
          enterKeyHint="search"
        />
        {search && (
          <button type="button" className="ec-journal__search-clear ec-focusable" onClick={() => onSearch("")} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </label>
    </div>
  );
}

// reason: "none" (no trades at all) | "period" (none in this window) | "filters"
export function JournalEmpty({ reason = "none", onClear }) {
  const { open } = useLogTrade();
  if (reason === "period") {
    return (
      <EmptyState
        icon={<BookOpen size={22} />}
        title="No trades in this period"
        body="Older trades may be outside the window you picked."
        action={
          <>
            <Button variant="secondary" onClick={onClear}>Show all time</Button>
            <Button icon={<Plus size={16} />} onClick={open}>Log trade</Button>
          </>
        }
      />
    );
  }
  if (reason === "filters") {
    return (
      <EmptyState
        icon={<SearchX size={22} />}
        title="No trades match"
        body="Try another period, filter or search."
        action={<Button variant="secondary" onClick={onClear}>Clear filters</Button>}
      />
    );
  }
  return (
    <EmptyState
      icon={<BookOpen size={22} />}
      title="No trades here yet"
      body="Log a trade by hand or from a broker screenshot. Each one shows up here under its day."
      action={<Button icon={<Plus size={16} />} onClick={open}>Log trade</Button>}
    />
  );
}

export function JournalError({ onRetry }) {
  return <ErrorState title="Couldn't load your journal" onRetry={onRetry} />;
}

export function DeleteTradeDialog({ trade, symbol, onConfirm, onCancel, busy }) {
  return (
    <ResponsiveModal open={Boolean(trade)} onClose={onCancel} title="Delete this trade?" width={420}>
      <p className="ec-journal__confirm">
        <strong>{symbol}</strong> will be removed from your journal and analytics. This can&apos;t be undone.
      </p>
      <div className="ec-journal__confirm-actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} loading={busy}>Delete trade</Button>
      </div>
    </ResponsiveModal>
  );
}
