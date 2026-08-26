"use client";

import Link from "next/link";

// Public account-deletion page.
//
// Google Play's User Data policy requires a deletion URL that is reachable
// WITHOUT signing in, and that the URL be listed in the Play Console Data
// safety form. This page is that URL. It documents the in-app path (which is
// what actually performs the deletion) plus an email fallback for people who
// no longer have access to the app.
//
// Deliberately no auth guard and no PageHeader — a Play reviewer opens this
// cold in a browser with no session.

const C = {
  bg: "#080D12",
  panel: "rgba(255,255,255,0.03)",
  border: "rgba(34,199,142,0.15)",
  green: "#22C78E",
  gold: "#B8860B",
  red: "#F87171",
  text: "#CBD5E1",
  heading: "#F1F5F9",
  muted: "#94A3B8",
};

const IN_APP_STEPS = [
  "Open Edgecipline and sign in.",
  "Go to Profile from the account menu.",
  'Scroll to the "Danger Zone" section at the bottom.',
  'Tap "Delete my account".',
  "Type your email address to confirm, then tap Delete permanently.",
];

const DELETED_IMMEDIATELY = [
  "Your profile, login credentials and authentication records",
  "Every trade you have logged, in both Forex and Indian Market journals",
  "All uploaded screenshots and trade images",
  "Reflections, pre-trade checklists, streaks and discipline history",
  "AI coach conversations and generated weekly reports",
  "Setups, missions, trading DNA reports and analytics events",
  "Push notification tokens and notification preferences",
];

const RETAINED = [
  {
    what: "Payment and invoice records",
    why: "Financial records are subject to statutory retention requirements. They contain no personal information beyond an internal account identifier, which no longer resolves to a person once your account is deleted.",
  },
];

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 19,
          fontWeight: 800,
          color: C.green,
          marginBottom: 14,
          paddingBottom: 9,
          borderBottom: `1px solid ${C.border}`,
          letterSpacing: "0.02em",
        }}
      >
        {title}
      </h2>
      <div style={{ color: C.text, fontSize: 15, lineHeight: 1.8 }}>{children}</div>
    </section>
  );
}

function Bullets({ items }) {
  return (
    <ul style={{ paddingLeft: 0, listStyle: "none", marginTop: 10 }}>
      {items.map((item) => (
        <li
          key={item}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 9,
            color: C.text,
            fontSize: 14.5,
            lineHeight: 1.7,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              background: C.green,
              borderRadius: "50%",
              marginTop: 8,
              flexShrink: 0,
            }}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function DeleteAccountPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        fontFamily: "'Plus Jakarta Sans', Arial, sans-serif",
        color: "#E2E8F0",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          height: 60,
          background: "rgba(8,13,18,0.95)",
          borderBottom: "1px solid rgba(34,199,142,0.1)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: C.heading,
              letterSpacing: "0.04em",
            }}
          >
            DELETE YOUR ACCOUNT
          </div>
          <div
            style={{
              fontSize: 9,
              color: C.green,
              letterSpacing: "0.15em",
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700,
            }}
          >
            EDGECIPLINE
          </div>
        </div>
        <Link
          href="/"
          style={{
            textDecoration: "none",
            fontSize: 11,
            fontWeight: 700,
            color: C.gold,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.08em",
          }}
        >
          HOME
        </Link>
      </header>

      <div
        style={{
          height: 2,
          background: `linear-gradient(90deg, ${C.green} 0%, ${C.gold} 50%, ${C.green} 100%)`,
        }}
      />

      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px 80px" }}>
        <h1
          style={{
            fontSize: 30,
            fontWeight: 800,
            color: C.heading,
            marginBottom: 10,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
          }}
        >
          Deleting your Edgecipline account
        </h1>
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 30, lineHeight: 1.7 }}>
          Edgecipline is published by Edgecipline (app ID{" "}
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: C.text }}>
            com.edgecipline
          </span>
          ). This page explains how to delete your account and exactly what happens
          to your data when you do.
        </p>

        <div
          style={{
            background: "rgba(248,113,113,0.07)",
            border: "1px solid rgba(248,113,113,0.3)",
            borderLeft: `3px solid ${C.red}`,
            borderRadius: "0 10px 10px 0",
            padding: "14px 18px",
            marginBottom: 36,
            color: "#FCA5A5",
            fontSize: 14,
            lineHeight: 1.7,
          }}
        >
          Account deletion is <strong>immediate and permanent</strong>. There is no
          grace period and no way for us to restore your journal afterwards. Export
          anything you want to keep before you start.
        </div>

        <Section title="1. Delete from inside the app">
          <p>The fastest way, and the one we recommend:</p>
          <ol style={{ paddingLeft: 20, marginTop: 12 }}>
            {IN_APP_STEPS.map((step) => (
              <li
                key={step}
                style={{ marginBottom: 8, fontSize: 14.5, lineHeight: 1.7, color: C.text }}
              >
                {step}
              </li>
            ))}
          </ol>
          <p style={{ marginTop: 12, color: C.muted, fontSize: 13.5 }}>
            Your account is erased as soon as you confirm, and you are signed out on
            every device.
          </p>
        </Section>

        <Section title="2. If you cannot access the app">
          <p>
            Email{" "}
            <a
              href="mailto:edgecipline@gmail.com?subject=Account%20deletion%20request"
              style={{ color: C.green, textDecoration: "none", fontWeight: 600 }}
            >
              edgecipline@gmail.com
            </a>{" "}
            from the address registered to your account, with the subject{" "}
            <em>Account deletion request</em>.
          </p>
          <p style={{ marginTop: 10 }}>
            We verify that the request comes from the account owner and complete the
            deletion within 30 days, usually much sooner. We will confirm by email
            once it is done.
          </p>
        </Section>

        <Section title="3. What is deleted">
          <p>Deleting your account permanently removes:</p>
          <Bullets items={DELETED_IMMEDIATELY} />
        </Section>

        <Section title="4. What is retained, and why">
          {RETAINED.map((row) => (
            <div key={row.what} style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, color: C.heading, marginBottom: 4, fontSize: 15 }}>
                {row.what}
              </div>
              <div style={{ color: C.text, fontSize: 14.5, lineHeight: 1.7 }}>{row.why}</div>
            </div>
          ))}
          <p style={{ marginTop: 14, color: C.muted, fontSize: 13.5, lineHeight: 1.7 }}>
            Anonymous, aggregated statistics that cannot be linked back to you may
            also be retained. Nothing in this category identifies you.
          </p>
        </Section>

        <Section title="5. Related">
          <p style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <Link href="/privacy-policy" style={{ color: C.green, textDecoration: "none", fontWeight: 600 }}>
              Privacy Policy
            </Link>
            <Link href="/terms" style={{ color: C.green, textDecoration: "none", fontWeight: 600 }}>
              Terms of Service
            </Link>
            <Link href="/support" style={{ color: C.green, textDecoration: "none", fontWeight: 600 }}>
              Support
            </Link>
          </p>
        </Section>
      </main>
    </div>
  );
}
