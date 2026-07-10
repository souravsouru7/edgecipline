const { isIP } = require("net");

const UNSAFE_TRUST_ALL = new Set(["true", "*", "0.0.0.0/0", "::/0"]);
const NAMED_RANGES = new Set(["loopback", "linklocal", "uniquelocal"]);

function isValidIpOrCidr(entry) {
  const slashIndex = entry.indexOf("/");
  const address = slashIndex === -1 ? entry : entry.slice(0, slashIndex);
  const prefix = slashIndex === -1 ? null : entry.slice(slashIndex + 1);
  const family = isIP(address);

  if (!family) return false;
  if (prefix === null) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;

  const prefixNumber = Number(prefix);
  return prefixNumber <= (family === 4 ? 32 : 128);
}

function parseTrustProxy(rawValue, { isProduction = false } = {}) {
  const value = String(rawValue || "").trim();

  if (!value) {
    if (isProduction) {
      throw new Error(
        "Missing required env var: TRUST_PROXY. Set it to false for direct traffic, " +
        "or to the exact proxy IP/CIDR list used by Nginx/load balancers."
      );
    }
    return false;
  }

  const normalized = value.toLowerCase();
  if (normalized === "false") return false;

  if (UNSAFE_TRUST_ALL.has(normalized)) {
    throw new Error("TRUST_PROXY must not trust every upstream address.");
  }

  const hopMatch = normalized.match(/^(?:hop:)?([1-9]\d*)$/);
  if (hopMatch) return Number(hopMatch[1]);

  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) {
    throw new Error("TRUST_PROXY must contain at least one trusted proxy IP or CIDR.");
  }

  for (const entry of entries) {
    const lowerEntry = entry.toLowerCase();
    if (UNSAFE_TRUST_ALL.has(lowerEntry)) {
      throw new Error("TRUST_PROXY must not contain a trust-all network.");
    }
    if (NAMED_RANGES.has(lowerEntry)) continue;

    if (!isValidIpOrCidr(entry)) {
      throw new Error(`Invalid TRUST_PROXY entry: ${entry}`);
    }
  }

  return entries.join(", ");
}

module.exports = { parseTrustProxy };
