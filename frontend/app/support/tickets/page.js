"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, Ticket, MessageSquare, ChevronRight } from "lucide-react";
import SupportShell from "@/features/support/components/SupportShell";
import SignInRequired from "@/features/support/components/SignInRequired";
import {
  StatusBadge,
  TicketCode,
  LoadingBlock,
  ErrorBlock,
  EmptyState,
  Pager,
  formatWhen,
} from "@/features/support/components/SupportBits";
import {
  useMyTickets,
  useSupportConfig,
  useIsSignedIn,
  useResettablePage,
} from "@/features/support/hooks/useSupport";

const FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Active" },
  { value: "waiting_on_user", label: "Needs you" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

function TicketList() {
  const signedIn = useIsSignedIn();
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useResettablePage(`${status}|${debounced}`);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: config } = useSupportConfig();
  const ticketsQuery = useMyTickets({ status, q: debounced, page });

  // A 401 from the server is the authoritative answer, and it also covers a
  // token that expired between page load and this request.
  if (!signedIn || ticketsQuery.error?.status === 401) {
    return <SignInRequired next="/support/tickets" config={config} />;
  }

  const tickets = ticketsQuery.data?.items || [];
  const hasFilters = Boolean(status || debounced);

  return (
    <SupportShell
      title="Your tickets"
      backHref="/support"
      actions={
        <Link href="/support/tickets/new" className="tl-new">
          <Plus size={15} aria-hidden="true" />
          New ticket
        </Link>
      }
    >
      <div className="tl-controls">
        <div className="tl-search">
          <Search size={16} aria-hidden="true" className="tl-search-icon" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your tickets…"
            aria-label="Search your tickets"
            className="tl-input"
          />
        </div>

        <div className="tl-filters" role="tablist" aria-label="Filter tickets by status">
          {FILTERS.map((filter) => (
            <button
              key={filter.value || "all"}
              type="button"
              role="tab"
              aria-selected={status === filter.value}
              onClick={() => setStatus(filter.value)}
              className={`tl-filter ${status === filter.value ? "tl-filter-on" : ""}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {ticketsQuery.isPending && <LoadingBlock label="Loading your tickets" rows={3} />}

      {ticketsQuery.isError && (
        <ErrorBlock
          message="We couldn't load your tickets."
          onRetry={() => ticketsQuery.refetch()}
        />
      )}

      {ticketsQuery.data && tickets.length === 0 && (
        <EmptyState
          icon={<Ticket size={28} aria-hidden="true" />}
          title={hasFilters ? "No tickets match that" : "No tickets yet"}
          description={
            hasFilters
              ? "Try a different filter, or clear the search."
              : "When you open a support ticket it will appear here, with every reply in one place."
          }
          action={
            hasFilters ? (
              <button
                type="button"
                onClick={() => {
                  setStatus("");
                  setQuery("");
                }}
                className="tl-clear"
              >
                Clear filters
              </button>
            ) : (
              <Link href="/support/tickets/new" className="tl-cta">
                Create your first ticket
              </Link>
            )
          }
        />
      )}

      {tickets.length > 0 && (
        <ul className="tl-list">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Link href={`/support/tickets/detail?id=${ticket.id}`} className="tl-row">
                <div className="tl-row-main">
                  <div className="tl-row-top">
                    <TicketCode code={ticket.ticketCode} />
                    <StatusBadge status={ticket.status} label={ticket.statusLabel} />
                  </div>
                  <div className="tl-subject">{ticket.subject}</div>
                  <div className="tl-meta">
                    <span>{ticket.categoryLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tl-msgs">
                      <MessageSquare size={12} aria-hidden="true" />
                      {ticket.messageCount}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Updated {formatWhen(ticket.lastActivityAt)}</span>
                  </div>
                </div>
                <ChevronRight size={17} aria-hidden="true" className="tl-chev" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pager pagination={ticketsQuery.data?.pagination} onPage={setPage} />

      <style jsx>{`
        :global(.tl-new) {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 36px;
          padding: 0 14px;
          border-radius: 9px;
          background: var(--color-dark);
          color: var(--color-primary-light);
          font-size: 12.5px;
          font-weight: 700;
          text-decoration: none;
          white-space: nowrap;
        }
        :global(.tl-new:focus-visible) {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .tl-controls {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 20px;
        }
        .tl-search {
          position: relative;
          display: flex;
          align-items: center;
        }
        :global(.tl-search-icon) {
          position: absolute;
          left: 14px;
          color: var(--color-text-disabled);
          pointer-events: none;
        }
        .tl-input {
          width: 100%;
          height: 44px;
          padding: 0 16px 0 40px;
          border-radius: 11px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          font-size: 14px;
          font-family: inherit;
          color: var(--color-dark);
          outline: none;
        }
        .tl-input:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px var(--color-primary-bg);
        }
        .tl-filters {
          display: flex;
          gap: 7px;
          overflow-x: auto;
          /* The filter row scrolls sideways on a phone; the page must not. */
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          padding-bottom: 2px;
        }
        .tl-filters::-webkit-scrollbar {
          display: none;
        }
        .tl-filter {
          flex-shrink: 0;
          height: 34px;
          padding: 0 15px;
          border-radius: 999px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          color: var(--color-text-muted);
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .tl-filter-on {
          border-color: var(--color-primary);
          background: var(--color-primary-bg);
          color: var(--color-primary);
        }
        .tl-filter:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .tl-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        :global(.tl-row) {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 15px 16px;
          border-radius: 13px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          text-decoration: none;
          transition: border-color 0.15s;
        }
        :global(.tl-row:hover) {
          border-color: var(--color-primary);
        }
        :global(.tl-row:focus-visible) {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .tl-row-main {
          flex: 1;
          min-width: 0;
        }
        .tl-row-top {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
          flex-wrap: wrap;
        }
        .tl-subject {
          font-size: 14.5px;
          font-weight: 600;
          color: var(--color-dark);
          line-height: 1.4;
          margin-bottom: 6px;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .tl-meta {
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
          font-size: 11.5px;
          color: var(--color-text-disabled);
        }
        .tl-msgs {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        :global(.tl-chev) {
          color: var(--color-text-disabled);
          flex-shrink: 0;
        }
        :global(.tl-cta) {
          display: inline-block;
          padding: 11px 22px;
          border-radius: 10px;
          background: var(--color-dark);
          color: var(--color-primary-light);
          font-size: 13px;
          font-weight: 700;
          text-decoration: none;
        }
        .tl-clear {
          padding: 10px 20px;
          border-radius: 10px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          color: var(--color-text-secondary);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        @media (min-width: 720px) {
          .tl-controls {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
          }
          .tl-search {
            max-width: 320px;
            flex: 1;
          }
        }
      `}</style>
    </SupportShell>
  );
}

export default function TicketsPage() {
  return (
    <Suspense
      fallback={
        <SupportShell title="Your tickets" backHref="/support">
          <LoadingBlock label="Loading tickets" rows={3} />
        </SupportShell>
      }
    >
      <TicketList />
    </Suspense>
  );
}
