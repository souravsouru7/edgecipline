const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const blockedPathPatterns = [
  /(^|\/)\.env(\..*)?$/i,
  /(^|\/)logs?\//i,
  /\.log$/i,
  /(^|\/)(tmp|temp|cache|artifacts|uploads|backups|scratch|reports)\//i,
  /\.(apk|aab|ipa|tsbuildinfo)$/i,
  /uri_output\.txt$/i,
];

const allowedPathPatterns = [
  /(^|\/)\.env\.example$/i,
  /(^|\/)backend\/\.env\.example$/i,
  /(^|\/)frontend\/\.env\.example$/i,
  /(^|\/)backend\/load-tests\//i,
  /(^|\/)backend\/__tests__\//i,
  /(^|\/)backend\/tests\//i,
];

const secretPatterns = [
  { name: "MongoDB URI with credentials", pattern: /mongodb(?:\+srv)?:\/\/[^:\s]+:[^@\s]+@/i },
  { name: "Cloudinary URL", pattern: /cloudinary:\/\/[^:\s]+:[^@\s]+@/i },
  { name: "Google API key", pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: "OpenAI API key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: "Private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: "Assigned secret-like value",
    pattern:
      /\b(?:JWT_SECRET|ADMIN_JWT_SECRET|GEMINI_API_KEY|CLOUD_API_SECRET|CLOUDINARY_API_SECRET|MONGO_URI|REDIS_URL|SMTP_PASS|SMTP_PASSWORD|RAZORPAY_KEY_SECRET|RESEND_API_KEY|SENTRY_AUTH_TOKEN)\s*[:=]\s*["'](?!your_|REPLACE_|<|$)[^"',]+["']/i,
  },
];

function isAllowed(file) {
  const normalized = file.replace(/\\/g, "/");
  return allowedPathPatterns.some((pattern) => pattern.test(normalized));
}

function isBlockedPath(file) {
  const normalized = file.replace(/\\/g, "/");
  return blockedPathPatterns.some((pattern) => pattern.test(normalized)) && !isAllowed(file);
}

function isProbablyBinary(buffer) {
  return buffer.includes(0);
}

const findings = [];

for (const file of trackedFiles) {
  if (isBlockedPath(file)) {
    findings.push(`${file}: blocked sensitive/generated path`);
    continue;
  }

  const fullPath = path.join(repoRoot, file);
  const buffer = fs.readFileSync(fullPath);
  if (isProbablyBinary(buffer)) {
    continue;
  }

  const content = buffer.toString("utf8");
  if (isAllowed(file)) {
    continue;
  }

  for (const { name, pattern } of secretPatterns) {
    const match = content.match(pattern);
    if (match) {
      const before = content.slice(0, match.index);
      const line = before.split(/\r?\n/).length;
      findings.push(`${file}:${line}: ${name}`);
    }
  }
}

if (findings.length) {
  console.error("Security scan failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("Security scan passed.");
