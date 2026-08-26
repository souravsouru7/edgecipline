/**
 * Client-side mirror of the server's password policy
 * (backend/controllers/authController.js → validatePasswordStrength).
 *
 * The server stays the authority — this only spares the user a round trip and
 * a generic red box. Keep the two in sync; if they drift, the server wins and
 * the user sees its message instead.
 */

export const PASSWORD_RULES = [
  { id: "length", label: "At least 8 characters", test: (v) => v.length >= 8 },
  { id: "upper", label: "One uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { id: "lower", label: "One lowercase letter", test: (v) => /[a-z]/.test(v) },
  { id: "digit", label: "One number", test: (v) => /[0-9]/.test(v) },
  {
    id: "special",
    label: "One special character",
    test: (v) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v),
  },
];

/** Returns the first unmet rule's message, or "" when the password passes. */
export function firstPasswordProblem(password) {
  const value = typeof password === "string" ? password : "";
  const failed = PASSWORD_RULES.find((rule) => !rule.test(value));
  return failed ? `Password needs: ${failed.label.toLowerCase()}` : "";
}

export function passwordRuleState(password) {
  const value = typeof password === "string" ? password : "";
  return PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.test(value),
  }));
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email) {
  return EMAIL_REGEX.test(String(email || "").trim());
}
