"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAdminAiCosts } from "@/services/adminApi";

/* ─────────────────────────────────────────
   AI COST ANALYTICS – Light theme
   Every figure is calculated from metered tokens x the price table on the
   server. It is not Google's invoice; the "metered / estimated" split says
   how much of each figure rests on provider usage numbers.
───────────────────────────────────────── */

const FEATURE_LABELS = {
  coach: "AI Coach",
  coach_summary: "Coach summary",
  trade_vision: "Screenshot (Gemini Vision)",
  trade_text: "Screenshot (OCR text AI)",
  trade_text_openai: "Screenshot (OpenAI fallback)",
  ocr_vision: "Cloud Vision OCR",
  weekly_report: "Weekly report",
  trading_dna: "Trading DNA",
  reflection: "Reflection insight",
  mind_progress: "Mind Score line",
};

const isoDay = (d) => d.toISOString().slice(0, 10);

function usd(n) {
  const v = Number(n) || 0;
  if (v === 0) return "$0";
  if (Math.abs(v) < 0.01) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(2)}`;
}

function inr(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1 && v !== 0) return `₹${v.toFixed(3)}`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const num = (n) => (Number(n) || 0).toLocaleString("en-IN");

const card = { background: "white", padding: 20, borderRadius: 16, border: "1px solid #E2E8F0" };
const th = { padding: "12px 16px", fontSize: 11, fontWeight: 700, color: "#64748B", textAlign: "left" };
const td = { padding: "12px 16px", fontSize: 13, borderTop: "1px solid #F1F5F9" };
const tdNum = { ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontSize: 12 };

function SplitNote({ row }) {
  if (!row) return null;
  const parts = [];
  if (row.meteredUsd) parts.push(`metered ${usd(row.meteredUsd)}`);
  if (row.estimatedUsd) parts.push(`estimated ${usd(row.estimatedUsd)}`);
  if (row.unitUsd) parts.push(`unit-priced ${usd(row.unitUsd)}`);
  if (row.legacyRows) parts.push(`${num(row.legacyRows)} unpriced legacy rows`);
  return <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>{parts.join(" · ") || "no spend"}</div>;
}

function Kpi({ label, value, sub, color = "#0F1923", split }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{sub}</div>}
      {split && <SplitNote row={split} />}
    </div>
  );
}

function DailyBars({ daily }) {
  const width = 900;
  const height = 180;
  const pad = 24;
  const max = Math.max(...daily.map((d) => d.costUsd), 0);
  if (!daily.length || max === 0) {
    return <div style={{ color: "#94A3B8", fontSize: 13, padding: 24 }}>No spend recorded in this range.</div>;
  }
  const barW = Math.max(2, (width - pad * 2) / daily.length - 2);
  const axis = { fontSize: 11, color: "#64748B", fontFamily: "'JetBrains Mono',monospace" };
  return (
    <div>
      <div style={{ ...axis, textAlign: "right", marginBottom: 4 }}>max {usd(max)}/day</div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="Daily AI spend">
      {daily.map((d, i) => {
        const x = pad + i * ((width - pad * 2) / daily.length);
        const h = (d.costUsd / max) * height;
        const est = d.costUsd ? (d.estimatedUsd / d.costUsd) * h : 0;
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${usd(d.costUsd)} (${num(d.requests)} requests, estimated ${usd(d.estimatedUsd)})`}</title>
            <rect x={x} y={height - h} width={barW} height={h - est} fill="#B8860B" rx={2} />
            {est > 0 && <rect x={x} y={height - est} width={barW} height={est} fill="#E5C77A" />}
          </g>
        );
      })}
      </svg>
      <div style={{ ...axis, display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span>{daily[0].day}</span>
        <span>{daily[daily.length - 1].day}</span>
      </div>
    </div>
  );
}

function BreakdownTable({ title, rows, keyName, labelFor }) {
  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 16px 8px", fontSize: 13, fontWeight: 800 }}>{title}</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8FAFC" }}>
              <th style={th}>{keyName.toUpperCase()}</th>
              <th style={{ ...th, textAlign: "right" }}>REQUESTS</th>
              <th style={{ ...th, textAlign: "right" }}>COST</th>
              <th style={{ ...th, textAlign: "right" }}>OF WHICH ESTIMATED</th>
              <th style={{ ...th, textAlign: "right" }}>AVG / REQUEST</th>
              <th style={{ ...th, textAlign: "right" }}>FAILED</th>
              <th style={{ ...th, textAlign: "right" }}>RETRIES / HEDGES</th>
              <th style={{ ...th, textAlign: "right" }}>TOKENS IN / OUT / THINK / CACHED</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td style={td} colSpan={8}>No data.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r[keyName]}>
                <td style={{ ...td, fontWeight: 600 }}>{labelFor ? labelFor(r[keyName]) : r[keyName]}</td>
                <td style={tdNum}>{num(r.requests)}</td>
                <td style={tdNum}>{usd(r.costUsd)}<div style={{ color: "#94A3B8" }}>{inr(r.costInr)}</div></td>
                <td style={tdNum}>{usd(r.estimatedUsd)}</td>
                <td style={tdNum}>{usd(r.avgCostPerRequestUsd)}</td>
                <td style={{ ...tdNum, color: r.failures ? "#D63B3B" : undefined }}>{num(r.failures)}</td>
                <td style={tdNum}>{num(r.retries)} / {num(r.hedgedAborted)}</td>
                <td style={tdNum}>{num(r.inputTokens)} / {num(r.outputTokens)} / {num(r.thinkingTokens)} / {num(r.cachedTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AiCostsPage() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(isoDay(new Date(today.getTime() - 29 * 86400000)));
  const [to, setTo] = useState(isoDay(today));
  const [feature, setFeature] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getAdminAiCosts({ from, to, feature }));
    } catch (err) {
      setError(err?.message || "Could not load AI cost analytics.");
    } finally {
      setLoading(false);
    }
  }, [from, to, feature]);

  useEffect(() => { load(); }, [load]);

  const label = (f) => FEATURE_LABELS[f] || f;
  const mostExpensive = data?.byFeature?.[0];

  const input = {
    padding: "8px 10px", borderRadius: 10, border: "1px solid #E2E8F0",
    fontSize: 13, background: "white", color: "#0F1923",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F0EEE9", fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923" }}>
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 28px", height: 60, background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(20px)", borderBottom: "1px solid #E2E8F0",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button aria-label="Back to dashboard" onClick={() => router.push("/admin/dashboard")} style={{ background: "none", border: "none", cursor: "pointer", color: "#0F1923" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>AI COST ANALYTICS</div>
            <div style={{ fontSize: 8, color: "#B8860B", letterSpacing: "0.15em", fontFamily: "'JetBrains Mono'" }}>GEMINI · CLOUD VISION · OPENAI</div>
          </div>
        </div>
      </header>

      <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B 0%,#D63B3B 50%,#B8860B 100%)" }} />

      <main style={{ padding: "28px", maxWidth: 1400, margin: "0 auto", display: "grid", gap: 20 }}>
        {/* Filters */}
        <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "#64748B" }}>
            FROM
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={input} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "#64748B" }}>
            TO
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={input} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "#64748B" }}>
            FEATURE
            <select value={feature} onChange={(e) => setFeature(e.target.value)} style={input}>
              <option value="">All features</option>
              {(data?.features || Object.keys(FEATURE_LABELS)).map((f) => (
                <option key={f} value={f}>{label(f)}</option>
              ))}
            </select>
          </label>
          <button onClick={load} disabled={loading} style={{ ...input, cursor: "pointer", fontWeight: 700, background: "#0F1923", color: "white", border: "none" }}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          {data && (
            <div style={{ fontSize: 11, color: "#94A3B8", marginLeft: "auto" }}>
              Price table {data.pricingVersion} · ₹{data.usdToInr}/$
            </div>
          )}
        </div>

        <div style={{ ...card, background: "#FFFBEB", borderColor: "#F5E2A8", fontSize: 12, color: "#7C5E10" }}>
          <strong>Calculated cost, not the Google invoice.</strong>{" "}
          {data?.note || "Costs are calculated from provider token counts × the server price table."}
          {" "}<em>Metered</em> = provider usage numbers × price table. <em>Estimated</em> = no usage numbers (e.g. an aborted hedge request).
        </div>

        {error && <div style={{ ...card, color: "#D63B3B" }}>{error}</div>}

        {data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 }}>
              <Kpi label="Today" value={usd(data.today.costUsd)} sub={`${inr(data.today.costInr)} · ${num(data.today.requests)} requests`} split={data.today} />
              <Kpi label="This month" value={usd(data.monthToDate.costUsd)} sub={`${inr(data.monthToDate.costInr)} · ${num(data.monthToDate.requests)} requests`} split={data.monthToDate} />
              <Kpi label="Selected range" value={usd(data.totals.costUsd)} sub={`${inr(data.totals.costInr)} · ${num(data.totals.requests)} requests`} split={data.totals} />
              <Kpi label="Avg per request" value={usd(data.totals.avgCostPerRequestUsd)} />
              <Kpi label="Avg per active user" value={usd(data.avgCostPerActiveUserUsd)} sub={`${num(data.activeUsers)} users made AI calls`} />
              <Kpi label="Avg per paying subscriber" value={usd(data.avgCostPerPayingSubscriberUsd)} sub={`${num(data.payingSubscribers)} paying now · payers spent ${usd(data.payingSubscriberCostUsd)}`} />
              <Kpi label="Avg screenshot extraction" value={usd(data.extraction.avgCostUsd)} sub={`${num(data.extraction.operations)} uploads · ${data.extraction.avgRequestsPerOperation.toFixed(2)} calls each`} />
              <Kpi label="Avg Coach reply" value={usd(data.coach.avgCostUsd)} sub={`${num(data.coach.operations)} replies · ${data.coach.avgRequestsPerOperation.toFixed(2)} calls each`} />
              <Kpi label="Failed / retries / hedges" value={`${num(data.totals.failures)} / ${num(data.totals.retries)} / ${num(data.totals.hedgedAborted)}`} color={data.totals.failures ? "#D63B3B" : "#0F1923"} sub="hedges = backup requests aborted" />
              <Kpi label="Most expensive feature" value={mostExpensive ? label(mostExpensive.feature) : "—"} sub={mostExpensive ? `${usd(mostExpensive.costUsd)} in range` : ""} />
            </div>

            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Daily spend <span style={{ fontWeight: 500, color: "#94A3B8", fontSize: 11 }}>(light segment = estimated)</span></div>
              <DailyBars daily={data.daily} />
            </div>

            <BreakdownTable title="Cost by feature" rows={data.byFeature} keyName="feature" labelFor={label} />
            <BreakdownTable title="Cost by model (the model Google says served the call)" rows={data.byModel} keyName="model" />
            <BreakdownTable title="Monthly trend" rows={data.monthly} keyName="month" />

            <div style={{ ...card, padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "16px 16px 8px", fontSize: 13, fontWeight: 800 }}>Heaviest users</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    <th style={th}>USER</th>
                    <th style={{ ...th, textAlign: "right" }}>REQUESTS</th>
                    <th style={{ ...th, textAlign: "right" }}>COST</th>
                    <th style={{ ...th, textAlign: "right" }}>TOKENS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topUsers.length === 0 && <tr><td style={td} colSpan={4}>No data.</td></tr>}
                  {data.topUsers.map((u) => (
                    <tr key={String(u.userId)}>
                      <td style={td}>{u.email || String(u.userId)}</td>
                      <td style={tdNum}>{num(u.requests)}</td>
                      <td style={tdNum}>{usd(u.costUsd)}</td>
                      <td style={tdNum}>{num(u.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
