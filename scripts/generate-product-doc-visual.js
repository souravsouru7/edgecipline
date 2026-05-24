const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "PRODUCT_DOCUMENTATION.md");
const htmlPath = path.join(root, "PRODUCT_DOCUMENTATION_VISUAL.html");
const pdfPath = path.join(root, "Edgecipline_Product_Documentation_Visual.pdf");

const markdown = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z0-9#]+;/gi, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return text;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(lines) {
  const header = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow);
  return [
    '<div class="table-wrap"><table>',
    "<thead><tr>",
    ...header.map((cell) => `<th>${inline(cell)}</th>`),
    "</tr></thead><tbody>",
    ...rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`),
    "</tbody></table></div>",
  ].join("");
}

function visualForHeading(level, text) {
  const normalized = text.toLowerCase();
  if (level !== 2) return "";

  if (normalized.includes("project overview")) {
    return `
      <div class="visual visual-system">
        <div class="visual-title">Product System</div>
        <div class="triad">
          <div><span>01</span><strong>Journal</strong><p>Fast manual logging plus AI screenshot extraction.</p></div>
          <div><span>02</span><strong>Analytics</strong><p>Performance, setup, risk, time, and psychology metrics.</p></div>
          <div><span>03</span><strong>AI Coach</strong><p>Morning Mentor, alerts, and weekly behavioral reports.</p></div>
        </div>
      </div>`;
  }

  if (normalized.includes("complete app workflow")) {
    return `
      <div class="visual visual-flow">
        <div class="visual-title">Core Habit Loop</div>
        <div class="flow-row">
          <div>Login</div><span></span><div>Dashboard</div><span></span><div>Checklist</div><span></span><div>Log Trade</div><span></span><div>Analytics</div><span></span><div>AI Coaching</div>
        </div>
      </div>`;
  }

  if (normalized.includes("page-by-page")) {
    return `
      <div class="visual app-map">
        <div class="visual-title">Application Map</div>
        <div class="map-grid">
          <div>Dashboard</div><div>Trade Journal</div><div>Add Trade</div><div>Upload Trade</div>
          <div>Analytics</div><div>Checklist</div><div>Setups</div><div>Weekly Reports</div>
          <div>Notifications</div><div>Profile</div><div>Support</div><div>Indian Market</div>
        </div>
      </div>`;
  }

  if (normalized.includes("user journeys")) {
    return `
      <div class="visual journey-strip">
        <div class="visual-title">Retention Arc</div>
        <div class="milestones">
          <div><b>Day 1</b><small>First trade logged</small></div>
          <div><b>Day 7</b><small>First weekly report</small></div>
          <div><b>Day 30</b><small>Behavior pattern visible</small></div>
          <div><b>Day 90</b><small>Annual habit formed</small></div>
        </div>
      </div>`;
  }

  if (normalized.includes("features")) {
    return `
      <div class="visual feature-wheel">
        <div class="visual-title">Feature Engine</div>
        <div class="wheel">
          <div>Trade Data</div><div>Psychology</div><div>Risk</div><div>Setups</div><div>Reports</div><div>Alerts</div>
        </div>
      </div>`;
  }

  if (normalized.includes("business")) {
    return `
      <div class="visual revenue-bars">
        <div class="visual-title">SaaS Growth Model</div>
        <div class="bar"><label>Free</label><span style="width:34%"></span><b>Trial + habit</b></div>
        <div class="bar"><label>Monthly Pro</label><span style="width:64%"></span><b>Active traders</b></div>
        <div class="bar"><label>Annual Pro</label><span style="width:88%"></span><b>Serious users</b></div>
      </div>`;
  }

  if (normalized.includes("future vision")) {
    return `
      <div class="visual roadmap">
        <div class="visual-title">Roadmap Horizon</div>
        <div><strong>6-12 months</strong><p>iOS, broker import, risk calculator, replay.</p></div>
        <div><strong>12-24 months</strong><p>AI quality scoring, live alerts, team dashboards.</p></div>
        <div><strong>24-48 months</strong><p>Conversational coach and global retail trader OS.</p></div>
      </div>`;
  }

  return "";
}

function renderMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const output = [];
  const headings = [];
  let i = 0;
  let inCode = false;
  let code = [];
  let para = [];

  function flushPara() {
    if (para.length) {
      output.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      flushPara();
      if (!inCode) {
        inCode = true;
        code = [];
      } else {
        output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        inCode = false;
      }
      i++;
      continue;
    }

    if (inCode) {
      code.push(line);
      i++;
      continue;
    }

    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text) || `section-${headings.length + 1}`;
      headings.push({ level, text, id });
      const pageClass = level === 2 ? ' class="section-title page-break"' : "";
      output.push(`<h${level}${pageClass} id="${id}">${inline(text)}</h${level}>`);
      output.push(visualForHeading(level, text));
      i++;
      continue;
    }

    if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[i + 1])) {
      flushPara();
      const table = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) {
        table.push(lines[i]);
        i++;
      }
      output.push(renderTable(table));
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushPara();
      const quotes = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quotes.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      output.push(`<blockquote>${inline(quotes.join(" "))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      output.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      output.push(`<ol>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushPara();
      output.push("<hr />");
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }

  flushPara();
  return { body: output.join("\n"), headings };
}

const rendered = renderMarkdown(markdown);
const toc = rendered.headings
  .filter((heading) => heading.level === 2 || heading.level === 3)
  .map((heading) => `<a class="toc-l${heading.level}" href="#${heading.id}">${inline(heading.text)}</a>`)
  .join("");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Edgecipline - Visual Product Documentation</title>
  <style>
    :root {
      --ink: #111827;
      --muted: #5b6472;
      --paper: #ffffff;
      --line: #d8e0e9;
      --soft: #f4f7fb;
      --navy: #0d1b2a;
      --teal: #00a878;
      --lime: #8adf7b;
      --red: #e5484d;
      --amber: #f59e0b;
      --blue: #2563eb;
      --violet: #7c3aed;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: #edf2f7;
      color: var(--ink);
      font-family: Inter, Segoe UI, Arial, sans-serif;
      line-height: 1.62;
      font-size: 15px;
    }
    .doc {
      width: 980px;
      max-width: calc(100% - 32px);
      margin: 28px auto 64px;
      background: var(--paper);
      box-shadow: 0 18px 60px rgba(13, 27, 42, 0.12);
    }
    .cover {
      min-height: 880px;
      padding: 74px 70px;
      color: #fff;
      background:
        radial-gradient(circle at 88% 12%, rgba(0, 208, 132, 0.36), transparent 24%),
        linear-gradient(135deg, #07111f 0%, #123456 56%, #073b33 100%);
      position: relative;
      overflow: hidden;
    }
    .cover:after {
      content: "";
      position: absolute;
      left: 70px;
      right: 70px;
      bottom: 92px;
      height: 250px;
      background:
        linear-gradient(90deg, rgba(255,255,255,0.18) 1px, transparent 1px) 0 0 / 72px 72px,
        linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px) 0 0 / 72px 72px;
      opacity: .45;
    }
    .brand { text-transform: uppercase; letter-spacing: 4px; color: #9ee8c5; font-weight: 800; }
    .cover h1 { margin: 92px 0 18px; font-size: 64px; line-height: 0.98; max-width: 720px; letter-spacing: 0; }
    .cover .subtitle { font-size: 24px; max-width: 660px; color: #dceaf5; }
    .cover .meta { position: absolute; left: 70px; bottom: 64px; display: flex; gap: 16px; z-index: 2; }
    .pill { border: 1px solid rgba(255,255,255,.28); padding: 10px 14px; border-radius: 6px; background: rgba(255,255,255,.08); }
    .content { padding: 48px 70px 80px; }
    h1, h2, h3, h4 { color: var(--navy); line-height: 1.18; letter-spacing: 0; }
    h1 { font-size: 38px; margin: 28px 0 18px; }
    h2 { font-size: 30px; margin: 46px 0 18px; padding-top: 10px; border-top: 4px solid var(--teal); }
    h3 { font-size: 21px; margin: 30px 0 10px; }
    h4 { font-size: 17px; margin: 22px 0 8px; }
    p { margin: 0 0 14px; color: var(--muted); }
    a { color: var(--blue); text-decoration: none; }
    strong { color: var(--ink); }
    blockquote {
      margin: 22px 0;
      padding: 18px 22px;
      border-left: 5px solid var(--teal);
      background: #eefbf6;
      color: #12352b;
      font-size: 17px;
      border-radius: 0 6px 6px 0;
    }
    ul, ol { margin: 10px 0 18px 24px; color: var(--muted); }
    li { margin: 5px 0; }
    code, pre { font-family: Consolas, Menlo, monospace; }
    code { background: #edf2f7; color: #0f766e; padding: 2px 5px; border-radius: 4px; }
    pre {
      background: #08111f;
      color: #c8f7dc;
      padding: 22px;
      border-radius: 8px;
      overflow: auto;
      white-space: pre-wrap;
      font-size: 12px;
      line-height: 1.35;
    }
    hr { border: 0; border-top: 1px solid var(--line); margin: 26px 0; }
    .toc-page { page-break-after: always; padding-bottom: 30px; }
    .toc-page h2 { border-top: 0; font-size: 36px; }
    .toc { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; }
    .toc a { color: var(--ink); border-bottom: 1px solid var(--line); padding: 8px 0; }
    .toc-l3 { padding-left: 18px !important; color: var(--muted) !important; font-size: 13px; }
    .visual {
      margin: 18px 0 28px;
      padding: 22px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, #fff, #f8fbfe);
      border-radius: 8px;
      page-break-inside: avoid;
    }
    .visual-title { color: var(--navy); font-weight: 800; text-transform: uppercase; font-size: 12px; letter-spacing: 2px; margin-bottom: 16px; }
    .triad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .triad div { background: #0f2238; color: #fff; padding: 18px; border-radius: 8px; min-height: 142px; }
    .triad span { color: var(--lime); font-weight: 800; display: block; margin-bottom: 12px; }
    .triad p { color: #d4e2ef; font-size: 13px; margin-top: 8px; }
    .flow-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .flow-row div { background: #10233a; color: #fff; border-radius: 6px; padding: 12px 14px; font-weight: 700; }
    .flow-row span { width: 22px; height: 2px; background: var(--teal); display: inline-block; }
    .map-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .map-grid div, .wheel div { background: #eef4ff; color: #14315f; border: 1px solid #cfe0ff; border-radius: 6px; padding: 12px; font-weight: 700; text-align: center; }
    .milestones { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .milestones div { border-top: 5px solid var(--teal); background: #f4fbf8; padding: 14px; border-radius: 6px; }
    .milestones small { display: block; color: var(--muted); margin-top: 6px; }
    .wheel { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .bar { display: grid; grid-template-columns: 130px 1fr 130px; align-items: center; gap: 12px; margin: 12px 0; }
    .bar span { display: block; height: 18px; border-radius: 20px; background: linear-gradient(90deg, var(--teal), var(--blue)); }
    .bar label, .bar b { font-size: 13px; color: var(--navy); }
    .roadmap { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .roadmap .visual-title { grid-column: 1 / -1; }
    .roadmap div:not(.visual-title) { background: #fff8e8; border: 1px solid #ffe0a3; border-radius: 6px; padding: 14px; }
    .table-wrap { width: 100%; overflow-x: auto; margin: 18px 0 24px; page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #10233a; color: #fff; text-align: left; padding: 10px; }
    td { border: 1px solid var(--line); padding: 9px 10px; vertical-align: top; color: var(--muted); }
    tr:nth-child(even) td { background: #f8fafc; }
    .section-title { page-break-before: always; }
    @page { size: A4; margin: 14mm 13mm; }
    @media print {
      body { background: #fff; font-size: 11px; }
      .doc { width: 100%; max-width: none; margin: 0; box-shadow: none; }
      .cover { min-height: 257mm; page-break-after: always; }
      .content { padding: 0; }
      h2.section-title { page-break-before: always; }
      h2, h3, h4, .visual, table, blockquote, pre { page-break-inside: avoid; }
      .toc { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <main class="doc">
    <section class="cover">
      <div class="brand">Stratedge Product Documentation</div>
      <h1>Edgecipline</h1>
      <p class="subtitle">AI-powered trading journal, performance analytics system, and psychology coach for disciplined retail traders.</p>
      <div class="meta">
        <div class="pill">Version 1.0</div>
        <div class="pill">May 2026</div>
        <div class="pill">Visual PDF Edition</div>
      </div>
    </section>
    <section class="content">
      <section class="toc-page">
        <h2>Contents</h2>
        <nav class="toc">${toc}</nav>
      </section>
      ${rendered.body}
    </section>
  </main>
</body>
</html>`;

fs.writeFileSync(htmlPath, html, "utf8");

const wkhtmltopdf = "wkhtmltopdf";
const result = spawnSync(
  wkhtmltopdf,
  [
    "--encoding",
    "utf-8",
    "--enable-local-file-access",
    "--print-media-type",
    "--page-size",
    "A4",
    "--margin-top",
    "12mm",
    "--margin-right",
    "11mm",
    "--margin-bottom",
    "12mm",
    "--margin-left",
    "11mm",
    htmlPath,
    pdfPath,
  ],
  { encoding: "utf8" }
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "wkhtmltopdf failed");
  process.exit(result.status || 1);
}

console.log(`Wrote ${htmlPath}`);
console.log(`Wrote ${pdfPath}`);
