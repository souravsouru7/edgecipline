// Builds a review PDF: both legal documents verbatim, plus a findings section
// comparing what they promise against what the app actually does.
//
// Run extract-legal.js first (produces legal-content.json).

const fs = require('fs');
const path = require('path');

const content = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'legal-content.json'), 'utf8')
);

// Page chrome and injected CSS that the DOM walk picks up but which is not
// part of the legal text.
const DROP_EXACT = new Set([
  'Skip to main content', 'BACK TO APP', 'LEGAL DOCUMENT', 'TABLE OF CONTENTS',
  'PRIVACY POLICY', 'TERMS & CONDITIONS', 'EDGECIPLINE', 'Privacy Policy',
  'Terms & Conditions', 'Support', 'HOME',
]);
const DROP_MATCH = [
  /^\d{2}$/,                       // TOC numbers
  /box-sizing|@media|@keyframes/,  // injected style blocks
  /^©\s*20\d\d/,
  /All rights reserved/i,
];

function keep(block, index) {
  // Always keep the document H1 and every H2.
  if (block.type === 'h1' || block.type === 'h2') return true;
  if (block.type === 'ul' || block.type === 'ol') return (block.items || []).length > 0;
  const t = (block.text || '').trim();
  if (!t || t.length < 3) return false;
  if (DROP_EXACT.has(t)) return false;
  if (DROP_MATCH.some((re) => re.test(t))) return false;
  // TOC entries duplicate the H2 titles; they appear before the first H2.
  if (index < 40 && /^(Information We Collect|How We Use Your Data|Data Storage|Third-Party Services|Data Sharing|Your Rights|Data Retention|Children's Privacy|Changes to Th|Contact Us|Acceptance of Terms|App Usage Rules|Trading Disclaimer|No Profit Guarantee|AI Features|Subscription|Account Responsibility|Limitation of Liability|Account Termination|Intellectual Property|Governing Law)/.test(t)) {
    return false;
  }
  return true;
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderDoc(doc) {
  const seenH2 = { v: false };
  const parts = [];

  doc.blocks.forEach((b, i) => {
    if (!keep(b, i)) return;
    if (b.type === 'h2') seenH2.v = true;

    if (b.type === 'h1') {
      parts.push(`<h1 class="doc-title">${esc(b.text)}</h1>`);
    } else if (b.type === 'h2') {
      parts.push(`<h2 class="clause">${esc(b.text)}</h2>`);
    } else if (b.type === 'h3') {
      parts.push(`<h3 class="sub">${esc(b.text)}</h3>`);
    } else if (b.type === 'ul' || b.type === 'ol') {
      const tag = b.type;
      parts.push(
        `<${tag}>` + b.items.map((it) => `<li>${esc(it)}</li>`).join('') + `</${tag}>`
      );
    } else {
      const t = b.text.trim();
      const allCaps = t.length > 40 && t === t.toUpperCase();
      parts.push(`<p class="${allCaps ? 'legal-caps' : ''}">${esc(t)}</p>`);
    }
  });

  return parts.join('\n');
}

// ── Review findings ─────────────────────────────────────────────────────────
const FINDINGS = [
  {
    sev: 'high', doc: 'Privacy', ref: '§4 Third-Party Services',
    title: 'Several services the app actually uses are not disclosed',
    body: `The policy names Firebase, MongoDB Atlas and a generic "AI Services". The app also sends data to: <b>Sentry</b> (crash reports, including IP address), <b>Cloudinary</b> (every uploaded trade screenshot), <b>Firebase Cloud Messaging</b> (push tokens), <b>Resend</b> (OTP and transactional email), and <b>Google Gemini</b> (the unnamed "AI Services" — your trade notes are sent to it). <b>Razorpay</b> applies once payments are switched on.`,
    why: `Play's Data safety form asks you to declare third-party sharing, and Apple cross-checks the App Privacy label against your policy. An omission here is the most common cause of a policy being rejected as inaccurate.`,
  },
  {
    sev: 'high', doc: 'Privacy', ref: '§1 What We Do NOT Collect',
    title: '"We do not collect device identifiers" contradicts the app',
    body: `The app collects an <code>x-device-id</code> per install and stores FCM <b>push notification tokens</b> in a DeviceToken collection. Both are device identifiers. The qualifier "for tracking purposes" is doing a lot of work here.`,
    why: `You will have to declare Device ID on the Play Data safety form. A form that says "collected" against a policy that says "not collected" is a direct contradiction reviewers do check.`,
  },
  {
    sev: 'high', doc: 'Terms', ref: '§6 Refund Policy',
    title: '"All payments are final and non-refundable" cannot hold once you use store billing',
    body: `With Apple In-App Purchase, refunds are handled by Apple and users request them from Apple directly — your terms cannot override that. Google Play has its own refund policy plus statutory rights. India's Consumer Protection Act also applies.`,
    why: `The "except where required by applicable law" carve-out softens it, but once billing runs through a store the clause is misleading. Reword to defer to the store's refund process for store-billed purchases.`,
  },
  {
    sev: 'high', doc: 'Terms', ref: 'missing',
    title: 'No Apple-required EULA clauses',
    body: `If you ship your own terms instead of Apple's standard EULA, Apple requires them to state that the agreement is between you and the user (not Apple), that Apple has no support or maintenance obligation, and that Apple is a third-party beneficiary entitled to enforce the terms.`,
    why: `Required by the Apple Developer Program License Agreement (Schedule A) whenever a custom EULA is used. Straightforward to add, and a known rejection trigger.`,
  },
  {
    sev: 'med', doc: 'Privacy', ref: 'missing',
    title: 'Push notifications and camera access are never mentioned',
    body: `The app requests notification permission and camera access (Android <code>CAMERA</code>, and the iOS <code>NSCameraUsageDescription</code> string added for submission). Neither appears anywhere in the policy.`,
    why: `Apple compares your usage-description strings and the App Privacy label against the policy. Permissions the app requests but the policy never explains read as undisclosed collection.`,
  },
  {
    sev: 'med', doc: 'Privacy', ref: 'missing',
    title: 'IP addresses and server logs not disclosed',
    body: `The backend records IP address with each session and login (visible in the auth diagnostics and request logs), and Sentry receives it too. The policy does not mention log data at all.`,
    why: `IP is personal data under both GDPR and India's DPDP Act. Cheap to disclose, awkward to be caught omitting.`,
  },
  {
    sev: 'med', doc: 'Terms', ref: '§6 Subscription & Payments',
    title: 'Describes billing the app currently cannot perform',
    body: `Monthly / 3-Month / 6-Month plans are described as purchasable, but the paywall is switched off in the shipped build (<code>NEXT_PUBLIC_PAYMENTS_ENABLED=false</code>) and there is no <code>/pricing</code> route.`,
    why: `Not fatal — terms may describe future plans. But a reviewer reading "requires a paid subscription" and finding no way to pay may question it. Consider marking the section as applying "where subscriptions are offered".`,
  },
  {
    sev: 'med', doc: 'Terms', ref: '§9 Account Termination',
    title: '"Cancel your subscription before deleting your account" has no cancel flow',
    body: `The app has no subscription management or cancellation UI, so this instruction cannot be followed from inside the app.`,
    why: `Play expects account deletion not to strand an active subscription. Once billing is live, either add cancellation or cancel automatically on deletion — and say which.`,
  },
  {
    sev: 'med', doc: 'Terms', ref: '§12 Governing Law',
    title: 'Governing law names no jurisdiction',
    body: `"Governed by applicable laws" and "submitted to the appropriate jurisdiction" identify nothing. As drafted the clause has close to no legal effect.`,
    why: `Name the country and the courts (e.g. "the laws of India, courts at <your city>"). Everything else in the app — INR pricing, IST scheduling, Indian Market module — points to India already.`,
  },
  {
    sev: 'med', doc: 'Privacy', ref: 'missing',
    title: 'No Indian data-protection framing and no grievance contact',
    body: `India's DPDP Act 2023 and the IT Rules expect a named grievance contact for user complaints. The policy gives a general support address only.`,
    why: `Given an India-based operation and an Indian user base, naming a grievance officer and referencing the DPDP Act is the expected form.`,
  },
  {
    sev: 'low', doc: 'Both', ref: 'Contact',
    title: 'A personal phone number is published',
    body: `<code>+91 90616 50463</code> appears at the bottom of both documents.`,
    why: `Intentional is fine — just confirm you want it public on a page the stores link to, since it will be scraped.`,
  },
  {
    sev: 'low', doc: 'Both', ref: 'Header',
    title: 'Dates now current, naming now consistent',
    body: `Both documents read "Last Updated: August 6, 2026" and refer to "Edgecipline" throughout. The earlier "Edge Discipline" references are gone.`,
    why: `Noted as resolved — no action needed.`,
  },
];

const SEV_LABEL = { high: 'Should fix', med: 'Worth fixing', low: 'Check' };

function renderFindings() {
  return FINDINGS.map((f, i) => `
    <div class="finding sev-${f.sev}">
      <div class="f-head">
        <span class="f-num">${String(i + 1).padStart(2, '0')}</span>
        <span class="f-sev sev-${f.sev}">${SEV_LABEL[f.sev]}</span>
        <span class="f-loc">${esc(f.doc)} · ${esc(f.ref)}</span>
      </div>
      <div class="f-title">${esc(f.title)}</div>
      <div class="f-body">${f.body}</div>
      <div class="f-why"><b>Why it matters:</b> ${f.why}</div>
    </div>`).join('\n');
}

const terms = content.find((d) => d.route === '/terms');
const privacy = content.find((d) => d.route === '/privacy-policy');

const counts = FINDINGS.reduce((a, f) => ((a[f.sev] = (a[f.sev] || 0) + 1), a), {});

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Edgecipline — Terms &amp; Privacy Policy, Full Text and Review</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Plus Jakarta Sans',sans-serif;color:#1A2533;font-size:11.5px;line-height:1.72;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:210mm;padding:16mm 17mm 18mm;page-break-after:always;position:relative}
  .page:last-child{page-break-after:avoid}

  .cover{background:linear-gradient(160deg,#0F1923,#1A2535 55%,#0D1218);color:#fff;min-height:297mm;display:flex;flex-direction:column;justify-content:space-between;padding:24mm 18mm 16mm}
  .cover .tag{display:inline-block;background:rgba(34,199,142,.18);border:1px solid rgba(34,199,142,.45);color:#6EE7B7;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.16em;padding:4px 12px;border-radius:99px;text-transform:uppercase;margin-bottom:24px}
  .cover h1{font-size:40px;font-weight:900;line-height:1.1;letter-spacing:-.035em;margin-bottom:16px}
  .cover h1 span{color:#22C78E}
  .cover .sub{font-size:14px;color:rgba(255,255,255,.62);max-width:150mm;margin-bottom:30px;line-height:1.65}
  .cover-stats{display:flex;gap:9px;margin-bottom:34px}
  .cs{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:13px;text-align:center}
  .cs .n{font-family:'JetBrains Mono',monospace;font-size:23px;font-weight:700;line-height:1;margin-bottom:6px}
  .cs .l{font-size:9px;color:rgba(255,255,255,.5);font-weight:600;letter-spacing:.09em;text-transform:uppercase}
  .cs.h .n{color:#FF8A8A}.cs.m .n{color:#FBBF24}.cs.l2 .n{color:#93C5FD}.cs.t .n{color:#22C78E}
  .cov-bot{border-top:1px solid rgba(255,255,255,.1);padding-top:14px;display:flex;justify-content:space-between;align-items:center}
  .cov-bot .b{font-size:14px;font-weight:800}.cov-bot .b span{color:#22C78E}
  .cov-bot .t{font-family:'JetBrains Mono',monospace;font-size:9px;color:rgba(255,255,255,.35);letter-spacing:.1em}

  .band{height:3px;border-radius:2px;margin-bottom:16px}
  .band-g{background:linear-gradient(90deg,#0D9E6E,#0D9E6E22)}
  .band-n{background:linear-gradient(90deg,#0F1923,#0F192322)}
  .band-r{background:linear-gradient(90deg,#D63B3B,#D63B3B22)}
  .eyebrow{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;margin-bottom:7px;color:#0D9E6E}
  .eyebrow.n{color:#0F1923}.eyebrow.r{color:#D63B3B}
  h1.doc-title{font-size:27px;font-weight:900;letter-spacing:-.03em;margin:0 0 4px;line-height:1.15}
  h2.sec{font-size:23px;font-weight:900;letter-spacing:-.028em;margin-bottom:6px}
  p.lede{font-size:12px;color:#5A6B7D;margin-bottom:18px;max-width:165mm}

  h2.clause{font-size:14.5px;font-weight:800;color:#0F1923;margin:20px 0 8px;padding-bottom:6px;border-bottom:1.5px solid #0D9E6E;letter-spacing:-.01em;page-break-after:avoid}
  h3.sub{font-size:12.5px;font-weight:800;color:#1A2533;margin:13px 0 5px;page-break-after:avoid}
  p{margin-bottom:9px;color:#33414F}
  ul,ol{margin:7px 0 11px;padding-left:17px}
  li{margin-bottom:5px;color:#33414F;line-height:1.68}
  p.legal-caps{background:#FFFBEB;border:1px solid #FDE68A;border-left:3px solid #B8860B;border-radius:0 8px 8px 0;padding:11px 14px;font-size:10.8px;font-weight:700;color:#78350F;letter-spacing:.01em;line-height:1.65;margin:11px 0}
  code{font-family:'JetBrains Mono',monospace;font-size:10px;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:4px;padding:1px 5px}

  .finding{border:1px solid #E2E8F0;border-radius:11px;padding:12px 15px 13px;margin-bottom:10px;page-break-inside:avoid}
  .finding.sev-high{border-left:3px solid #D63B3B;background:#FFFBFB}
  .finding.sev-med{border-left:3px solid #D97706;background:#FFFDF8}
  .finding.sev-low{border-left:3px solid #64748B;background:#FAFBFC}
  .f-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .f-num{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:#94A3B8}
  .f-sev{font-family:'JetBrains Mono',monospace;font-size:8.5px;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:.05em;text-transform:uppercase}
  .f-sev.sev-high{background:#FEE2E2;color:#B91C1C}
  .f-sev.sev-med{background:#FEF3C7;color:#92400E}
  .f-sev.sev-low{background:#E2E8F0;color:#475569}
  .f-loc{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:#64748B;margin-left:auto}
  .f-title{font-size:13px;font-weight:800;letter-spacing:-.012em;margin-bottom:5px;line-height:1.35}
  .f-body{font-size:11.2px;color:#33414F;line-height:1.65;margin-bottom:6px}
  .f-why{font-size:10.8px;color:#14532D;background:#F0FDF4;border-left:2px solid #0D9E6E;border-radius:0 7px 7px 0;padding:7px 11px;line-height:1.6}
  .f-why b{color:#0D9E6E}

  .note{background:#EFF6FF;border:1px solid #BFDBFE;border-left:3px solid #2563EB;border-radius:0 9px 9px 0;padding:12px 15px;margin:14px 0;font-size:11.3px;color:#1E3A8A;line-height:1.68}
  .note b{color:#1D4ED8}

  .foot{position:absolute;bottom:9mm;left:17mm;right:17mm;display:flex;justify-content:space-between;border-top:1px solid #E2E8F0;padding-top:7px;font-family:'JetBrains Mono',monospace;font-size:8.5px;color:#94A3B8;letter-spacing:.08em}
  .foot .b{font-weight:700;color:#0F1923;font-family:'Plus Jakarta Sans',sans-serif;letter-spacing:0;font-size:10px}
  .foot .b span{color:#0D9E6E}
</style>
</head>
<body>

<div class="page cover">
  <div>
    <div class="tag">Legal Content Review</div>
    <h1>Terms &amp; <span>Privacy Policy</span><br/>Full Text and Review</h1>
    <div class="sub">
      The complete text of both documents exactly as they render in the app, followed by
      a review of what they promise measured against what the application actually does.
    </div>
    <div class="cover-stats">
      <div class="cs t"><div class="n">23</div><div class="l">Clauses</div></div>
      <div class="cs h"><div class="n">${counts.high || 0}</div><div class="l">Should fix</div></div>
      <div class="cs m"><div class="n">${counts.med || 0}</div><div class="l">Worth fixing</div></div>
      <div class="cs l2"><div class="n">${counts.low || 0}</div><div class="l">Check</div></div>
    </div>
  </div>
  <div class="cov-bot">
    <div class="b">Edge<span>cipline</span></div>
    <div class="t">EXTRACTED FROM LIVE PAGES · LAST UPDATED 6 AUG 2026</div>
  </div>
</div>

<div class="page">
  <div class="band band-n"></div>
  <div class="eyebrow n">Part One</div>
  ${renderDoc(terms)}
  <div class="foot"><div class="b">Edge<span>cipline</span></div><div>TERMS OF SERVICE</div><div>—</div></div>
</div>

<div class="page">
  <div class="band band-g"></div>
  <div class="eyebrow">Part Two</div>
  ${renderDoc(privacy)}
  <div class="foot"><div class="b">Edge<span>cipline</span></div><div>PRIVACY POLICY</div><div>—</div></div>
</div>

<div class="page">
  <div class="band band-r"></div>
  <div class="eyebrow r">Part Three</div>
  <h2 class="sec">Review findings</h2>
  <p class="lede">
    Each item below compares a statement in the documents against the code, the
    permissions the app requests, or the services it actually sends data to.
    Ordered by how likely it is to matter at review.
  </p>

  <div class="note">
    <b>The single most important one:</b> the Play Data safety form and the Apple App Privacy
    label are both cross-checked against this policy. Findings 1, 2 and 5 are all cases where
    the policy says less than the app does — which is the specific shape of mismatch that gets
    a submission sent back.
  </div>

  ${renderFindings()}
  <div class="foot"><div class="b">Edge<span>cipline</span></div><div>REVIEW FINDINGS</div><div>—</div></div>
</div>

</body>
</html>`;

fs.writeFileSync(path.join(__dirname, '..', 'edgecipline-legal-review.html'), html);
console.log('wrote docs/edgecipline-legal-review.html');
