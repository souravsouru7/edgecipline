"use client";

import { AlertCircle, Loader2, Inbox, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Small building blocks shared across every support screen.
 *
 * All colours come from the design-token custom properties in globals.css so
 * the support module inherits the app's palette rather than hardcoding a
 * second one that drifts.
 */

export const STATUS_STYLE = {
  open:            { fg: "#B8860B", bg: "rgba(184,134,11,0.12)",  label: "Open" },
  in_progress:     { fg: "#0D9E6E", bg: "rgba(13,158,110,0.12)",  label: "In Progress" },
  waiting_on_user: { fg: "#3B82F6", bg: "rgba(59,130,246,0.12)",  label: "Waiting for You" },
  pending:         { fg: "#8B5CF6", bg: "rgba(139,92,246,0.12)",  label: "Pending" },
  resolved:        { fg: "#0D9E6E", bg: "rgba(13,158,110,0.16)",  label: "Resolved" },
  closed:          { fg: "#64748B", bg: "rgba(100,116,139,0.12)", label: "Closed" },
};

export const PRIORITY_STYLE = {
  low:    { fg: "#64748B", label: "Low" },
  normal: { fg: "#3B82F6", label: "Normal" },
  high:   { fg: "#B8860B", label: "High" },
  urgent: { fg: "#D63B3B", label: "Urgent" },
};

export function StatusBadge({ status, label }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.open;
  return (
    <span
      // Screen readers announce "Status: Resolved" rather than reading a bare
      // coloured word out of context.
      role="status"
      aria-label={`Status: ${label || style.label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        background: style.bg,
        color: style.fg,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: style.fg }} />
      {label || style.label}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  const style = PRIORITY_STYLE[priority] || PRIORITY_STYLE.normal;
  return (
    <span
      aria-label={`Priority: ${style.label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 700,
        color: style.fg,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 2, background: style.fg }} />
      {style.label}
    </span>
  );
}

export function TicketCode({ code }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-jetbrains-mono)",
        fontSize: 11,
        fontWeight: 700,
        color: "var(--color-gold)",
        letterSpacing: "0.02em",
      }}
    >
      {code}
    </span>
  );
}

export function LoadingBlock({ label = "Loading", rows = 3 }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" style={{ padding: "8px 0" }}>
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {label}…
      </span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="sk-shimmer"
          style={{
            height: 64,
            borderRadius: 12,
            marginBottom: 10,
            background: "var(--color-surface-hover)",
            border: "1px solid var(--color-border-subtle)",
          }}
        />
      ))}
      <style jsx>{`
        .sk-shimmer {
          animation: sk 1.4s ease-in-out infinite;
        }
        @keyframes sk {
          0%,
          100% {
            opacity: 0.55;
          }
          50% {
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .sk-shimmer {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

export function InlineSpinner({ size = 15 }) {
  return (
    <Loader2
      size={size}
      aria-hidden="true"
      style={{ animation: "supspin 0.9s linear infinite" }}
    />
  );
}

/**
 * Error state.
 *
 * Always offers a way forward — a retry, or a route out. An error screen that
 * only says what went wrong leaves the customer stuck on the page they came to
 * for help, which is the worst place in the product to dead-end.
 */
export function ErrorBlock({ message, onRetry, action }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: 16,
        borderRadius: 12,
        background: "var(--color-error-bg)",
        border: "1px solid var(--color-error-border)",
      }}
    >
      <AlertCircle size={18} color="var(--color-error)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-dark)", lineHeight: 1.5 }}>
          {message || "Something went wrong. Please try again."}
        </div>
        {(onRetry || action) && (
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            {onRetry && (
              <button type="button" onClick={onRetry} className="sup-link-btn">
                Try again
              </button>
            )}
            {action}
          </div>
        )}
      </div>
      <style jsx>{`
        .sup-link-btn {
          background: none;
          border: none;
          padding: 0;
          font-size: 12.5;
          font-weight: 700;
          color: var(--color-error);
          cursor: pointer;
          text-decoration: underline;
          font-family: inherit;
        }
        .sup-link-btn:focus-visible {
          outline: 2px solid var(--color-error);
          outline-offset: 3px;
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "48px 24px",
        border: "1px dashed var(--color-border)",
        borderRadius: 16,
        background: "var(--color-surface)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14, color: "var(--color-text-disabled)" }}>
        {icon || <Inbox size={30} aria-hidden="true" />}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-dark)", marginBottom: 6 }}>{title}</div>
      {description && (
        <div
          style={{
            fontSize: 13.5,
            color: "var(--color-text-muted)",
            lineHeight: 1.65,
            maxWidth: 420,
            margin: "0 auto",
          }}
        >
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}

export function Pager({ pagination, onPage }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total } = pagination;

  return (
    <nav
      aria-label="Pagination"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginTop: 18,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
        Page {page} of {totalPages} · {total} total
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="sup-pg"
          onClick={() => onPage(page - 1)}
          disabled={!pagination.hasPreviousPage}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} aria-hidden="true" /> Prev
        </button>
        <button
          type="button"
          className="sup-pg"
          onClick={() => onPage(page + 1)}
          disabled={!pagination.hasNextPage}
          aria-label="Next page"
        >
          Next <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
      <style jsx>{`
        .sup-pg {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 34px;
          padding: 0 12px;
          border-radius: 8px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          color: var(--color-text-secondary);
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        .sup-pg:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .sup-pg:not(:disabled):hover {
          border-color: var(--color-primary);
          color: var(--color-primary);
        }
        .sup-pg:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
      `}</style>
    </nav>
  );
}

/**
 * Labelled form field.
 *
 * The error message is wired to the input through aria-describedby and
 * aria-invalid, so a screen reader announces the problem when focus lands on
 * the field rather than leaving it as a red line only sighted users can see.
 */
export function Field({ label, htmlFor, required, error, hint, children }) {
  const errorId = error ? `${htmlFor}-error` : undefined;
  const hintId = hint ? `${htmlFor}-hint` : undefined;

  return (
    <div style={{ marginBottom: 18 }}>
      <label
        htmlFor={htmlFor}
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
          marginBottom: 8,
        }}
      >
        {label}
        {required && (
          <span style={{ color: "var(--color-error)", marginLeft: 3 }} aria-hidden="true">
            *
          </span>
        )}
      </label>
      {hint && (
        <div id={hintId} style={{ fontSize: 12, color: "var(--color-text-disabled)", marginBottom: 8, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
      {children({ id: htmlFor, "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? "true" : undefined })}
      {error && (
        <div id={errorId} role="alert" style={{ fontSize: 12, color: "var(--color-error)", marginTop: 6, fontWeight: 600 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function formatWhen(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatExact(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}
