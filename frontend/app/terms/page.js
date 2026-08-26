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

function Warning({ children }) {
  return (
    <div style={{
      background: "rgba(239,68,68,0.06)",
      border: "1px solid rgba(239,68,68,0.25)",
      borderLeft: "3px solid #EF4444",
      borderRadius: "0 10px 10px 0",
      padding: "14px 18px",
      margin: "16px 0",
      color: "#FCA5A5",
      fontSize: 14,
      lineHeight: 1.7,
      fontWeight: 600,
    }}>
      {children}
    </div>
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

export default function TermsPage() {
  const router = useRouter();

  const toc = [
    { id: "acceptance", label: "Acceptance of Terms" },
    { id: "app-usage", label: "App Usage Rules" },
    { id: "disclaimer", label: "Trading Disclaimer" },
    { id: "no-guarantee", label: "No Profit Guarantee" },
    { id: "ai-disclaimer", label: "AI Disclaimer" },
    { id: "subscriptions", label: "Subscription & Payments" },
    { id: "account", label: "Account Responsibility" },
    { id: "liability", label: "Limitation of Liability" },
    { id: "termination", label: "Account Termination" },
    { id: "changes", label: "Changes to Terms" },
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
              TERMS & CONDITIONS
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
          Terms & Conditions
        </h1>
        <p style={{ fontSize: 15, color: "#94A3B8", maxWidth: 540, margin: "0 auto 20px", lineHeight: 1.7 }}>
          Please read these Terms & Conditions carefully before using Edgecipline. By accessing or using our app, you agree to be bound by these terms.
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
          Welcome to <strong style={{ color: "#F1F5F9" }}>Edgecipline</strong>. {"These Terms & Conditions (\"Terms\") govern your use of our application and services. By creating an account or using any part of the app, you acknowledge that you have read, understood, and agree to be legally bound by these Terms."}
        </p>

        {/* ── SECTION 1 ── */}
        <Section title="1. Acceptance of Terms" id="acceptance">
          <p>
            By downloading, installing, accessing, or using Edgecipline, you confirm that you are at least 18 years of age and have the legal capacity to enter into a binding agreement. If you do not agree with any part of these Terms, you must not use the application.
          </p>
          <p style={{ marginTop: 12 }}>
            These Terms apply to all users, including registered users and visitors. We reserve the right to update these Terms at any time, and your continued use of the app after changes constitutes acceptance of the revised Terms.
          </p>
        </Section>

        {/* ── SECTION 2 ── */}
        <Section title="2. App Usage Rules" id="app-usage">
          <p style={{ marginBottom: 12 }}>When using Edgecipline, you agree to:</p>
          <BulletList items={[
            "Use the app only for lawful, personal, and non-commercial purposes",
            "Provide accurate and current information during registration",
            "Keep your login credentials confidential and not share your account with others",
            "Not attempt to reverse-engineer, hack, scrape, or disrupt the application or its servers",
            "Not upload content that is illegal, harmful, defamatory, obscene, or infringes on third-party rights",
            "Not use the app to engage in any activity that violates applicable laws or regulations",
          ]} />
          <p style={{ marginTop: 12 }}>
            We reserve the right to remove content or suspend accounts that violate these rules without prior notice.
          </p>
        </Section>

        {/* ── SECTION 3 — TRADING DISCLAIMER ── */}
        <Section title="3. Trading Disclaimer — Important" id="disclaimer">
          <Warning>
            EDGECIPLINE IS A JOURNALING AND SELF-IMPROVEMENT TOOL. IT DOES NOT PROVIDE FINANCIAL ADVICE, INVESTMENT ADVICE, OR TRADING RECOMMENDATIONS OF ANY KIND.
          </Warning>
          <BulletList items={[
            "Nothing in this application, including AI-generated feedback, analytics, insights, trade patterns, or any other content, constitutes financial advice, investment advice, or a recommendation to buy or sell any financial instrument",
            "Edgecipline is not a licensed financial advisor, broker, or investment firm",
            "Any information displayed in the app is for educational, journaling, and self-reflective purposes only",
            "You are solely responsible for all trading decisions you make",
            "Past trade performance documented in the app does not guarantee future results",
            "Trading financial instruments involves significant risk, including the possible loss of your entire invested capital",
          ]} />
          <Highlight>
            Always conduct your own research and, where appropriate, consult a qualified financial advisor before making any trading or investment decisions.
          </Highlight>
        </Section>

        {/* ── SECTION 4 ── */}
        <Section title="4. No Profit Guarantee" id="no-guarantee">
          <Warning>
            EDGECIPLINE MAKES NO REPRESENTATION, WARRANTY, OR GUARANTEE — EXPRESS OR IMPLIED — THAT USING THIS APPLICATION WILL RESULT IN PROFITABLE TRADES OR IMPROVED TRADING PERFORMANCE.
          </Warning>
          <BulletList items={[
            "Improved journaling and self-discipline may contribute to better trading habits, but we cannot guarantee financial outcomes",
            "Market conditions, individual skill, capital management, and numerous external factors influence trading results",
            "Any testimonials or performance examples shown are not indicative of typical results",
            "You use this application with full understanding that trading involves inherent financial risk",
          ]} />
        </Section>

        {/* ── SECTION 5 ── */}
        <Section title="5. AI Features Disclaimer" id="ai-disclaimer">
          <p style={{ marginBottom: 12 }}>
            Edgecipline uses artificial intelligence to generate feedback, pattern analysis, and insights based on your trade journal entries.
          </p>
          <BulletList items={[
            "AI-generated content is informational only and does not constitute financial, trading, or investment advice",
            "AI outputs are generated based on patterns in your data and are not guaranteed to be accurate, complete, or suitable for your specific situation",
            "You should critically evaluate AI feedback and not rely on it as the sole basis for any trading decision",
            "AI models can make errors or provide output that is misleading — always apply your own judgment",
          ]} />
          <Highlight>
            The AI features in Edgecipline are designed to help you reflect on your trading behavior, not to direct your trading strategy or predict market outcomes.
          </Highlight>
        </Section>

        {/* ── SECTION 6 ── */}
        <Section title="6. Subscription & Payments" id="subscriptions">
          <p style={{ marginBottom: 16 }}>Access to premium features of Edgecipline requires a paid subscription.</p>

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 10, marginTop: 16 }}>Available Plans</h3>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 20 }}>
            {[
              { plan: "Monthly", detail: "Billed every 30 days" },
              { plan: "3-Month", detail: "Billed every 3 months" },
              { plan: "6-Month", detail: "Billed every 6 months" },
            ].map((p, i) => (
              <div key={i} style={{
                background: "rgba(34,199,142,0.05)",
                border: "1px solid rgba(34,199,142,0.15)",
                borderRadius: 12,
                padding: "16px",
                textAlign: "center",
              }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#F1F5F9", marginBottom: 4 }}>{p.plan}</div>
                <div style={{ fontSize: 12, color: "#64748B", fontFamily: "'JetBrains Mono'" }}>{p.detail}</div>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 10, marginTop: 20 }}>Payment Terms</h3>
          <BulletList items={[
            "Subscriptions are billed in advance at the beginning of each billing cycle",
            "By subscribing, you authorize us to charge the applicable subscription fee to your chosen payment method",
            "All prices are displayed in the app and may be subject to applicable taxes",
          ]} />

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 10, marginTop: 20 }}>Refund Policy</h3>
          <Warning>
            ALL PAYMENTS ARE FINAL AND NON-REFUNDABLE, EXCEPT WHERE REQUIRED BY APPLICABLE LAW. We do not provide refunds for partial subscription periods, unused time, or change of mind.
          </Warning>
          <BulletList items={[
            "You may cancel your subscription at any time to prevent future charges",
            "Cancellation takes effect at the end of the current billing period; you will retain access until then",
            "If you believe you have been charged in error, contact us within 14 days at edgecipline@gmail.com",
          ]} />
        </Section>

        {/* ── SECTION 7 ── */}
        <Section title="7. Account Responsibility" id="account">
          <BulletList items={[
            "You are responsible for maintaining the security of your account credentials",
            "You must notify us immediately at edgecipline@gmail.com if you suspect unauthorized access to your account",
            "We are not liable for any losses resulting from unauthorized account access caused by your failure to secure your credentials",
            "You are responsible for all activity that occurs under your account",
            "You may not transfer, sell, or share your account with any third party",
            "One account per user — creating multiple accounts to circumvent restrictions is prohibited",
          ]} />
        </Section>

        {/* ── SECTION 8 ── */}
        <Section title="8. Limitation of Liability" id="liability">
          <Warning>
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, EDGECIPLINE AND ITS OWNERS, OPERATORS, AND AFFILIATES SHALL NOT BE LIABLE FOR ANY TRADING LOSSES, FINANCIAL LOSSES, LOST PROFITS, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE APPLICATION OR YOUR TRADING ACTIVITY.
          </Warning>
          <BulletList items={[
            "We are not responsible for any financial losses you incur from trading decisions, whether or not influenced by features of the app",
            "We are not responsible for any inaccuracies in AI-generated feedback or insights",
            "We are not liable for service interruptions, data loss due to technical failures, or downtime",
            "Our total liability in any matter is limited to the amount you paid to us in the three (3) months preceding the claim",
            "Some jurisdictions do not allow the exclusion of certain warranties or liability — these limitations apply to the fullest extent permitted by law",
          ]} />
        </Section>

        {/* ── SECTION 9 ── */}
        <Section title="9. Account Termination" id="termination">
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 8 }}>Termination by You</h3>
          <BulletList items={[
            "You may delete your account at any time from within the app settings",
            "Account deletion is permanent and irreversible — all data will be removed",
            "Active subscriptions should be cancelled before account deletion to avoid future charges",
          ]} />

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 8, marginTop: 20 }}>Termination by Edgecipline</h3>
          <BulletList items={[
            "We reserve the right to suspend or terminate your account immediately, without prior notice, if you violate these Terms",
            "We may also terminate accounts for extended inactivity, fraudulent activity, or legal requirements",
            "Upon termination, your right to access the app ceases immediately",
            "We are not obligated to provide refunds upon termination for cause",
          ]} />
        </Section>

        {/* ── SECTION 10 ── */}
        <Section title="10. Intellectual Property" id="ip">
          <BulletList items={[
            "Edgecipline, including its name, logo, design, code, and content, is the intellectual property of its owners",
            "You are granted a limited, non-exclusive, non-transferable license to use the app for personal purposes",
            "You retain ownership of the trading data and content you upload to the app",
            "You grant us a limited license to process and store your data solely to provide the service",
            "You may not copy, reproduce, distribute, or create derivative works from any part of the application",
          ]} />
        </Section>

        {/* ── SECTION 11 ── */}
        <Section title="11. Changes to These Terms" id="changes">
          <p>
            {"We reserve the right to modify these Terms & Conditions at any time. When we make significant changes, we will update the \"Last Updated\" date at the top of this page and may notify you via in-app notification or email."}
          </p>
          <p style={{ marginTop: 12 }}>
            Your continued use of Edgecipline following notification of changes constitutes your acceptance of the revised Terms. If you disagree with the updated Terms, you must stop using the application and delete your account.
          </p>
        </Section>

        {/* ── SECTION 12 ── */}
        <Section title="12. Governing Law" id="law">
          <p>
            These Terms are governed by and construed in accordance with applicable laws. Any disputes arising from these Terms or your use of Edgecipline shall be resolved through good-faith negotiation. If a dispute cannot be resolved informally, it shall be submitted to the appropriate jurisdiction.
          </p>
        </Section>

        {/* ── SECTION 13 ── */}
        <Section title="13. Contact Us" id="contact">
          <p style={{ marginBottom: 16 }}>
            For any questions, concerns, or legal matters regarding these Terms & Conditions, please contact us:
          </p>
          <div style={{
            background: "rgba(34,199,142,0.06)",
            border: "1px solid rgba(34,199,142,0.2)",
            borderRadius: 14,
            padding: "24px 28px",
            display: "inline-block",
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#F1F5F9", marginBottom: 4 }}>Edgecipline</div>
            <div style={{ fontSize: 14, color: "#94A3B8", marginBottom: 12 }}>Legal & Terms Inquiries</div>
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
            <Link href="/privacy-policy" style={{ fontSize: 12, color: "#64748B", textDecoration: "none" }}>
              Privacy Policy
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
