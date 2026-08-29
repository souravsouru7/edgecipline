"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, BookOpen, Inbox, Filter, X } from "lucide-react";
import AdminHeader from "@/components/AdminHeader";
import {
  StatusBadge,
  PriorityBadge,
  TicketCode,
  LoadingBlock,
  ErrorBlock,
  EmptyState,
  Pager,
  formatWhen,
} from "@/features/support/components/SupportBits";
import {
  useSupportCapabilities,
  useSupportMetrics,
  useStaffTickets,
  useSupportAgents,
  useCan,
  useResettablePage,
} from "@/features/support/hooks/useSupport";

const QUEUES = [
  { value: "mine", label: "My tickets" },
  { value: "unassigned", label: "Unassigned" },
  { value: "all", label: "All" },
  { value: "waiting_on_user", label: "Waiting on user" },
  { value: "resolved", label: "Resolved" },
];

const PRIORITIES = ["urgent", "high", "normal", "low"];
const STATUSES = ["open", "in_progress", "waiting_on_user", "pending", "resolved", "closed"];

function MetricTile({ label, value, tone, onClick, active }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button", onClick } : {})}
      className={`mt ${onClick ? "mt-click" : ""} ${active ? "mt-active" : ""}`}
      aria-pressed={onClick ? active : undefined}
    >
      <span className="mt-value" style={tone ? { color: tone } : undefined}>
        {value ?? "—"}
      </span>
      <span className="mt-label">{label}</span>
      <style jsx>{`
        .mt {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 14px 16px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          background: #fff;
          text-align: left;
          font-family: inherit;
          min-width: 0;
        }
        .mt-click {
          cursor: pointer;
        }
        .mt-click:hover {
          border-color: #0d9e6e;
        }
        .mt-click:focus-visible {
          outline: 2px solid #0d9e6e;
          outline-offset: 2px;
        }
        .mt-active {
          border-color: #0d9e6e;
          background: rgba(13, 158, 110, 0.06);
        }
        .mt-value {
          font-size: 22px;
          font-weight: 800;
          color: #0f1923;
          line-height: 1.1;
        }
        .mt-label {
          font-size: 11px;
          font-weight: 600;
          color: #64748b;
        }
      `}</style>
    </Tag>
  );
}

function SupportConsole() {
  const router = useRouter();
  const [queue, setQueue] = useState("unassigned");
  const [filters, setFilters] = useState({ status: "", priority: "", assignedTo: "" });
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [searchMessages, setSearchMessages] = useState(false);
  const [page, setPage] = useResettablePage(
    `${queue}|${filters.status}|${filters.priority}|${filters.assignedTo}|${debounced}|${searchMessages}`
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const capabilities = useSupportCapabilities();
  const metrics = useSupportMetrics();
  const agents = useSupportAgents();
  const can = useCan(capabilities.data?.capabilities);

  const tickets = useStaffTickets({
    queue,
    page,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.assignedTo ? { assignedTo: filters.assignedTo } : {}),
    ...(debounced ? (searchMessages ? { messageQuery: debounced } : { q: debounced }) : {}),
  });

  // supportAuth returns 403 for a signed-in admin who has no support access, and
  // 401 once the session is gone. Only the second is a login problem.
  if (capabilities.isError) {
    const denied = capabilities.error?.status === 403;
    return (
      <div style={{ minHeight: "100vh", background: "#f0eee9" }}>
        <AdminHeader />
        <div style={{ maxWidth: 640, margin: "60px auto", padding: "0 20px" }}>
          <ErrorBlock
            message={
              denied
                ? "Your account does not have support access. An administrator can grant it from the support console."
                : "Your admin session has expired. Please sign in again."
            }
            action={
              denied ? null : (
                <Link href="/admin/login" style={{ fontWeight: 700, color: "#d63b3b" }}>
                  Go to admin login
                </Link>
              )
            }
          />
        </div>
      </div>
    );
  }

  const rows = tickets.data?.items || [];
  const m = metrics.data;
  const hasFilters = Boolean(filters.status || filters.priority || filters.assignedTo || debounced);

  return (
    <div style={{ minHeight: "100vh", background: "#f0eee9", paddingBottom: 60 }}>
      <AdminHeader />

      <main style={{ maxWidth: 1320, margin: "0 auto", padding: "26px 20px" }}>
        <div className="cs-top">
          <div>
            <h1 className="cs-h1">Customer Support</h1>
            <p className="cs-sub">
              {capabilities.data?.supportRole
                ? `Signed in as ${capabilities.data.supportRole}`
                : "Signed in as administrator"}
            </p>
          </div>
          {can("support:manage_kb") && (
            <Link href="/admin/support/articles" className="cs-kb">
              <BookOpen size={15} aria-hidden="true" />
              Knowledge base
            </Link>
          )}
        </div>

        {/* ── Metrics ─────────────────────────────────────────────────── */}
        <section aria-label="Support metrics" className="cs-metrics">
          <MetricTile label="Open" value={m?.open} onClick={() => setQueue("all")} />
          <MetricTile
            label="Unassigned"
            value={m?.unassigned}
            tone={m?.unassigned > 0 ? "#B8860B" : undefined}
            onClick={() => setQueue("unassigned")}
            active={queue === "unassigned"}
          />
          <MetricTile
            label="Mine"
            value={m?.mine}
            onClick={() => setQueue("mine")}
            active={queue === "mine"}
          />
          <MetricTile
            label="High priority"
            value={m?.highPriority}
            tone={m?.highPriority > 0 ? "#D63B3B" : undefined}
          />
          <MetricTile label="Waiting on user" value={m?.waitingOnUser} />
          <MetricTile label="Resolved (24h)" value={m?.resolvedToday} tone="#0D9E6E" />
          <MetricTile
            label={`First reply${m?.firstResponseSample ? ` · n=${m.firstResponseSample}` : ""}`}
            value={m?.avgFirstResponseHours != null ? `${m.avgFirstResponseHours}h` : "—"}
          />
          <MetricTile
            label={`Resolution${m?.resolutionSample ? ` · n=${m.resolutionSample}` : ""}`}
            value={m?.avgResolutionHours != null ? `${m.avgResolutionHours}h` : "—"}
          />
        </section>

        {/* Sample sizes are printed next to the averages on purpose — "4.2h"
            across three tickets and across nine hundred are very different
            claims, and a dashboard that hides which one it is invites the
            wrong decision. */}

        {/* ── Queue tabs ──────────────────────────────────────────────── */}
        <nav className="cs-tabs" role="tablist" aria-label="Ticket queues">
          {QUEUES.map((q) => (
            <button
              key={q.value}
              type="button"
              role="tab"
              aria-selected={queue === q.value}
              onClick={() => setQueue(q.value)}
              className={`cs-tab ${queue === q.value ? "cs-tab-on" : ""}`}
            >
              {q.label}
            </button>
          ))}
        </nav>

        {/* ── Search + filters ────────────────────────────────────────── */}
        <div className="cs-controls">
          <div className="cs-search">
            <Search size={16} aria-hidden="true" className="cs-search-icon" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchMessages ? "Search message text…" : "Ticket code, subject…"}
              aria-label="Search tickets"
              className="cs-input"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="cs-clear">
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          <label className="cs-check">
            <input
              type="checkbox"
              checked={searchMessages}
              onChange={(e) => setSearchMessages(e.target.checked)}
            />
            Search message bodies
          </label>

          <label className="cs-sr" htmlFor="cs-status">
            Status
          </label>
          <select
            id="cs-status"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="cs-select"
          >
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          <label className="cs-sr" htmlFor="cs-priority">
            Priority
          </label>
          <select
            id="cs-priority"
            value={filters.priority}
            onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
            className="cs-select"
          >
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <label className="cs-sr" htmlFor="cs-agent">
            Agent
          </label>
          <select
            id="cs-agent"
            value={filters.assignedTo}
            onChange={(e) => setFilters((f) => ({ ...f, assignedTo: e.target.value }))}
            className="cs-select"
          >
            <option value="">Any agent</option>
            <option value="none">Unassigned</option>
            {(agents.data || []).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>

          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setFilters({ status: "", priority: "", assignedTo: "" });
                setQuery("");
              }}
              className="cs-reset"
            >
              <Filter size={13} aria-hidden="true" /> Reset
            </button>
          )}
        </div>

        {/* ── Rows ────────────────────────────────────────────────────── */}
        {tickets.isPending && <LoadingBlock label="Loading queue" rows={4} />}

        {tickets.isError && (
          <ErrorBlock message="Could not load the ticket queue." onRetry={() => tickets.refetch()} />
        )}

        {tickets.data && rows.length === 0 && (
          <EmptyState
            icon={<Inbox size={28} aria-hidden="true" />}
            title={hasFilters ? "Nothing matches those filters" : "This queue is clear"}
            description={
              hasFilters
                ? "Try widening the filters, or switch queue."
                : queue === "unassigned"
                  ? "Every ticket has an owner. Nice."
                  : "No tickets here right now."
            }
          />
        )}

        {rows.length > 0 && (
          <div className="cs-table-wrap">
            <table className="cs-table">
              <thead>
                <tr>
                  <th scope="col">Ticket</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Category</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Status</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((ticket) => (
                  <tr
                    key={ticket.id}
                    onClick={() => router.push(`/admin/support/detail?id=${ticket.id}`)}
                    // Rows are clickable, so they must also be reachable and
                    // activatable from the keyboard.
                    tabIndex={0}
                    role="link"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/admin/support/detail?id=${ticket.id}`);
                      }
                    }}
                  >
                    <td>
                      <div className="cs-code">
                        <TicketCode code={ticket.ticketCode} />
                      </div>
                      <div className="cs-subject">{ticket.subject}</div>
                    </td>
                    <td>
                      <div className="cs-name">{ticket.user?.name || "—"}</div>
                      <div className="cs-email">{ticket.user?.email}</div>
                    </td>
                    <td className="cs-muted">{ticket.categoryLabel}</td>
                    <td>
                      <PriorityBadge priority={ticket.priority} />
                    </td>
                    <td>
                      <StatusBadge status={ticket.status} label={ticket.statusLabel} />
                    </td>
                    <td className="cs-muted">
                      {ticket.assignee ? (
                        <span style={ticket.assignee.active ? undefined : { color: "#D63B3B" }}>
                          {ticket.assignee.name || "Agent"}
                          {!ticket.assignee.active && " (disabled)"}
                        </span>
                      ) : (
                        <span style={{ color: "#B8860B", fontWeight: 700 }}>Unassigned</span>
                      )}
                    </td>
                    <td className="cs-muted">{formatWhen(ticket.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pager pagination={tickets.data?.pagination} onPage={setPage} />
      </main>

      <style jsx>{`
        .cs-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 20px;
        }
        .cs-h1 {
          font-size: 24px;
          font-weight: 800;
          margin: 0 0 4px;
          color: #0f1923;
        }
        .cs-sub {
          margin: 0;
          font-size: 12.5px;
          color: #64748b;
        }
        .cs-kb {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          height: 38px;
          padding: 0 15px;
          border-radius: 9px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #0f1923;
          font-size: 12.5px;
          font-weight: 700;
          text-decoration: none;
        }
        .cs-kb:hover {
          border-color: #0d9e6e;
          color: #0d9e6e;
        }
        .cs-metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
          gap: 10px;
          margin-bottom: 22px;
        }
        .cs-tabs {
          display: flex;
          gap: 7px;
          overflow-x: auto;
          scrollbar-width: none;
          margin-bottom: 14px;
          padding-bottom: 2px;
        }
        .cs-tabs::-webkit-scrollbar {
          display: none;
        }
        .cs-tab {
          flex-shrink: 0;
          height: 36px;
          padding: 0 16px;
          border-radius: 999px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #64748b;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .cs-tab-on {
          border-color: #0d9e6e;
          background: rgba(13, 158, 110, 0.08);
          color: #0d9e6e;
        }
        .cs-tab:focus-visible {
          outline: 2px solid #0d9e6e;
          outline-offset: 2px;
        }
        .cs-controls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 9px;
          margin-bottom: 16px;
        }
        .cs-search {
          position: relative;
          display: flex;
          align-items: center;
          flex: 1;
          min-width: 220px;
        }
        .cs-search-icon {
          position: absolute;
          left: 13px;
          color: #94a3b8;
          pointer-events: none;
        }
        .cs-input {
          width: 100%;
          height: 38px;
          padding: 0 34px 0 36px;
          border-radius: 9px;
          border: 1px solid #e2e8f0;
          background: #fff;
          font-size: 13px;
          font-family: inherit;
          outline: none;
        }
        .cs-input:focus {
          border-color: #0d9e6e;
          box-shadow: 0 0 0 3px rgba(13, 158, 110, 0.1);
        }
        .cs-clear {
          position: absolute;
          right: 9px;
          display: flex;
          width: 22px;
          height: 22px;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: 50%;
          background: #f1f5f9;
          color: #64748b;
          cursor: pointer;
        }
        .cs-check {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          color: #64748b;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }
        .cs-select {
          height: 38px;
          padding: 0 10px;
          border-radius: 9px;
          border: 1px solid #e2e8f0;
          background: #fff;
          font-size: 12.5px;
          font-family: inherit;
          color: #4a5568;
          cursor: pointer;
        }
        .cs-select:focus-visible {
          outline: 2px solid #0d9e6e;
          outline-offset: 1px;
        }
        .cs-reset {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 38px;
          padding: 0 13px;
          border-radius: 9px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #64748b;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .cs-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
        .cs-table-wrap {
          /* The table scrolls inside its own box; the page never scrolls
             sideways on a narrow screen. */
          overflow-x: auto;
          border-radius: 13px;
          border: 1px solid #e2e8f0;
          background: #fff;
        }
        .cs-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 860px;
        }
        .cs-table th {
          text-align: left;
          padding: 11px 14px;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: #94a3b8;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        .cs-table td {
          padding: 13px 14px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 13px;
          vertical-align: top;
        }
        .cs-table tbody tr {
          cursor: pointer;
        }
        .cs-table tbody tr:hover {
          background: #f8fafc;
        }
        .cs-table tbody tr:focus-visible {
          outline: 2px solid #0d9e6e;
          outline-offset: -2px;
        }
        .cs-code {
          margin-bottom: 4px;
        }
        .cs-subject {
          font-size: 13px;
          font-weight: 600;
          color: #0f1923;
          max-width: 300px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cs-name {
          font-weight: 600;
          color: #0f1923;
        }
        .cs-email {
          font-size: 11.5px;
          color: #94a3b8;
        }
        .cs-muted {
          color: #64748b;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}

export default function AdminSupportPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f0eee9" }} />}>
      <SupportConsole />
    </Suspense>
  );
}
