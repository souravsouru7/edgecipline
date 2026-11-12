"use client";

import LegalShell, { Section, BulletList, Highlight } from "@/features/legal/LegalShell";

// Public legal page: reachable with no session (store listings link here).
// The legal text is unchanged; only the frame and colours follow the theme.

const toc = [
    { id: "information-collected", label: "Information We Collect" },
    { id: "how-we-use", label: "How We Use Your Data" },
    { id: "data-storage", label: "Data Storage & Security" },
    { id: "third-party", label: "Third-Party Services" },
    { id: "data-sharing", label: "Data Sharing" },
    { id: "user-rights", label: "Your Rights" },
    { id: "data-retention", label: "Data Retention" },
    { id: "children", label: "Children's Privacy" },
    { id: "changes", label: "Changes to This Policy" },
    { id: "contact", label: "Contact Us" },
  ];

export default function PrivacyPolicyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro="We respect your privacy and are committed to protecting your personal data. This policy explains how Edgecipline handles your information."
      updated="August 6, 2026"
      toc={toc}
      related={[{ href: "/terms", label: "Terms & Conditions" }, { href: "/delete-account", label: "Delete your account" }, { href: "/support", label: "Help" }]}
    >
        {/* ── INTRO ── */}
        <p style={{ fontSize: 15, color: "var(--ec-text-2)", lineHeight: 1.8, marginBottom: 48 }}>
          This Privacy Policy describes how <strong style={{ color: "var(--ec-text)" }}>Edgecipline</strong> {"(\"we,\" \"our,\" or \"us\") collects, uses, and protects your information when you use our mobile and web application. By using Edgecipline, you agree to the collection and use of information as outlined in this policy."}
        </p>

        {/* ── SECTION 1 ── */}
        <Section title="1. Information We Collect" id="information-collected">
          <p style={{ marginBottom: 12 }}>We collect the following categories of information to provide and improve our services:</p>

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ec-text)", marginBottom: 8, marginTop: 20 }}>Account Information</h3>
          <BulletList items={[
            "Full name (provided during registration)",
            "Email address (used for authentication and communication)",
            "Password (stored securely via Firebase Authentication — we never see your plain-text password)",
          ]} />

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ec-text)", marginBottom: 8, marginTop: 20 }}>Trading Data</h3>
          <BulletList items={[
            "Trade journal entries including notes, trade details, and performance records",
            "Pre-trade checklist responses",
            "Uploaded screenshots and images related to trades",
          ]} />

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ec-text)", marginBottom: 8, marginTop: 20 }}>AI-Generated Content</h3>
          <BulletList items={[
            "AI-generated feedback and insights based on your trade data",
            "Performance analysis and pattern observations",
          ]} />

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ec-text)", marginBottom: 8, marginTop: 20 }}>What We Do NOT Collect</h3>
          <BulletList items={[
            "Profile photos or profile pictures",
            "Financial account information, broker credentials, or banking details",
            "Device identifiers or advertising IDs for tracking purposes",
            "Location data",
          ]} />
        </Section>

        {/* ── SECTION 2 ── */}
        <Section title="2. How We Use Your Data" id="how-we-use">
          <p style={{ marginBottom: 12 }}>Your data is used strictly to provide you with the features of Edgecipline:</p>
          <BulletList items={[
            "To authenticate your identity and maintain your account",
            "To store and display your trade journal entries and checklist responses",
            "To generate AI-powered feedback and performance insights from your trading data",
            "To provide analytics and performance tracking within the app",
            "To process your subscription and manage access to premium features",
            "To respond to your support requests",
            "To improve the reliability and features of the application",
          ]} />
          <Highlight>
            Edgecipline does NOT use your data for advertising, does NOT sell your data to third parties, and does NOT use your data to train general-purpose AI models.
          </Highlight>
        </Section>

        {/* ── SECTION 3 ── */}
        <Section title="3. Data Storage & Security" id="data-storage">
          <p style={{ marginBottom: 16 }}>We use reputable cloud infrastructure to store your data securely:</p>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginBottom: 16 }}>
            {[
              { name: "Firebase (Google)", desc: "Used for user authentication and secure login management.", color: "#F97316" },
              { name: "MongoDB Atlas", desc: "Used for storing trade journal entries, insights, checklists, and app data.", color: "var(--ec-accent-text)" },
            ].map((s) => (
              <div key={s.name} style={{
                background: "color-mix(in srgb, var(--ec-text) 3%, transparent)",
                border: `1px solid ${s.color}33`,
                borderLeft: `3px solid ${s.color}`,
                borderRadius: "0 12px 12px 0",
                padding: "16px 18px",
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: s.color, marginBottom: 6 }}>{s.name}</div>
                <div style={{ fontSize: 13, color: "var(--ec-text-2)", lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>

          <BulletList items={[
            "All data is transmitted over encrypted HTTPS connections",
            "Authentication tokens and passwords are handled by Firebase's secure infrastructure",
            "Uploaded images are stored in secure cloud storage with access controls",
            "We regularly review security practices to protect your information",
          ]} />
        </Section>

        {/* ── SECTION 4 ── */}
        <Section title="4. Third-Party Services" id="third-party">
          <p style={{ marginBottom: 12 }}>Edgecipline integrates with the following third-party services:</p>
          <BulletList items={[
            "Google Sign-In (Firebase Authentication) — for social login. Google's privacy policy governs how Google handles your Google account data.",
            "Firebase (Google Cloud) — for authentication infrastructure.",
            "MongoDB Atlas — for database storage.",
            "AI Services — to generate trading insights and feedback based on your inputs.",
          ]} />
          <p style={{ marginTop: 16 }}>
            These services are bound by their own privacy policies. We encourage you to review their policies as they govern their use of data. We only share the minimum necessary data with these services to provide our features.
          </p>
        </Section>

        {/* ── SECTION 5 ── */}
        <Section title="5. Data Sharing" id="data-sharing">
          <Highlight>
            We do not sell, rent, trade, or otherwise transfer your personal information to third parties for commercial purposes.
          </Highlight>
          <p style={{ marginTop: 12 }}>We may share data only in the following limited circumstances:</p>
          <BulletList items={[
            "With service providers (Firebase, MongoDB) strictly to operate the platform",
            "If required by applicable law, regulation, or valid legal process",
            "To protect the rights, property, or safety of Edgecipline, our users, or the public",
            "In the event of a business merger or acquisition — users will be notified",
          ]} />
        </Section>

        {/* ── SECTION 6 ── */}
        <Section title="6. Your Rights" id="user-rights">
          <p style={{ marginBottom: 12 }}>You have full control over your personal data:</p>
          <BulletList items={[
            "Access — You can view all your trade data, journal entries, and insights within the app at any time",
            "Correction — You can edit or update your account information and trade entries",
            "Deletion — You can delete individual trade entries or permanently delete your entire account and all associated data from within the app settings",
            "Data Portability — Contact us to request a copy of your data",
            "Withdrawal of Consent — You may stop using the app at any time; account deletion removes all stored data",
          ]} />
          <p style={{ marginTop: 16 }}>
            To exercise any of these rights or for data-related requests, contact us at{" "}
            <a href="mailto:dream@edgecipline.com" style={{ color: "var(--ec-accent-text)", textDecoration: "none" }}>
              dream@edgecipline.com
            </a>.
          </p>
        </Section>

        {/* ── SECTION 7 ── */}
        <Section title="7. Data Retention" id="data-retention">
          <BulletList items={[
            "Your data is retained as long as your account remains active",
            "When you delete your account, all personal data — including trade entries, images, insights, and account details — is permanently deleted from our systems",
            "Payment and invoice records are retained after account deletion where required by law. These contain no personal information beyond an internal account identifier, which no longer identifies anyone once your account is removed",
            "Some anonymized, non-identifiable data may be retained for product improvement and analytics",
            "Backups may retain data for a limited period (up to 30 days) before permanent deletion",
          ]} />
        </Section>

        {/* ── SECTION 8 ── */}
        <Section title="8. Children's Privacy" id="children">
          <p>
            Edgecipline is not directed at individuals under the age of 18. We do not knowingly collect personal information from minors. If you believe a minor has provided us with personal data, please contact us immediately and we will delete the information.
          </p>
        </Section>

        {/* ── SECTION 9 ── */}
        <Section title="9. Changes to This Policy" id="changes">
          <p>
            {"We may update this Privacy Policy from time to time to reflect changes in our practices or legal requirements. When we make material changes, we will notify you by updating the \"Last Updated\" date at the top of this page and, where appropriate, through an in-app notification. Continued use of the app after changes constitute acceptance of the updated policy."}
          </p>
        </Section>

        {/* ── SECTION 10 ── */}
        <Section title="10. Contact Us" id="contact">
          <p style={{ marginBottom: 16 }}>
            If you have any questions, concerns, or requests regarding this Privacy Policy or your personal data, please reach out to us:
          </p>
          <div style={{
            background: "color-mix(in srgb, var(--ec-accent) 6%, transparent)",
            border: "1px solid color-mix(in srgb, var(--ec-accent) 20%, transparent)",
            borderRadius: 14,
            padding: "24px 28px",
            display: "inline-block",
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ec-text)", marginBottom: 4 }}>Edgecipline</div>
            <div style={{ fontSize: 14, color: "var(--ec-text-2)", marginBottom: 12 }}>Privacy & Data Requests</div>
            <a href="mailto:dream@edgecipline.com" style={{
              display: "flex", alignItems: "center", gap: 8,
              color: "var(--ec-accent-text)", textDecoration: "none", fontSize: 14, fontWeight: 700,
              marginBottom: 8,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              dream@edgecipline.com
            </a>
            <a href="tel:+919061650463" style={{
              display: "flex", alignItems: "center", gap: 8,
              color: "var(--ec-accent-text)", textDecoration: "none", fontSize: 14, fontWeight: 700,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.13 6.13l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              +91 90616 50463
            </a>
          </div>
        </Section>
    </LegalShell>
  );
}
