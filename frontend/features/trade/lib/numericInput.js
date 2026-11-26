// Numeric field handling shared by the manual add-trade forms, the edit forms
// and the OCR review form. Field names decide the rules: integer-only fields
// reject ".", and only P&L may go negative.

export const INTEGER_NUMBER_FIELDS = new Set(["strikePrice", "quantity", "sharesQty"]);
export const DECIMAL_NUMBER_FIELDS = new Set([
  "profit", "entryPrice", "exitPrice", "brokerage", "sttTaxes", "stopLoss", "takeProfit",
  "lotSize", "commission", "swap",
]);
// Fields that may go negative: P&L, swap (a credit or a charge), and the
// charges brokers print with a minus sign. The server takes the absolute
// value of commission/brokerage/STT, so a pasted sign is harmless.
export const NEGATIVE_ALLOWED_FIELDS = new Set(["profit", "swap", "commission", "brokerage", "sttTaxes"]);
// Symbol boxes: letters, digits, space and / . _ - & (EUR/USD, XAUUSD.x,
// NIFTY 26000 CE, M&M), uppercased as typed.
export const SYMBOL_FIELDS = new Set(["pair", "stockSymbol", "underlyingOther"]);
export const sanitizeSymbolInput = (value) =>
  String(value ?? "").toUpperCase().replace(/[^A-Z0-9 /._&-]/g, "").replace(/ {2,}/g, " ").slice(0, 50);
// R:R ratio text ("1:2.5"): digits, one ":" (or "/"), one "." per side.
export const RATIO_FIELDS = new Set(["riskRewardCustom"]);

// Strip anything that is not part of a number from a typed/pasted value.
// Keeps at most one leading "-" (when allowed) and one "." (when not integer).
export const sanitizeNumericInput = (value, { allowNegative = false, integer = false } = {}) => {
  const raw = String(value ?? "");
  let cleaned = raw.replace(/[^\d.-]/g, "");

  if (!allowNegative) {
    cleaned = cleaned.replace(/-/g, "");
  } else {
    const isNegative = cleaned.startsWith("-");
    cleaned = cleaned.replace(/-/g, "");
    if (isNegative) cleaned = `-${cleaned}`;
  }

  if (integer) {
    return cleaned.replace(/\./g, "");
  }

  const sign = cleaned.startsWith("-") ? "-" : "";
  const unsigned = sign ? cleaned.slice(1) : cleaned;
  const [firstPart, ...rest] = unsigned.split(".");
  return `${sign}${firstPart}${rest.length ? `.${rest.join("")}` : ""}`;
};

// Letters never make it into a ratio box: "1:2.5", "1/3" or "2.5" only.
export const sanitizeRatioInput = (value) => {
  const raw = String(value ?? "").replace(/[^\d.:/]/g, "");
  const sepIndex = raw.search(/[:/]/);
  const oneDot = (part) => {
    const [head, ...rest] = part.split(".");
    return `${head}${rest.length ? `.${rest.join("")}` : ""}`;
  };
  if (sepIndex === -1) return oneDot(raw);
  const left = raw.slice(0, sepIndex);
  const right = raw.slice(sepIndex + 1).replace(/[:/]/g, "");
  return `${oneDot(left)}:${oneDot(right)}`.slice(0, 20);
};

// Sanitize by field name — the rule set every trade form's change handler
// applies, so a letter typed or pasted into a number box is dropped on the spot.
export const sanitizeNumericField = (name, value) => {
  if (INTEGER_NUMBER_FIELDS.has(name)) return sanitizeNumericInput(value, { integer: true });
  if (DECIMAL_NUMBER_FIELDS.has(name)) return sanitizeNumericInput(value, { allowNegative: NEGATIVE_ALLOWED_FIELDS.has(name) });
  if (RATIO_FIELDS.has(name)) return sanitizeRatioInput(value);
  if (SYMBOL_FIELDS.has(name)) return sanitizeSymbolInput(value);
  return value;
};

// onKeyDown guard for <input type="number">: browsers accept "e", "+" and a
// stray "-" in number inputs and then report an empty value.
export const blockInvalidNumberKeys = (e) => {
  const fieldName = e.currentTarget?.name;
  const isIntegerField = INTEGER_NUMBER_FIELDS.has(fieldName);
  const allowsNegative = NEGATIVE_ALLOWED_FIELDS.has(fieldName);
  if (["e", "E", "+"].includes(e.key)) e.preventDefault();
  if (!allowsNegative && e.key === "-") e.preventDefault();
  if (isIntegerField && e.key === ".") e.preventDefault();
};

// Form string → number for the API payload; blank/invalid → undefined so the
// field is omitted rather than sent as NaN.
// Strict: "1.2abc" is NOT 1.2 (parseFloat would say it is). Thousands commas
// from a paste are accepted.
export const parseNumericField = (val) => {
  if (typeof val === "number") return Number.isFinite(val) ? val : undefined;
  const text = String(val ?? "").replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text) && !/^-?\.\d+$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
};
