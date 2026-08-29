"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, RotateCcw, Star, Paperclip, Info } from "lucide-react";
import SupportShell from "@/features/support/components/SupportShell";
import SignInRequired from "@/features/support/components/SignInRequired";
import ContactChannels from "@/features/support/components/ContactChannels";
import MessageComposer from "@/features/support/components/MessageComposer";
import {
  StatusBadge,
  TicketCode,
  LoadingBlock,
  ErrorBlock,
  EmptyState,
  Pager,
  InlineSpinner,
  formatWhen,
  formatExact,
} from "@/features/support/components/SupportBits";
import {
  useMyTicket,
  useMyTicketMessages,
  useReplyToTicket,
  useReopenTicket,
  useRateTicket,
  useSupportConfig,
  useIsSignedIn,
} from "@/features/support/hooks/useSupport";
import { attachmentUrl } from "@/features/support/api/supportApi";

/**
 * One conversation, from the customer's side.
 *
 * The thread only ever contains public messages — the server filters internal
 * notes out in the query, so nothing rendered here could be staff-only even if
 * this component tried.
 */

function Attachments({ items }) {
  if (!items?.length) return null;

  return (
    <div className="at-wrap">
      {items.map((file) => (
        <a
          key={`${file.messageId}-${file.index}`}
          // Points at our API, which re-authorises on every fetch and then
          // redirects to a short-lived signed URL. There is no durable
          // Cloudinary link anywhere in this payload.
          href={attachmentUrl(file.messageId, file.index)}
          target="_blank"
          rel="noopener noreferrer"
          className="at-chip"
        >
          <Paperclip size={12} aria-hidden="true" />
          <span className="at-name">{file.originalName}</span>
        </a>
      ))}
      <style jsx>{`
        .at-wrap {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 10px;
        }
        .at-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          max-width: 220px;
          padding: 6px 11px;
          border-radius: 8px;
          border: 1px solid var(--color-border);
          background: var(--background);
          color: var(--color-text-secondary);
          font-size: 11.5px;
          font-weight: 600;
          text-decoration: none;
        }
        .at-chip:hover {
          border-color: var(--color-primary);
          color: var(--color-primary);
        }
        .at-chip:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .at-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}

function Message({ message }) {
  if (message.type === "system_event") {
    return (
      <div className="ms-system">
        <Info size={12} aria-hidden="true" />
        <span>{message.body}</span>
        <time dateTime={message.createdAt}>{formatWhen(message.createdAt)}</time>
        <style jsx>{`
          .ms-system {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            flex-wrap: wrap;
            margin: 14px 0;
            font-size: 11.5px;
            color: var(--color-text-disabled);
          }
          time {
            font-family: var(--font-jetbrains-mono);
            font-size: 10.5px;
          }
        `}</style>
      </div>
    );
  }

  const mine = message.author === "you";

  return (
    <div className={`ms-row ${mine ? "ms-mine" : ""}`}>
      <div className="ms-bubble">
        <div className="ms-head">
          {/* Agents are shown as "Support", never by name or email — the
              customer's counterparty is the team, and an individual agent's
              identity is staff data. */}
          <span className="ms-who">{mine ? "You" : "Support"}</span>
          <time dateTime={message.createdAt} title={formatExact(message.createdAt)}>
            {formatWhen(message.createdAt)}
          </time>
        </div>
        <div className="ms-body">{message.body}</div>
        <Attachments items={message.attachments} />
      </div>

      <style jsx>{`
        .ms-row {
          display: flex;
          margin-bottom: 13px;
        }
        .ms-mine {
          justify-content: flex-end;
        }
        .ms-bubble {
          max-width: min(84%, 560px);
          padding: 13px 16px;
          border-radius: 14px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
        }
        .ms-mine .ms-bubble {
          background: var(--color-primary-bg);
          border-color: rgba(13, 158, 110, 0.25);
        }
        .ms-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 6px;
        }
        .ms-who {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--color-primary);
        }
        time {
          font-size: 10.5px;
          color: var(--color-text-disabled);
          font-family: var(--font-jetbrains-mono);
          white-space: nowrap;
        }
        .ms-body {
          font-size: 14.5px;
          line-height: 1.68;
          color: var(--color-text-secondary);
          /* Preserves the customer's paragraph breaks without ever
             interpreting their text as markup. */
          white-space: pre-wrap;
          word-break: break-word;
        }
      `}</style>
    </div>
  );
}

function Rating({ ticketId, onDone }) {
  const [hovered, setHovered] = useState(0);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const rate = useRateTicket(ticketId);

  const submit = async () => {
    if (!rating) return;
    try {
      await rate.mutateAsync({ rating, comment });
      onDone?.();
    } catch {
      /* the mutation's error state drives the message below */
    }
  };

  return (
    <div className="rt-wrap">
      <div className="rt-q">How did we do?</div>
      <div className="rt-stars" role="radiogroup" aria-label="Rate this support experience">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} out of 5`}
            onClick={() => setRating(value)}
            onMouseEnter={() => setHovered(value)}
            onMouseLeave={() => setHovered(0)}
            className="rt-star"
          >
            <Star
              size={26}
              aria-hidden="true"
              fill={(hovered || rating) >= value ? "#B8860B" : "none"}
              color={(hovered || rating) >= value ? "#B8860B" : "var(--color-border)"}
            />
          </button>
        ))}
      </div>

      {rating > 0 && (
        <>
          <label htmlFor="rt-comment" className="rt-label">
            Anything you would like to add? (optional)
          </label>
          <textarea
            id="rt-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={1000}
            className="rt-textarea"
          />
          {rate.isError && (
            <div style={{ marginTop: 10 }}>
              <ErrorBlock message={rate.error?.data?.message || "We couldn't save that rating."} />
            </div>
          )}
          <button type="button" onClick={submit} disabled={rate.isPending} className="rt-send">
            {rate.isPending ? <InlineSpinner /> : null}
            {rate.isPending ? "Sending…" : "Submit rating"}
          </button>
        </>
      )}

      <style jsx>{`
        .rt-wrap {
          padding: 18px;
          border-radius: 14px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          margin-bottom: 16px;
        }
        .rt-q {
          font-size: 14px;
          font-weight: 700;
          color: var(--color-dark);
          margin-bottom: 11px;
        }
        .rt-stars {
          display: flex;
          gap: 5px;
          margin-bottom: 4px;
        }
        .rt-star {
          background: none;
          border: none;
          padding: 3px;
          cursor: pointer;
          line-height: 0;
          border-radius: 6px;
        }
        .rt-star:focus-visible {
          outline: 2px solid var(--color-gold);
          outline-offset: 1px;
        }
        .rt-label {
          display: block;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--color-text-muted);
          margin: 14px 0 8px;
        }
        .rt-textarea {
          width: 100%;
          padding: 11px 13px;
          border-radius: 10px;
          border: 1px solid var(--color-border);
          background: var(--background);
          font-family: inherit;
          font-size: 14px;
          line-height: 1.6;
          resize: vertical;
          outline: none;
          color: var(--color-dark);
        }
        .rt-textarea:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px var(--color-primary-bg);
        }
        .rt-send {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          height: 42px;
          padding: 0 22px;
          border: none;
          border-radius: 10px;
          background: var(--color-dark);
          color: var(--color-primary-light);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .rt-send:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .rt-send:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 3px;
        }
      `}</style>
    </div>
  );
}

function TicketDetail() {
  const params = useSearchParams();
  const id = params.get("id");
  const justCreated = params.get("created") === "1";

  const signedIn = useIsSignedIn();
  const [page, setPage] = useState(1);
  const [rated, setRated] = useState(false);
  const bottomRef = useRef(null);

  const { data: config } = useSupportConfig();
  const ticketQuery = useMyTicket(signedIn ? id : null);
  const messagesQuery = useMyTicketMessages(signedIn ? id : null, { page });
  const reply = useReplyToTicket(id);
  const reopen = useReopenTicket(id);

  const ticket = ticketQuery.data;
  const messages = messagesQuery.data?.items || [];
  const pagination = messagesQuery.data?.pagination;

  // Only auto-scroll on the last page. Jumping to the bottom while someone is
  // reading page 1 of a long thread would yank them away from what they were
  // looking at.
  useEffect(() => {
    if (!pagination || pagination.hasNextPage) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, pagination]);

  if (!signedIn || ticketQuery.error?.status === 401) {
    return <SignInRequired next={`/support/tickets/detail?id=${id || ""}`} config={config} title="Ticket" />;
  }

  if (!id) {
    return (
      <SupportShell title="Ticket" backHref="/support/tickets">
        <EmptyState
          title="No ticket selected"
          description="That link is missing a ticket reference."
          action={
            <Link href="/support/tickets" className="td-cta">
              Back to your tickets
            </Link>
          }
        />
      </SupportShell>
    );
  }

  if (ticketQuery.isPending) {
    return (
      <SupportShell title="Ticket" backHref="/support/tickets">
        <LoadingBlock label="Loading ticket" rows={4} />
      </SupportShell>
    );
  }

  if (ticketQuery.isError) {
    // A ticket belonging to someone else returns 404, exactly like one that
    // does not exist — so this copy must cover both without implying which.
    const notFound = ticketQuery.error?.status === 404;
    return (
      <SupportShell title={notFound ? "Ticket not found" : "Couldn't load ticket"} backHref="/support/tickets">
        {notFound ? (
          <EmptyState
            title="We couldn't find that ticket"
            description="It may have been removed, or the link may be wrong."
            action={
              <Link href="/support/tickets" className="td-cta">
                Back to your tickets
              </Link>
            }
          />
        ) : (
          <ErrorBlock message="We couldn't load this ticket." onRetry={() => ticketQuery.refetch()} />
        )}
        <style jsx>{`
          :global(.td-cta) {
            display: inline-block;
            padding: 11px 22px;
            border-radius: 10px;
            background: var(--color-dark);
            color: var(--color-primary-light);
            font-size: 13px;
            font-weight: 700;
            text-decoration: none;
          }
        `}</style>
      </SupportShell>
    );
  }

  const closed = ticket.status === "closed";
  const showRating = ticket.canRate && !rated;

  return (
    <SupportShell backHref="/support/tickets" maxWidth={780}>
      {justCreated && (
        <div className="td-created" role="status">
          <CheckCircle2 size={17} aria-hidden="true" color="var(--color-primary)" />
          <span>
            Ticket created. We&apos;ve emailed you a confirmation and the team has been notified.
          </span>
        </div>
      )}

      <header className="td-head">
        <div className="td-head-top">
          <TicketCode code={ticket.ticketCode} />
          <StatusBadge status={ticket.status} label={ticket.statusLabel} />
        </div>
        <h1 className="td-subject">{ticket.subject}</h1>
        <div className="td-meta">
          <span>{ticket.categoryLabel}</span>
          <span aria-hidden="true">·</span>
          <span>Opened {formatWhen(ticket.createdAt)}</span>
          {ticket.isAssigned && (
            <>
              <span aria-hidden="true">·</span>
              <span className="td-assigned">An agent is on this</span>
            </>
          )}
        </div>
      </header>

      {ticket.status === "resolved" && ticket.resolution && (
        <div className="td-resolution">
          <div className="td-resolution-head">
            <CheckCircle2 size={15} aria-hidden="true" />
            Resolution
          </div>
          <p>{ticket.resolution}</p>
        </div>
      )}

      <section aria-label="Conversation" className="td-thread">
        {messagesQuery.isPending && <LoadingBlock label="Loading conversation" rows={2} />}

        {messagesQuery.isError && (
          <ErrorBlock
            message="We couldn't load the conversation."
            onRetry={() => messagesQuery.refetch()}
          />
        )}

        {pagination?.hasPreviousPage && (
          <div className="td-pager-top">
            <Pager pagination={pagination} onPage={setPage} />
          </div>
        )}

        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}

        <div ref={bottomRef} />

        {pagination?.hasNextPage && <Pager pagination={pagination} onPage={setPage} />}
      </section>

      {showRating && <Rating ticketId={id} onDone={() => setRated(true)} />}

      {ticket.canReopen && (
        <div className="td-reopen">
          <span>Still not right?</span>
          <button
            type="button"
            onClick={() => reopen.mutate()}
            disabled={reopen.isPending}
            className="td-reopen-btn"
          >
            {reopen.isPending ? <InlineSpinner /> : <RotateCcw size={14} aria-hidden="true" />}
            {reopen.isPending ? "Reopening…" : "Reopen this ticket"}
          </button>
        </div>
      )}

      <MessageComposer
        onSend={(payload) => reply.mutateAsync(payload)}
        disabled={closed}
        disabledReason="This ticket is closed. Open a new one and we'll pick it up from there."
        maxAttachments={config?.limits?.maxAttachments || 5}
        maxBytes={config?.limits?.maxAttachmentBytes || 5 * 1024 * 1024}
        placeholder="Add more detail, or reply to the team…"
      />

      {closed && (
        <div style={{ marginTop: 20 }}>
          <Link href="/support/tickets/new" className="td-cta">
            Open a new ticket
          </Link>
        </div>
      )}

      <section className="td-other">
        <h2 className="td-h2">Prefer to talk?</h2>
        <ContactChannels
          config={config}
          categoryLabel={ticket.categoryLabel}
          ticketCode={ticket.ticketCode}
          ticketsEnabled={false}
          compact
        />
      </section>

      <style jsx>{`
        .td-created {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 14px 16px;
          border-radius: 12px;
          background: var(--color-primary-bg);
          border: 1px solid rgba(13, 158, 110, 0.28);
          font-size: 13.5px;
          line-height: 1.55;
          color: var(--color-dark);
          margin-bottom: 20px;
        }
        .td-head {
          margin-bottom: 20px;
        }
        .td-head-top {
          display: flex;
          align-items: center;
          gap: 11px;
          margin-bottom: 9px;
          flex-wrap: wrap;
        }
        .td-subject {
          font-size: 21px;
          font-weight: 800;
          line-height: 1.28;
          letter-spacing: -0.012em;
          margin: 0 0 9px;
          color: var(--color-dark);
        }
        .td-meta {
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
          font-size: 12px;
          color: var(--color-text-disabled);
        }
        .td-assigned {
          color: var(--color-primary);
          font-weight: 600;
        }
        .td-resolution {
          padding: 15px 17px;
          border-radius: 13px;
          background: var(--color-primary-bg);
          border: 1px solid rgba(13, 158, 110, 0.25);
          margin-bottom: 20px;
        }
        .td-resolution-head {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--color-primary);
          margin-bottom: 8px;
        }
        .td-resolution p {
          margin: 0;
          font-size: 14px;
          line-height: 1.65;
          color: var(--color-text-secondary);
          white-space: pre-wrap;
        }
        .td-thread {
          padding: 4px 0 18px;
        }
        .td-pager-top {
          margin-bottom: 14px;
        }
        .td-reopen {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          padding: 14px 17px;
          border-radius: 13px;
          border: 1px dashed var(--color-border);
          background: var(--color-surface);
          margin-bottom: 16px;
          font-size: 13.5px;
          color: var(--color-text-muted);
        }
        .td-reopen-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 40px;
          padding: 0 18px;
          border-radius: 10px;
          border: 1px solid var(--color-primary);
          background: var(--color-primary-bg);
          color: var(--color-primary);
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .td-reopen-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .td-reopen-btn:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .td-other {
          margin-top: 34px;
          padding-top: 26px;
          border-top: 1px solid var(--color-border);
        }
        .td-h2 {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--color-text-muted);
          margin: 0 0 13px;
        }
        :global(.td-cta) {
          display: inline-block;
          padding: 12px 24px;
          border-radius: 10px;
          background: var(--color-dark);
          color: var(--color-primary-light);
          font-size: 13px;
          font-weight: 700;
          text-decoration: none;
        }
        @media (min-width: 720px) {
          .td-subject {
            font-size: 25px;
          }
        }
      `}</style>
    </SupportShell>
  );
}

export default function TicketDetailPage() {
  return (
    <Suspense
      fallback={
        <SupportShell title="Ticket" backHref="/support/tickets">
          <LoadingBlock label="Loading ticket" rows={4} />
        </SupportShell>
      }
    >
      <TicketDetail />
    </Suspense>
  );
}
