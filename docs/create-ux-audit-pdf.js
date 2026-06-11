const fs = require("fs");
const path = require("path");

const out = path.join(__dirname, "stratedge-product-experience-audit.pdf");

const sections = [
  {
    title: "Stratedge Product Experience Audit",
    body: [
      "Complete frontend, UI, UX, product experience, information architecture, onboarding, discoverability, and premium-product audit.",
      "Prepared from source-level review of dashboard, analytics, OCR import, trade journal, setup templates, pre-trade checklist, discipline analytics, psychology timeline, reports, shared navigation, and Indian-market variants.",
    ],
  },
  {
    title: "Executive Scores",
    body: [
      "UX Score: 68/100",
      "UI Score: 72/100",
      "Product Clarity Score: 58/100",
      "Premium Feel Score: 64/100",
      "Mobile UX Score: 61/100",
      "Discoverability Score: 52/100",
    ],
  },
  {
    title: "Critical Problems",
    body: [
      "The strongest value proposition, trader intelligence plus psychology edge, is not clear in the first 10 seconds.",
      "The product can look like a generic trading journal with many dashboards before it feels like an elite intelligence system.",
      "Premium systems are hidden. Trading DNA, Psychology Cost, Self Awareness, Pattern Detection, AI Coach, Timeline, Discipline, OCR, and Notifications are scattered across routes and cards.",
      "The information architecture is fragmented across analytics subroutes, top-level pages, market-specific duplicates, and dashboard cards.",
      "First-time onboarding is feature-led instead of outcome-led. Users need a guided loop from first trade to first insight.",
      "Visible encoding issues in UI copy and symbols hurt premium trust.",
      "Brand naming is inconsistent between Stratedge and Edgecipline, which weakens subscription confidence.",
    ],
  },
  {
    title: "High Priority Problems",
    body: [
      "Dashboard prioritizes generic KPIs while the differentiators appear conditionally or lower on the page.",
      "Analytics overview gives too many modules equal weight, increasing cognitive load.",
      "OCR upload has strong mechanics, but the required post-extraction review feels heavy without enough context.",
      "Mobile experiences become long stacked-card scrolls, making power features hard to scan.",
      "Empty states explain that more trades are needed but do not sufficiently preview the future value.",
    ],
  },
  {
    title: "Medium Priority Problems",
    body: [
      "AI Extractor, AI Reports, AI Insights, and AI Coach Feed overlap conceptually.",
      "Psychology Score, Self Awareness, Discipline, Trade Quality, and Would Retake need a shared mental model.",
      "Weekly Reports feel separate from the main intelligence system.",
      "Checklist and Setup Templates are valuable, but their connection to Trading DNA, Discipline, and Pattern Detection is not obvious.",
      "Indian-market route duplication creates risk of inconsistent UX quality.",
    ],
  },
  {
    title: "Low Priority Problems",
    body: [
      "The visual system leans toward generic SaaS dashboard patterns: cards, KPI tiles, small labels, and many chart panels.",
      "Important explanations are sometimes hidden in hover tooltips instead of embedded into the user journey.",
      "Ticker tape and decorative trading background create atmosphere but can distract from the core behavioral insight story.",
      "Some dense tool surfaces could use cleaner icon-led controls.",
    ],
  },
  {
    title: "Features To Promote",
    body: [
      "Psychology Cost Calculator",
      "Trading DNA Engine",
      "Self Awareness Engine",
      "Pattern Detection Engine",
      "AI Coach Feed",
      "Pre-Trade Checklist tied to setup rules",
      "Weekly AI Reports",
      "Psychology Timeline",
    ],
  },
  {
    title: "Features To Reorganize",
    body: [
      "Move all intelligence systems into one top-level Intelligence or Coach area.",
      "Use primary navigation: Dashboard, Journal, Import, Plan, Intelligence, Reports, Settings.",
      "Place Trading DNA, Psychology Cost, Pattern Detection, Self Awareness, Discipline, Timeline, and AI Coach under Intelligence.",
      "Place Setups and Pre-Trade Checklist under Plan.",
      "Place OCR upload and manual add under Import.",
    ],
  },
  {
    title: "Features To Explain Better",
    body: [
      "Trading DNA: your repeatable edge fingerprint.",
      "Psychology Cost: money lost to behavior, not strategy.",
      "Self Awareness: how accurately you judge trade quality.",
      "Pattern Detection: repeated strengths and risk patterns with sample-size confidence.",
      "AI Coach Feed: what changed, why it matters, and the next action.",
      "Psychology Timeline: why your mindset score changes over time.",
    ],
  },
  {
    title: "Features To Hide Or De-emphasize",
    body: [
      "Do not remove features. Hide advanced analytics until enough data exists or place them behind Advanced breakdown.",
      "Hide low-confidence charts when sample size is too small and show unlock previews instead.",
      "Reduce duplicate AI labels in top-level navigation.",
    ],
  },
  {
    title: "Features To Merge",
    body: [
      "Merge AI Insights and AI Coach Feed into one coaching stream.",
      "Merge Discipline Analytics signals with Checklist outcomes.",
      "Merge Psychology Timeline with Psychology Analytics as a longitudinal tab.",
      "Merge top-level trading-dna route with analytics/trading-dna to avoid duplicate mental models.",
      "Merge market-specific IA where possible and use market context instead of duplicate navigation.",
    ],
  },
  {
    title: "Redesign Strategy",
    body: [
      "Make the product promise: Stratedge shows what makes you profitable, what leaks money, and what to do before your next trade.",
      "Primary navigation should be: Dashboard, Journal, Import, Plan, Intelligence, Reports.",
      "Dashboard should become a command center with today's next action, current edge, biggest leak, discipline status, latest AI coach insight, Log Trade, and Run Checklist.",
      "Intelligence should become the premium heart of the app with tabs for Trading DNA, Psychology Cost, Patterns, Self Awareness, Discipline, Timeline, and AI Coach.",
      "Each intelligence tab should answer four questions: what happened, why it matters, what to do next, and what improves if the user follows through.",
      "Onboarding should be milestone-based: create setup rules, log or upload first trade, add psychology tags, review first insight, run first checklist, generate first weekly report, unlock Trading DNA.",
      "Preserve all premium systems, but present them as one intelligence loop: Plan, Execute, Journal, Analyze, Coach, Improve.",
    ],
  },
];

function sanitize(text) {
  return String(text)
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(text, max = 92) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const pages = [];
let lines = [];

function pushLine(text = "", size = 10, leading = 14, indent = 0) {
  lines.push({ text, size, leading, indent });
  if (lines.length > 47) {
    pages.push(lines);
    lines = [];
  }
}

sections.forEach((section, index) => {
  if (index > 0) pushLine("");
  pushLine(section.title, index === 0 ? 18 : 13, index === 0 ? 24 : 18);
  section.body.forEach((item) => {
    const isScore = /Score:/.test(item);
    const prefix = isScore ? "" : "- ";
    wrap(`${prefix}${item}`, isScore ? 86 : 90).forEach((line, lineIndex) => {
      pushLine(lineIndex === 0 ? line : `  ${line}`, 10, 13, 0);
    });
  });
});
if (lines.length) pages.push(lines);

const objects = [];
function addObject(body) {
  objects.push(body);
  return objects.length;
}

const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const pageIds = [];

for (let p = 0; p < pages.length; p++) {
  let y = 760;
  let stream = "BT\n/F1 10 Tf\n72 760 Td\n";
  for (const line of pages[p]) {
    stream += `/F1 ${line.size} Tf\n`;
    stream += `1 0 0 1 ${72 + line.indent} ${y} Tm\n`;
    stream += `(${sanitize(line.text)}) Tj\n`;
    y -= line.leading;
  }
  stream += "ET\n";
  const contentId = addObject(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  const pageId = addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  pageIds.push(pageId);
}

const pagesId = addObject(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

for (const pageId of pageIds) {
  objects[pageId - 1] = objects[pageId - 1].replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
}

let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += "0000000000 65535 f \n";
for (let i = 1; i <= objects.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

fs.writeFileSync(out, pdf, "binary");
console.log(out);
