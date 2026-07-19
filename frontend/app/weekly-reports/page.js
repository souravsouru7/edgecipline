"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, TrendingUp, TrendingDown, Target, AlertTriangle, CheckSquare, Lightbulb } from "lucide-react";
import LoadingSpinner from "@/components/LoadingSpinner";
import { generateWeeklyFeedbackNow, listWeeklyReports } from "@/services/reportsApi";
import { useMarket } from "@/context/MarketContext";
import PageHeader from "@/features/shared/components/PageHeader";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";

const C = { bull: "#0D9E6E", bear: "#D63B3B", gold: "#B8860B", blue: "#3B82F6", purple: "#8B5CF6", primary: "#0F1923", muted: "#94A3B8" };

// -- JSON extraction helpers ---------------------------------------------------

function tryParseJson(value) {
  if (!value || typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function unescapeForDisplay(value) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Common Gemini escaping patterns
  s = s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  s = s.trim();
  // If the entire string is wrapped in quotes, remove them.
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  // Clean up weird tokens occasionally injected into summaries
  s = s.replace(/\(n\)\s*/gi, " ");
  // Collapse only spaces/tabs, not newlines (so we can still split into paragraphs).
  s = s.replace(/[ \t]+/g, " ");
  // Normalize excessive newlines to at most double-newline.
  s = s.replace(/\n{3,}/g, "\n\n");
  // Ensure spacing after sentence punctuation
  s = s.replace(/([.!?])([A-Z0-9])/g, "$1 $2");
  // Fix broken decimal formatting like "33. 3" -> "33.3", "-13. 01" -> "-13.01"
  s = s.replace(/(\d)\.\s+(\d)/g, "$1.$2");
  return s;
}

function extractWeekAndSummaryFromText(text) {
  const t = String(text || "").trim();
  if (!t) return null;

  // Extract JSON-ish fields when the model returns: {"week":"...","summary":"..."}
  const weekMatch = t.match(/"week"\s*:\s*"([^"]*)"/i);
  // Summary can contain commas/periods/newlines; capture until the next known key or end.
  let summaryMatch = t.match(
    /"summary"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"(?:week|mistakes|improvements|nextWeekChecklist)"\s*:|[}\]]|$)/i
  );
  // Fallback: summary runs till the end if we cannot find a next key.
  if (!summaryMatch) {
    summaryMatch = t.match(/"summary"\s*:\s*"([\s\S]*?)"\s*$/i);
  }

  if (!summaryMatch) return null;

  const week = weekMatch ? unescapeForDisplay(weekMatch[1]) : "";
  const summary = unescapeForDisplay(summaryMatch[1]);
  if (!summary) return null;

  return {
    week,
    summary
  };
}

// Recursively unwrap JSON until summary is plain text or we give up.
// Handles any depth of Gemini accidentally wrapping responses inside summary.
function deepExtractSummary(value, depth = 0) {
  if (!value || typeof value !== "string" || depth > 5) return value || "";
  const text = value.trim();
  if (!text.startsWith("{")) {
    // If the model returned JSON-ish week/summary without an outer object,
    // still extract what we can for readability.
    const extracted = extractWeekAndSummaryFromText(text);
    if (extracted && extracted.summary) {
      return extracted.week ? `Week: ${extracted.week}\n\nSummary: ${extracted.summary}` : extracted.summary;
    }
    return text; // already plain text
  }
  const inner = tryParseJson(text);
  if (inner && typeof inner.summary === "string") {
    return deepExtractSummary(inner.summary, depth + 1);
  }
  // If it's not valid JSON but still contains JSON-ish `"week"` / `"summary"` fields, extract them.
  const extracted = extractWeekAndSummaryFromText(text);
  if (extracted && extracted.summary) {
    return extracted.week ? `Week: ${extracted.week}\n\nSummary: ${extracted.summary}` : extracted.summary;
  }
  // Last resort: regex grab
  const m = text.match(
    /"summary"\s*:\s*"([\s\S]*?)"\s*(?=\s*,\s*"(?:week|mistakes|improvements|nextWeekChecklist)"|\s*}\s*|$)/i
  );
  if (m) return unescapeForDisplay(m[1]);
  return text; // give up - show raw, at least not silently
}

function splitSummaryIntoParagraphs(value) {
  const raw = unescapeForDisplay(value);
  if (!raw) return [];

  const extracted = extractWeekAndSummaryFromText(raw);
  let weekText = extracted?.week ? `Week: ${extracted.week}` : null;
  let summaryText = extracted?.summary ? extracted.summary : raw;

  // Also handle already-labeled output:
  // "Week: ...\n\nSummary: ..."
  if (!extracted?.week) {
    const weekIdx = raw.search(/\bWeek:\b/i);
    const summaryIdx = raw.search(/\bSummary:\b/i);
    if (weekIdx !== -1 && summaryIdx !== -1 && summaryIdx > weekIdx) {
      const weekPart = raw.slice(weekIdx, summaryIdx).trim();
      const summaryPart = raw.slice(summaryIdx).replace(/^\s*Summary:\s*/i, "").trim();
      // If we found a labeled split, override for the bullet extraction.
      if (weekPart && summaryPart) {
        weekText = weekPart.startsWith("Week:") ? weekPart : `Week: ${weekPart}`;
        summaryText = summaryPart;
      }
    }
  }

  // Try to convert the summary into labeled bullets for readability.
  // This targets the common Gemini "comma paragraph" output shape.
  const s = summaryText;
  const bullets = [];

  const netMatch = s.match(/net\s*P\s*n\s*L\s*(?:of)?\s*([+-]?\d+(?:\.\d+)?)/i);
  const tradesMatch = s.match(/across\s*(\d+)\s*total\s*trades/i);
  const winRateMatch = s.match(/win\s*rate\s*(?:stood at|was|is)\s*([0-9]+(?:\.\d+)?)\s*%/i);
  const profitFactorMatch = s.match(/profit\s*factor\s*(?:was|indicating|was\s+)?\s*([0-9]+(?:\.\d+)?)/i);
  if (netMatch || winRateMatch || profitFactorMatch) {
    const net = netMatch?.[1] ? Number(netMatch[1]).toFixed(2).replace(/\.00$/, "") : null;
    const trades = tradesMatch?.[1] || null;
    const win = winRateMatch?.[1] ? Number(winRateMatch[1]).toFixed(1).replace(/\.0$/, "") : null;
    const pf = profitFactorMatch?.[1] ? Number(profitFactorMatch[1]).toFixed(2).replace(/\.00$/, "") : null;
    const parts = [
      net != null ? `Net P&L ${net}` : null,
      trades != null ? `over ${trades} trades` : null,
      win != null ? `Win rate ${win}%` : null,
      pf != null ? `Profit factor ${pf}` : null
    ].filter(Boolean);
    if (parts.length) bullets.push(`Results: ${parts.join("; ")}.`);
  }

  const bestMatch = s.match(/best\s*trade[^.]*profit\s*of\s*([+-]?\d+(?:\.\d+)?)[^']*'([^']+)'/i);
  if (bestMatch) {
    const bestProfit = Number(bestMatch[1]).toFixed(2).replace(/\.00$/, "");
    const bestStrategy = bestMatch[2];
    bullets.push(`Best trade: +${bestProfit} (Strategy '${bestStrategy}').`);
  } else {
    const bestProfitOnly = s.match(/best\s*trade[^.]*profit\s*of\s*([+-]?\d+(?:\.\d+)?)/i);
    if (bestProfitOnly?.[1]) {
      const bestProfit = Number(bestProfitOnly[1]).toFixed(2).replace(/\.00$/, "");
      bullets.push(`Best trade: +${bestProfit}.`);
    }
  }

  const worstMatch = s.match(/worst\s*trade[^.]*loss\s*of\s*([+-]?\d+(?:\.\d+)?)[^']*'([^']+)'/i);
  const setupScoreMatch = s.match(/setup\s*score\s*(?:of\s*)?([0-9]+(?:\.\d+)?)/i);
  if (worstMatch) {
    const worstLoss = Number(worstMatch[1]).toFixed(2).replace(/\.00$/, "");
    const worstStrategy = worstMatch[2];
    const setupScore = setupScoreMatch?.[1] ? Number(setupScoreMatch[1]).toFixed(0) : null;
    bullets.push(
      `Worst trade: ${worstLoss} (Strategy '${worstStrategy}'${setupScore != null ? `, setup score ${setupScore}` : ""}).`
    );
  }

  const overRelianceMatch = s.match(/over-reliance\s*on\s*(?:the\s+)?'([^']+)'/i);
  if (overRelianceMatch?.[1]) bullets.push(`Main theme: Over-reliance on strategy '${overRelianceMatch[1]}'.`);

  const ruleBreakMatch = s.match(/rule\s*break[^']*'([^']+)'/i);
  if (ruleBreakMatch?.[1]) bullets.push(`Discipline signal: Rule break '${ruleBreakMatch[1]}'.`);

  // Take the final "action" sentence as-is (much easier than keeping the whole paragraph).
  const sentenceChunks = s.match(/[^.!?]+[.!?]+(?:\s+|$)/g)?.map((x) => x.trim()).filter(Boolean) || [];
  const lastSentence = sentenceChunks.length ? sentenceChunks[sentenceChunks.length - 1] : null;
  if (lastSentence && lastSentence.length > 30) {
    const trimmed = lastSentence.length > 190 ? `${lastSentence.slice(0, 187).trim()}...` : lastSentence;
    bullets.push(`What to focus next: ${trimmed}`);
  }

  const cleanedBullets = bullets.map((b) => String(b).trim()).filter((b) => b.length > 10);
  if (cleanedBullets.length >= 3) {
    const out = [];
    if (weekText) out.push(weekText);
    out.push(...cleanedBullets.slice(0, 6));
    return out;
  }

  // Fallback: prefer explicit paragraph breaks.
  const explicit = raw.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 10);
  if (explicit.length > 1) return explicit.slice(0, 6);

  // Fallback: split Week/Summary labels if present.
  const weekIdx = raw.search(/\bWeek:\b/i);
  const summaryIdx = raw.search(/\bSummary:\b/i);
  if (weekIdx !== -1 && summaryIdx !== -1 && summaryIdx > weekIdx) {
    const weekPart = raw.slice(0, summaryIdx).trim();
    const summaryPart = raw.slice(summaryIdx).trim();
    return [weekPart, summaryPart].filter((p) => p.length > 10).slice(0, 4);
  }

  // Otherwise split into sentences and group into readable chunks.
  const sentences =
    raw.match(/[^.!?]+[.!?]+(?:\s+|$)/g)?.map((x) => x.trim()).filter((x) => x.length > 0) || [];
  if (!sentences.length) return [raw].filter((p) => p.length > 10);
  return sentences.slice(0, 6);
}

// Deep-extract the full aiFeedback object, handling any nesting
function normalizeAiFeedback(raw) {
  if (!raw) return null;

  // Step 1: get an object
  let obj = typeof raw === "object" ? raw : tryParseJson(String(raw));
  if (!obj) return { week: "", summary: String(raw), summaryParagraphs: [String(raw)], mistakes: [], improvements: [], nextWeekChecklist: [] };

  // Step 2: if summary itself is a full JSON blob, merge it upward
  if (typeof obj.summary === "string") {
    const nested = tryParseJson(obj.summary);
    if (nested && typeof nested === "object" && (nested.summary || nested.mistakes)) {
      obj = {
        ...obj,
        ...nested,
        week: nested.week || obj.week || "",
        mistakes: (Array.isArray(nested.mistakes) && nested.mistakes.length ? nested.mistakes : obj.mistakes) || [],
        improvements: (Array.isArray(nested.improvements) && nested.improvements.length ? nested.improvements : obj.improvements) || [],
        nextWeekChecklist: (Array.isArray(nested.nextWeekChecklist) && nested.nextWeekChecklist.length ? nested.nextWeekChecklist : obj.nextWeekChecklist) || [],
      };
    }
  }

  // Step 3: extract clean summary (recursive JSON unwrap)
  const summary = deepExtractSummary(obj.summary || "");
  const mistakes = Array.isArray(obj.mistakes) ? obj.mistakes.filter(m => m && (m.title || m.evidence)) : [];
  const improvements = Array.isArray(obj.improvements) ? obj.improvements : [];
  const nextWeekChecklist = Array.isArray(obj.nextWeekChecklist) ? obj.nextWeekChecklist.filter(Boolean) : [];
  const psychologyFeedback =
    typeof obj.psychologyFeedback === "string" && obj.psychologyFeedback.trim().length > 0
      ? obj.psychologyFeedback.trim()
      : "";

  return {
    week: obj.week || "",
    summary,
    summaryParagraphs: summary ? splitSummaryIntoParagraphs(summary) : [],
    mistakes,
    improvements,
    nextWeekChecklist,
    psychologyFeedback,
  };
}

// -- Sub-components ------------------------------------------------------------

function KpiCard({ label, value, color }) {
  return (
    <div style={{ background: "#FAFAFA", borderRadius: 12, border: "1px solid #E8EDF2", padding: "14px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.primary, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function SummaryParagraph({ text }) {
  const m = String(text || "").match(/^(Week|Summary|Results|Best trade|Worst trade|Main theme|Discipline signal|What to focus next):\s*(.+)$/i);
  const isLabeled = Boolean(m);
  const label = isLabeled ? `${m[1]}:` : null;
  const body = isLabeled ? m[2] : text;

  return (
    <div style={{ margin: 0, padding: "10px 12px", borderRadius: 10, background: "#F8FAFC", border: "1px solid #E8EDF2" }}>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "#2D3748" }}>
        {label ? <span style={{ fontWeight: 900, color: C.primary, marginRight: 6 }}>{label}</span> : null}
        {body}
      </p>
    </div>
  );
}

function MistakeCard({ mistake, index }) {
  return (
    <div style={{ borderRadius: 12, border: "1px solid #FED7D7", background: "#FFF8F8", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid #FED7D7", background: "#FFF5F5" }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: "#FED7D7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: C.bear }}>{index + 1}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>{mistake.title}</div>
      </div>
      {mistake.evidence && (
        <div style={{ padding: "10px 14px", borderBottom: mistake.fix ? "1px solid #FED7D7" : "none" }}>
          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: "0.07em", marginBottom: 5 }}>EVIDENCE</div>
          <p style={{ margin: 0, fontSize: 12, color: "#4A5568", lineHeight: 1.65 }}>{mistake.evidence}</p>
        </div>
      )}
      {mistake.fix && (
        <div style={{ padding: "10px 14px", background: "rgba(13,158,110,0.04)" }}>
          <div style={{ fontSize: 9, color: C.bull, fontWeight: 700, letterSpacing: "0.07em", marginBottom: 5 }}>FIX</div>
          <p style={{ margin: 0, fontSize: 12, color: C.primary, lineHeight: 1.65 }}>{mistake.fix}</p>
        </div>
      )}
    </div>
  );
}

function ImprovementCard({ item }) {
  const title = typeof item === "string" ? item : item?.title;
  const why   = typeof item === "object" ? item?.why : null;
  const how   = typeof item === "object" ? item?.how : null;
  return (
    <div style={{ borderRadius: 12, border: "1px solid #BFDBFE", background: "#F0F7FF", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: (why || how) ? "1px solid #BFDBFE" : "none", background: "#EBF4FF" }}>
        <Target size={13} color={C.blue} />
        <div style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>{title}</div>
      </div>
      {why && (
        <div style={{ padding: "10px 14px", borderBottom: how ? "1px solid #BFDBFE" : "none" }}>
          <div style={{ fontSize: 9, color: C.blue, fontWeight: 700, letterSpacing: "0.07em", marginBottom: 5 }}>WHY</div>
          <p style={{ margin: 0, fontSize: 12, color: "#374151", lineHeight: 1.65 }}>{why}</p>
        </div>
      )}
      {how && (
        <div style={{ padding: "10px 14px" }}>
          <div style={{ fontSize: 9, color: C.blue, fontWeight: 700, letterSpacing: "0.07em", marginBottom: 5 }}>HOW</div>
          <p style={{ margin: 0, fontSize: 12, color: "#374151", lineHeight: 1.65 }}>{how}</p>
        </div>
      )}
    </div>
  );
}

function SkeletonBlock({ width = "100%", height = 12, radius = 8, style = {} }) {
  return (
    <div
      className="wr-skeleton"
      style={{
        width,
        height,
        borderRadius: radius,
        background: "#E8EDF2",
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    />
  );
}

function ReportHistorySkeleton() {
  return (
    <div style={{ padding: 16 }}>
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          style={{
            padding: item === 0 ? "0 0 14px" : "14px 0",
            borderTop: item === 0 ? "none" : "1px solid #F1F5F9",
          }}
        >
          <SkeletonBlock width="72%" height={12} radius={6} style={{ marginBottom: 9 }} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <SkeletonBlock width="34%" height={10} radius={6} />
            <SkeletonBlock width="26%" height={10} radius={6} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportDetailSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", padding: "16px 18px", boxShadow: "0 2px 12px rgba(15,25,35,0.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SkeletonBlock width="38%" height={16} radius={7} style={{ marginBottom: 8 }} />
            <SkeletonBlock width="24%" height={10} radius={6} />
          </div>
          <SkeletonBlock width={118} height={34} radius={9} />
        </div>
        <div className="wr-kpi-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 10 }}>
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} style={{ background: "#FAFAFA", borderRadius: 12, border: "1px solid #E8EDF2", padding: "14px 16px" }}>
              <SkeletonBlock width="46%" height={9} radius={6} style={{ marginBottom: 10 }} />
              <SkeletonBlock width="68%" height={21} radius={7} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.04)" }}>
        <div style={{ height: 3, background: `linear-gradient(90deg, ${C.bull}, transparent)` }} />
        <div style={{ padding: "18px 22px" }}>
          <SkeletonBlock width={130} height={10} radius={6} style={{ marginBottom: 16 }} />
          <SkeletonBlock width="100%" height={64} radius={10} style={{ marginBottom: 10 }} />
          <SkeletonBlock width="88%" height={64} radius={10} />
        </div>
      </div>

      <div className="wr-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[C.bear, C.blue].map((accent, item) => (
          <div key={item} style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.04)" }}>
            <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
            <div style={{ padding: "18px 22px" }}>
              <SkeletonBlock width="42%" height={10} radius={6} style={{ marginBottom: 16 }} />
              <SkeletonBlock width="100%" height={48} radius={10} style={{ marginBottom: 10 }} />
              <SkeletonBlock width="92%" height={48} radius={10} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -- Main component ------------------------------------------------------------

function WeeklyReportsContent() {
  const { ready } = useRequireAuth();
  const searchParams = useSearchParams();
  const marketParam = searchParams.get("market");
  const { currentMarket, getCurrencySymbol } = useMarket();
  const [reports, setReports]   = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");
  const [info, setInfo]         = useState("");

  const fetchReports = async () => {
    const data = await listWeeklyReports(20, currentMarket);
    setReports(data);
    if (!selected && data?.length) setSelected(data[0]);
  };

  useEffect(() => {
    if (!ready) return;
    fetchReports().catch(e => setError(e.message || "Failed to load reports"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, currentMarket]);

  const ai   = useMemo(() => normalizeAiFeedback(selected?.aiFeedback), [selected]);
  const snap = selected?.snapshot;
  const currency = getCurrencySymbol();
  const net  = snap?.pnl?.net ?? 0;

  const onGenerateNow = async () => {
    try {
      setBusy(true); setError(""); setInfo("");
      const created = await generateWeeklyFeedbackNow(currentMarket);
      await fetchReports();
      setSelected(created);
    } catch (e) {
      const msg = e?.message || "Failed to generate weekly feedback";
      if (msg.toLowerCase().includes("last 7 days")) {
        setInfo("AI feedback already generated this week. You can generate again after 7 days.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const isIndian = marketParam === "Indian_Market";

  return (
    <div style={{ minHeight: "100vh", background: "#F4F2EE", fontFamily: "'Plus Jakarta Sans',sans-serif", color: C.primary }}>
      {isIndian ? <IndianMarketHeader /> : <PageHeader />}

      {/* -- Page toolbar -- */}
      <div style={{
        background: "#FFFFFF", borderBottom: "1px solid #E8EDF2",
        padding: "10px 20px", display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 12,
      }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.primary }}>Weekly AI Reports</span>
        <button onClick={onGenerateNow} disabled={busy} className="wr-gen-btn" style={{
          display: "flex", alignItems: "center", gap: 6,
          background: busy ? "#E2E8F0" : C.bull,
          border: "none", borderRadius: 8, padding: "8px 14px",
          color: busy ? C.muted : "#FFFFFF",
          fontSize: 12, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer",
          transition: "all 0.2s", whiteSpace: "nowrap",
        }}>
          <RefreshCw size={13} style={{ animation: busy ? "spin 1s linear infinite" : "none" }} />
          <span className="wr-gen-label">{busy ? "Generating..." : "Generate Report"}</span>
        </button>
      </div>

      {/* -- Body -------------------------------------------------- */}
      <div className="wr-body" style={{ maxWidth: 1180, margin: "0 auto", padding: "24px", display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, alignItems: "start" }}>

        {/* Sidebar */}
        <aside style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.04)", position: "sticky", top: 110 }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #E8EDF2" }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em" }}>REPORT HISTORY</div>
          </div>

          {!reports ? (
            <ReportHistorySkeleton />
          ) : reports.length === 0 ? (
            <div style={{ padding: 20, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
              No reports yet.<br />Click <strong style={{ color: C.bull }}>Generate Report</strong> above.
            </div>
          ) : (
            <div className="wr-sidebar-list" style={{ display: "flex", flexDirection: "column" }}>
              {reports.map(r => {
                const label = r?.snapshot?.week?.label || new Date(r.weekStart).toDateString();
                const rNet  = r?.snapshot?.pnl?.net ?? 0;
                const active = selected?._id === r._id;
                return (
                  <button key={r._id} onClick={() => setSelected(r)} style={{
                    textAlign: "left", padding: "12px 16px",
                    border: "none", borderBottom: "1px solid #F4F2EE",
                    background: active ? "rgba(13,158,110,0.07)" : "transparent",
                    cursor: "pointer", transition: "background 0.15s",
                    borderLeft: active ? `3px solid ${C.bull}` : "3px solid transparent",
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: active ? C.bull : C.primary, marginBottom: 4, lineHeight: 1.4 }}>
                      {label.replace(" (Last 7 days)", "")}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: C.muted, fontFamily: "'JetBrains Mono',monospace" }}>
                        {r?.snapshot?.counts?.totalTrades ?? 0} trades
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: rNet >= 0 ? C.bull : C.bear }}>
                        {rNet >= 0 ? "+" : ""}{currency}{Math.abs(rNet).toFixed(2)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Report detail */}
        <main>
          {/* Alerts */}
          {error && (
            <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: "rgba(214,59,59,0.08)", border: "1px solid rgba(214,59,59,0.2)", color: C.bear, fontSize: 13 }}>
              {error}
            </div>
          )}
          {info && !error && (
            <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: "rgba(13,158,110,0.07)", border: "1px solid rgba(13,158,110,0.2)", color: C.bull, fontSize: 13 }}>
              {info}
            </div>
          )}

          {!reports ? (
            <ReportDetailSkeleton />
          ) : !selected ? (
            <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", padding: "60px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: C.muted }}>Select a report from the left panel.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* -- Week header ------------------------------------ */}
              <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", padding: "16px 18px", boxShadow: "0 2px 12px rgba(15,25,35,0.04)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.primary, lineHeight: 1.4, wordBreak: "break-word" }}>
                      {snap?.week?.label?.replace(" (Last 7 days)", "") || "Weekly Report"}
                    </h2>
                    <div style={{ fontSize: 10, color: C.muted, fontFamily: "'JetBrains Mono',monospace", marginTop: 4, letterSpacing: "0.04em" }}>
                      {selected.aiModel ? `AI: ${selected.aiModel}` : "No AI model"} * {snap?.counts?.totalTrades ?? 0} trades
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: net >= 0 ? "rgba(13,158,110,0.08)" : "rgba(214,59,59,0.08)", border: `1px solid ${net >= 0 ? "rgba(13,158,110,0.2)" : "rgba(214,59,59,0.2)"}`, flexShrink: 0 }}>
                    {net >= 0 ? <TrendingUp size={14} color={C.bull} /> : <TrendingDown size={14} color={C.bear} />}
                    <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", color: net >= 0 ? C.bull : C.bear }}>
                      {net >= 0 ? "+" : ""}{currency}{Math.abs(net).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* KPI row */}
                <div className="wr-kpi-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 10 }}>
                  <KpiCard label="Win Rate"      value={`${snap?.rates?.winRatePct ?? 0}%`} color={parseFloat(snap?.rates?.winRatePct ?? 0) >= 50 ? C.bull : C.bear} />
                  <KpiCard label="Profit Factor" value={snap?.rates?.profitFactor ?? "-"}   color={parseFloat(snap?.rates?.profitFactor ?? 0) >= 1 ? C.bull : C.bear} />
                  <KpiCard label="Avg Win"       value={`${currency}${snap?.rates?.avgWin ?? 0}`}  color={C.bull} />
                  <KpiCard label="Avg Loss"      value={`${currency}${snap?.rates?.avgLoss ?? 0}`} color={C.bear} />
                  {typeof snap?.discipline?.avgSetupScore === "number" && (
                    <KpiCard label="Setup Score" value={`${snap.discipline.avgSetupScore}%`} color={snap.discipline.avgSetupScore >= 70 ? C.bull : C.gold} />
                  )}
                </div>
              </div>

              {/* -- AI Overview ------------------------------------- */}
              {ai && (
                <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.04)" }}>
                  <div style={{ height: 3, background: `linear-gradient(90deg, ${C.bull}, transparent)` }} />
                  <div style={{ padding: "18px 22px" }}>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 14 }}>AI COACHING SUMMARY</div>
                    {ai.summaryParagraphs.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {ai.summaryParagraphs.map((para, i) => (
                          <SummaryParagraph key={i} text={para} />
                        ))}
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Generate a report to see AI feedback.</p>
                    )}
                  </div>
                </div>
              )}

              {/* -- Psychology feedback (if provided) -------------- */}
              {ai?.psychologyFeedback && (
                <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.04)" }}>
                  <div style={{ height: 3, background: `linear-gradient(90deg, ${C.purple}, transparent)` }} />
                  <div style={{ padding: "18px 22px" }}>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 10 }}>
                      PSYCHOLOGY FEEDBACK
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {ai.psychologyFeedback.split(/\n{2,}/).map((block, idx) => (
                        <p key={idx} style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "#2D3748" }}>
                          {block.trim()}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* -- Mistakes ---------------------------------------- */}
              {ai?.mistakes?.length > 0 && (
                <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.04)" }}>
                  <div style={{ height: 3, background: `linear-gradient(90deg, ${C.bear}, transparent)` }} />
                  <div style={{ padding: "18px 22px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                      <AlertTriangle size={14} color={C.bear} />
                      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em" }}>TOP MISTAKES THIS WEEK</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {ai.mistakes.slice(0, 5).map((m, i) => <MistakeCard key={i} mistake={m} index={i} />)}
                    </div>
                  </div>
                </div>
              )}

              {/* -- Improvements + Checklist ------------------------ */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="wr-grid">

                {ai?.improvements?.length > 0 && (
                  <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.04)" }}>
                    <div style={{ height: 3, background: `linear-gradient(90deg, ${C.blue}, transparent)` }} />
                    <div style={{ padding: "18px 22px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                        <Lightbulb size={14} color={C.blue} />
                        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em" }}>FOCUS AREAS</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {ai.improvements.slice(0, 5).map((item, i) => <ImprovementCard key={i} item={item} />)}
                      </div>
                    </div>
                  </div>
                )}

                {ai?.nextWeekChecklist?.length > 0 && (
                  <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.04)" }}>
                    <div style={{ height: 3, background: `linear-gradient(90deg, ${C.gold}, transparent)` }} />
                    <div style={{ padding: "18px 22px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                        <CheckSquare size={14} color={C.gold} />
                        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em" }}>NEXT WEEK CHECKLIST</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {ai.nextWeekChecklist.slice(0, 10).map((item, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <div style={{ width: 20, height: 20, borderRadius: 6, background: "#FFFBEB", border: "1px solid #FDE68A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#92400E", flexShrink: 0, marginTop: 1 }}>
                              {i + 1}
                            </div>
                            <p style={{ margin: 0, fontSize: 12, color: C.primary, lineHeight: 1.65 }}>{item}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* No AI feedback yet */}
              {ai && !ai.summaryParagraphs.length && !ai.mistakes.length && !ai.improvements.length && !ai.nextWeekChecklist.length && (
                <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E8EDF2", padding: "40px 24px", textAlign: "center" }}>
                  <p style={{ margin: 0, fontSize: 13, color: C.muted }}>No AI feedback generated yet for this week.</p>
                  <button onClick={onGenerateNow} disabled={busy} style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 6, background: C.bull, border: "none", borderRadius: 8, padding: "10px 20px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    <RefreshCw size={13} /> Generate Now
                  </button>
                </div>
              )}

            </div>
          )}
        </main>
      </div>

      <style jsx global>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes wrShimmer { 100% { transform: translateX(100%); } }
        * { box-sizing: border-box; }
        .wr-skeleton::after {
          content: "";
          position: absolute;
          inset: 0;
          transform: translateX(-100%);
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.68) 50%, transparent 100%);
          animation: wrShimmer 1.2s ease-in-out infinite;
        }

        /* -- Tablet ---------------------------------------- */
        @media (max-width: 900px) {
          .wr-body { grid-template-columns: 1fr !important; padding: 16px !important; }
          .wr-grid { grid-template-columns: 1fr !important; }
        }

        /* -- Mobile ---------------------------------------- */
        @media (max-width: 600px) {
          .wr-body { padding: 12px !important; gap: 12px !important; }

          /* Header */
          .wr-gen-label { display: none; }
          .wr-gen-btn   { padding: 8px 10px !important; }

          /* Sidebar: static + horizontal scrollable list on mobile */
          aside { position: static !important; }
          .wr-sidebar-list {
            flex-direction: row !important;
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
          .wr-sidebar-list::-webkit-scrollbar { display: none; }
          .wr-sidebar-list > button {
            min-width: 160px !important;
            border-bottom: none !important;
            border-right: 1px solid #F4F2EE !important;
            flex-shrink: 0 !important;
          }

          /* Week header */
          .wr-kpi-row { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

export default function WeeklyReportsPage() {
  return (
    <Suspense fallback={<LoadingSpinner message="Loading..." fullPage />}>
      <WeeklyReportsContent />
    </Suspense>
  );
}
