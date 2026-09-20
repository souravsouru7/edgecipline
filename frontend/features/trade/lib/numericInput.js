// Numeric field handling shared by the manual add-trade forms, the edit forms
// and the OCR review form. Field names decide the rules: integer-only fields
// reject ".", and only P&L may go negative.

export const INTEGER_NUMBER_FIELDS = new Set(["strikePrice", "quantity", "sharesQty"]);
export const DECIMAL_NUMBER_FIELDS = new Set(["profit", "entryPrice", "exitPrice", "brokerage", "sttTaxes", "stopLoss", "takeProfit"]);

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

// Sanitize by field name — the rule set the change handlers apply.
export const sanitizeNumericField = (name, value) => {
  if (INTEGER_NUMBER_FIELDS.has(name)) return sanitizeNumericInput(value, { integer: true });
  if (DECIMAL_NUMBER_FIELDS.has(name)) return sanitizeNumericInput(value, { allowNegative: name === "profit" });
  return value;
};

// onKeyDown guard for <input type="number">: browsers accept "e", "+" and a
// stray "-" in number inputs and then report an empty value.
export const blockInvalidNumberKeys = (e) => {
  const fieldName = e.currentTarget?.name;
  const isIntegerField = INTEGER_NUMBER_FIELDS.has(fieldName);
  const allowsNegative = fieldName === "profit";
  if (["e", "E", "+"].includes(e.key)) e.preventDefault();
  if (!allowsNegative && e.key === "-") e.preventDefault();
  if (isIntegerField && e.key === ".") e.preventDefault();
};

// Form string → number for the API payload; blank/invalid → undefined so the
// field is omitted rather than sent as NaN.
export const parseNumericField = (val) => {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : undefined;
};
