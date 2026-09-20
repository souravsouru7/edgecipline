"use client";

import { tapLight } from "@/utils/haptics";

/**
 * SetupChecklist
 * Renders setup rules as interactive checkboxes for trade quality tracking.
 *
 * @param {Array}    rules           - Array of { id, label, followed }
 * @param {Function} onToggle        - (id) => void
 * @param {Function} onUpdateLabel   - (id, value) => void
 * @param {Function} onAdd           - () => void — adds empty rule
 * @param {Function} onClear         - () => void — resets all to unfollowed
 */
export default function SetupChecklist({ rules, onToggle, onUpdateLabel, onAdd, onClear }) {
  const activeRules  = rules.filter(r => r.label && String(r.label).trim().length > 0);
  const followedCount = activeRules.filter(r => r.followed).length;
  const score = activeRules.length > 0 ? Math.round((followedCount / activeRules.length) * 100) : null;

  const quality = (() => {
    if (score === null) return null;
    if (score >= 100) return { label: "A+", color: "#0D9E6E", bg: "#ECFDF5" };
    if (score >= 80)  return { label: "A",  color: "#10B981", bg: "#F0FDF4" };
    if (score >= 60)  return { label: "B",  color: "#B8860B", bg: "#FFFBEB" };
    if (score >= 40)  return { label: "C",  color: "#F59E0B", bg: "#FFF7ED" };
    return { label: "D", color: "#D63B3B", bg: "#FEF2F2" };
  })();

  return (
    <div>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {quality && (
            <div style={{ width: 36, height: 36, borderRadius: 10, background: quality.bg, border: `1.5px solid ${quality.color}33`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: quality.color, fontFamily: "'JetBrains Mono',monospace" }}>{quality.label}</span>
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0F1923", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
              {score !== null ? `${followedCount}/${activeRules.length} Rules Followed` : "No rules defined"}
            </div>
            {score !== null && (
              <div style={{ fontSize: "var(--fs-2xs)", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>Setup score: {score}%</div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={onClear}
            style={{ fontSize: "var(--fs-2xs)", color: "#94A3B8", background: "none", border: "1px solid #E2E8F0", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em" }}
          >CLEAR</button>
          <button
            type="button"
            onClick={onAdd}
            style={{ fontSize: "var(--fs-2xs)", color: "#0D9E6E", background: "rgba(13,158,110,0.08)", border: "1px solid rgba(13,158,110,0.25)", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em" }}
          >+ RULE</button>
        </div>
      </div>

      {/* Rules list */}
      {rules.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#94A3B8", fontSize: 11, fontFamily: "'Plus Jakarta Sans',sans-serif", background: "#F8FAFC", borderRadius: 8, border: "1px dashed #E2E8F0" }}>
          Select a strategy above to load its rules, or click + RULE to add manually.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rules.map(rule => (
            <div
              key={rule.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: rule.followed ? "#ECFDF5" : "#F8FAFC", border: `1px solid ${rule.followed ? "#A7F3D0" : "#E2E8F0"}`, transition: "all 0.2s" }}
            >
              {/* Checkbox */}
              <div
                onClick={() => { void tapLight(); onToggle(rule.id); }}
                style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${rule.followed ? "#0D9E6E" : "#CBD5E1"}`, background: rule.followed ? "#0D9E6E" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "all 0.2s" }}
              >
                {rule.followed && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>

              {/* Label (editable) */}
              <input
                value={rule.label}
                onChange={e => onUpdateLabel(rule.id, e.target.value)}
                placeholder="Describe this rule..."
                style={{ flex: 1, fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 12, color: "#0F1923", background: "transparent", border: "none", outline: "none", textDecoration: rule.followed ? "line-through" : "none", opacity: rule.followed ? 0.6 : 1 }}
              />

              {/* Status badge */}
              {rule.label && rule.label.trim() && (
                <span style={{ fontSize: "var(--fs-2xs)", fontWeight: 700, letterSpacing: "0.1em", color: rule.followed ? "#0D9E6E" : "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>
                  {rule.followed ? "✓ FOLLOWED" : "PENDING"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
