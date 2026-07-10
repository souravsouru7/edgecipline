"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/features/shared/components/PageHeader";
import { useStreaks, useMarkNoTradeToday } from "@/features/streaks/hooks/useStreaks";
import StreakCalendar from "@/features/streaks/components/StreakCalendar";
import StreakMilestones from "@/features/streaks/components/StreakMilestones";

export default function StreaksPage() {
  const { data, isLoading, error } = useStreaks(90);
  const markNoTrade = useMarkNoTradeToday();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  if (isLoading) return <PageShell><LoadingState /></PageShell>;
  if (error)     return <PageShell><ErrorState /></PageShell>;
  if (!data)     return <PageShell><EmptyState /></PageShell>;

  const journal = data.journal || { current: 0, longest: 0, atRisk: false, recoveryAvailable: true };
  const checklist = data.checklist || { current: 0, longest: 0 };
  const rule = data.rule || { current: 0, longest: 0, threshold: 70 };
  const calendar = data.calendar || [];
  const milestones = data.milestones || [];
  const todayKey = data.todayKey;
  const todayCell = calendar.find((c) => c.day === todayKey);
  const alreadyLoggedToday = !!todayCell && todayCell.qualifiesJournal;

  return (
    <PageShell>
      {/* ── Hero block ─────────────────────────────────────────────── */}
      <section style={heroCard}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{
            fontSize: 64, fontWeight: 800, lineHeight: 1,
            color: journal.current > 0 ? "#F59E0B" : "#94A3B8",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {journal.current > 0 ? "🔥" : "✨"}
            <span style={{ marginLeft: 12 }}>{journal.current}</span>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 0.15, color: "#7A3E0B", textTransform: "uppercase" }}>
              Discipline Streak
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0F1923", margin: "6px 0 4px" }}>
              {headlineFor(journal)}
            </h1>
            <p style={{ fontSize: 13, color: "#64748B", margin: 0, maxWidth: 520 }}>
              {subFor(journal, alreadyLoggedToday)}
            </p>
          </div>
        </div>

        {/* Action row — never punitive. Two clear options. */}
        {!alreadyLoggedToday && (
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            <Link href="/add-trade" style={primaryButton}>
              Log a trade — 30 sec
            </Link>
            <button onClick={() => setNoteOpen(!noteOpen)} style={secondaryButton} type="button">
              I sat out today
            </button>
          </div>
        )}

        {noteOpen && !alreadyLoggedToday && (
          <div style={{ marginTop: 14, padding: 14, background: "#FEF3C7", borderRadius: 10, border: "1px solid #FBBF24" }}>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "#7A3E0B", fontWeight: 700 }}>
              Mark today as "Sat Out" — keeps your streak alive without trading.
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 280))}
              placeholder="Optional: why you sat out (e.g. no setup, high impact news)"
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #FBBF24", borderRadius: 8, fontSize: 13, marginBottom: 10 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => markNoTrade.mutate({ note }, { onSuccess: () => { setNoteOpen(false); setNote(""); } })}
                disabled={markNoTrade.isPending}
                style={primaryButton}
                type="button"
              >
                {markNoTrade.isPending ? "Saving…" : "Mark Sat Out"}
              </button>
              <button onClick={() => setNoteOpen(false)} style={secondaryButton} type="button">Cancel</button>
            </div>
          </div>
        )}

        {alreadyLoggedToday && (
          <div style={{ marginTop: 18, padding: 12, background: "#ECFDF5", borderRadius: 10, border: "1px solid #A7F3D0", color: "#065F46", fontSize: 13, fontWeight: 700 }}>
            ✅ Today is locked in. See you tomorrow.
          </div>
        )}
      </section>

      {/* ── Milestones strip ──────────────────────────────────────── */}
      <section style={card}>
        <SectionTitle title="Milestones" subtitle="Lit cells are streaks you've already protected" />
        <StreakMilestones milestones={milestones} current={journal.current} longest={journal.longest} />
      </section>

      {/* ── Calendar ──────────────────────────────────────────────── */}
      <section style={card}>
        <SectionTitle title="Last 12 weeks" subtitle="Every cell is a day you showed up — or didn't" />
        <StreakCalendar calendar={calendar} />
      </section>

      {/* ── Other streaks ─────────────────────────────────────────── */}
      <section style={card}>
        <SectionTitle title="Other discipline measures" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 8 }}>
          <MetricBlock
            label="Checklist Streak"
            value={checklist.current}
            sub={`Best ${checklist.longest}`}
            hint="Trading days where you ran the pre-trade checklist."
          />
          <MetricBlock
            label="Rule Discipline Streak"
            value={rule.current}
            sub={`Best ${rule.longest} • threshold ${rule.threshold}%`}
            hint="Consecutive trades where your setup score met your threshold."
          />
        </div>
      </section>
    </PageShell>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function headlineFor(j) {
  if (j.current >= 30) return "A full month of discipline.";
  if (j.current >= 14) return "Two weeks of consistency.";
  if (j.current >= 7)  return "A full week protected.";
  if (j.current >= 3)  return "Momentum is building.";
  if (j.current >= 1)  return "You're on day one.";
  return "Start a new streak today.";
}

function subFor(j, alreadyLogged) {
  if (alreadyLogged && j.current >= 1) {
    return "You showed up today. The streak rolls on tomorrow.";
  }
  if (j.atRisk && j.current >= 1) {
    return j.recoveryAvailable
      ? "Your streak is safe if you log today — even a 'Sat Out' counts."
      : "Log today to keep it alive.";
  }
  if (j.current === 0 && j.longest > 0) {
    return `Your best run was ${j.longest} days. Today is day one of the next one.`;
  }
  return "One trade or one Sat Out is all today needs.";
}

// ── Layout primitives ───────────────────────────────────────────────────────

function PageShell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#F4F2EE", fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#0F1923" }}>
      <PageHeader />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        {children}
      </main>
    </div>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#0F1923" }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>{subtitle}</div>}
    </div>
  );
}

function MetricBlock({ label, value, sub, hint }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 12, background: "#FFFFFF", border: "1px solid #E2E8F0" }}>
      <div style={{ fontSize: 10, color: "#94A3B8", letterSpacing: 0.1, textTransform: "uppercase", fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 28, color: "#0F1923", fontWeight: 800, marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>{sub}</div>
      {hint && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 8, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

function LoadingState() {
  return <div style={{ ...card, padding: 30, textAlign: "center", color: "#94A3B8" }}>Loading streaks…</div>;
}
function ErrorState() {
  return <div style={{ ...card, padding: 30, textAlign: "center", color: "#D63B3B" }}>Couldn't load streaks. Pull to refresh.</div>;
}
function EmptyState() {
  return (
    <div style={{ ...card, padding: 30, textAlign: "center", color: "#64748B" }}>
      No streaks yet. <Link href="/add-trade" style={{ color: "#0D9E6E", fontWeight: 700 }}>Log your first trade</Link> to begin.
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const card = {
  background: "#FFFFFF",
  borderRadius: 14,
  border: "1px solid #E2E8F0",
  padding: 20,
  boxShadow: "0 2px 12px rgba(15,25,35,0.04)",
};

const heroCard = {
  ...card,
  background: "linear-gradient(135deg, #FFFBEB 0%, #FFFFFF 60%)",
  borderColor: "#FCD34D",
  padding: 24,
};

const primaryButton = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "10px 16px", borderRadius: 10, background: "#0F1923", color: "#FFFFFF",
  border: "none", fontWeight: 800, fontSize: 13, cursor: "pointer", textDecoration: "none",
};
const secondaryButton = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "10px 16px", borderRadius: 10, background: "#FFFFFF", color: "#0F1923",
  border: "1px solid #CBD5E1", fontWeight: 800, fontSize: 13, cursor: "pointer",
};
