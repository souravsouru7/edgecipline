#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const fixKnown = process.argv.includes("--fix-known");
const includeGenerated = process.argv.includes("--include-generated");

const alwaysIgnoredDirs = new Set([
  ".git",
  "node_modules"
]);

const ignoredDirs = new Set([
  ".next",
  "dist",
  "build",
  "coverage",
  "out"
]);

const ignoredPathFragments = [
  path.join("frontend", "android", "app", "src", "main", "assets", "public")
];

const ignoredFiles = new Set([
  "package-lock.json",
  "android.zip",
  "app-debug.apk",
  "eng.traineddata",
  "trades_output.txt"
]);

const textExtensions = new Set([
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".webmanifest",
  ".xml",
  ".yaml",
  ".yml"
]);

const s = (...codes) => String.fromCharCode(...codes);

const knownFixes = [
  [s(0x00e2, 0x20ac, 0x201d), "-"],
  [s(0x00e2, 0x20ac, 0x201c), "-"],
  [s(0x00e2, 0x2020, 0x2019), "->"],
  [s(0x00e2, 0x0153, 0x201c), "OK"],
  [s(0x00e2, 0x20ac, 0x00a6), "..."],
  [s(0x00c2, 0x00b7), "*"],
  [s(0x00e2, 0x20ac, 0x0153), "\""],
  [s(0x00e2, 0x20ac, 0x009d), "\""],
  [s(0x00e2, 0x20ac, 0x02dc), "'"],
  [s(0x00e2, 0x20ac, 0x2122), "'"],
  [s(0x00e2, 0x201d, 0x20ac), "-"],
  [s(0x00e2, 0x00ac, 0x2020), ""],
  [s(0x00f0, 0x0178, 0x201c, 0x0160), ""],
  [s(0x00f0, 0x0178, 0x201c, 0x2039), ""],
  [s(0x00f0, 0x0178, 0x2021, 0x00ae, 0x00f0, 0x0178, 0x2021, 0x00b3), "IN"],
  [s(0x00f0, 0x0178, 0x017d, 0x201c), ""]
];

const blockedPatterns = [
  new RegExp(s(0x00e2), "g"),
  new RegExp(s(0x00c3), "g"),
  new RegExp(s(0x00ef, 0x00bf, 0x00bd), "g"),
  /\uFFFD/g,
  new RegExp(s(0x00f0, 0x0178), "g"),
  new RegExp(s(0x00e2, 0x2020), "g"),
  new RegExp(s(0x00e2, 0x0153), "g"),
  new RegExp(s(0x00e2, 0x201d), "g")
];

function isTextFile(filePath) {
  const base = path.basename(filePath);
  if (ignoredFiles.has(base)) return false;
  if (base.startsWith(".env")) return true;
  return textExtensions.has(path.extname(base));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (alwaysIgnoredDirs.has(entry.name)) continue;
    if (!includeGenerated && ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (!includeGenerated && ignoredPathFragments.some((fragment) => relativePath.startsWith(fragment))) continue;
    if (entry.isDirectory()) {
      walk(fullPath, out);
    } else if (entry.isFile() && isTextFile(fullPath)) {
      out.push(fullPath);
    }
  }
  return out;
}

function repair(text) {
  let next = text;
  for (const [from, to] of knownFixes) {
    next = next.split(from).join(to);
  }
  return next;
}

const findings = [];

for (const file of walk(root)) {
  let text = fs.readFileSync(file, "utf8");

  if (fixKnown) {
    const repaired = repair(text);
    if (repaired !== text) {
      fs.writeFileSync(file, repaired, "utf8");
      text = repaired;
    }
  }

  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (blockedPatterns.some((pattern) => pattern.test(line))) {
      blockedPatterns.forEach((pattern) => {
        pattern.lastIndex = 0;
      });
      findings.push({
        file: path.relative(root, file),
        line: index + 1,
        text: line.trim().slice(0, 180)
      });
    }
  });
}

if (findings.length) {
  console.error("Mojibake patterns found:");
  for (const finding of findings.slice(0, 80)) {
    console.error(`${finding.file}:${finding.line}: ${finding.text}`);
  }
  if (findings.length > 80) {
    console.error(`...and ${findings.length - 80} more.`);
  }
  process.exit(1);
}

console.log("Mojibake scan passed.");
