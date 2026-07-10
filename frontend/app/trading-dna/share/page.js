"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSharedTradingDna } from "@/features/trading-dna";

const C = {
  bgDeep: "#0F1923",
  bull: "#0D9E6E",
  bear: "#D63B3B",
  muted: "#94A3B8",
  border: "#E2E8F0",
  primary: "#0F1923",
  surface: "#FFFFFF",
};

const FONT_BODY = "'Plus Jakarta Sans',sans-serif";
const FONT_MONO = "'JetBrains Mono',monospace";

const ARCHETYPE_ACCENTS = {
  "Patient Sniper": "#A855F7",
  "Momentum Rider": "#F97316",
  "Disciplined Grinder": "#0D9E6E",
  "Volatility Surfer": "#06B6D4",
  "Reactive Improviser": "#F43F5E",
  "Range Hunter": "#10B981",
  "Breakout Hunter": "#F59E0B",
  "Risk Curator": "#3B82F6",
  "Mean Reversion Specialist": "#8B5CF6",
  "Trend Follower": "#0EA5E9",
  Scalper: "#EC4899",
  "Swing Builder": "#22C55E",
};

function SharedReportView() {
  const params = useSearchParams();
  const token = params.get("t");
  // Initialise lazily so the "missing token" branch never has to setState
  // synchronously inside an effect.
  const [state, setState] = useState(() =>
    token
      ? { loading: true, error: null, data: null }
      : { loading: false, error: "Missing share token in the URL.", data: null }
  );

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await getSharedTradingDna(token);
        if (!cancelled) setState({ loading: false, error: null, data });
      } catch (err) {
        if (cancelled) return;
        const status = err?.response?.status || err?.status;
        const message =
          err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          (status === 401
            ? "This share link has expired or is no longer valid."
            : "This shared report is no longer available.");
        setState({ loading: false, error: message, data: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const data = state.data;
  const archetype = data?.identity?.archetype || null;
  const accent = archetype
    ? ARCHETYPE_ACCENTS[archetype] || "#8B5CF6"
    : "#8B5CF6";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bgDeep,
        color: "#F8FAFC",
        fontFamily: FONT_BODY,
        padding: "40px 20px",
        boxSizing: "border-box",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />

      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              fontSize: 11,
              color: C.muted,
              letterSpacing: "0.24em",
              fontFamily: FONT_MONO,
              marginBottom: 8,
            }}
          >
            EDGECIPLINE · TRADING DNA
          </div>
          <div style={{ height: 2, width: 48, background: accent, margin: "0 auto" }} />
        </div>

        {state.loading ? (
          <Skeleton />
        ) : state.error ? (
          <ErrorCard message={state.error} />
        ) : data ? (
          <ReportBody data={data} accent={accent} />
        ) : null}

        <footer
          style={{
            marginTop: 48,
            textAlign: "center",
            fontSize: 11,
            color: C.muted,
          }}
        >
          <Link
            href="/dashboard"
            style={{
              color: accent,
              fontWeight: 700,
              textDecoration: "none",
              letterSpacing: "0.04em",
            }}
          >
            Build your own Trading DNA →
          </Link>
        </footer>
      </main>
    </div>
  );
}

function ReportBody({ data, accent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          background: "linear-gradient(135deg,#1A2538 0%,#0F1923 100%)",
          borderRadius: 18,
          padding: "32px 28px",
          border: `1px solid ${accent}55`,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: accent,
            letterSpacing: "0.2em",
            fontWeight: 800,
            marginBottom: 16,
          }}
        >
          TRADING IDENTITY
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 900,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            marginBottom: 10,
          }}
        >
          {data.identity?.archetype || "Building DNA…"}
        </div>
        {data.identity?.tagline ? (
          <div
            style={{
              fontSize: 12,
              color: accent,
              fontFamily: FONT_MONO,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            {data.identity.tagline}
          </div>
        ) : null}
        {data.identity?.oneLiner ? (
          <p
            style={{
              fontSize: 15,
              color: "#CBD5E1",
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            {data.identity.oneLiner}
          </p>
        ) : null}
        <div
          style={{
            marginTop: 20,
            display: "flex",
            gap: 18,
            fontSize: 10,
            color: "#64748B",
            letterSpacing: "0.06em",
            fontFamily: FONT_MONO,
          }}
        >
          {data.sample?.totalTrades != null ? (
            <span>BASED ON {data.sample.totalTrades} TRADES</span>
          ) : null}
          {data.sample?.lowSample ? (
            <span style={{ color: "#F59E0B" }}>PRELIMINARY</span>
          ) : null}
        </div>
      </div>

      {data.coachSummary ? (
        <Card title="COACH SUMMARY" accent={accent}>
          <p
            style={{
              fontSize: 14,
              color: "#E2E8F0",
              lineHeight: 1.8,
              margin: 0,
            }}
          >
            {data.coachSummary}
          </p>
        </Card>
      ) : null}

      {data.topStrengths?.length ? (
        <Card title="TOP STRENGTHS" accent={accent}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.topStrengths.map((s, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontSize: 14,
                  color: "#E2E8F0",
                }}
              >
                <span style={{ color: accent, fontWeight: 900 }}>✓</span>
                {s.title}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {data.topImprovement ? (
        <Card title="HIGHEST-LEVERAGE FOCUS" accent={accent}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: "#F8FAFC",
              marginBottom: 8,
            }}
          >
            {data.topImprovement.priority}
          </div>
          {data.topImprovement.action ? (
            <div
              style={{
                fontSize: 13,
                color: "#CBD5E1",
                lineHeight: 1.6,
              }}
            >
              {data.topImprovement.action}
            </div>
          ) : null}
        </Card>
      ) : null}

      {data.psychologyScore != null || data.planAdherencePct != null ? (
        <Card title="HEADLINE METRICS" accent={accent}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
              gap: 14,
            }}
          >
            {data.psychologyScore != null ? (
              <Metric label="Psychology score" value={`${data.psychologyScore}/100`} accent={accent} />
            ) : null}
            {data.planAdherencePct != null ? (
              <Metric label="Plan adherence" value={`${data.planAdherencePct}%`} accent={accent} />
            ) : null}
          </div>
        </Card>
      ) : null}

      {data.confidenceNote ? (
        <div
          style={{
            fontSize: 11,
            color: C.muted,
            textAlign: "center",
            fontFamily: FONT_MONO,
            letterSpacing: "0.04em",
            paddingTop: 4,
          }}
        >
          {data.confidenceNote}
        </div>
      ) : null}
    </div>
  );
}

function Card({ title, accent, children }) {
  return (
    <div
      style={{
        background: "#0B1422",
        borderRadius: 14,
        padding: "20px 22px",
        border: "1px solid rgba(148,163,184,0.15)",
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: accent,
          letterSpacing: "0.18em",
          fontWeight: 800,
          marginBottom: 14,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: C.muted,
          letterSpacing: "0.1em",
          marginBottom: 6,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 900,
          color: accent,
          fontFamily: FONT_MONO,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ErrorCard({ message }) {
  return (
    <div
      style={{
        background: "#0B1422",
        borderRadius: 14,
        padding: "32px 24px",
        border: "1px solid rgba(214,59,59,0.4)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 30, marginBottom: 14 }}>🔒</div>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>
        Share link unavailable
      </div>
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
        {message}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          background: "#0B1422",
          borderRadius: 18,
          padding: "32px 24px",
          height: 240,
        }}
      />
      <div
        style={{
          background: "#0B1422",
          borderRadius: 14,
          padding: "20px 22px",
          height: 140,
        }}
      />
      <div
        style={{
          background: "#0B1422",
          borderRadius: 14,
          padding: "20px 22px",
          height: 120,
        }}
      />
    </div>
  );
}

export default function SharedTradingDnaPage() {
  return (
    <Suspense fallback={null}>
      <SharedReportView />
    </Suspense>
  );
}
