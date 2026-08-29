"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Lock,
  Info,
  Paperclip,
  UserPlus,
  History,
  CreditCard,
  Bug,
  Star,
} from "lucide-react";
import AdminHeader from "@/components/AdminHeader";
import MessageComposer from "@/features/support/components/MessageComposer";
import {
  StatusBadge,
  PriorityBadge,
  TicketCode,
  LoadingBlock,
  ErrorBlock,
  EmptyState,
  InlineSpinner,
  formatWhen,
  formatExact,
} from "@/features/support/components/SupportBits";
import {
  useStaffTicket,
  useStaffTicketMessages,
  useTicketContext,
  useTicketAudit,
  useSupportAgents,
  useSupportCapabilities,
  useCan,
  useStaffReply,
  useAssignTicket,
  useChangeStatus,
  useChangePriority,
  useUpdateTags,
} from "@/features/support/hooks/useSupport";
import { staffAttachmentUrl } from "@/features/support/api/adminSupportApi";

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting_on_user", label: "Waiting on user" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITIES = ["low", "normal", "high", "urgent"];

const TAGS = [
  "refund",
  "duplicate_charge",
  "bug",
  "data_loss",
  "cannot_login",
  "ocr_failure",
  "feature_idea",
  "vip",
  "escalated",
  "awaiting_third_party",
  "documentation",
  "spam",
];

function StaffMessage({ message }) {
  if (message.type === "system_event") {
    return (
      <div className="sm-system">
        <Info size={12} aria-hidden="true" />
        <span>{message.body}</span>
        {message.visibility === "internal" && <span className="sm-internal-tag">internal</span>}
        <time dateTime={message.createdAt}>{formatWhen(message.createdAt)}</time>
        <style jsx>{`
          .sm-system {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            flex-wrap: wrap;
            margin: 13px 0;
            font-size: 11.5px;
            color: #94a3b8;
          }
          .sm-internal-tag {
            font-size: 9.5px;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #b8860b;
            background: rgba(184, 134, 11, 0.12);
            padding: 2px 6px;
            border-radius: 4px;
          }
          time {
            font-family: var(--font-jetbrains-mono);
            font-size: 10.5px;
          }
        `}</style>
      </div>
    );
  }

  const internal = message.visibility === "internal";
  const fromUser = message.authorRole === "user";

  return (
    <div className={`sm-row ${fromUser ? "" : "sm-right"}`}>
      <div className={`sm-bubble ${internal ? "sm-note" : fromUser ? "sm-user" : "sm-agent"}`}>
        <div className="sm-head">
          <span className="sm-who">
            {internal && <Lock size={11} aria-hidden="true" style={{ marginRight: 4 }} />}
            {internal ? "Internal note" : fromUser ? "Customer" : message.authorName || "Agent"}
          </span>
          <time dateTime={message.createdAt} title={formatExact(message.createdAt)}>
            {formatWhen(message.createdAt)}
          </time>
        </div>

        {internal && (
          <div className="sm-note-warn">Not visible to the customer. Author: {message.authorName || "—"}</div>
        )}

        <div className="sm-body">{message.body}</div>

        {message.attachments?.length > 0 && (
          <div className="sm-files">
            {message.attachments.map((file) => (
              <a
                key={`${file.messageId}-${file.index}`}
                href={staffAttachmentUrl(file.messageId, file.index)}
                target="_blank"
                rel="noopener noreferrer"
                className="sm-file"
              >
                <Paperclip size={11} aria-hidden="true" />
                {file.originalName}
              </a>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .sm-row {
          display: flex;
          margin-bottom: 12px;
        }
        .sm-right {
          justify-content: flex-end;
        }
        .sm-bubble {
          max-width: min(88%, 620px);
          padding: 12px 15px;
          border-radius: 13px;
          border: 1px solid #e2e8f0;
          background: #fff;
        }
        .sm-user {
          background: #fff;
        }
        .sm-agent {
          background: rgba(13, 158, 110, 0.06);
          border-color: rgba(13, 158, 110, 0.25);
        }
        /* Internal notes are visually unmistakable — a dashed gold frame that
           looks nothing like a customer-visible reply. The colour is the
           reminder; the server is the control. */
        .sm-note {
          background: rgba(184, 134, 11, 0.07);
          border: 1px dashed rgba(184, 134, 11, 0.55);
        }
        .sm-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 5px;
        }
        .sm-who {
          display: inline-flex;
          align-items: center;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #0d9e6e;
        }
        .sm-note .sm-who {
          color: #b8860b;
        }
        time {
          font-size: 10.5px;
          color: #94a3b8;
          font-family: var(--font-jetbrains-mono);
          white-space: nowrap;
        }
        .sm-note-warn {
          font-size: 10.5px;
          color: #b8860b;
          font-weight: 700;
          margin-bottom: 7px;
        }
        .sm-body {
          font-size: 14px;
          line-height: 1.65;
          color: #4a5568;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .sm-files {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 9px;
        }
        .sm-file {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          max-width: 200px;
          padding: 5px 9px;
          border-radius: 7px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          color: #4a5568;
          font-size: 11px;
          font-weight: 600;
          text-decoration: none;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sm-file:hover {
          border-color: #0d9e6e;
          color: #0d9e6e;
        }
      `}</style>
    </div>
  );
}

function ContextPanel({ context, canSeeBilling }) {
  if (!context) return null;
  const { account, plan, ticketCounts, recentTickets, issueReports, billing } = context;

  return (
    <aside className="cx" aria-label="Customer context">
      <section className="cx-block">
        <h2 className="cx-h">Customer</h2>
        <div className="cx-name">{account.name || "—"}</div>
        <div className="cx-email">{account.email}</div>
        {account.deleted ? (
          <div className="cx-warn">This account has been deleted.</div>
        ) : (
          <dl className="cx-dl">
            <dt>Member since</dt>
            <dd>{account.memberSince ? new Date(account.memberSince).toLocaleDateString() : "—"}</dd>
            <dt>Last seen</dt>
            <dd>{account.lastLogin ? formatWhen(account.lastLogin) : "—"}</dd>
            <dt>Market</dt>
            <dd>{account.preferredMarket || "—"}</dd>
            <dt>Style</dt>
            <dd>{account.tradingStyle || "—"}</dd>
            <dt>Status</dt>
            <dd style={account.accountStatus !== "active" ? { color: "#D63B3B", fontWeight: 700 } : undefined}>
              {account.accountStatus}
            </dd>
          </dl>
        )}
      </section>

      {plan && (
        <section className="cx-block">
          <h2 className="cx-h">Plan</h2>
          <div className="cx-plan">
            <span className={plan.premium ? "cx-badge cx-badge-on" : "cx-badge"}>
              {plan.premium ? "Premium" : "Free"}
            </span>
            <span className="cx-plan-detail">
              {plan.plan} · {plan.status} · via {plan.source}
            </span>
          </div>
        </section>
      )}

      <section className="cx-block">
        <h2 className="cx-h">
          <CreditCard size={12} aria-hidden="true" /> Billing
        </h2>
        {/* Payment figures are gated on VIEW_BILLING. An agent triaging an OCR
            bug has no reason to see a customer's transaction history, and the
            server decides this — the panel just renders what it is given. */}
        {!canSeeBilling || !billing?.visible ? (
          <p className="cx-muted">
            Payment details are restricted to support leads and administrators.
          </p>
        ) : billing.lastPayment ? (
          <dl className="cx-dl">
            <dt>Last payment</dt>
            <dd>
              {billing.lastPayment.currency} {billing.lastPayment.amount}
            </dd>
            <dt>Plan</dt>
            <dd>{billing.lastPayment.plan}</dd>
            <dt>When</dt>
            <dd>{formatWhen(billing.lastPayment.at)}</dd>
          </dl>
        ) : (
          <p className="cx-muted">No completed payments on record.</p>
        )}
      </section>

      {Object.keys(ticketCounts || {}).length > 0 && (
        <section className="cx-block">
          <h2 className="cx-h">Ticket history</h2>
          <div className="cx-counts">
            {Object.entries(ticketCounts).map(([status, count]) => (
              <span key={status} className="cx-count">
                <strong>{count}</strong> {status.replace(/_/g, " ")}
              </span>
            ))}
          </div>
          {recentTickets?.length > 0 && (
            <ul className="cx-list">
              {recentTickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/admin/support/detail?id=${t.id}`} className="cx-link">
                    <span className="cx-link-code">{t.ticketCode}</span>
                    <span className="cx-link-subject">{t.subject}</span>
                    {t.rating && (
                      <span className="cx-rating">
                        <Star size={10} fill="#B8860B" color="#B8860B" aria-hidden="true" />
                        {t.rating}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {issueReports?.length > 0 && (
        <section className="cx-block">
          <h2 className="cx-h">
            <Bug size={12} aria-hidden="true" /> Bug reports
          </h2>
          <ul className="cx-list">
            {issueReports.map((issue) => (
              <li key={issue.id}>
                <Link href={`/admin/issues`} className="cx-link">
                  <span className="cx-link-code">{issue.issueCode}</span>
                  <span className="cx-link-subject">
                    {issue.category.replace(/_/g, " ").toLowerCase()} · {issue.status.toLowerCase()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <style jsx>{`
        .cx {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .cx-block {
          padding: 15px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          background: #fff;
        }
        .cx-h {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #94a3b8;
          margin: 0 0 10px;
        }
        .cx-name {
          font-size: 14.5px;
          font-weight: 700;
          color: #0f1923;
        }
        .cx-email {
          font-size: 12px;
          color: #64748b;
          margin-bottom: 10px;
          word-break: break-all;
        }
        .cx-warn {
          font-size: 12px;
          font-weight: 700;
          color: #d63b3b;
        }
        .cx-dl {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 5px 12px;
          margin: 0;
          font-size: 12px;
        }
        .cx-dl dt {
          color: #94a3b8;
        }
        .cx-dl dd {
          margin: 0;
          color: #4a5568;
          font-weight: 600;
          text-align: right;
        }
        .cx-plan {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cx-badge {
          align-self: flex-start;
          padding: 3px 9px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #64748b;
          font-size: 11px;
          font-weight: 800;
        }
        .cx-badge-on {
          background: rgba(13, 158, 110, 0.12);
          color: #0d9e6e;
        }
        .cx-plan-detail {
          font-size: 11.5px;
          color: #94a3b8;
        }
        .cx-muted {
          margin: 0;
          font-size: 12px;
          color: #94a3b8;
          line-height: 1.55;
        }
        .cx-counts {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 10px;
        }
        .cx-count {
          font-size: 11px;
          color: #64748b;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 3px 8px;
        }
        .cx-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .cx-link {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 9px;
          border-radius: 7px;
          background: #f8fafc;
          text-decoration: none;
          font-size: 11.5px;
        }
        .cx-link:hover {
          background: rgba(13, 158, 110, 0.07);
        }
        .cx-link-code {
          font-family: var(--font-jetbrains-mono);
          font-weight: 700;
          color: #b8860b;
          flex-shrink: 0;
        }
        .cx-link-subject {
          flex: 1;
          min-width: 0;
          color: #4a5568;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cx-rating {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          color: #b8860b;
          font-weight: 700;
          flex-shrink: 0;
        }
      `}</style>
    </aside>
  );
}

function TicketWorkspace() {
  const params = useSearchParams();
  const id = params.get("id");
  const [actionError, setActionError] = useState("");
  const [showAudit, setShowAudit] = useState(false);
  const [resolutionDraft, setResolutionDraft] = useState("");
  const [pendingStatus, setPendingStatus] = useState("");
  const bottomRef = useRef(null);

  const capabilities = useSupportCapabilities();
  const can = useCan(capabilities.data?.capabilities);
  const ticketQuery = useStaffTicket(id);
  const messagesQuery = useStaffTicketMessages(id);
  const contextQuery = useTicketContext(id);
  const auditQuery = useTicketAudit(showAudit ? id : null);
  const agents = useSupportAgents();

  const reply = useStaffReply(id);
  const assign = useAssignTicket(id);
  const changeStatus = useChangeStatus(id);
  const changePriority = useChangePriority(id);
  const updateTags = useUpdateTags(id);

  const ticket = ticketQuery.data;
  const messages = messagesQuery.data?.items || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);

  // Every mutation sends the version the agent was looking at. If someone else
  // moved first, the server rejects with 409 and this surfaces the reason
  // instead of silently overwriting their colleague's change.
  const run = async (fn) => {
    setActionError("");
    try {
      await fn();
    } catch (err) {
      setActionError(err?.data?.message || err?.message || "That action could not be completed.");
    }
  };

  if (!id) {
    return (
      <div style={{ minHeight: "100vh", background: "#f0eee9" }}>
        <AdminHeader />
        <div style={{ maxWidth: 700, margin: "50px auto", padding: "0 20px" }}>
          <EmptyState title="No ticket selected" description="That link is missing a ticket reference." />
        </div>
      </div>
    );
  }

  if (ticketQuery.isPending) {
    return (
      <div style={{ minHeight: "100vh", background: "#f0eee9" }}>
        <AdminHeader />
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "26px 20px" }}>
          <LoadingBlock label="Loading ticket" rows={5} />
        </div>
      </div>
    );
  }

  if (ticketQuery.isError) {
    const denied = ticketQuery.error?.status === 403;
    return (
      <div style={{ minHeight: "100vh", background: "#f0eee9" }}>
        <AdminHeader />
        <div style={{ maxWidth: 700, margin: "50px auto", padding: "0 20px" }}>
          <ErrorBlock
            message={
              denied
                ? "Your account does not have support access."
                : "Could not load this ticket."
            }
            onRetry={denied ? undefined : () => ticketQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  const meId = capabilities.data?.id;

  return (
    <div style={{ minHeight: "100vh", background: "#f0eee9", paddingBottom: 60 }}>
      <AdminHeader />

      <main style={{ maxWidth: 1320, margin: "0 auto", padding: "22px 20px" }}>
        <Link href="/admin/support" className="tw-back">
          <ArrowLeft size={15} aria-hidden="true" /> Back to queue
        </Link>

        <div className="tw-grid">
          <div className="tw-main">
            <header className="tw-head">
              <div className="tw-head-top">
                <TicketCode code={ticket.ticketCode} />
                <StatusBadge status={ticket.status} label={ticket.statusLabel} />
                <PriorityBadge priority={ticket.priority} />
                {ticket.reopenCount > 0 && (
                  <span className="tw-reopen">reopened ×{ticket.reopenCount}</span>
                )}
              </div>
              <h1 className="tw-subject">{ticket.subject}</h1>
              <div className="tw-meta">
                <span>{ticket.categoryLabel}</span>
                <span aria-hidden="true">·</span>
                <span>{ticket.channel}</span>
                <span aria-hidden="true">·</span>
                <span>Opened {formatWhen(ticket.createdAt)}</span>
                {ticket.firstResponseAt && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>First reply {formatWhen(ticket.firstResponseAt)}</span>
                  </>
                )}
              </div>
            </header>

            {/* ── Actions ─────────────────────────────────────────────── */}
            <div className="tw-actions">
              <div className="tw-action">
                <label htmlFor="tw-assign" className="tw-label">
                  Assigned to
                </label>
                <select
                  id="tw-assign"
                  value={ticket.assignee?.id || ""}
                  disabled={assign.isPending}
                  onChange={(e) =>
                    run(() =>
                      assign.mutateAsync({
                        assigneeId: e.target.value,
                        expectedVersion: ticket.version,
                      })
                    )
                  }
                  className="tw-select"
                >
                  <option value="">Unassigned</option>
                  {(agents.data || []).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                      {agent.id === meId ? " (me)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {!ticket.assignee && can("support:assign_self") && (
                <button
                  type="button"
                  onClick={() => run(() => assign.mutateAsync({ assigneeId: meId }))}
                  disabled={assign.isPending}
                  className="tw-claim"
                >
                  {assign.isPending ? <InlineSpinner /> : <UserPlus size={14} aria-hidden="true" />}
                  Claim
                </button>
              )}

              <div className="tw-action">
                <label htmlFor="tw-status" className="tw-label">
                  Status
                </label>
                <select
                  id="tw-status"
                  value={ticket.status}
                  disabled={changeStatus.isPending || !can("support:change_status")}
                  onChange={(e) => {
                    const next = e.target.value;
                    // Resolving asks for a summary first — a resolution with no
                    // explanation is the thing customers complain about most.
                    if (next === "resolved") {
                      setPendingStatus("resolved");
                      return;
                    }
                    run(() =>
                      changeStatus.mutateAsync({ status: next, expectedVersion: ticket.version })
                    );
                  }}
                  className="tw-select"
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="tw-action">
                <label htmlFor="tw-priority" className="tw-label">
                  Priority
                </label>
                <select
                  id="tw-priority"
                  value={ticket.priority}
                  disabled={changePriority.isPending || !can("support:change_priority")}
                  onChange={(e) =>
                    run(() =>
                      changePriority.mutateAsync({
                        priority: e.target.value,
                        expectedVersion: ticket.version,
                      })
                    )
                  }
                  className="tw-select"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setShowAudit((v) => !v)}
                className="tw-audit-toggle"
                aria-expanded={showAudit}
              >
                <History size={14} aria-hidden="true" /> History
              </button>
            </div>

            {can("support:manage_tags") && (
              <div className="tw-tags">
                {TAGS.map((tag) => {
                  const on = ticket.tags?.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={on}
                      disabled={updateTags.isPending}
                      onClick={() =>
                        run(() =>
                          updateTags.mutateAsync(
                            on
                              ? ticket.tags.filter((t) => t !== tag)
                              : [...(ticket.tags || []), tag]
                          )
                        )
                      }
                      className={`tw-tag ${on ? "tw-tag-on" : ""}`}
                    >
                      {tag.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
            )}

            {pendingStatus === "resolved" && (
              <div className="tw-resolve">
                <label htmlFor="tw-resolution" className="tw-label">
                  Resolution summary (sent to the customer)
                </label>
                <textarea
                  id="tw-resolution"
                  value={resolutionDraft}
                  onChange={(e) => setResolutionDraft(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  className="tw-textarea"
                  placeholder="What was wrong, and what you did about it."
                />
                <div className="tw-resolve-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingStatus("");
                      setResolutionDraft("");
                    }}
                    className="tw-ghost"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={changeStatus.isPending}
                    onClick={() =>
                      run(async () => {
                        await changeStatus.mutateAsync({
                          status: "resolved",
                          resolutionSummary: resolutionDraft,
                          expectedVersion: ticket.version,
                        });
                        setPendingStatus("");
                        setResolutionDraft("");
                      })
                    }
                    className="tw-primary"
                  >
                    {changeStatus.isPending ? <InlineSpinner /> : null}
                    Resolve ticket
                  </button>
                </div>
              </div>
            )}

            {actionError && (
              <div style={{ marginBottom: 14 }}>
                <ErrorBlock message={actionError} onRetry={() => ticketQuery.refetch()} />
              </div>
            )}

            {showAudit && (
              <div className="tw-audit">
                <h2 className="tw-label" style={{ marginBottom: 10 }}>
                  Staff action history
                </h2>
                {auditQuery.isPending && <LoadingBlock label="Loading history" rows={1} />}
                {(auditQuery.data || []).map((row) => (
                  <div key={row.id} className="tw-audit-row">
                    <span className="tw-audit-actor">{row.actorName || "System"}</span>
                    <span className="tw-audit-action">
                      {row.action.replace(/_/g, " ")}
                      {row.from || row.to ? `: ${row.from || "—"} → ${row.to || "—"}` : ""}
                    </span>
                    <time dateTime={row.at}>{formatWhen(row.at)}</time>
                  </div>
                ))}
                {auditQuery.data?.length === 0 && (
                  <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>No staff actions yet.</p>
                )}
              </div>
            )}

            {/* ── Conversation ────────────────────────────────────────── */}
            <section aria-label="Conversation" className="tw-thread">
              {messagesQuery.isPending && <LoadingBlock label="Loading conversation" rows={3} />}
              {messagesQuery.isError && (
                <ErrorBlock
                  message="Could not load the conversation."
                  onRetry={() => messagesQuery.refetch()}
                />
              )}
              {messages.map((message) => (
                <StaffMessage key={message.id} message={message} />
              ))}
              <div ref={bottomRef} />
            </section>

            <MessageComposer
              onSend={(payload) => reply.mutateAsync(payload)}
              allowInternal={can("support:internal_note")}
              statusOptions={can("support:change_status") ? STATUSES.filter((s) => s.value !== "resolved") : null}
              submitLabel="Send reply"
              placeholder="Reply to the customer…"
            />
          </div>

          <div className="tw-side">
            {contextQuery.isPending && <LoadingBlock label="Loading customer" rows={2} />}
            {contextQuery.isError && (
              <ErrorBlock message="Could not load customer context." onRetry={() => contextQuery.refetch()} />
            )}
            <ContextPanel context={contextQuery.data} canSeeBilling={can("support:view_billing")} />
          </div>
        </div>
      </main>

      <style jsx>{`
        .tw-back {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 12.5px;
          font-weight: 700;
          color: #64748b;
          text-decoration: none;
          margin-bottom: 16px;
        }
        .tw-back:hover {
          color: #0d9e6e;
        }
        .tw-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 18px;
        }
        .tw-main {
          min-width: 0;
        }
        .tw-head {
          margin-bottom: 16px;
        }
        .tw-head-top {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 8px;
        }
        .tw-reopen {
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #d63b3b;
          background: rgba(214, 59, 59, 0.1);
          padding: 3px 8px;
          border-radius: 5px;
        }
        .tw-subject {
          font-size: 20px;
          font-weight: 800;
          line-height: 1.3;
          margin: 0 0 8px;
          color: #0f1923;
        }
        .tw-meta {
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
          font-size: 11.5px;
          color: #94a3b8;
        }
        .tw-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          gap: 10px;
          padding: 14px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          background: #fff;
          margin-bottom: 12px;
        }
        .tw-action {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 140px;
        }
        .tw-label {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: #94a3b8;
        }
        .tw-select {
          height: 36px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #fff;
          font-size: 12.5px;
          font-family: inherit;
          color: #4a5568;
          cursor: pointer;
        }
        .tw-select:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .tw-select:focus-visible {
          outline: 2px solid #0d9e6e;
          outline-offset: 1px;
        }
        .tw-claim,
        .tw-audit-toggle {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          height: 36px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #4a5568;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .tw-claim {
          border-color: #0d9e6e;
          color: #0d9e6e;
          background: rgba(13, 158, 110, 0.07);
        }
        .tw-claim:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .tw-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 12px;
        }
        .tw-tag {
          height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .tw-tag-on {
          border-color: #0d9e6e;
          background: rgba(13, 158, 110, 0.1);
          color: #0d9e6e;
        }
        .tw-tag:focus-visible {
          outline: 2px solid #0d9e6e;
          outline-offset: 1px;
        }
        .tw-resolve {
          padding: 15px;
          border-radius: 12px;
          border: 1px solid rgba(13, 158, 110, 0.35);
          background: rgba(13, 158, 110, 0.05);
          margin-bottom: 14px;
        }
        .tw-textarea {
          width: 100%;
          margin-top: 7px;
          padding: 11px 13px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          background: #fff;
          font-family: inherit;
          font-size: 13.5px;
          line-height: 1.6;
          resize: vertical;
          outline: none;
        }
        .tw-textarea:focus {
          border-color: #0d9e6e;
        }
        .tw-resolve-actions {
          display: flex;
          justify-content: flex-end;
          gap: 9px;
          margin-top: 11px;
        }
        .tw-ghost {
          height: 38px;
          padding: 0 16px;
          border-radius: 9px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #64748b;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .tw-primary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 38px;
          padding: 0 20px;
          border: none;
          border-radius: 9px;
          background: #0f1923;
          color: #22c78e;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .tw-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .tw-audit {
          padding: 14px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          background: #fff;
          margin-bottom: 14px;
        }
        .tw-audit-row {
          display: flex;
          align-items: baseline;
          gap: 9px;
          padding: 6px 0;
          border-bottom: 1px solid #f1f5f9;
          font-size: 11.5px;
          flex-wrap: wrap;
        }
        .tw-audit-actor {
          font-weight: 700;
          color: #0f1923;
        }
        .tw-audit-action {
          flex: 1;
          min-width: 0;
          color: #64748b;
        }
        .tw-audit-row time {
          color: #94a3b8;
          font-family: var(--font-jetbrains-mono);
          font-size: 10.5px;
        }
        .tw-thread {
          padding: 6px 0 16px;
        }
        .tw-side {
          min-width: 0;
        }
        @media (min-width: 1080px) {
          .tw-grid {
            grid-template-columns: minmax(0, 1fr) 320px;
            align-items: start;
          }
          .tw-side {
            position: sticky;
            top: 78px;
          }
        }
      `}</style>
    </div>
  );
}

export default function AdminSupportDetailPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f0eee9" }} />}>
      <TicketWorkspace />
    </Suspense>
  );
}
