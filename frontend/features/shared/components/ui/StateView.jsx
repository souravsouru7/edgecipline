"use client";

import { AlertTriangle, Inbox } from "lucide-react";
import Button from "./Button";

/**
 * Empty state: tells the user what will appear here and the one action
 * that makes it appear.
 */
export function EmptyState({ icon, title, body, action }) {
  return (
    <div className="ec-state">
      <span className="ec-state__icon" aria-hidden="true">{icon ?? <Inbox size={22} />}</span>
      <h3 className="ec-state__title">{title}</h3>
      {body && <p className="ec-state__body">{body}</p>}
      {action && <div className="ec-state__actions">{action}</div>}
    </div>
  );
}

/** Error state with a retry. Never a dead end. */
export function ErrorState({
  title = "Something went wrong",
  body = "We couldn't load this. Check your connection and try again.",
  onRetry,
  action,
}) {
  return (
    <div className="ec-state ec-state--error" role="alert">
      <span className="ec-state__icon" aria-hidden="true"><AlertTriangle size={22} /></span>
      <h3 className="ec-state__title">{title}</h3>
      <p className="ec-state__body">{body}</p>
      {(onRetry || action) && (
        <div className="ec-state__actions">
          {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
          {action}
        </div>
      )}
    </div>
  );
}

/** Token-based shimmer block for migrated screens. */
export function Placeholder({ width = "100%", height = 16, radius, style }) {
  return <span className="ec-skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}
