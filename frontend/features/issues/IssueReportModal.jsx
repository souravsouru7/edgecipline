"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { X, Upload, AlertCircle, CheckCircle2, Loader2, Trash2, WifiOff, LifeBuoy } from "lucide-react";
import { submitIssueReport, ISSUE_CATEGORIES } from "@/services/issueApi";
import { useToast } from "@/features/shared/components/ui/Toast";
import FocusTrap from "@/features/shared/components/FocusTrap";
import { useSupportConfig, SUPPORT_KEY } from "@/features/support/hooks/useSupport";

// Fallback only — the live cap comes from GET /support/config, because the
// screenshots become support-ticket attachments and the server enforces the
// ticket limit, not a limit of this form's own.
const DEFAULT_MAX_SCREENSHOTS = 5;
const MAX_DESCRIPTION = 4000;

// Same palette as the rest of the app (frontend/app/globals.css) and the
// Support ticket UI — this modal used to run its own dark-navy/blue theme,
// which read as a different, bolted-on product the moment it opened on top
// of a light screen.
const theme = {
  bg: "#F0EEE9",
  card: "#FFFFFF",
  text: "#0F1923",
  textSecondary: "#4A5568",
  textMuted: "#64748B",
  textDisabled: "#94A3B8",
  border: "#E2E8F0",
  primary: "#0D9E6E",
  primaryLight: "#22C78E",
  primaryBg: "rgba(13,158,110,0.08)",
  error: "#D63B3B",
  errorBg: "rgba(214,59,59,0.06)",
  errorBorder: "rgba(214,59,59,0.3)",
};
const fontFamily = "'Plus Jakarta Sans', system-ui, sans-serif";

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function genSubmissionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Universal Issue Report Modal.
 *
 * Props:
 *   open               — boolean
 *   onClose            — () => void
 *   defaultCategory    — one of ISSUE_CATEGORIES.value (preselects dropdown)
 *   defaultModule      — string, free-text screen identifier (e.g. "upload-trade-forex")
 *   marketType         — "Forex" | "Indian_Market" | "Both" | "Unknown"
 *   ocrDataSnapshot    — object, included only when category=OCR_EXTRACTION
 *   tradeId            — optional ObjectId string
 *   onSubmitted        — (issue) => void, fires on success
 */
export default function IssueReportModal({
  open,
  onClose,
  defaultCategory = "OTHER",
  defaultModule = "",
  marketType = "Unknown",
  ocrDataSnapshot = null,
  tradeId = null,
  onSubmitted,
}) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { data: supportConfig } = useSupportConfig();
  const MAX_SCREENSHOTS = Number(supportConfig?.limits?.maxAttachments) || DEFAULT_MAX_SCREENSHOTS;
  const ticketsEnabled = supportConfig?.ticketsEnabled !== false;

  const [category, setCategory] = useState(defaultCategory);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  // { ticketId, ticketCode, issueCode } — the ticket is what the user tracks.
  const [success, setSuccess] = useState(null);
  // A server refusal the user can act on (e.g. too many open tickets), kept
  // in the dialog rather than a toast so the "view my tickets" link stays.
  const [blocked, setBlocked] = useState(null);
  const [offline, setOffline] = useState(false);
  const [dragging, setDragging] = useState(false);
  const submissionIdRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  useEffect(() => {
    if (open) {
      setCategory(defaultCategory);
      setDescription("");
      setFiles([]);
      setSuccess(null);
      setBlocked(null);
      setOffline(isOffline());
      submissionIdRef.current = genSubmissionId();
    }
  }, [open, defaultCategory]);

  // Track online/offline while modal is open
  useEffect(() => {
    if (!open) return;
    const onOnline  = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [open]);

  const previews = useMemo(
    () => files.map((f) => ({ name: f.name, size: f.size, url: URL.createObjectURL(f) })),
    [files]
  );

  useEffect(() => {
    return () => previews.forEach((p) => URL.revokeObjectURL(p.url));
  }, [previews]);

  const mergeFiles = useCallback(
    (incoming) => {
      const accepted = incoming.filter((f) =>
        /^image\/(jpeg|jpg|png|webp)$/i.test(f.type || "")
      );
      if (accepted.length < incoming.length) {
        addToast("Only JPG, PNG, or WEBP images are accepted.", "error", 4000);
      }
      if (!accepted.length) return;
      setFiles((prev) => {
        const combined = [...prev, ...accepted].slice(0, MAX_SCREENSHOTS);
        if (prev.length + accepted.length > MAX_SCREENSHOTS) {
          addToast(`Max ${MAX_SCREENSHOTS} screenshots allowed.`, "info", 3500);
        }
        return combined;
      });
    },
    [addToast, MAX_SCREENSHOTS]
  );

  // Track how many files were in the picker before it closed (Android permission detection)
  const filesBeforePickRef = useRef(0);

  const onPickFiles = useCallback(
    (e) => {
      const picked = Array.from(e.target.files || []);
      // If the picker returned 0 files but we tried to open it, Android likely
      // denied gallery permission. Show an actionable message.
      if (picked.length === 0 && filesBeforePickRef.current === 0) {
        addToast(
          "No images selected. If this is Android, check Storage permission in Settings.",
          "info",
          5000
        );
      }
      mergeFiles(picked);
      e.target.value = "";
    },
    [addToast, mergeFiles]
  );

  const onPickerClick = useCallback(() => {
    filesBeforePickRef.current = files.length;
    fileInputRef.current?.click();
  }, [files.length]);

  // Drag-and-drop handlers
  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear dragging if leaving the drop zone itself (not a child element)
    if (!dropZoneRef.current?.contains(e.relatedTarget)) {
      setDragging(false);
    }
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      if (submitting || files.length >= MAX_SCREENSHOTS) return;
      const dropped = Array.from(e.dataTransfer?.files || []);
      mergeFiles(dropped);
    },
    [submitting, files.length, mergeFiles, MAX_SCREENSHOTS]
  );

  const removeFile = useCallback((idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const onSubmit = async () => {
    if (submitting) return;

    // Offline gate — check current state and re-query in case React state lagged
    if (offline || isOffline()) {
      addToast("You are offline. Please reconnect and try again.", "error", 5000);
      return;
    }

    if (description.trim().length < 5) {
      addToast("Please describe what happened (at least 5 characters).", "error", 4000);
      return;
    }
    if (description.length > MAX_DESCRIPTION) {
      addToast("Description is too long.", "error", 4000);
      return;
    }
    setSubmitting(true);
    setBlocked(null);
    try {
      const resp = await submitIssueReport({
        issueCategory: category,
        description: description.trim(),
        marketType,
        module: defaultModule,
        screenshots: files,
        ocrDataSnapshot: category === "OCR_EXTRACTION" ? ocrDataSnapshot : null,
        tradeId,
        submissionId: submissionIdRef.current,
      });
      const issue = resp?.issue || resp;
      const ticket = issue?.ticket || null;
      setSuccess({
        ticketId: ticket?.id || "",
        ticketCode: ticket?.ticketCode || "",
        issueCode: issue?.issueCode || "",
      });
      // The ticket now exists in Help & Support; make the list reflect it
      // without waiting for a refetch.
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "my-tickets"] });
      addToast(`Reported • ${ticket?.ticketCode || issue?.issueCode || ""}`, "success", 4000);
      onSubmitted?.(issue);
    } catch (error) {
      const status = error?.status;
      const errorCode = error?.data?.errorCode;
      const serverMessage = error?.data?.message || error?.message;

      if (!navigator.onLine) {
        addToast(
          "You went offline during upload. Your report was not saved — please reconnect and try again.",
          "error",
          6000
        );
      } else if (status === 401 || status === 403) {
        addToast("Your session expired. Please log in again and resubmit.", "error", 6000);
      } else if (errorCode === "SUPPORT_TOO_MANY_OPEN_TICKETS") {
        // The support cap, not a rate limit. The user already has open
        // conversations — the useful answer is a way to get to them.
        setBlocked({
          title: "You already have open tickets",
          body:
            serverMessage ||
            "Please continue on one of your existing tickets, or wait for a reply before opening another.",
          link: { href: "/support/tickets", label: "View my tickets" },
        });
      } else if (errorCode === "SUPPORT_TICKETS_DISABLED" || status === 503) {
        setBlocked({
          title: "Reporting is paused right now",
          body:
            serverMessage ||
            "Ticket creation is temporarily unavailable. Please reach us on WhatsApp or by email.",
          link: { href: "/support", label: "Contact options" },
        });
      } else if (status === 429) {
        addToast("Too many reports submitted. Please wait a while before trying again.", "error", 6000);
      } else if (status === 413) {
        addToast(
          "Screenshots are too large even after compression. Try reducing the number of images.",
          "error",
          6000
        );
      } else {
        addToast(serverMessage || "Could not submit issue. Please try again.", "error", 6000);
      }
      // submissionId is intentionally preserved in ref so a retry will be idempotent
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={submitting ? undefined : onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(10, 15, 20, 0.78)",
        }}
      />
      <FocusTrap>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report an issue"
        style={{
          position: "relative",
          width: "min(560px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          background: theme.card,
          color: theme.text,
          borderRadius: 24,
          border: "1px solid rgba(226, 232, 240, 0.8)",
          boxShadow: "0 40px 100px -20px rgba(0,0,0,0.35)",
          padding: 24,
          fontFamily,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: theme.primaryBg, color: theme.primary,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <AlertCircle size={19} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: theme.text, letterSpacing: "-0.01em" }}>
                Report Issue
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: theme.textMuted }}>
                Opens a support ticket — track it under Help &amp; Support.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            style={{
              background: "#F1F5F9",
              border: "none",
              width: 32,
              height: 32,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: theme.textMuted,
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {offline && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: theme.errorBg,
              border: `1px solid ${theme.errorBorder}`,
              color: theme.error,
              padding: "10px 12px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 14,
            }}
          >
            <WifiOff size={15} />
            You&apos;re offline. Reconnect to submit.
          </div>
        )}

        {success ? (
          <div style={{ textAlign: "center", padding: "18px 8px 6px" }}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%", margin: "0 auto 14px",
              background: theme.primaryBg, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <CheckCircle2 size={34} color={theme.primary} />
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 800, color: theme.text }}>Thanks — we got it.</h3>
            {success.ticketCode && (
              <p style={{ color: theme.textMuted, fontSize: 13, margin: 0 }}>
                Support ticket{" "}
                <strong style={{ color: theme.text, fontFamily: "'JetBrains Mono',monospace" }}>{success.ticketCode}</strong>
              </p>
            )}
            <p style={{ color: theme.textMuted, fontSize: 13, margin: "10px 0 20px", lineHeight: 1.55 }}>
              The support team will reply on your ticket under Help &amp; Support, and you&apos;ll be
              notified when there&apos;s an update.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {success.ticketId && (
                <Link
                  href={`/support/tickets/detail?id=${encodeURIComponent(success.ticketId)}&created=1`}
                  onClick={onClose}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: `linear-gradient(135deg, ${theme.primary}, ${theme.text})`,
                    color: "#FFFFFF",
                    textDecoration: "none",
                    padding: "12px 22px",
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 800,
                    fontFamily,
                  }}
                >
                  <LifeBuoy size={15} />
                  View ticket
                </Link>
              )}
              <button
                onClick={onClose}
                style={{
                  background: theme.card,
                  color: theme.textSecondary,
                  border: `1px solid ${theme.border}`,
                  padding: "12px 22px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily,
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : blocked ? (
          <div style={{ padding: "8px 4px 4px" }}>
            <div
              style={{
                background: "rgba(184,134,11,0.08)",
                border: "1px solid rgba(184,134,11,0.3)",
                borderRadius: 14,
                padding: "16px 18px",
                marginBottom: 16,
              }}
            >
              <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#B45309" }}>{blocked.title}</p>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: theme.textSecondary, lineHeight: 1.55 }}>
                {blocked.body}
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                onClick={() => setBlocked(null)}
                style={{
                  background: theme.card,
                  color: theme.textSecondary,
                  border: `1px solid ${theme.border}`,
                  padding: "12px 20px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily,
                }}
              >
                Back
              </button>
              {blocked.link && (
                <Link
                  href={blocked.link.href}
                  onClick={onClose}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    background: `linear-gradient(135deg, ${theme.primary}, ${theme.text})`,
                    color: "#FFFFFF",
                    textDecoration: "none",
                    padding: "12px 22px",
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 800,
                    fontFamily,
                  }}
                >
                  {blocked.link.label}
                </Link>
              )}
            </div>
          </div>
        ) : (
          <>
            {!ticketsEnabled && (
              <div
                style={{
                  background: "rgba(184,134,11,0.08)",
                  border: "1px solid rgba(184,134,11,0.3)",
                  color: "#B45309",
                  padding: "10px 12px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 14,
                  lineHeight: 1.5,
                }}
              >
                Reporting is paused right now. You can still{" "}
                <Link href="/support" onClick={onClose} style={{ color: "#B45309", fontWeight: 800 }}>
                  reach the team directly
                </Link>
                .
              </div>
            )}
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.textDisabled, marginBottom: 6 }}>
              Issue Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={submitting}
              style={{
                width: "100%",
                padding: "12px 14px",
                background: theme.card,
                color: theme.text,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                marginBottom: 16,
                fontSize: 14,
                fontFamily,
              }}
            >
              {ISSUE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.textDisabled, marginBottom: 6 }}>
              Description <span style={{ color: theme.error }}>*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
              placeholder="Please explain what happened."
              rows={5}
              disabled={submitting}
              style={{
                width: "100%",
                padding: "12px 14px",
                background: theme.card,
                color: theme.text,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                fontSize: 14,
                fontFamily,
                resize: "vertical",
                marginBottom: 4,
              }}
            />
            <div style={{ fontSize: 11, color: theme.textDisabled, textAlign: "right", marginBottom: 16 }}>
              {description.length} / {MAX_DESCRIPTION}
            </div>

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.textDisabled, marginBottom: 6 }}>
              Screenshots (optional, up to {MAX_SCREENSHOTS})
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/jpg"
              multiple
              onChange={onPickFiles}
              disabled={submitting || files.length >= MAX_SCREENSHOTS}
              style={{ display: "none" }}
            />
            <div
              ref={dropZoneRef}
              onDragOver={files.length < MAX_SCREENSHOTS && !submitting ? onDragOver : undefined}
              onDragLeave={onDragLeave}
              onDrop={files.length < MAX_SCREENSHOTS && !submitting ? onDrop : undefined}
              onClick={submitting || files.length >= MAX_SCREENSHOTS ? undefined : onPickerClick}
              role="button"
              tabIndex={submitting || files.length >= MAX_SCREENSHOTS ? -1 : 0}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !submitting && files.length < MAX_SCREENSHOTS) {
                  onPickerClick();
                }
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                width: "100%",
                padding: "20px 12px",
                background: dragging ? theme.primaryBg : "#FAFAFA",
                color: files.length >= MAX_SCREENSHOTS ? theme.textDisabled : theme.primary,
                border: dragging
                  ? `2px dashed ${theme.primary}`
                  : `2px dashed ${theme.border}`,
                borderRadius: 14,
                cursor: submitting || files.length >= MAX_SCREENSHOTS ? "not-allowed" : "pointer",
                fontSize: 13,
                fontWeight: 700,
                marginBottom: previews.length ? 10 : 16,
                transition: "background 120ms, border-color 120ms",
              }}
            >
              <Upload size={18} />
              {files.length >= MAX_SCREENSHOTS
                ? "Max screenshots reached"
                : dragging
                ? "Drop here"
                : "Add screenshots or drag & drop"}
              {files.length < MAX_SCREENSHOTS && (
                <span style={{ fontSize: 11, color: theme.textDisabled, fontWeight: 500 }}>
                  JPG · PNG · WEBP · up to {MAX_SCREENSHOTS}
                </span>
              )}
            </div>

            {previews.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                {previews.map((p, idx) => (
                  <div
                    key={`${p.name}-${idx}`}
                    style={{
                      position: "relative",
                      aspectRatio: "1 / 1",
                      borderRadius: 10,
                      overflow: "hidden",
                      border: `1px solid ${theme.border}`,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={p.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      disabled={submitting}
                      aria-label="Remove screenshot"
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        background: "rgba(15, 25, 35, 0.75)",
                        border: "none",
                        borderRadius: 6,
                        padding: 4,
                        cursor: submitting ? "not-allowed" : "pointer",
                        color: "#FFFFFF",
                        display: "flex",
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={onClose}
                disabled={submitting}
                style={{
                  background: theme.card,
                  color: theme.textSecondary,
                  border: `1px solid ${theme.border}`,
                  padding: "12px 20px",
                  borderRadius: 12,
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily,
                }}
              >
                Cancel
              </button>
              <button
                onClick={onSubmit}
                disabled={submitting || offline || !ticketsEnabled}
                style={{
                  background: submitting || offline || !ticketsEnabled
                    ? theme.textDisabled
                    : `linear-gradient(135deg, ${theme.primary}, ${theme.text})`,
                  color: "#FFFFFF",
                  border: "none",
                  padding: "12px 26px",
                  borderRadius: 12,
                  cursor: submitting || offline || !ticketsEnabled ? (submitting ? "wait" : "not-allowed") : "pointer",
                  fontSize: 14,
                  fontWeight: 800,
                  fontFamily,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 140,
                  justifyContent: "center",
                }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Issue"
                )}
              </button>
            </div>
          </>
        )}
      </div>
      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        :global(.spin) {
          animation: spin 0.9s linear infinite;
        }
      `}</style>
      </FocusTrap>
    </div>
  );
}
