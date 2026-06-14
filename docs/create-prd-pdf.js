const fs = require("fs");
const path = require("path");

const input = path.join(__dirname, "product-requirements-document.md");
const output = path.join(__dirname, "edgecipline-product-requirements-document.pdf");

const markdown = fs.readFileSync(input, "utf8").replace(/^\uFEFF/, "");

function sanitize(text) {
  return String(text)
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function inline(text) {
  return String(text)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/, "");
}

function wrap(text, max = 86) {
  const words = inline(text).split(/\s+/).filter(Boolean);
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

function styleForHeading(level) {
  if (level === 1) return { size: 22, leading: 30, before: 12, max: 58 };
  if (level === 2) return { size: 15, leading: 22, before: 14, max: 72 };
  if (level === 3) return { size: 12, leading: 17, before: 10, max: 82 };
  return { size: 10, leading: 14, before: 8, max: 86 };
}

const pages = [];
let page = [];
let y = 742;

function newPage() {
  if (page.length) pages.push(page);
  page = [];
  y = 742;
}

function addLine(text = "", options = {}) {
  const size = options.size || 10;
  const leading = options.leading || 14;
  const indent = options.indent || 0;

  if (y - leading < 54) newPage();
  page.push({ text, size, leading, indent });
  y -= leading;
}

function addWrapped(text, options = {}) {
  const max = options.max || 86;
  const prefix = options.prefix || "";
  const continuation = options.continuation || "";
  const lines = wrap(`${prefix}${text}`, max);
  lines.forEach((line, index) => {
    addLine(index === 0 ? line : `${continuation}${line}`, options);
  });
}

function addSpacer(amount = 8) {
  if (y - amount < 54) newPage();
  y -= amount;
}

// Cover page
page.push({ text: "EDGEDISCIPLINE", size: 10, leading: 16, indent: 0 });
page.push({ text: "Product Requirements Document", size: 26, leading: 36, indent: 0 });
page.push({ text: "AI-powered trading journal and discipline coach", size: 13, leading: 22, indent: 0 });
page.push({ text: "Prepared from the Stratedge codebase", size: 10, leading: 18, indent: 0 });
page.push({ text: "Last updated: 2026-06-13", size: 10, leading: 18, indent: 0 });
pages.push(page);
page = [];
y = 742;

const lines = markdown.split(/\r?\n/);
let paragraph = [];
let inCode = false;

function flushParagraph() {
  if (!paragraph.length) return;
  addWrapped(paragraph.join(" "), { size: 10, leading: 14, max: 89 });
  paragraph = [];
}

for (const rawLine of lines) {
  const line = rawLine.trimEnd();

  if (line.startsWith("```")) {
    flushParagraph();
    inCode = !inCode;
    continue;
  }

  if (inCode) {
    if (line.trim()) addWrapped(line, { size: 8, leading: 11, max: 98, indent: 12 });
    continue;
  }

  if (!line.trim()) {
    flushParagraph();
    addSpacer(5);
    continue;
  }

  const heading = /^(#{1,6})\s+(.+)$/.exec(line);
  if (heading) {
    flushParagraph();
    const level = heading[1].length;
    const text = heading[2].replace(/^#+\s*/, "");
    const st = styleForHeading(level);
    if (level === 2 && page.length && y < 680) newPage();
    addSpacer(st.before);
    wrap(text, st.max).forEach((wrapped) => addLine(wrapped, { size: st.size, leading: st.leading }));
    continue;
  }

  if (/^[-*]\s+/.test(line.trim())) {
    flushParagraph();
    addWrapped(line.trim().replace(/^[-*]\s+/, ""), {
      size: 10,
      leading: 14,
      max: 84,
      prefix: "- ",
      continuation: "  ",
    });
    continue;
  }

  if (/^\d+\.\s+/.test(line.trim())) {
    flushParagraph();
    const number = line.trim().match(/^(\d+)\./)[1];
    addWrapped(line.trim().replace(/^\d+\.\s+/, ""), {
      size: 10,
      leading: 14,
      max: 83,
      prefix: `${number}. `,
      continuation: "   ",
    });
    continue;
  }

  if (/^>\s?/.test(line)) {
    flushParagraph();
    addWrapped(line.replace(/^>\s?/, ""), { size: 11, leading: 16, max: 82, indent: 14 });
    continue;
  }

  paragraph.push(line.trim());
}

flushParagraph();
if (page.length) pages.push(page);

const objects = [];
function addObject(body) {
  objects.push(body);
  return objects.length;
}

const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
const pageIds = [];

for (let p = 0; p < pages.length; p++) {
  let cursorY = 742;
  let stream = "BT\n";

  for (const line of pages[p]) {
    const font = line.size >= 12 ? boldFontId : fontId;
    stream += `/F${font === boldFontId ? "B" : "R"} ${line.size} Tf\n`;
    stream += `1 0 0 1 ${62 + line.indent} ${cursorY} Tm\n`;
    stream += `(${sanitize(line.text)}) Tj\n`;
    cursorY -= line.leading;
  }

  stream += `/FR 8 Tf\n1 0 0 1 62 34 Tm\n(${sanitize(`Edgecipline PRD | ${p + 1}`)}) Tj\n`;
  stream += "ET\n";

  const contentId = addObject(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  const pageId = addObject(
    `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 612 792] /Resources << /Font << /FR ${fontId} 0 R /FB ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`
  );
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

fs.writeFileSync(output, pdf, "binary");
console.log(output);
