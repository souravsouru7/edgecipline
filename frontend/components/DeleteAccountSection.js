"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { deleteMyAccount } from "@/services/api";
import { clearAuthToken } from "@/utils/auth";
import { signOutFirebase } from "@/services/firebaseAuth";
import FocusTrap from "@/features/shared/components/FocusTrap";

// In-app account deletion.
//
// Required by Google Play's User Data policy and Apple Guideline 5.1.1(v):
// an app that lets users create an account must let them delete it from
// inside the app. A "contact support to delete" link does not satisfy either
// policy, and neither does deactivation.
//
// The confirmation deliberately requires typing the full email rather than a
// single "are you sure" tap — this is unrecoverable, and the friction is the
// point. The server enforces the same check independently.

const C = {
  card: "#FFFFFF",
  navy: "#0F1923",
  red: "#D63B3B",
  redDark: "#B91C1C",
  muted: "#94A3B8",
  secondary: "#4A5568",
  border: "#E2E8F0",
};

const WHAT_GETS_DELETED = [
  "Every trade, screenshot and uploaded image",
  "Your reflections, checklists, streaks and discipline history",
  "AI coach conversations and weekly reports",
  "Your profile, login and notification settings",
];

export default function DeleteAccountSection({ email }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const target = String(email || "").trim().toLowerCase();
  const matches = typed.trim().toLowerCase() === target && target.length > 0;

  // FocusTrap handles tab containment but not dismissal.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) {
        setOpen(false);
        setTyped("");
        setError("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setTyped("");
    setError("");
  };

  const handleDelete = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError("");

    try {
      await deleteMyAccount(typed.trim());

      // The account is gone server-side; clear every local trace before
      // leaving. Failures here must not block the redirect — the session is
      // already invalid, so stranding the user on a dead screen is worse.
      // try/catch rather than .catch(): clearAuthToken returns undefined on
      // web (it only produces a promise on native Capacitor).
      try { await clearAuthToken(); } catch { /* already signing out */ }
      try { await signOutFirebase(); } catch { /* already signing out */ }

      router.replace("/login?deleted=1");
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.data?.message ||
        err?.message ||
        "Could not delete your account. Please try again or contact support.";
      setError(message);
      setBusy(false);
    }
  };

  return (
    <>
      <div
        style={{
          background: C.card,
          border: `1px solid #FCA5A5`,
          borderRadius: 14,
          padding: 18,
          marginTop: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <AlertTriangle size={15} color={C.red} strokeWidth={2.4} />
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: C.red,
              letterSpacing: "0.12em",
            }}
          >
            DANGER ZONE
          </div>
        </div>

        <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.6, marginBottom: 14 }}>
          Deleting your account permanently erases your journal and everything in it.
          This cannot be undone, and we cannot recover it for you afterwards.
        </div>

        <button
          onClick={() => setOpen(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 9,
            border: `1px solid ${C.red}`,
            background: "rgba(214,59,59,0.05)",
            color: C.red,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <Trash2 size={14} strokeWidth={2.2} />
          Delete my account
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(15,25,35,0.55)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <FocusTrap active>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: C.card,
                borderRadius: 16,
                width: "100%",
                maxWidth: 440,
                padding: 22,
                boxShadow: "0 30px 80px rgba(0,0,0,0.3)",
                maxHeight: "90vh",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <h2
                  id="delete-account-title"
                  style={{ fontSize: 18, fontWeight: 800, color: C.navy, margin: 0 }}
                >
                  Delete your account?
                </h2>
                <button
                  onClick={close}
                  aria-label="Cancel"
                  disabled={busy}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: busy ? "not-allowed" : "pointer",
                    color: C.muted,
                    padding: 2,
                    lineHeight: 0,
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ fontSize: 13, color: C.secondary, lineHeight: 1.6, marginBottom: 10 }}>
                This permanently removes:
              </div>
              <ul style={{ margin: "0 0 14px", paddingLeft: 18 }}>
                {WHAT_GETS_DELETED.map((item) => (
                  <li
                    key={item}
                    style={{ fontSize: 12.5, color: C.secondary, marginBottom: 5, lineHeight: 1.55 }}
                  >
                    {item}
                  </li>
                ))}
              </ul>

              <div
                style={{
                  background: "#FEF2F2",
                  border: "1px solid #FCA5A5",
                  borderRadius: 9,
                  padding: "10px 12px",
                  fontSize: 12,
                  color: C.redDark,
                  lineHeight: 1.55,
                  marginBottom: 16,
                }}
              >
                This is immediate and permanent. There is no grace period and no way
                to restore your data.
              </div>

              <label
                htmlFor="confirm-email"
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.navy,
                  marginBottom: 6,
                }}
              >
                Type <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{target}</span> to confirm
              </label>
              <input
                id="confirm-email"
                type="email"
                value={typed}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={busy}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="your email address"
                style={{
                  width: "100%",
                  padding: "11px 12px",
                  borderRadius: 9,
                  border: `1.5px solid ${matches ? C.red : C.border}`,
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono',monospace",
                  outline: "none",
                  marginBottom: error ? 8 : 16,
                  boxSizing: "border-box",
                }}
              />

              {error && (
                <div style={{ fontSize: 12, color: C.red, marginBottom: 14, lineHeight: 1.5 }}>
                  {error}
                </div>
              )}

              <div style={{ display: "flex", gap: 9 }}>
                <button
                  onClick={close}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: "11px",
                    borderRadius: 9,
                    border: `1px solid ${C.border}`,
                    background: "#F8FAFC",
                    color: C.navy,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: busy ? "not-allowed" : "pointer",
                  }}
                >
                  Keep my account
                </button>
                <button
                  onClick={handleDelete}
                  disabled={!matches || busy}
                  style={{
                    flex: 1,
                    padding: "11px",
                    borderRadius: 9,
                    border: "none",
                    background: matches && !busy ? C.red : "#FCA5A5",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: matches && !busy ? "pointer" : "not-allowed",
                  }}
                >
                  {busy ? "Deleting..." : "Delete permanently"}
                </button>
              </div>
            </div>
          </FocusTrap>
        </div>
      )}
    </>
  );
}
