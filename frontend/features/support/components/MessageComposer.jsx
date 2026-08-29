"use client";

import { useRef, useState } from "react";
import { Paperclip, Send, X, Lock } from "lucide-react";
import { InlineSpinner } from "./SupportBits";

const DEFAULT_MAX_ATTACHMENTS = 5;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_BODY = 10000;

function prettyBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Reply box, shared by the customer thread and the agent console.
 *
 * Two behaviours worth calling out:
 *
 * - The idempotency key is generated ONCE per composed message and only reset
 *   after a confirmed success. A send that times out and is retried carries the
 *   same key, so the server recognises it as the same message rather than
 *   posting it twice. Resetting it on failure would defeat the whole mechanism.
 *
 * - The draft is NOT cleared until the server confirms. Clearing optimistically
 *   means a failed send silently destroys something the customer spent five
 *   minutes writing, which is the worst possible failure on a support screen.
 */
export default function MessageComposer({
  onSend,
  disabled = false,
  disabledReason,
  placeholder = "Write your reply…",
  submitLabel = "Send",
  maxAttachments = DEFAULT_MAX_ATTACHMENTS,
  maxBytes = DEFAULT_MAX_BYTES,
  // Staff-only affordances.
  allowInternal = false,
  statusOptions = null,
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState([]);
  const [internal, setInternal] = useState(false);
  const [nextStatus, setNextStatus] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const fileInput = useRef(null);
  const keyRef = useRef(null);

  const ensureKey = () => {
    if (!keyRef.current) {
      keyRef.current =
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return keyRef.current;
  };

  const addFiles = (selected) => {
    setError("");
    const incoming = Array.from(selected || []);
    const room = maxAttachments - files.length;

    if (incoming.length > room) {
      setError(`You can attach up to ${maxAttachments} files.`);
    }

    const accepted = [];
    for (const file of incoming.slice(0, Math.max(room, 0))) {
      // Client-side checks are a courtesy so the customer finds out now rather
      // than after a slow upload. The server re-validates type, magic bytes,
      // decodability and size regardless — none of this is trusted.
      if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
        setError("Only JPG, PNG and WEBP images can be attached.");
        continue;
      }
      if (file.size > maxBytes) {
        setError(`"${file.name}" is larger than ${prettyBytes(maxBytes)}.`);
        continue;
      }
      accepted.push(file);
    }

    if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (sending || disabled) return;

    const trimmed = body.trim();
    if (!trimmed) {
      setError("Please write a message first.");
      return;
    }
    if (trimmed.length > MAX_BODY) {
      setError(`That message is too long — the limit is ${MAX_BODY.toLocaleString()} characters.`);
      return;
    }

    setSending(true);
    setError("");

    try {
      await onSend({
        body: trimmed,
        attachments: files,
        clientMessageId: ensureKey(),
        ...(allowInternal ? { internal } : {}),
        ...(nextStatus ? { nextStatus } : {}),
      });

      // Only now is it safe to discard the draft and mint a fresh key.
      setBody("");
      setFiles([]);
      setInternal(false);
      setNextStatus("");
      keyRef.current = null;
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "We couldn't send that. Your message is still here — please try again."
      );
    } finally {
      setSending(false);
    }
  };

  if (disabled) {
    return (
      <div className="mc-disabled" role="status">
        <Lock size={15} aria-hidden="true" />
        <span>{disabledReason || "This conversation is closed."}</span>
        <style jsx>{`
          .mc-disabled {
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 15px 18px;
            border-radius: 13px;
            border: 1px dashed var(--color-border);
            background: var(--color-surface-hover);
            color: var(--color-text-muted);
            font-size: 13px;
            line-height: 1.55;
          }
        `}</style>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`mc-wrap ${internal ? "mc-internal" : ""}`}>
      {allowInternal && (
        <div className="mc-modes" role="radiogroup" aria-label="Message visibility">
          <button
            type="button"
            role="radio"
            aria-checked={!internal}
            onClick={() => setInternal(false)}
            className={`mc-mode ${!internal ? "mc-mode-on" : ""}`}
          >
            Reply to customer
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={internal}
            onClick={() => setInternal(true)}
            className={`mc-mode ${internal ? "mc-mode-on mc-mode-note" : ""}`}
          >
            <Lock size={12} aria-hidden="true" /> Internal note
          </button>
        </div>
      )}

      {internal && (
        <p className="mc-notice" role="status">
          Only support staff can see internal notes. The customer is not notified.
        </p>
      )}

      <label htmlFor="mc-body" className="mc-sr">
        {internal ? "Internal note" : "Your message"}
      </label>
      <textarea
        id="mc-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={internal ? "Note for the team…" : placeholder}
        rows={4}
        maxLength={MAX_BODY}
        className="mc-textarea"
        aria-describedby={error ? "mc-error" : undefined}
        aria-invalid={error ? "true" : undefined}
      />

      {files.length > 0 && (
        <ul className="mc-files" aria-label="Attachments">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="mc-file">
              <span className="mc-file-name">{file.name}</span>
              <span className="mc-file-size">{prettyBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                aria-label={`Remove ${file.name}`}
                className="mc-file-x"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div id="mc-error" role="alert" className="mc-error">
          {error}
        </div>
      )}

      <div className="mc-actions">
        <div className="mc-left">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => addFiles(e.target.files)}
            className="mc-sr-input"
            id="mc-files"
          />
          <label
            htmlFor="mc-files"
            className="mc-attach"
            aria-disabled={files.length >= maxAttachments}
          >
            <Paperclip size={14} aria-hidden="true" />
            Attach
            {files.length > 0 && <span className="mc-count">{files.length}</span>}
          </label>

          {statusOptions && (
            <>
              <label htmlFor="mc-status" className="mc-sr">
                Set status after sending
              </label>
              <select
                id="mc-status"
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value)}
                className="mc-select"
              >
                <option value="">Keep current status</option>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    Then set: {option.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <button type="submit" disabled={sending || !body.trim()} className="mc-send">
          {sending ? <InlineSpinner /> : <Send size={14} aria-hidden="true" />}
          {sending ? "Sending…" : internal ? "Add note" : submitLabel}
        </button>
      </div>

      <style jsx>{`
        .mc-wrap {
          padding: 16px;
          border-radius: 14px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
        }
        .mc-internal {
          border-color: rgba(184, 134, 11, 0.45);
          background: rgba(184, 134, 11, 0.04);
        }
        .mc-modes {
          display: flex;
          gap: 7px;
          margin-bottom: 12px;
          flex-wrap: wrap;
        }
        .mc-mode {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 32px;
          padding: 0 13px;
          border-radius: 8px;
          border: 1px solid var(--color-border);
          background: var(--background);
          color: var(--color-text-muted);
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .mc-mode-on {
          border-color: var(--color-primary);
          background: var(--color-primary-bg);
          color: var(--color-primary);
        }
        .mc-mode-note {
          border-color: var(--color-gold);
          background: rgba(184, 134, 11, 0.1);
          color: var(--color-gold);
        }
        .mc-mode:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .mc-notice {
          margin: 0 0 10px;
          font-size: 12px;
          font-weight: 600;
          color: var(--color-gold);
        }
        .mc-textarea {
          width: 100%;
          padding: 13px 15px;
          border-radius: 11px;
          border: 1px solid var(--color-border);
          background: var(--background);
          font-family: inherit;
          font-size: 14.5px;
          line-height: 1.65;
          color: var(--color-dark);
          resize: vertical;
          outline: none;
          min-height: 96px;
        }
        .mc-textarea:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px var(--color-primary-bg);
        }
        .mc-files {
          list-style: none;
          margin: 11px 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .mc-file {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 8px 11px;
          border-radius: 9px;
          background: var(--color-surface-hover);
          border: 1px solid var(--color-border-subtle);
          font-size: 12.5px;
        }
        .mc-file-name {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--color-text-secondary);
          font-weight: 600;
        }
        .mc-file-size {
          color: var(--color-text-disabled);
          font-size: 11.5px;
          flex-shrink: 0;
        }
        .mc-file-x {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: var(--color-text-muted);
          cursor: pointer;
          flex-shrink: 0;
        }
        .mc-file-x:hover {
          background: var(--color-error-bg);
          color: var(--color-error);
        }
        .mc-file-x:focus-visible {
          outline: 2px solid var(--color-error);
          outline-offset: 1px;
        }
        .mc-error {
          margin-top: 10px;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--color-error);
          line-height: 1.5;
        }
        .mc-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 13px;
          flex-wrap: wrap;
        }
        .mc-left {
          display: flex;
          align-items: center;
          gap: 9px;
          flex-wrap: wrap;
        }
        .mc-sr,
        .mc-sr-input {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
        .mc-attach {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          height: 38px;
          padding: 0 14px;
          border-radius: 9px;
          border: 1px solid var(--color-border);
          background: var(--background);
          color: var(--color-text-muted);
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
        }
        .mc-attach:hover {
          border-color: var(--color-primary);
          color: var(--color-primary);
        }
        .mc-attach[aria-disabled="true"] {
          opacity: 0.5;
          cursor: not-allowed;
        }
        /* Keyboard users tab to the hidden input, so the visible label is what
           has to show the focus ring. */
        .mc-sr-input:focus-visible + .mc-attach {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .mc-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 17px;
          height: 17px;
          padding: 0 4px;
          border-radius: 9px;
          background: var(--color-primary);
          color: #fff;
          font-size: 10px;
          font-weight: 800;
        }
        .mc-select {
          height: 38px;
          padding: 0 10px;
          border-radius: 9px;
          border: 1px solid var(--color-border);
          background: var(--background);
          color: var(--color-text-secondary);
          font-size: 12.5px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          max-width: 210px;
        }
        .mc-select:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .mc-send {
          display: inline-flex;
          align-items: center;
          gap: 8px;
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
          letter-spacing: 0.01em;
        }
        .mc-send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .mc-send:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 3px;
        }
        @media (max-width: 520px) {
          .mc-actions {
            flex-direction: column;
            align-items: stretch;
          }
          .mc-send {
            width: 100%;
            justify-content: center;
          }
          .mc-select {
            max-width: none;
            flex: 1;
          }
        }
      `}</style>
    </form>
  );
}
