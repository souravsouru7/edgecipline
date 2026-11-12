"use client";

import LegalShell, { Section, BulletList, Highlight, Warning } from "@/features/legal/LegalShell";

// Public legal page: reachable with no session (store listings link here).
// The legal text is unchanged; only the frame and colours follow the theme.

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

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms &amp; Conditions"
      intro="Please read these Terms & Conditions carefully before using Edgecipline. By accessing or using our app, you agree to be bound by these terms."
      updated="August 6, 2026"
      toc={toc}
      related={[{ href: "/privacy-policy", label: "Privacy Policy" }, { href: "/delete-account", label: "Delete your account" }, { href: "/support", label: "Help" }]}
    >
        {/* ── INTRO ── */}
        <p style={{ fontSize: 15, color: "var(--ec-text-2)", lineHeight: 1.8, marginBottom: 48 }}>
          Welcome to <strong style={{ color: "var(--ec-text)" }}>Edgecipline</strong>. {"These Terms & Conditions (\"Terms\") govern your use of our application and services. By creating an account or using any part of the app, you acknowledge that you have read, understood, and agree to be legally bound by these Terms."}
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

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ec-text)", marginBottom: 10, marginTop: 16 }}>Available Plans</h3>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 20 }}>
            {[
              { plan: "Monthly", detail: "Billed every 30 days" },
              { plan: "3-Month", detail: "Billed every 3 months" },
              { plan: "6-Month", detail: "Billed every 6 months" },
            ].map((p, i) => (
              <div key={i} style={{
                background: "color-mix(in srgb, var(--ec-accent) 5%, transparent)",
                border: "1px solid color-mix(in srgb, var(--ec-accent) 15%, transparent)",
                borderRadius: 12,
                padding: "16px",
                textAlign: "center",
              }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ec-text)", marginBottom: 4 }}>{p.plan}</div>
                <div style={{ fontSize: 12, color: "var(--ec-text-3)", fontFamily: "var(--ec-font-mono)" }}>{p.detail}</div>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ec-text)", marginBottom: 10, marginTop: 20 }}>Payment Terms</h3>
          <BulletList items={[
            "Subscriptions are billed in advance at the beginning of each billing cycle",
            "By subscribing, you authorize us to charge the applicable subscription fee to your chosen payment method",
            "All prices are displayed in the app and may be subject to applicable taxes",
          ]} />

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ec-text)", marginBottom: 10, marginTop: 20 }}>Refund Policy</h3>
          <Warning>
            ALL PAYMENTS ARE FINAL AND NON-REFUNDABLE, EXCEPT WHERE REQUIRED BY APPLICABLE LAW. We do not provide refunds for partial subscription periods, unused time, or change of mind.
          </Warning>
          <BulletList items={[
            "You may cancel your subscription at any time to prevent future charges",
            "Cancellation takes effect at the end of the current billing period; you will retain access until then",
            "If you believe you have been charged in error, contact us within 14 days at dream@edgecipline.com",
          ]} />
        </Section>

        {/* ── SECTION 7 ── */}
        <Section title="7. Account Responsibility" id="account">
          <BulletList items={[
            "You are responsible for maintaining the security of your account credentials",
            "You must notify us immediately at dream@edgecipline.com if you suspect unauthorized access to your account",
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
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ec-text)", marginBottom: 8 }}>Termination by You</h3>
          <BulletList items={[
            "You may delete your account at any time from within the app settings",
            "Account deletion is permanent and irreversible — all data will be removed",
            "Active subscriptions should be cancelled before account deletion to avoid future charges",
          ]} />

          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ec-text)", marginBottom: 8, marginTop: 20 }}>Termination by Edgecipline</h3>
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
            background: "color-mix(in srgb, var(--ec-accent) 6%, transparent)",
            border: "1px solid color-mix(in srgb, var(--ec-accent) 20%, transparent)",
            borderRadius: 14,
            padding: "24px 28px",
            display: "inline-block",
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ec-text)", marginBottom: 4 }}>Edgecipline</div>
            <div style={{ fontSize: 14, color: "var(--ec-text-2)", marginBottom: 12 }}>Legal & Terms Inquiries</div>
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
