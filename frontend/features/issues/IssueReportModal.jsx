"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { X, Upload, AlertCircle, CheckCircle2, Loader2, Trash2, WifiOff } from "lucide-react";
import { submitIssueReport, ISSUE_CATEGORIES } from "@/services/issueApi";
import { useToast } from "@/features/shared/components/ui/Toast";

const MAX_SCREENSHOTS = 8;
const MAX_DESCRIPTION = 4000;

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
  const [category, setCategory] = useState(defaultCategory);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null); // { issueCode }
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
    [addToast]
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
    [submitting, files.length, mergeFiles]
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
      setSuccess({ issueCode: issue?.issueCode || "" });
      addToast(`Issue submitted • ${issue?.issueCode || ""}`, "success", 4000);
      onSubmitted?.(issue);
    } catch (error) {
      const status = error?.response?.status;
      let msg;
      if (!navigator.onLine) {
        msg = "You went offline during upload. Your report was not saved — please reconnect and try again.";
      } else if (status === 401 || status === 403) {
        msg = "Your session expired. Please log in again and resubmit.";
      } else if (status === 429) {
        msg = "Too many reports submitted. Please wait a while before trying again.";
      } else if (status === 413) {
        msg = "Screenshots are too large even after compression. Try reducing the number of images.";
      } else {
        msg =
          error?.response?.data?.message ||
          error?.message ||
          "Could not submit issue. Please try again.";
      }
      addToast(msg, "error", 6000);
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
      }}
    >
      <div
        onClick={submitting ? undefined : onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(2, 6, 16, 0.72)",
          backdropFilter: "blur(4px)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "relative",
          width: "min(560px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          background: "linear-gradient(180deg, #0f172a 0%, #0b1224 100%)",
          color: "#e6edf7",
          borderRadius: 16,
          border: "1px solid rgba(120, 140, 180, 0.22)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AlertCircle size={20} color="#60a5fa" />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Report Issue</h2>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {offline && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(239, 68, 68, 0.10)",
              border: "1px solid rgba(239, 68, 68, 0.40)",
              color: "#fca5a5",
              padding: "9px 12px",
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            <WifiOff size={15} />
            You&apos;re offline. Reconnect to submit.
          </div>
        )}

        {success ? (
          <div style={{ textAlign: "center", padding: "18px 8px 6px" }}>
            <CheckCircle2 size={48} color="#22c55e" style={{ margin: "0 auto 12px" }} />
            <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>Thanks — we got it.</h3>
            <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
              Issue ID: <strong style={{ color: "#cbd5e1" }}>{success.issueCode}</strong>
            </p>
            <p style={{ color: "#94a3b8", fontSize: 13, margin: "10px 0 18px" }}>
              We&apos;ll notify you when this is fixed.
            </p>
            <button
              onClick={onClose}
              style={{
                background: "#1e293b",
                color: "#e6edf7",
                border: "1px solid rgba(120, 140, 180, 0.3)",
                padding: "9px 22px",
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <label style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "block" }}>
              Issue Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={submitting}
              style={{
                width: "100%",
                padding: "9px 12px",
                background: "#0b1224",
                color: "#e6edf7",
                border: "1px solid rgba(120, 140, 180, 0.25)",
                borderRadius: 8,
                marginBottom: 14,
                fontSize: 14,
              }}
            >
              {ISSUE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <label style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "block" }}>
              Description *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
              placeholder="Please explain what happened."
              rows={5}
              disabled={submitting}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#0b1224",
                color: "#e6edf7",
                border: "1px solid rgba(120, 140, 180, 0.25)",
                borderRadius: 8,
                fontSize: 14,
                fontFamily: "inherit",
                resize: "vertical",
                marginBottom: 4,
              }}
            />
            <div style={{ fontSize: 11, color: "#64748b", textAlign: "right", marginBottom: 14 }}>
              {description.length} / {MAX_DESCRIPTION}
            </div>

            <label style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "block" }}>
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
                padding: "14px 12px",
                background: dragging
                  ? "rgba(96, 165, 250, 0.12)"
                  : "transparent",
                color: files.length >= MAX_SCREENSHOTS ? "#475569" : "#60a5fa",
                border: dragging
                  ? "2px dashed rgba(96, 165, 250, 0.85)"
                  : "1px dashed rgba(96, 165, 250, 0.5)",
                borderRadius: 8,
                cursor: submitting || files.length >= MAX_SCREENSHOTS ? "not-allowed" : "pointer",
                fontSize: 13,
                marginBottom: previews.length ? 10 : 14,
                transition: "background 120ms, border-color 120ms",
              }}
            >
              <Upload size={16} />
              {files.length >= MAX_SCREENSHOTS
                ? "Max screenshots reached"
                : dragging
                ? "Drop here"
                : "Add screenshots or drag & drop"}
              {files.length < MAX_SCREENSHOTS && (
                <span style={{ fontSize: 11, color: "#64748b" }}>
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
                  marginBottom: 14,
                }}
              >
                {previews.map((p, idx) => (
                  <div
                    key={`${p.name}-${idx}`}
                    style={{
                      position: "relative",
                      aspectRatio: "1 / 1",
                      borderRadius: 6,
                      overflow: "hidden",
                      border: "1px solid rgba(120, 140, 180, 0.25)",
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
                        background: "rgba(15, 23, 42, 0.85)",
                        border: "none",
                        borderRadius: 4,
                        padding: 3,
                        cursor: submitting ? "not-allowed" : "pointer",
                        color: "#fca5a5",
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
                  background: "transparent",
                  color: "#94a3b8",
                  border: "1px solid rgba(120, 140, 180, 0.25)",
                  padding: "9px 16px",
                  borderRadius: 10,
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                onClick={onSubmit}
                disabled={submitting || offline}
                style={{
                  background: submitting || offline
                    ? "#1e3a8a"
                    : "linear-gradient(135deg, #2563eb, #1d4ed8)",
                  color: "white",
                  border: "none",
                  padding: "9px 22px",
                  borderRadius: 10,
                  cursor: submitting || offline ? (submitting ? "wait" : "not-allowed") : "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 130,
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
    </div>
  );
}
