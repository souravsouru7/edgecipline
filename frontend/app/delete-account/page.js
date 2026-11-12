"use client";

import Link from "next/link";
import LegalShell, { Section, BulletList } from "@/features/legal/LegalShell";

// Public account-deletion page.
//
// Google Play's User Data policy requires a deletion URL that is reachable
// WITHOUT signing in, and that the URL be listed in the Play Console Data
// safety form. This page is that URL. It documents the in-app path (which is
// what actually performs the deletion) plus an email fallback for people who
// no longer have access to the app.
//
// Deliberately no auth guard and no PageHeader (LegalShell needs no session) — a Play reviewer opens this
// cold in a browser with no session.

const IN_APP_STEPS = [
  "Open Edgecipline and sign in.",
  "Go to Settings (the Settings tab, or Profile in the account menu).",
  'Scroll to the "Danger zone" section at the bottom.',
  'Tap "Delete account".',
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

export default function DeleteAccountPage() {
  return (
    <LegalShell
      title="Deleting your Edgecipline account"
      related={[
        { href: "/privacy-policy", label: "Privacy Policy" },
        { href: "/terms", label: "Terms of Service" },
        { href: "/support", label: "Support" },
      ]}
    >
      <p className="ec-legal__lead">
        Edgecipline is published by Edgecipline (app ID <code>com.edgecipline</code>). This page
        explains how to delete your account and exactly what happens to your data when you do.
      </p>

      <div className="ec-legal__callout ec-legal__callout--bad">
        Account deletion is <strong>immediate and permanent</strong>. There is no
        grace period and no way for us to restore your journal afterwards. Export
        anything you want to keep before you start: in the app, go to Settings, then
        Your data, to download your trades as a spreadsheet.
      </div>

      <Section title="1. Delete from inside the app">
        <p>The fastest way, and the one we recommend:</p>
        <ol className="ec-legal__steps">
          {IN_APP_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="ec-legal__note">
          Your account is erased as soon as you confirm, and you are signed out on
          every device.
        </p>
      </Section>

      <Section title="2. If you cannot access the app">
        <p>
          Email{" "}
          <a href="mailto:dream@edgecipline.com?subject=Account%20deletion%20request">
            dream@edgecipline.com
          </a>{" "}
          from the address registered to your account, with the subject{" "}
          <em>Account deletion request</em>.
        </p>
        <p>
          We verify that the request comes from the account owner and complete the
          deletion within 30 days, usually much sooner. We will confirm by email
          once it is done.
        </p>
      </Section>

      <Section title="3. What is deleted">
        <p>Deleting your account permanently removes:</p>
        <BulletList items={DELETED_IMMEDIATELY} />
      </Section>

      <Section title="4. What is retained, and why">
        {RETAINED.map((row) => (
          <div key={row.what} className="ec-legal__kept">
            <strong>{row.what}</strong>
            <p>{row.why}</p>
          </div>
        ))}
        <p className="ec-legal__note">
          Anonymous, aggregated statistics that cannot be linked back to you may
          also be retained. Nothing in this category identifies you.
        </p>
      </Section>

      <Section title="5. Related">
        <p className="ec-legal__links">
          <Link href="/privacy-policy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/support">Support</Link>
        </p>
      </Section>
    </LegalShell>
  );
}
