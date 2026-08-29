"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, FileText, Paperclip, X, ChevronRight } from "lucide-react";
import SupportShell from "@/features/support/components/SupportShell";
import SignInRequired from "@/features/support/components/SignInRequired";
import {
  Field,
  LoadingBlock,
  ErrorBlock,
  StatusBadge,
  TicketCode,
  InlineSpinner,
  formatWhen,
} from "@/features/support/components/SupportBits";
import {
  useSupportConfig,
  useCreateTicket,
  useDuplicateCandidates,
  useArticleSuggestions,
  useIdempotencyKey,
  useIsSignedIn,
  useSessionDraft,
} from "@/features/support/hooks/useSupport";

const MAX_FILE_FALLBACK = 5 * 1024 * 1024;
const DRAFT_KEY = "edgecipline:support-draft";

function detectPlatform() {
  try {
    if (typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.()) {
      return window.Capacitor.getPlatform?.() === "ios" ? "ios" : "android";
    }
  } catch {
    /* fall through to web */
  }
  return "web";
}

function prettyBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function NewTicketForm() {
  const router = useRouter();
  const params = useSearchParams();

  const signedIn = useIsSignedIn();
  const [category, setCategory] = useState(params.get("category") || "");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [dismissedDuplicates, setDismissedDuplicates] = useState(false);

  // Held across a submit failure AND across an accidental navigation, so a
  // customer who spent five minutes describing a billing problem never loses
  // it. Cleared only once the ticket is genuinely created.
  const [clientRequestId, resetRequestId] = useIdempotencyKey();

  // Draft restore.
  //
  // sessionStorage is invisible to a static prerender, so the draft can only be
  // read on the client. Reading it in a mount effect would work, but it means
  // rendering an empty form and then replacing it — a visible flash on the one
  // screen where the customer has already typed something. Instead the draft
  // arrives via a client/server snapshot and is applied DURING render, which is
  // React's documented pattern for adjusting state when an input changes.
  const savedDraft = useSessionDraft(DRAFT_KEY);
  const [draftApplied, setDraftApplied] = useState(false);

  if (savedDraft && !draftApplied) {
    setDraftApplied(true);
    // `||` throughout: a category passed in the URL, or anything the customer
    // has already typed, outranks the stored draft.
    if (savedDraft.category) setCategory((c) => c || savedDraft.category);
    if (savedDraft.subject) setSubject((s) => s || savedDraft.subject);
    if (savedDraft.description) setDescription((d) => d || savedDraft.description);
  }

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ category, subject, description }));
    } catch {
      /* private mode — the draft is a convenience, not a requirement */
    }
  }, [category, subject, description]);

  const { data: config } = useSupportConfig();
  const createTicket = useCreateTicket();
  const duplicates = useDuplicateCandidates(category);
  const suggestions = useArticleSuggestions({ category, subject });

  // Memoised on the config object: a fresh `[]` each render would invalidate
  // the useMemo below on every render.
  const categories = useMemo(() => config?.categories || [], [config]);
  const maxAttachments = config?.limits?.maxAttachments || 5;
  const maxBytes = config?.limits?.maxAttachmentBytes || MAX_FILE_FALLBACK;

  const selectedCategory = useMemo(
    () => categories.find((c) => c.value === category),
    [categories, category]
  );

  const duplicateList = duplicates.data || [];
  const suggestionList = suggestions.data || [];

  const addFiles = (selected) => {
    const incoming = Array.from(selected || []);
    const room = maxAttachments - files.length;
    const accepted = [];
    let message = "";

    for (const file of incoming.slice(0, Math.max(room, 0))) {
      if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
        message = "Only JPG, PNG and WEBP images can be attached.";
        continue;
      }
      if (file.size > maxBytes) {
        message = `"${file.name}" is larger than ${prettyBytes(maxBytes)}.`;
        continue;
      }
      accepted.push(file);
    }

    if (incoming.length > room) message = `You can attach up to ${maxAttachments} files.`;
    setErrors((prev) => ({ ...prev, attachments: message }));
    if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
  };

  const validate = () => {
    const next = {};
    if (!category) next.category = "Please choose what this is about.";
    if (subject.trim().length < 5) next.subject = "Please give a subject of at least 5 characters.";
    if (subject.trim().length > 200) next.subject = "Subject is too long (200 characters max).";
    if (!description.trim()) next.description = "Please describe the problem.";
    setErrors((prev) => ({ ...prev, ...next, attachments: prev.attachments }));
    return Object.keys(next).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitError("");
    if (!validate()) {
      // Move focus to the first problem so a keyboard or screen-reader user is
      // not left guessing why nothing happened.
      const firstError = document.querySelector('[aria-invalid="true"]');
      firstError?.focus();
      return;
    }

    try {
      const ticket = await createTicket.mutateAsync({
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
        attachments: files,
        clientRequestId,
        platform: detectPlatform(),
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION || "",
      });

      resetRequestId();
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* nothing to clean up */
      }
      router.replace(`/support/tickets/detail?id=${ticket.id}&created=1`);
    } catch (err) {
      setSubmitError(
        err?.data?.message ||
          err?.message ||
          "We couldn't create that ticket. Nothing was lost — please try again."
      );
    }
  };

  if (!signedIn) {
    return <SignInRequired next="/support/tickets/new" config={config} title="New support ticket" />;
  }

  if (config && config.ticketsEnabled === false) {
    return (
      <SupportShell title="New ticket" backHref="/support">
        <ErrorBlock
          message="Ticket creation is paused right now. WhatsApp and email are working normally — please use one of those and we'll pick it up straight away."
          action={
            <Link href="/support" style={{ fontWeight: 700, color: "var(--color-error)" }}>
              Back to contact options
            </Link>
          }
        />
      </SupportShell>
    );
  }

  return (
    <SupportShell title="New support ticket" backHref="/support/tickets" maxWidth={760}>
      <form onSubmit={submit} noValidate>
        <Field
          label="What is this about?"
          htmlFor="nt-category"
          required
          error={errors.category}
        >
          {(props) => (
            <div className="nt-cats" role="radiogroup" aria-label="Category">
              {categories.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  role="radio"
                  aria-checked={category === cat.value}
                  onClick={() => {
                    setCategory(cat.value);
                    setDismissedDuplicates(false);
                    setErrors((prev) => ({ ...prev, category: "" }));
                  }}
                  className={`nt-cat ${category === cat.value ? "nt-cat-on" : ""}`}
                  {...(cat.value === categories[0]?.value ? { id: props.id } : {})}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}
        </Field>

        {/* Duplicate guard. Shown BEFORE the customer writes the whole thing
            again — the point is to send them to the existing conversation, not
            to reject the submission afterwards. Nothing is merged
            automatically; the choice stays theirs. */}
        {category && duplicateList.length > 0 && !dismissedDuplicates && (
          <div className="nt-dupe" role="status">
            <div className="nt-dupe-head">
              <AlertTriangle size={16} aria-hidden="true" color="var(--color-gold)" />
              <span>You already have an open ticket about this</span>
              <button
                type="button"
                onClick={() => setDismissedDuplicates(true)}
                aria-label="Dismiss"
                className="nt-dupe-x"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <p className="nt-dupe-note">
              Replying on the existing ticket keeps everything in one place and usually gets a
              faster answer.
            </p>
            {duplicateList.map((dupe) => (
              <Link key={dupe.id} href={`/support/tickets/detail?id=${dupe.id}`} className="nt-dupe-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 9, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                    <TicketCode code={dupe.ticketCode} />
                    <StatusBadge status={dupe.status} label={dupe.statusLabel} />
                  </div>
                  <div className="nt-dupe-subject">{dupe.subject}</div>
                  <div className="nt-dupe-when">Updated {formatWhen(dupe.lastActivityAt)}</div>
                </div>
                <ChevronRight size={15} aria-hidden="true" style={{ color: "var(--color-text-disabled)" }} />
              </Link>
            ))}
          </div>
        )}

        <Field label="Subject" htmlFor="nt-subject" required error={errors.subject}>
          {(props) => (
            <input
              {...props}
              type="text"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setErrors((prev) => ({ ...prev, subject: "" }));
              }}
              maxLength={200}
              placeholder="A one-line summary"
              className="nt-input"
            />
          )}
        </Field>

        {/* Deflection. If an article answers the question, the best outcome is
            that this ticket is never submitted. */}
        {suggestionList.length > 0 && (
          <div className="nt-suggest">
            <div className="nt-suggest-head">This might already answer it</div>
            {suggestionList.map((article) => (
              <Link
                key={article.slug}
                href={`/support/article?slug=${encodeURIComponent(article.slug)}`}
                className="nt-suggest-row"
              >
                <FileText size={14} aria-hidden="true" style={{ color: "var(--color-primary)", flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>{article.title}</span>
                <ChevronRight size={14} aria-hidden="true" style={{ color: "var(--color-text-disabled)", flexShrink: 0 }} />
              </Link>
            ))}
          </div>
        )}

        <Field
          label="What's happening?"
          htmlFor="nt-description"
          required
          error={errors.description}
          hint="The more detail the better — what you were doing, what you expected, and what happened instead."
        >
          {(props) => (
            <textarea
              {...props}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setErrors((prev) => ({ ...prev, description: "" }));
              }}
              rows={7}
              maxLength={10000}
              placeholder="Describe the problem…"
              className="nt-textarea"
            />
          )}
        </Field>

        <Field
          label="How urgent is it?"
          htmlFor="nt-priority"
          hint={
            selectedCategory && ["payments", "subscription_billing"].includes(selectedCategory.value)
              ? "Billing and payment tickets are always treated as high priority."
              : undefined
          }
        >
          {(props) => (
            <div className="nt-prio" role="radiogroup" aria-label="Priority">
              {[
                { value: "low", label: "Low", desc: "No rush" },
                { value: "normal", label: "Normal", desc: "Standard" },
                { value: "high", label: "High", desc: "Blocking me" },
              ].map((option, i) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={priority === option.value}
                  onClick={() => setPriority(option.value)}
                  className={`nt-prio-btn ${priority === option.value ? "nt-prio-on" : ""}`}
                  {...(i === 0 ? { id: props.id } : {})}
                >
                  <span className="nt-prio-label">{option.label}</span>
                  <span className="nt-prio-desc">{option.desc}</span>
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field
          label="Screenshots"
          htmlFor="nt-files"
          error={errors.attachments}
          hint={`Optional. Up to ${maxAttachments} images, ${prettyBytes(maxBytes)} each. JPG, PNG or WEBP.`}
        >
          {(props) => (
            <>
              <input
                {...props}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
                className="nt-file-input"
              />
              <label htmlFor="nt-files" className="nt-file-label">
                <Paperclip size={15} aria-hidden="true" />
                Choose images
              </label>

              {files.length > 0 && (
                <ul className="nt-files">
                  {files.map((file, i) => (
                    <li key={`${file.name}-${i}`} className="nt-file">
                      <span className="nt-file-name">{file.name}</span>
                      <span className="nt-file-size">{prettyBytes(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, index) => index !== i))}
                        aria-label={`Remove ${file.name}`}
                        className="nt-file-x"
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Field>

        {submitError && (
          <div style={{ marginBottom: 16 }}>
            <ErrorBlock message={submitError} />
          </div>
        )}

        <div className="nt-actions">
          <Link href="/support/tickets" className="nt-cancel">
            Cancel
          </Link>
          <button type="submit" disabled={createTicket.isPending} className="nt-submit">
            {createTicket.isPending ? <InlineSpinner /> : null}
            {createTicket.isPending ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </form>

      <style jsx>{`
        .nt-cats {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 8px;
        }
        .nt-cat {
          padding: 11px 13px;
          border-radius: 10px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          color: var(--color-text-secondary);
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          min-height: 44px;
        }
        .nt-cat-on {
          border-color: var(--color-primary);
          background: var(--color-primary-bg);
          color: var(--color-primary);
          font-weight: 700;
        }
        .nt-cat:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .nt-input,
        .nt-textarea {
          width: 100%;
          padding: 13px 15px;
          border-radius: 11px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          font-family: inherit;
          font-size: 14.5px;
          line-height: 1.6;
          color: var(--color-dark);
          outline: none;
        }
        .nt-textarea {
          resize: vertical;
          min-height: 150px;
        }
        .nt-input:focus,
        .nt-textarea:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px var(--color-primary-bg);
        }
        .nt-input[aria-invalid="true"],
        .nt-textarea[aria-invalid="true"] {
          border-color: var(--color-error);
        }
        .nt-dupe {
          padding: 15px;
          border-radius: 13px;
          border: 1px solid rgba(184, 134, 11, 0.35);
          background: rgba(184, 134, 11, 0.06);
          margin-bottom: 20px;
        }
        .nt-dupe-head {
          display: flex;
          align-items: center;
          gap: 9px;
          font-size: 13.5px;
          font-weight: 700;
          color: var(--color-dark);
          margin-bottom: 6px;
        }
        .nt-dupe-x {
          margin-left: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border: none;
          border-radius: 7px;
          background: transparent;
          color: var(--color-text-muted);
          cursor: pointer;
        }
        .nt-dupe-x:focus-visible {
          outline: 2px solid var(--color-gold);
          outline-offset: 1px;
        }
        .nt-dupe-note {
          font-size: 12.5px;
          color: var(--color-text-muted);
          line-height: 1.55;
          margin: 0 0 12px;
        }
        :global(.nt-dupe-row) {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 11px 13px;
          border-radius: 10px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          text-decoration: none;
          margin-bottom: 7px;
        }
        :global(.nt-dupe-row:hover) {
          border-color: var(--color-gold);
        }
        :global(.nt-dupe-row:focus-visible) {
          outline: 2px solid var(--color-gold);
          outline-offset: 2px;
        }
        .nt-dupe-subject {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-dark);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .nt-dupe-when {
          font-size: 11px;
          color: var(--color-text-disabled);
          margin-top: 3px;
        }
        .nt-suggest {
          margin: -6px 0 20px;
          padding: 13px 15px;
          border-radius: 12px;
          background: var(--color-primary-bg);
          border: 1px solid rgba(13, 158, 110, 0.22);
        }
        .nt-suggest-head {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--color-primary);
          margin-bottom: 9px;
        }
        .nt-suggest-row {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 9px 11px;
          border-radius: 9px;
          background: var(--color-surface);
          text-decoration: none;
          color: var(--color-dark);
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 6px;
        }
        .nt-suggest-row:hover {
          background: #fff;
          box-shadow: 0 2px 8px rgba(15, 25, 35, 0.06);
        }
        .nt-suggest-row:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .nt-prio {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }
        .nt-prio-btn {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 11px;
          border-radius: 10px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          cursor: pointer;
          font-family: inherit;
          min-height: 56px;
        }
        .nt-prio-on {
          border-color: var(--color-primary);
          background: var(--color-primary-bg);
        }
        .nt-prio-btn:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .nt-prio-label {
          font-size: 13px;
          font-weight: 700;
          color: var(--color-dark);
        }
        .nt-prio-desc {
          font-size: 11px;
          color: var(--color-text-muted);
        }
        .nt-file-input {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
        .nt-file-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 42px;
          padding: 0 18px;
          border-radius: 10px;
          border: 1px dashed var(--color-border);
          background: var(--color-surface);
          color: var(--color-text-muted);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }
        .nt-file-label:hover {
          border-color: var(--color-primary);
          color: var(--color-primary);
        }
        .nt-file-input:focus-visible + .nt-file-label {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .nt-files {
          list-style: none;
          margin: 11px 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .nt-file {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 9px 12px;
          border-radius: 9px;
          background: var(--color-surface-hover);
          border: 1px solid var(--color-border-subtle);
          font-size: 12.5px;
        }
        .nt-file-name {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 600;
          color: var(--color-text-secondary);
        }
        .nt-file-size {
          color: var(--color-text-disabled);
          font-size: 11.5px;
        }
        .nt-file-x {
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
        }
        .nt-file-x:hover {
          background: var(--color-error-bg);
          color: var(--color-error);
        }
        .nt-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 8px;
          padding-top: 20px;
          border-top: 1px solid var(--color-border);
        }
        :global(.nt-cancel) {
          padding: 12px 20px;
          font-size: 13px;
          font-weight: 700;
          color: var(--color-text-muted);
          text-decoration: none;
          border-radius: 10px;
        }
        :global(.nt-cancel:hover) {
          background: var(--color-surface-hover);
        }
        .nt-submit {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          height: 46px;
          padding: 0 26px;
          border: none;
          border-radius: 10px;
          background: var(--color-dark);
          color: var(--color-primary-light);
          font-size: 13.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .nt-submit:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .nt-submit:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 3px;
        }
        @media (max-width: 520px) {
          .nt-actions {
            flex-direction: column-reverse;
            align-items: stretch;
          }
          .nt-submit,
          :global(.nt-cancel) {
            width: 100%;
            justify-content: center;
            text-align: center;
          }
        }
      `}</style>
    </SupportShell>
  );
}

export default function NewTicketPage() {
  return (
    <Suspense
      fallback={
        <SupportShell title="New ticket" backHref="/support">
          <LoadingBlock label="Loading" rows={3} />
        </SupportShell>
      }
    >
      <NewTicketForm />
    </Suspense>
  );
}
