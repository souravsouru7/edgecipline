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
    if (score >= 100) return { label: "A+", color: "var(--lg-green, #0D9E6E)", bg: "var(--lg-green-soft, #ECFDF5)" };
    if (score >= 80)  return { label: "A",  color: "var(--lg-green, #10B981)", bg: "var(--lg-green-soft, #F0FDF4)" };
    if (score >= 60)  return { label: "B",  color: "var(--lg-gold, #B8860B)", bg: "var(--lg-gold-soft, #FFFBEB)" };
    if (score >= 40)  return { label: "C",  color: "var(--lg-gold, #F59E0B)", bg: "var(--lg-gold-soft, #FFF7ED)" };
    return { label: "D", color: "var(--lg-red, #D63B3B)", bg: "var(--lg-red-soft, #FEF2F2)" };
  })();

  return (
    <div>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {quality && (
            <div style={{ width: 36, height: 36, borderRadius: 10, background: quality.bg, border: `1.5px solid color-mix(in srgb, ${quality.color} 20%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: quality.color, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>{quality.label}</span>
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--lg-ink, #0F1923)", fontFamily: "var(--lg-sans, 'Plus Jakarta Sans', sans-serif)" }}>
              {score !== null ? `${followedCount}/${activeRules.length} Rules Followed` : "No rules defined"}
            </div>
            {score !== null && (
              <div style={{ fontSize: "var(--fs-2xs)", color: "var(--lg-muted, #94A3B8)", fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>Setup score: {score}%</div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={onClear}
            style={{ fontSize: "var(--fs-2xs)", color: "var(--lg-muted, #94A3B8)", background: "none", border: "1px solid var(--lg-line, #E2E8F0)", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)", letterSpacing: "0.08em" }}
          >CLEAR</button>
          <button
            type="button"
            onClick={onAdd}
            style={{ fontSize: "var(--fs-2xs)", color: "var(--lg-green, #0D9E6E)", background: "rgba(13,158,110,0.08)", border: "1px solid rgba(13,158,110,0.25)", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)", letterSpacing: "0.08em" }}
          >+ RULE</button>
        </div>
      </div>

      {/* Rules list */}
      {rules.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "var(--lg-muted, #94A3B8)", fontSize: 11, fontFamily: "var(--lg-sans, 'Plus Jakarta Sans', sans-serif)", background: "var(--lg-soft, #F8FAFC)", borderRadius: 8, border: "1px dashed var(--lg-line, #E2E8F0)" }}>
          Select a strategy above to load its rules, or click + RULE to add manually.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rules.map(rule => (
            <div
              key={rule.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: rule.followed ? "var(--lg-green-soft, #ECFDF5)" : "var(--lg-soft, #F8FAFC)", border: `1px solid ${rule.followed ? "var(--lg-green-line, #A7F3D0)" : "var(--lg-line, #E2E8F0)"}`, transition: "all 0.2s" }}
            >
              {/* Checkbox */}
              <div
                onClick={() => { void tapLight(); onToggle(rule.id); }}
                style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${rule.followed ? "var(--lg-green, #0D9E6E)" : "var(--lg-line-strong, #CBD5E1)"}`, background: rule.followed ? "var(--lg-green, #0D9E6E)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "all 0.2s" }}
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
                style={{ flex: 1, fontFamily: "var(--lg-sans, 'Plus Jakarta Sans', sans-serif)", fontSize: 12, color: "var(--lg-ink, #0F1923)", background: "transparent", border: "none", outline: "none", textDecoration: rule.followed ? "line-through" : "none", opacity: rule.followed ? 0.6 : 1 }}
              />

              {/* Status badge */}
              {rule.label && rule.label.trim() && (
                <span style={{ fontSize: "var(--fs-2xs)", fontWeight: 700, letterSpacing: "0.1em", color: rule.followed ? "var(--lg-green, #0D9E6E)" : "var(--lg-muted, #94A3B8)", fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>
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
