// Pure helpers for the per-trade setup checklist ({ id, label, followed }[]).
// Both add-trade forms and both edit forms keep this list in React state and
// used to each carry their own copy of these updaters; the ID scheme had
// already drifted between them (Date.now() vs. index+1 vs. length+1).

// Server documents may omit rule ids. Keep any id the server sent — the
// checklist notification binds to it — and fall back to the 1-based position.
export function normalizeSetupRules(rules = []) {
  return Array.isArray(rules)
    ? rules.map((rule, index) => ({
        id: rule?.id ?? index + 1,
        label: rule?.label || "",
        followed: Boolean(rule?.followed),
      }))
    : [];
}

// Next free id: one past the largest numeric id present, so a freshly added
// rule can never collide with one that came from the server.
export function nextSetupRuleId(rules = []) {
  const maxId = rules.reduce((max, rule) => {
    const id = Number(rule?.id);
    return Number.isFinite(id) && id > max ? id : max;
  }, 0);
  return maxId + 1;
}

export function appendSetupRule(rules = []) {
  return [...rules, { id: nextSetupRuleId(rules), label: "", followed: false }];
}

export function toggleSetupRule(rules = [], id) {
  return rules.map((rule) => (rule.id === id ? { ...rule, followed: !rule.followed } : rule));
}

export function setSetupRuleLabel(rules = [], id, label) {
  return rules.map((rule) => (rule.id === id ? { ...rule, label } : rule));
}

export function clearSetupRules(rules = []) {
  return rules.map((rule) => ({ ...rule, followed: false }));
}
