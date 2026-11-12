"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Lock, Target } from "lucide-react";
import { Badge, Button, Placeholder } from "@/features/shared/components/ui";
import { getSharedTradingDna } from "@/features/trading-dna";
import { archetypeAccent } from "@/features/trading-dna/components/tokens";
import { hasValidAuthToken } from "@/utils/auth";

// Public page: anyone with the link can open it, logged in or not. No app
// shell; just the shared summary and a way to make your own.

function SharedReportView() {
  const params = useSearchParams();
  const token = params.get("t");
  const [state, setState] = useState(() =>
    token
      ? { loading: true, error: null, data: null }
      : { loading: false, error: "This link is missing its code. Ask the person who shared it to send it again.", data: null }
  );
  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    (async () => {
      try {
        const data = await getSharedTradingDna(token, controller.signal);
        setState({ loading: false, error: null, data, signedIn: hasValidAuthToken() });
      } catch (err) {
        if (controller.signal.aborted) return;
        const status = err?.status;
        const message =
          status === 401
            ? "This link has expired or isn't valid any more."
            : status === 404
              ? "This report has been removed."
              : status === 429
                ? "Too many requests. Wait a minute and refresh."
                : "Couldn't load this report. Check your connection and refresh.";
        setState({ loading: false, error: message, data: null, signedIn: hasValidAuthToken() });
      }
    })();
    return () => controller.abort();
  }, [token]);

  const data = state.data;
  const accent = archetypeAccent(data?.identity?.archetype);

  return (
    <div className="ec-app ec-dna-share">
      <main className="ec-dna-share__main">
        <p className="ec-dna-share__brand">Edgecipline · Trading DNA</p>

        {state.loading ? (
          <div className="ec-disc__stack" aria-busy="true" aria-label="Loading shared report">
            <div className="ec-card ec-card--pad">
              <Placeholder width="35%" height={12} />
              <Placeholder width="65%" height={34} style={{ marginTop: 14 }} />
              <Placeholder width="90%" height={14} style={{ marginTop: 14 }} />
            </div>
            <div className="ec-card ec-card--pad">
              <Placeholder width="30%" height={14} />
              <Placeholder height={60} style={{ marginTop: 14 }} />
            </div>
          </div>
        ) : state.error ? (
          <div className="ec-card">
            <div className="ec-state">
              <span className="ec-state__icon" aria-hidden="true"><Lock size={22} /></span>
              <h1 className="ec-state__title">This shared report isn&apos;t available</h1>
              <p className="ec-state__body">{state.error}</p>
            </div>
          </div>
        ) : data ? (
          <ReportBody data={data} accent={accent} />
        ) : null}

        {state.loading ? null : (
        <div className="ec-dna-share__cta">
          <p>Find out what kind of trader you are, from your own trades.</p>
          <Button as={Link} href={state.signedIn ? "/trading-dna" : "/register"}>
            {state.signedIn ? "See my Trading DNA" : "Build my own Trading DNA"}
          </Button>
        </div>
        )}
      </main>
    </div>
  );
}

function ReportBody({ data, accent }) {
  const identity = data.identity || {};
  return (
    <div className="ec-disc__stack">
      <section className="ec-card ec-card--pad ec-dna__hero" style={{ "--dna-accent": accent }}>
        <p className="ec-dna__eyebrow">Trading identity</p>
        <h1 className="ec-dna__archetype">{identity.archetype || "Still forming"}</h1>
        {identity.tagline ? <p className="ec-dna__tagline">{identity.tagline}</p> : null}
        {identity.oneLiner ? <p className="ec-dna__oneliner">{identity.oneLiner}</p> : null}
        <div className="ec-dna__meta">
          {data.sample?.totalTrades != null ? (
            <span>Based on <strong>{data.sample.totalTrades}</strong> trades</span>
          ) : null}
          {data.sample?.lowSample ? <Badge tone="warning">Early read: small sample</Badge> : null}
        </div>
      </section>

      {data.psychologyScore != null || data.planAdherencePct != null ? (
        <div className="ec-dna-share__stats">
          {data.psychologyScore != null ? (
            <div className="ec-card ec-card--pad">
              <p className="ec-disc__eyebrow">Psychology score</p>
              <p className="ec-dna-share__num">{data.psychologyScore}<span>/100</span></p>
            </div>
          ) : null}
          {data.planAdherencePct != null ? (
            <div className="ec-card ec-card--pad">
              <p className="ec-disc__eyebrow">Plan followed</p>
              <p className="ec-dna-share__num">{data.planAdherencePct}<span>%</span></p>
            </div>
          ) : null}
        </div>
      ) : null}

      {data.coachSummary ? (
        <section className="ec-card ec-card--pad">
          <h2 className="ec-card__title">Coach summary</h2>
          <p className="ec-dna__prose" style={{ marginTop: 10 }}>{data.coachSummary}</p>
        </section>
      ) : null}

      {data.topStrengths?.length ? (
        <section className="ec-card ec-card--pad">
          <h2 className="ec-card__title">Top strengths</h2>
          <ul className="ec-dna-share__list">
            {data.topStrengths.map((s, i) => (
              <li key={`${s.title}-${i}`}>
                <Check size={16} aria-hidden="true" className="ec-tone--good" />
                <span>{s.title}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.topImprovement ? (
        <section className="ec-card ec-card--pad">
          <h2 className="ec-card__title ec-dna__title-icon">
            <Target size={16} aria-hidden="true" className="ec-tone--good" /> Working on next
          </h2>
          <p className="ec-dna__item-title" style={{ marginTop: 10 }}>{data.topImprovement.priority}</p>
          {data.topImprovement.action ? <p className="ec-dna__item-text">{data.topImprovement.action}</p> : null}
        </section>
      ) : null}

      {data.confidenceNote ? <p className="ec-dna__fine" style={{ textAlign: "center" }}>{data.confidenceNote}</p> : null}
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
