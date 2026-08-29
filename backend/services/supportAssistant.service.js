"use strict";

const knowledgeBase = require("./knowledgeBase.service");
const { logger } = require("../utils/logger");
const { SUPPORT_CATEGORY_VALUES } = require("../constants/support");

/**
 * The support assistant.
 *
 * Retrieval only. It matches what someone typed against the knowledge base and
 * hands back real articles — it never composes an answer, because a support
 * bot that writes its own prose eventually writes a refund policy nobody
 * approved, and the customer will hold you to it.
 *
 * Everything below is deterministic: the same question always produces the same
 * answer, and every sentence the customer reads was written by a human and
 * published through the knowledge-base editor.
 */

/**
 * Topics where a wrong answer costs money, access, or trust.
 *
 * These skip retrieval entirely and go straight to a human. Not because the
 * knowledge base has nothing to say, but because "the article said X" is not
 * an acceptable outcome when someone has been charged twice or thinks their
 * account is compromised. Being unhelpfully fast here is worse than being
 * slightly slower and correct.
 */
const SENSITIVE_RULES = [
  {
    reason: "money",
    category: "payments",
    message:
      "Anything involving a payment needs a person to look at your account — I don't want to guess about money. Reach us on any of these and it will be treated as high priority.",
    patterns: [
      /\brefund(ed|ing)?\b/,
      /\bcharge?d? (me )?(twice|two times|2 times|double|again)\b/,
      /\bdouble (charge|debit|payment)/,
      /\bdeduct(ed|ion)?\b/,
      /\bdebited\b/,
      /\bmoney (was |is )?(gone|taken|cut|deducted|not)/,
      /\bpaid but\b/,
      /\bpayment (failed|stuck|pending|not working|issue|problem)/,
      /\b(didn'?t|not|never) (get|receive|got)\b.{0,20}\b(refund|money|plan|premium)/,
      /\bchargeback\b/,
      /\bupi\b/,
      /\b(credit|debit) card\b/,
      /\bbank\b/,
      /\binvoice\b/,
      /\bbilled\b/,
      /₹\s*\d/,
    ],
  },
  {
    reason: "account_security",
    category: "security_privacy",
    message:
      "That sounds like an account-security problem, and I'm not going to try to handle it with an article. Contact us directly and we will check the sign-in activity on your account.",
    patterns: [
      /\bhack(ed|ing)?\b/,
      /\bcompromis(ed|e)\b/,
      /\bsomeone else\b.{0,25}\b(account|logged|login|access)/,
      /\bunauthori[sz]ed\b/,
      /\bstolen\b/,
      /\bfraud\b/,
      /\bscam\b/,
      /\bphish/,
      /\bnot me\b/,
    ],
  },
  {
    reason: "data_loss",
    category: "technical_issue",
    message:
      "Missing data is worth a person looking at properly rather than an article. Get in touch and we will check what happened to it.",
    patterns: [
      /\b(trades?|data|journal|setups?|everything)\b.{0,25}\b(gone|missing|disappear(ed)?|deleted|lost|wiped|vanish)/,
      /\blost (all|my) \b/,
      /\bdeleted (my |all )?(trades?|data|account)\b/,
    ],
  },
  {
    reason: "complaint",
    category: "other",
    message:
      "I'd rather a person read this than have me answer it. Here is how to reach the team directly.",
    patterns: [
      /\b(complain|complaint|legal|lawyer|consumer court|ombudsman)\b/,
      /\b(terrible|worst|useless|pathetic|cheat(ed|ing)?|fraudulent)\b/,
      /\bsue\b/,
    ],
  },
];

/**
 * Keyword hints per category, used only to bias retrieval and to pre-select the
 * ticket category when the customer escalates. A wrong guess here costs a
 * slightly worse article match, nothing more.
 */
const CATEGORY_HINTS = {
  getting_started: [/\bstart(ed|ing)?\b/, /\bnew here\b/, /\bhow do i begin\b/, /\bsetup\b/, /\bonboard/],
  account_profile: [/\blog ?in\b/, /\bsign ?in\b/, /\bpassword\b/, /\botp\b/, /\bemail address\b/, /\bprofile\b/, /\blogged out\b/],
  trading_journal: [/\bjournal\b/, /\blog a trade\b/, /\badd trade\b/, /\bchecklist\b/, /\bsetup(s)?\b/],
  trade_import: [/\bocr\b/, /\bscreenshot\b/, /\bimport\b/, /\bupload\b/, /\bextract/, /\bscan(ning)?\b/, /\bread(ing)? my (trade|image)/],
  analytics_reports: [/\banalytic/, /\breport\b/, /\bdashboard\b/, /\bwin ?rate\b/, /\bstatistic/, /\bchart\b/, /\binsight/, /\bdna\b/],
  subscription_billing: [/\bplan\b/, /\bsubscri/, /\bpremium\b/, /\bupgrade\b/, /\brenew/, /\bcancel\b/, /\bfree (tier|limit)\b/, /\blimit\b/],
  technical_issue: [/\bcrash/, /\berror\b/, /\bbug\b/, /\bnot working\b/, /\bbroken\b/, /\bslow\b/, /\bblank\b/, /\bstuck\b/, /\bfreez/],
  mobile_app: [/\bandroid\b/, /\bios\b/, /\biphone\b/, /\bapp\b/, /\bnotification/, /\bpush\b/, /\binstall/],
  security_privacy: [/\bprivacy\b/, /\bsecure\b/, /\bdelete my account\b/, /\bmy data\b/, /\b2fa\b/],
  feature_request: [/\bfeature\b/, /\bsuggest/, /\brequest\b/, /\bcan you add\b/, /\bwould be (nice|good|great)\b/],
};

const MIN_QUESTION_LENGTH = 3;
const MAX_QUESTION_LENGTH = 500;
const MAX_ARTICLES = 3;

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUESTION_LENGTH);
}

/**
 * Does this need a human regardless of what the knowledge base contains?
 * Returns the matching rule, or null.
 */
function detectSensitive(normalized) {
  for (const rule of SENSITIVE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule;
    }
  }
  return null;
}

/** Best-guess category, by how many hint patterns each one matches. */
function detectCategory(normalized) {
  let best = null;
  let bestScore = 0;

  for (const [category, patterns] of Object.entries(CATEGORY_HINTS)) {
    const score = patterns.reduce((total, pattern) => total + (pattern.test(normalized) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }

  return SUPPORT_CATEGORY_VALUES.includes(best) ? best : null;
}

/**
 * Answer a question from the knowledge base, or route it to a human.
 *
 * @returns {{
 *   outcome: "escalate" | "articles" | "no_match",
 *   message: string,
 *   articles: Array,
 *   category: string|null,
 *   reason: string|null
 * }}
 */
async function answer({ text }) {
  const normalized = normalize(text);

  if (normalized.length < MIN_QUESTION_LENGTH) {
    return {
      outcome: "no_match",
      message: "Tell me a little more about what is going wrong and I will find the right guide.",
      articles: [],
      category: null,
      reason: null,
    };
  }

  // Sensitive topics short-circuit BEFORE retrieval. There is deliberately no
  // path where a money or account-access question gets answered by an article.
  const sensitive = detectSensitive(normalized);
  if (sensitive) {
    logger.info("SUPPORT_ASSISTANT_ESCALATED", { reason: sensitive.reason });
    return {
      outcome: "escalate",
      message: sensitive.message,
      articles: [],
      category: sensitive.category,
      reason: sensitive.reason,
    };
  }

  const category = detectCategory(normalized);

  // Category-scoped first, then unscoped — a customer's phrasing often points
  // at the wrong category, and a good article in the "wrong" one still answers
  // the question.
  let result = await knowledgeBase.searchArticles({
    q: normalized,
    category: category || undefined,
    limit: MAX_ARTICLES,
  });

  if (!result.items.length && category) {
    result = await knowledgeBase.searchArticles({ q: normalized, limit: MAX_ARTICLES });
  }

  if (!result.items.length) {
    return {
      outcome: "no_match",
      message:
        "I could not find a guide for that one. A person will be able to help — here are the fastest ways to reach us.",
      articles: [],
      category,
      reason: "no_match",
    };
  }

  return {
    outcome: "articles",
    message:
      result.matchedBy === "partial"
        ? "I did not find an exact match, but this looks closest:"
        : result.items.length > 1
          ? "This should cover it:"
          : "This should help:",
    articles: result.items.slice(0, MAX_ARTICLES),
    category,
    reason: null,
  };
}

module.exports = {
  answer,
  // Exported for tests — these are the rules the safety guarantee rests on.
  detectSensitive,
  detectCategory,
  normalize,
  SENSITIVE_RULES,
  MAX_QUESTION_LENGTH,
};
