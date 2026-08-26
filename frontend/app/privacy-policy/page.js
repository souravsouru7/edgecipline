"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

function Section({ title, children, id }) {
  return (
    <section id={id} style={{ marginBottom: 48 }}>
      <h2 style={{
        fontSize: 20,
        fontWeight: 800,
        color: "#22C78E",
        marginBottom: 16,
        paddingBottom: 10,
        borderBottom: "1px solid rgba(34,199,142,0.2)",
        letterSpacing: "0.02em",
      }}>
        {title}
      </h2>
      <div style={{ color: "#CBD5E1", fontSize: 15, lineHeight: 1.8 }}>
        {children}
      </div>
    </section>
  );
}

function BulletList({ items }) {
  return (
    <ul style={{ paddingLeft: 0, listStyle: "none", marginTop: 12 }}>
      {items.map((item) => (
        <li key={item} style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          marginBottom: 10, color: "#CBD5E1", fontSize: 15, lineHeight: 1.7
        }}>
          <span style={{
            width: 6, height: 6, background: "#22C78E", borderRadius: "50%",
            marginTop: 8, flexShrink: 0
          }} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Highlight({ children }) {
  return (
    <div style={{
      background: "rgba(184,134,11,0.08)",
      border: "1px solid rgba(184,134,11,0.25)",
      borderLeft: "3px solid #B8860B",
      borderRadius: "0 10px 10px 0",
      padding: "14px 18px",
      margin: "16px 0",
      color: "#FDE68A",
      fontSize: 14,
      lineHeight: 1.7,
    }}>
      {children}
    </div>
  );
}

export default function PrivacyPolicyPage() {
  const router = useRouter();

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

  return (
    <div style={{
      minHeight: "100vh",
      background: "#080D12",
      fontFamily: "'Plus Jakarta Sans', Arial, sans-serif",
      color: "#E2E8F0",
    }}>

      {/* ── HEADER ── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 60,
        background: "rgba(8,13,18,0.95)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(34,199,142,0.1)",
        position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 1px 24px rgba(0,0,0,0.4)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => router.back()}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#94A3B8", padding: 8, display: "flex", alignItems: "center",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#F1F5F9", letterSpacing: "0.04em" }}>
              PRIVACY POLICY
            </div>
            <div style={{
              fontSize: 9, color: "#22C78E", letterSpacing: "0.15em",
              fontFamily: "'JetBrains Mono'", fontWeight: 700
            }}>
              EDGECIPLINE
            </div>
          </div>
        </div>
        <Link href="/dashboard" style={{
          textDecoration: "none", fontSize: 11, fontWeight: 700,
          color: "#B8860B", fontFamily: "'JetBrains Mono'", letterSpacing: "0.08em"
        }}>
          BACK TO APP
        </Link>
      </header>

      {/* ── GRADIENT BAR ── */}
      <div style={{ height: 2, background: "linear-gradient(90deg, #22C78E 0%, #B8860B 50%, #22C78E 100%)" }} />

      {/* ── HERO ── */}
      <div style={{
        background: "linear-gradient(180deg, #0D1520 0%, #080D12 100%)",
        borderBottom: "1px solid rgba(34,199,142,0.08)",
        padding: "52px 24px 48px",
        textAlign: "center",
      }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "rgba(34,199,142,0.08)", border: "1px solid rgba(34,199,142,0.2)",
          borderRadius: 100, padding: "6px 16px", marginBottom: 20,
        }}>
          <span style={{ fontSize: 10, color: "#22C78E", fontFamily: "'JetBrains Mono'", fontWeight: 700, letterSpacing: "0.12em" }}>
            LEGAL DOCUMENT
          </span>
        </div>
        <h1 style={{
          fontSize: "clamp(28px, 6vw, 44px)",
          fontWeight: 800,
          color: "#F1F5F9",
          lineHeight: 1.15,
          marginBottom: 16,
        }}>
          Privacy Policy
        </h1>
        <p style={{ fontSize: 15, color: "#94A3B8", maxWidth: 540, margin: "0 auto 20px", lineHeight: 1.7 }}>
          We respect your privacy and are committed to protecting your personal data. This policy explains how Edgecipline handles your information.
        </p>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "rgba(255,255,255,0.04)", borderRadius: 8,
          padding: "8px 16px",
          fontSize: 12, color: "#64748B", fontFamily: "'JetBrains Mono'"
        }}>
          Last Updated: August 6, 2026
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px 80px" }}>

        {/* ── TABLE OF CONTENTS ── */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(34,199,142,0.12)",
          borderRadius: 16,
          padding: "28px 32px",
          marginBottom: 56,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color: "#22C78E",
            letterSpacing: "0.15em", fontFamily: "'JetBrains Mono'", marginBottom: 16
          }}>
            TABLE OF CONTENTS
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px 24px" }}>
            {toc.map((item, i) => (
              <a key={item.id} href={`#${item.id}`} style={{
                display: "flex", alignItems: "center", gap: 10,
                textDecoration: "none", color: "#94A3B8",
                fontSize: 13, padding: "6px 0", transition: "color 0.2s",
              }}
                onMouseEnter={e => e.currentTarget.style.color = "#22C78E"}
                onMouseLeave={e => e.currentTarget.style.color = "#94A3B8"}
              >
                <span style={{
                  width: 20, height: 20, background: "rgba(34,199,142,0.1)",
                  borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, color: "#22C78E", fontFamily: "'JetBrains Mono'", flexShrink: 0
                }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {item.label}
              </a>
            ))}
          </div>
        </div>

        {/* ── INTRO ── */}
        <p style={{ fontSize: 15, color: "#94A3B8", lineHeight: 1.8, marginBottom: 48 }}>
          This Privacy Policy describes how <strong style={{ color: "#F1F5F9" }}>Edgecipline</strong> {"(\"we,\" \"our,\" or \"us\") collects, uses, and protects your information when you use our mobile and web application. By using Edgecipline, you agree to the collection and use of information as outlined in this policy."}
        </p>

        {/* ── SECTION 1 ── */}
        <Section title="1. Information We Collect" id="information-collected">
          <p style={{ marginBottom: 12 }}>We collect the following categories of information to provide and improve our services:</p>

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 8, marginTop: 20 }}>Account Information</h3>
          <BulletList items={[
            "Full name (provided during registration)",
            "Email address (used for authentication and communication)",
            "Password (stored securely via Firebase Authentication — we never see your plain-text password)",
          ]} />

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 8, marginTop: 20 }}>Trading Data</h3>
          <BulletList items={[
            "Trade journal entries including notes, trade details, and performance records",
            "Pre-trade checklist responses",
            "Uploaded screenshots and images related to trades",
          ]} />

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 8, marginTop: 20 }}>AI-Generated Content</h3>
          <BulletList items={[
            "AI-generated feedback and insights based on your trade data",
            "Performance analysis and pattern observations",
          ]} />

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 8, marginTop: 20 }}>What We Do NOT Collect</h3>
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
              { name: "MongoDB Atlas", desc: "Used for storing trade journal entries, insights, checklists, and app data.", color: "#22C78E" },
            ].map((s) => (
              <div key={s.name} style={{
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${s.color}33`,
                borderLeft: `3px solid ${s.color}`,
                borderRadius: "0 12px 12px 0",
                padding: "16px 18px",
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: s.color, marginBottom: 6 }}>{s.name}</div>
                <div style={{ fontSize: 13, color: "#94A3B8", lineHeight: 1.6 }}>{s.desc}</div>
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
            <a href="mailto:edgecipline@gmail.com" style={{ color: "#22C78E", textDecoration: "none" }}>
              edgecipline@gmail.com
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
            background: "rgba(34,199,142,0.06)",
            border: "1px solid rgba(34,199,142,0.2)",
            borderRadius: 14,
            padding: "24px 28px",
            display: "inline-block",
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#F1F5F9", marginBottom: 4 }}>Edgecipline</div>
            <div style={{ fontSize: 14, color: "#94A3B8", marginBottom: 12 }}>Privacy & Data Requests</div>
            <a href="mailto:edgecipline@gmail.com" style={{
              display: "flex", alignItems: "center", gap: 8,
              color: "#22C78E", textDecoration: "none", fontSize: 14, fontWeight: 700,
              marginBottom: 8,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              edgecipline@gmail.com
            </a>
            <a href="tel:+919061650463" style={{
              display: "flex", alignItems: "center", gap: 8,
              color: "#22C78E", textDecoration: "none", fontSize: 14, fontWeight: 700,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.13 6.13l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              +91 90616 50463
            </a>
          </div>
        </Section>

        {/* ── FOOTER CTA ── */}
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          paddingTop: 40,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}>
          <div style={{ fontSize: 12, color: "#475569", fontFamily: "'JetBrains Mono'" }}>
            © 2026 Edgecipline. All rights reserved.
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            <Link href="/terms" style={{ fontSize: 12, color: "#64748B", textDecoration: "none" }}
              onMouseEnter={e => e.currentTarget.style.color = "#22C78E"}
              onMouseLeave={e => e.currentTarget.style.color = "#64748B"}
            >
              Terms &amp; Conditions
            </Link>
            <Link href="/support" style={{ fontSize: 12, color: "#64748B", textDecoration: "none" }}>
              Support
            </Link>
          </div>
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
      `}</style>
    </div>
  );
}
