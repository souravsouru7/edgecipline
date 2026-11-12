const crypto = require("crypto");
const { Resend } = require("resend");
const nodemailer = require("nodemailer");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const { withTimeout } = require("../utils/withTimeout");
// Safe: paymentService does not require mailService, so there is no cycle.
const { listOrderablePlans } = require("./paymentService");

// ─── Transport selection ─────────────────────────────────────────────────────
//
// Two providers, one rule: SMTP wins whenever SMTP_USER + SMTP_PASS are set,
// otherwise Resend. Resend refuses to deliver from a domain that is not
// verified in its dashboard, and its sandbox sender (onboarding@resend.dev)
// only reaches the account owner's own inbox — so until a real domain has its
// DNS records verified, Resend cannot send a password reset to anyone. SMTP
// (a Gmail app password is enough) needs no DNS at all, which is why it is the
// override rather than the fallback.

let resendClient = null;
function getResendClient() {
  if (!resendClient) resendClient = new Resend(appConfig.resend.apiKey);
  return resendClient;
}

// Unit tests mock `config` without the email block; fall back to safe values.
function getEmailConfig() {
  return appConfig.email || {};
}

function getReplyTo() {
  return String(getEmailConfig().replyTo || "").trim() || undefined;
}

function getSendTimeoutMs() {
  const ms = Number(getEmailConfig().sendTimeoutMs);
  return Number.isFinite(ms) && ms > 0 ? ms : 15000;
}

// Unit tests mock `config` with only the resend block, so the smtp block must
// be treated as optional here.
function getSmtpConfig() {
  return appConfig.smtp || {};
}

function isSmtpConfigured() {
  const smtp = getSmtpConfig();
  return Boolean(smtp.user && smtp.pass);
}

function isResendConfigured() {
  return Boolean(appConfig.resend.apiKey);
}

// Unit tests mock `config` without the email block; treat it as off.
function isConsoleOnly() {
  return Boolean(appConfig.email?.consoleOnly);
}

function getProvider() {
  if (isConsoleOnly()) return "console";
  if (isSmtpConfigured()) return "smtp";
  if (isResendConfigured()) return "resend";
  return null;
}

// Gmail overwrites the From address with the authenticated account regardless,
// but the display name survives, so make sure there is one.
function getSmtpFromAddress() {
  const from = String(getSmtpConfig().from || getSmtpConfig().user || "");
  return /</.test(from) ? from : `Edgecipline <${from}>`;
}

function getFromAddress() {
  return getProvider() === "smtp" ? getSmtpFromAddress() : appConfig.resend.from;
}

// Plain-text rendering of a template. Sent alongside the HTML as the
// `text` part (spam filters score HTML-only mail worse, and some clients show
// it in previews) and printed in console mode.
function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|h[1-6]|tr|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&copy;/g, "(c)")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

// Dev-only stand-in for a mailbox. Goes to stdout on purpose, not the logger:
// the logger redacts, ships to files/Sentry, and has a test asserting it never
// sees a plaintext OTP — the whole point here is that the developer does.
function printToConsole({ to, subject, html }) {
  const text = htmlToText(html);
  const line = "═".repeat(72);
  process.stdout.write(
    [
      "",
      line,
      "EMAIL_CONSOLE_ONLY — not sent, printed for local testing",
      `To:      ${to}`,
      `Subject: ${subject}`,
      "─".repeat(72),
      text,
      line,
      "",
      "",
    ].join("\n")
  );
}

let smtpTransport = null;
function getSmtpTransport() {
  if (!smtpTransport) {
    const smtp = getSmtpConfig();
    const timeout = getSendTimeoutMs();
    smtpTransport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      // Without these nodemailer waits on the OS socket timeout (minutes) when
      // the relay is unreachable, and the forgot-password request waits with it.
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
    });
  }
  return smtpTransport;
}

// Correlatable in logs, not reversible to an inbox.
function hashRecipient(email) {
  return crypto.createHash("sha256").update(String(email || "").toLowerCase().trim()).digest("hex").slice(0, 12);
}

function getSenderDomain(fromAddress = getFromAddress()) {
  const match = String(fromAddress || "").match(/@([^>\s]+)/);
  return match?.[1] || "";
}

function getResendErrorMessage(error) {
  return error?.message || error?.name || "Resend rejected the email";
}

// Mailbox providers whose domains Resend can never verify; mirrors the list
// the boot-time warning in config uses.
const PUBLIC_MAILBOX_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com",
  "hotmail.com", "live.com", "icloud.com", "proton.me", "protonmail.com", "rediffmail.com",
]);


// Resend refuses a misconfigured sender the same way every single time: an
// unverified `from` domain, a send-only key used for a read, a revoked key, or
// a sandbox sender writing to someone other than the account owner all come
// back as 4xx validation failures. Retrying one is guaranteed to fail again, so
// callers must be able to tell it apart from a genuine blip before they invite
// the user to "try again in a moment".
const PERMANENT_SEND_ERROR_NAMES = new Set([
  "validation_error",
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "not_found",
]);

function isPermanentSendFailure(error) {
  const status = Number(error?.statusCode || 0);
  if (status === 401 || status === 403 || status === 404 || status === 422) return true;
  return PERMANENT_SEND_ERROR_NAMES.has(String(error?.name || ""));
}

// Nodemailer's equivalents: EAUTH is a wrong app password (or 2FA/app
// passwords not enabled), EENVELOPE with a 5xx is a sender/recipient the relay
// refuses outright. Connection drops and 4xx greylisting are worth a retry.
function isPermanentSmtpFailure(error) {
  const code = String(error?.code || "");
  if (code === "EAUTH") return true;
  const responseCode = Number(error?.responseCode || 0);
  return responseCode >= 500 && responseCode < 600;
}

// Wraps a provider rejection in an Error the caller can classify. `permanent`
// means "no amount of retrying fixes this — an operator has to change config".
function buildSendError(error, provider = "resend") {
  if (provider === "smtp") {
    const err = new Error(error?.message || "SMTP relay rejected the email");
    err.provider = "smtp";
    err.providerStatus = Number(error?.responseCode || 0);
    err.providerErrorName = String(error?.code || "");
    err.permanent = isPermanentSmtpFailure(error);
    return err;
  }
  const err = new Error(getResendErrorMessage(error));
  err.provider = "resend";
  err.providerStatus = Number(error?.statusCode || 0);
  err.providerErrorName = String(error?.name || "");
  // A timeout or a dropped connection is the one kind of failure a retry can
  // fix — never let it be mistaken for a config fault.
  err.permanent = error?.code === "ETIMEDOUT" ? false : isPermanentSendFailure(error);
  return err;
}

// What an operator has to change when a send is permanently failing. Spelled
// out because the provider message alone ("the X domain is not verified") has
// repeatedly been read as a transient outage. No scheme in URLs on purpose —
// the logger redacts anything that looks like one, which would strip the only
// actionable part of this.
function operatorActionFor(sendError, what) {
  if (!sendError.permanent) return undefined;
  const prefix = `${what} is misconfigured and every send will fail until it is fixed.`;
  if (sendError.provider === "smtp") {
    return `${prefix} SMTP_USER/SMTP_PASS were rejected by ${getSmtpConfig().host} — for Gmail, generate an app password at myaccount.google.com/apppasswords and put it in SMTP_PASS.`;
  }
  if (sendError.providerStatus === 401 || sendError.providerErrorName === "invalid_api_key") {
    return `${prefix} RESEND_API_KEY was rejected (revoked or mistyped) — create a new key at resend.com/api-keys.`;
  }
  const domain = getSenderDomain();
  if (domain === "resend.dev") {
    return `${prefix} RESEND_FROM is the sandbox sender (onboarding@resend.dev), which only delivers to the Resend account owner's inbox. Set RESEND_FROM=Edgecipline <noreply@edgecipline.com> (edgecipline.com is verified).`;
  }
  if (PUBLIC_MAILBOX_DOMAINS.has(domain)) {
    return `${prefix} RESEND_FROM uses ${domain}, which Resend cannot verify. Set RESEND_FROM=Edgecipline <noreply@edgecipline.com>, or set SMTP_USER/SMTP_PASS to send through Gmail instead.`;
  }
  return `${prefix} Verify the "${domain}" domain in the Resend dashboard (resend.com/domains) and keep RESEND_FROM on a verified domain, or set SMTP_USER/SMTP_PASS to send through Gmail instead.`;
}

// The one place mail leaves the process. Resolves to `{ error }` in the same
// shape both callers below already classify; never throws for a provider
// rejection so the callers can decide whether that is fatal for them.
async function deliver({ to, subject, html }) {
  const provider = getProvider();
  const text = htmlToText(html);
  const replyTo = getReplyTo();
  const timeoutMs = getSendTimeoutMs();

  if (provider === "console") {
    printToConsole({ to, subject, html });
    return { error: null, provider };
  }

  if (provider === "smtp") {
    try {
      await withTimeout(
        getSmtpTransport().sendMail({ from: getSmtpFromAddress(), to, subject, html, text, replyTo }),
        "SMTP relay",
        timeoutMs
      );
      return { error: null, provider };
    } catch (error) {
      return { error: buildSendError(error, "smtp"), provider };
    }
  }

  // The SDK reports API rejections as `{ error }` rather than throwing, but a
  // DNS failure, a timeout, or a bug inside it still throws — treat those as
  // transient too instead of letting them escape unclassified.
  try {
    const { error } = await withTimeout(
      getResendClient().emails.send({
        from: appConfig.resend.from,
        to,
        subject,
        html,
        text,
        replyTo,
      }),
      "Resend",
      timeoutMs
    );
    return { error: error ? buildSendError(error, "resend") : null, provider };
  } catch (error) {
    return { error: buildSendError(error, "resend"), provider };
  }
}

exports.sendOTPEmail = async (email, otp) => {
  if (!getProvider()) {
    logger.error("No email provider configured - OTP email cannot be sent", {
      recipientConfigured: Boolean(email),
    });
    const err = new Error("RESEND_API_KEY is not configured and no SMTP credentials are set");
    err.permanent = true;
    throw err;
  }

  const { error: sendError, provider } = await deliver({
    to: email,
    subject: "Your Edgecipline password reset code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #0d9e6e; text-align: center;">EDGECIPLINE</h2>
        <p>Hello,</p>
        <p>You requested a password reset. Use the following 6-digit code to reset your password. It expires in <strong>10 minutes</strong>.</p>
        <div style="background-color: #f0fdf9; border: 1px dashed #0d9e6e; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <h1 style="color: #0d9e6e; font-size: 40px; letter-spacing: 8px; margin: 0;">${otp}</h1>
        </div>
        <p>If you did not request this, you can safely ignore this email - your password will not change.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #94a3b8; text-align: center;">&copy; 2026 Edgecipline. All rights reserved.</p>
      </div>
    `,
  });

  if (sendError) {
    logger.error("OTP email failed", {
      provider,
      recipientId: hashRecipient(email),
      senderDomain: getSenderDomain(),
      providerStatus: sendError.providerStatus,
      providerErrorName: sendError.providerErrorName,
      permanent: sendError.permanent,
      operatorAction: operatorActionFor(sendError, "Password reset email"),
      error: sendError.message,
    });
    throw sendError;
  }

  return true;
};

exports.getSenderDomain = getSenderDomain;
exports.getProvider = getProvider;
exports.getFromAddress = getFromAddress;
exports.getReplyTo = getReplyTo;
exports.htmlToText = htmlToText;

// ─── Customer support ────────────────────────────────────────────────────────
//
// Everything below interpolates text written by a human — a customer's subject
// line, an agent's reply — into HTML. That text is escaped, without exception.
// An unescaped `<img onerror>` in a ticket subject would execute in whatever
// webmail client opens the message, and support email is exactly the surface an
// attacker gets to choose the contents of.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function supportLayout({ heading, ticketCode, bodyHtml, ctaLabel, ctaPath }) {
  const base = String(appConfig.support.appBaseUrl || "").replace(/\/+$/, "");
  const ctaUrl = `${base}${ctaPath}`;

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px 24px;background:#FFFFFF;color:#0F1923;">
      <div style="text-align:center;margin-bottom:8px;">
        <h2 style="color:#0D9E6E;margin:0;letter-spacing:0.04em;">EDGECIPLINE</h2>
        <div style="font-size:11px;color:#94A3B8;letter-spacing:0.15em;margin-top:4px;">CUSTOMER SUPPORT</div>
      </div>

      <div style="height:3px;background:linear-gradient(90deg,#B8860B 0%,#0D9E6E 50%,#B8860B 100%);margin:20px 0 28px;"></div>

      <h3 style="font-size:18px;margin:0 0 6px;color:#0F1923;">${escapeHtml(heading)}</h3>
      <div style="font-family:'Courier New',monospace;font-size:12px;color:#B8860B;font-weight:700;margin-bottom:20px;">
        Ticket ${escapeHtml(ticketCode)}
      </div>

      ${bodyHtml}

      <div style="text-align:center;margin:28px 0 12px;">
        <a href="${ctaUrl}"
           style="background:#0F1923;color:#22C78E;padding:14px 32px;text-decoration:none;border-radius:10px;font-weight:800;font-size:14px;letter-spacing:0.02em;display:inline-block;">
          ${escapeHtml(ctaLabel)}
        </a>
      </div>

      <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 16px;" />
      <p style="font-size:11px;color:#94A3B8;text-align:center;margin:0;line-height:1.6;">
        Reply on the ticket rather than to this email — replies to this address are not monitored.<br />
        Need us faster? WhatsApp +${escapeHtml(appConfig.support.whatsappNumber)} or email
        <a href="mailto:${escapeHtml(appConfig.support.email)}" style="color:#64748B;">${escapeHtml(appConfig.support.email)}</a>.
      </p>
    </div>
  `;
}

// Support email must never be the reason a ticket write fails. Every sender
// below resolves rather than throws: the caller has already committed the
// ticket, and the customer can always see the reply in the app.
async function sendSupportEmail({ to, subject, html, context }) {
  if (!appConfig.support.emailNotificationsEnabled) {
    return { sent: false, reason: "disabled" };
  }
  if (!getProvider()) {
    logger.warn("No email provider configured — skipping support email", context);
    return { sent: false, reason: "not_configured" };
  }
  if (!to) {
    return { sent: false, reason: "no_recipient" };
  }

  try {
    const { error: sendError, provider } = await deliver({ to, subject, html });

    if (sendError) {
      logger.error("SUPPORT_EMAIL_FAILED", {
        ...context,
        provider,
        recipientId: hashRecipient(to),
        senderDomain: getSenderDomain(),
        providerStatus: sendError.providerStatus,
        providerErrorName: sendError.providerErrorName,
        permanent: sendError.permanent,
        operatorAction: operatorActionFor(sendError, "Support email"),
        error: sendError.message,
      });
      return { sent: false, reason: sendError.permanent ? "permanent" : "transient" };
    }

    return { sent: true };
  } catch (error) {
    logger.error("SUPPORT_EMAIL_THREW", { ...context, error: error.message });
    return { sent: false, reason: "exception" };
  }
}

exports.sendSupportTicketCreated = async ({ to, userName, ticketId, ticketCode, subject, categoryLabel }) => {
  const bodyHtml = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">Hi ${escapeHtml(userName || "there")},</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#334155;">
      We have your request and the support team has been notified. You will get an email as soon as someone replies.
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #E2E8F0;border-radius:10px;border-collapse:separate;border-spacing:0;margin:0 0 8px;">
      <tr>
        <td style="padding:10px 14px;color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #EEF2F6;">Subject</td>
        <td style="padding:10px 14px;color:#0F1923;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #EEF2F6;">${escapeHtml(subject)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Category</td>
        <td style="padding:10px 14px;color:#0F1923;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(categoryLabel)}</td>
      </tr>
    </table>
  `;

  return sendSupportEmail({
    to,
    subject: `Edgecipline Support — Ticket ${ticketCode} received`,
    html: supportLayout({
      heading: "We've received your request",
      ticketCode,
      bodyHtml,
      ctaLabel: "VIEW TICKET",
      ctaPath: `/support/tickets/detail?id=${encodeURIComponent(ticketId)}`,
    }),
    context: { event: "ticket_created", ticketCode },
  });
};

/**
 * @param {string} replyPreview MUST come from a PUBLIC message. Passing an
 *   internal note here would email staff-only commentary to the customer, so
 *   the caller reads it from the public-only query rather than from whatever
 *   message it happens to be holding.
 */
exports.sendSupportAgentReply = async ({ to, userName, ticketId, ticketCode, subject, replyPreview, agentName }) => {
  const bodyHtml = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">Hi ${escapeHtml(userName || "there")},</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#334155;">
      ${escapeHtml(agentName || "Our support team")} replied to your ticket about
      &ldquo;${escapeHtml(subject)}&rdquo;.
    </p>
    <div style="background:#F8FAFC;border-left:3px solid #0D9E6E;padding:14px 16px;margin:0 0 8px;color:#475569;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(replyPreview)}</div>
  `;

  return sendSupportEmail({
    to,
    subject: `Edgecipline Support — Ticket ${ticketCode}`,
    html: supportLayout({
      heading: "You have a new reply",
      ticketCode,
      bodyHtml,
      ctaLabel: "READ & REPLY",
      ctaPath: `/support/tickets/detail?id=${encodeURIComponent(ticketId)}`,
    }),
    context: { event: "agent_reply", ticketCode },
  });
};

exports.sendSupportResolved = async ({ to, userName, ticketId, ticketCode, subject, resolutionSummary }) => {
  const summaryBlock = resolutionSummary
    ? `<div style="background:#F0FDF9;border-left:3px solid #0D9E6E;padding:14px 16px;margin:0 0 8px;color:#334155;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(resolutionSummary)}</div>`
    : "";

  const bodyHtml = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">Hi ${escapeHtml(userName || "there")},</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#334155;">
      We have marked your ticket about &ldquo;${escapeHtml(subject)}&rdquo; as resolved.
    </p>
    ${summaryBlock}
    <p style="font-size:13px;line-height:1.6;margin:16px 0 0;color:#64748B;">
      Not fixed? Reply on the ticket within 7 days and it reopens straight away.
    </p>
  `;

  return sendSupportEmail({
    to,
    subject: `Edgecipline Support — Ticket ${ticketCode} resolved`,
    html: supportLayout({
      heading: "Your ticket is resolved",
      ticketCode,
      bodyHtml,
      ctaLabel: "REVIEW & RATE",
      ctaPath: `/support/tickets/detail?id=${encodeURIComponent(ticketId)}`,
    }),
    context: { event: "resolved", ticketCode },
  });
};

exports.escapeHtml = escapeHtml;

// Subscription Rescue Funnel — one templated function for all 7 touchpoints.
// `intro` is the touchpoint-specific opener written by subscriptionRescueService.
// `context` is the rescue context payload; we render the metric block from it
// so every email shows the user their *own* numbers, not generic copy.
//
// Required fields on `context`:
//   disciplineStreak, longestStreak, tradesLogged, weeklyReportsCount,
//   bestSetup ({ name, winRate } | null), latestInsightLine (string | null)
exports.sendRescueEmail = async ({ to, userName, touchpoint, subject, intro, context }) => {
  if (!getProvider()) {
    logger.warn("No email provider configured — skipping rescue email", { touchpoint });
    return true;
  }

  const metricRow = (label, value) => `
    <tr>
      <td style="padding:8px 12px;color:#64748B;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #EEF2F6;">${label}</td>
      <td style="padding:8px 12px;color:#0F1923;font-size:18px;font-weight:700;text-align:right;border-bottom:1px solid #EEF2F6;">${value}</td>
    </tr>`;

  const rows = [];
  if (context.disciplineStreak > 0) rows.push(metricRow("Discipline streak", `${context.disciplineStreak} days`));
  if (context.tradesLogged > 0)     rows.push(metricRow("Trades logged", String(context.tradesLogged)));
  if (context.bestSetup)            rows.push(metricRow("Best setup", `${context.bestSetup.name} · ${context.bestSetup.winRate}%`));
  if (context.weeklyReportsCount)   rows.push(metricRow("Weekly reports", String(context.weeklyReportsCount)));
  if (context.longestStreak > 0 && context.longestStreak !== context.disciplineStreak) {
    rows.push(metricRow("Longest streak", `${context.longestStreak} days`));
  }

  const insightBlock = context.latestInsightLine
    ? `<div style="background:#F8FAFC;border-left:3px solid #0D9E6E;padding:14px 16px;margin:20px 0;font-style:italic;color:#475569;font-size:14px;line-height:1.55;">"${context.latestInsightLine}"</div>`
    : "";

  // Quote the real catalogue rather than a literal: this template shipped
  // "₹50/month" long after that price was retired, i.e. it emailed customers
  // a price the checkout would never charge.
  const cheapestPerMonth = Math.min(
    ...listOrderablePlans().map((plan) => plan.perMonth)
  );

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px 24px;background:#FFFFFF;color:#0F1923;">
      <div style="text-align:center;margin-bottom:24px;">
        <h2 style="color:#0D9E6E;margin:0;letter-spacing:0.04em;">EDGECIPLINE</h2>
      </div>

      <p style="font-size:15px;line-height:1.55;margin:0 0 12px;">Hi ${userName || "trader"},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#334155;">${intro}</p>

      ${rows.length > 0
        ? `<table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #E2E8F0;border-radius:10px;border-collapse:separate;border-spacing:0;margin:8px 0 20px;">${rows.join("")}</table>`
        : ""}

      ${insightBlock}

      <div style="text-align:center;margin:28px 0 12px;">
        <a href="https://app.edgecipline.com/settings"
           style="background:#0F1923;color:#22C78E;padding:14px 32px;text-decoration:none;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:0.02em;display:inline-block;">
          REACTIVATE PREMIUM
        </a>
      </div>
      <p style="text-align:center;color:#94A3B8;font-size:11px;margin:0;">From ₹${cheapestPerMonth}/month · Cancel anytime · Your data stays exactly where it is</p>

      <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 16px;" />
      <p style="font-size:11px;color:#94A3B8;text-align:center;margin:0;">
        You're receiving this because you have notifications enabled for your Edgecipline account.<br />
        Manage preferences in <a href="https://app.edgecipline.com/settings" style="color:#64748B;">Settings</a>.
      </p>
    </div>
  `;

  const { error, provider } = await deliver({ to, subject, html });

  if (error) {
    logger.error("Rescue email failed", {
      recipientId: hashRecipient(to),
      touchpoint,
      provider,
      permanent: error.permanent,
      operatorAction: operatorActionFor(error, "Rescue email"),
      error: error.message,
    });
    throw new Error("Failed to send rescue email");
  }

  return true;
};

// Free-tier conversion funnel — one templated function for the D+3 / D+7 /
// D+14 touchpoints written by freeTierNudgeService. `context` is the
// free-tier context from freeTierFunnelService; the email recaps the user's
// own live trades (symbol, side, P&L, date) so it reads as their log, not a
// brochure. No deadline, no discount, no "you'll lose your data": the log
// stays readable on the free tier and the copy says so.
//
// Required fields on `context`:
//   recentTrades ([{ market, symbol, side, pnl, date }]), teaserInsight
//   ({ text }), disciplineStreak, freeTradeLimit, primaryMarketLabel
exports.sendFreeTierEmail = async ({ to, userName, touchpoint, subject, intro, context }) => {
  if (!getProvider()) {
    logger.warn("No email provider configured — skipping free-tier email", { touchpoint });
    return true;
  }

  const formatPnl = (trade) => {
    if (typeof trade.pnl !== "number") return "—";
    const unit = trade.market === "Indian_Market" ? "₹" : "$";
    const sign = trade.pnl < 0 ? "-" : trade.pnl > 0 ? "+" : "";
    return `${sign}${unit}${Math.abs(trade.pnl).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  };
  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  const tradeRow = (trade) => {
    const pnl = trade.pnl;
    const colour = typeof pnl !== "number" ? "#64748B" : pnl >= 0 ? "#0D9E6E" : "#D63B3B";
    return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #EEF2F6;">
        <div style="color:#0F1923;font-size:14px;font-weight:700;">${escapeHtml(trade.symbol || "Trade")}</div>
        <div style="color:#94A3B8;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">${escapeHtml(trade.side || "")}${trade.side && trade.date ? " · " : ""}${escapeHtml(formatDate(trade.date))}</div>
      </td>
      <td style="padding:10px 12px;color:${colour};font-size:15px;font-weight:700;text-align:right;border-bottom:1px solid #EEF2F6;white-space:nowrap;">${escapeHtml(formatPnl(trade))}</td>
    </tr>`;
  };

  const trades = Array.isArray(context.recentTrades) ? context.recentTrades : [];
  const tradeTable = trades.length > 0
    ? `<table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #E2E8F0;border-radius:10px;border-collapse:separate;border-spacing:0;margin:8px 0 20px;">${trades.map(tradeRow).join("")}</table>`
    : "";

  const teaser = context.teaserInsight?.text
    ? `<div style="background:#F8FAFC;border-left:3px solid #B8860B;padding:14px 16px;margin:20px 0;color:#475569;font-size:14px;line-height:1.55;">🔒 ${escapeHtml(context.teaserInsight.text)}</div>`
    : "";

  const streakLine = context.disciplineStreak > 0
    ? `<p style="font-size:14px;line-height:1.6;margin:0 0 16px;color:#334155;">You're on a <strong>${Number(context.disciplineStreak)}-day</strong> discipline streak. Premium keeps it counting.</p>`
    : "";

  const cheapestPerMonth = Math.min(
    ...listOrderablePlans().map((plan) => plan.perMonth)
  );

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px 24px;background:#FFFFFF;color:#0F1923;">
      <div style="text-align:center;margin-bottom:24px;">
        <h2 style="color:#0D9E6E;margin:0;letter-spacing:0.04em;">EDGECIPLINE</h2>
      </div>

      <p style="font-size:15px;line-height:1.55;margin:0 0 12px;">Hi ${escapeHtml(userName || "trader")},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#334155;">${escapeHtml(intro)}</p>

      ${tradeTable}
      ${teaser}
      ${streakLine}

      <p style="font-size:14px;line-height:1.6;margin:0 0 6px;color:#334155;"><strong>What Premium adds</strong></p>
      <ul style="font-size:14px;line-height:1.7;margin:0 0 20px;padding-left:20px;color:#334155;">
        <li>Unlimited trades in both markets</li>
        <li>Weekly AI reports on your own log</li>
        <li>The AI coach, with your trades as context</li>
      </ul>

      <div style="text-align:center;margin:28px 0 12px;">
        <a href="https://app.edgecipline.com/settings"
           style="background:#0F1923;color:#22C78E;padding:14px 32px;text-decoration:none;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:0.02em;display:inline-block;">
          UNLOCK PREMIUM
        </a>
      </div>
      <p style="text-align:center;color:#94A3B8;font-size:11px;margin:0;">From ₹${cheapestPerMonth}/month · Cancel anytime · Your log stays readable either way</p>

      <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 16px;" />
      <p style="font-size:11px;color:#94A3B8;text-align:center;margin:0;">
        You're receiving this because you have notifications enabled for your Edgecipline account.<br />
        Manage preferences in <a href="https://app.edgecipline.com/settings" style="color:#64748B;">Settings</a>.
      </p>
    </div>
  `;

  const { error, provider } = await deliver({ to, subject, html });

  if (error) {
    logger.error("Free-tier email failed", { to, touchpoint, provider, error: error.message });
    throw new Error("Failed to send free-tier email");
  }

  return true;
};

exports.sendRenewalReminder = async (email, userName, expiryDate) => {
  if (!getProvider()) {
    logger.warn("No email provider configured — skipping renewal reminder email");
    return true;
  }

  const formattedDate = new Date(expiryDate).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });

  const { error, provider } = await deliver({
    to: email,
    subject: "Your Edgecipline Subscription Has Expired",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #b8860b; text-align: center;">EDGECIPLINE</h2>
        <p>Hello ${userName},</p>
        <p>Your Edgecipline subscription expired on <strong>${formattedDate}</strong>.</p>
        <p>Renew today to keep tracking your performance and accessing AI trade insights.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="https://app.edgecipline.com/settings" style="background-color: #0d9e6e; color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">RENEW NOW</a>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #94a3b8; text-align: center;">&copy; 2026 Edgecipline. All rights reserved.</p>
      </div>
    `,
  });

  if (error) {
    logger.error("Renewal reminder email failed", {
      recipientId: hashRecipient(email),
      provider,
      permanent: error.permanent,
      operatorAction: operatorActionFor(error, "Renewal reminder email"),
      error: error.message,
    });
    throw new Error("Failed to send renewal reminder email");
  }

  return true;
};

// ─── Welcome (first signup) ──────────────────────────────────────────────────
//
// Sent once per account by services/welcomeEmailService. Table layout + inline
// styles only: that is what Gmail, Outlook and Apple Mail all agree on. The
// logo is a hosted PNG (data: URIs are stripped by Gmail, SVG is unsupported
// in most clients), with styled alt text for clients that block images.
function getAppBaseUrl() {
  return String(appConfig.support?.appBaseUrl || "https://app.edgecipline.com").replace(/\/+$/, "");
}

function buildWelcomeEmail({ userName, trialEndsAt }) {
  const base = getAppBaseUrl();
  const logoUrl = String(getEmailConfig().logoUrl || "").trim() || `${base}/brand-opener-logo-dark.png`;
  const markUrl = `${base}/logo.png`;
  const support = appConfig.support || {};
  const supportEmail = support.email || "dream@edgecipline.com";
  const firstName = String(userName || "").trim().split(/\s+/)[0] || "trader";
  const safeFirst = escapeHtml(firstName);

  const trialDate = trialEndsAt ? new Date(trialEndsAt) : null;
  const trialPill = trialDate && !Number.isNaN(trialDate.getTime())
    ? `<tr><td align="center" style="padding:22px 0 0;">
         <span style="display:inline-block;background:#12302A;border:1px solid #1E6B52;color:#22C78E;font-size:12px;font-weight:700;letter-spacing:0.04em;padding:7px 16px;border-radius:999px;">
           &#10022; 7-day Premium trial &middot; ends ${escapeHtml(trialDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" }))}
         </span>
       </td></tr>`
    : "";

  const step = (num, title, text) => `
            <tr><td style="padding:0 0 12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E8EEF4;border-radius:14px;">
                <tr>
                  <td width="56" valign="top" style="padding:18px 0 18px 18px;">
                    <div style="width:38px;height:38px;line-height:38px;border-radius:12px;background:#0F1923;color:#22C78E;font-family:'Courier New',monospace;font-size:14px;font-weight:800;text-align:center;">${num}</div>
                  </td>
                  <td valign="top" style="padding:18px 18px 18px 14px;">
                    <div style="font-size:15px;font-weight:700;color:#0F1923;margin:0 0 4px;">${title}</div>
                    <div style="font-size:13px;line-height:1.55;color:#64748B;">${text}</div>
                  </td>
                </tr>
              </table>
            </td></tr>`;

  const html = `
<div style="margin:0;padding:0;background:#EEF2F6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your account is ready. Here is how to get the most out of your first week.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F6;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        <tr><td style="background:#0F1923;border-radius:20px 20px 0 0;padding:36px 32px 34px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <img src="${escapeHtml(logoUrl)}" width="220" alt="EDGECIPLINE" style="display:block;width:220px;max-width:100%;height:auto;border:0;color:#22C78E;font-size:22px;font-weight:800;letter-spacing:0.08em;" />
            </td></tr>
            <tr><td style="padding:28px 0 0;">
              <div style="height:2px;line-height:2px;font-size:0;background:#0D9E6E;background:linear-gradient(90deg,#0F1923 0%,#B8860B 20%,#0D9E6E 50%,#B8860B 80%,#0F1923 100%);">&nbsp;</div>
            </td></tr>
            <tr><td align="center" style="padding:28px 0 0;">
              <h1 style="margin:0;color:#FFFFFF;font-size:30px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;">Welcome aboard, ${safeFirst}.</h1>
              <p style="margin:12px 0 0;color:#94A3B8;font-size:15px;line-height:1.6;">Your trading journal that keeps you disciplined &mdash; every trade, every rule, every week.</p>
            </td></tr>
            ${trialPill}
          </table>
        </td></tr>

        <tr><td style="background:#FFFFFF;padding:32px 32px 8px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:0.16em;color:#0D9E6E;text-transform:uppercase;margin:0 0 6px;">Get started</div>
          <div style="font-size:20px;font-weight:800;color:#0F1923;letter-spacing:-0.01em;margin:0 0 20px;">Three steps to your edge</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${step("01", "Log your first trade", "Add it by hand or upload a screenshot &mdash; we pull the details out for you.")}
            ${step("02", "Set your pre-trade checklist", "Write down the rules you trade by, and tick them off before every entry.")}
            ${step("03", "Read your weekly AI report", "Every week, see what is working, what is leaking, and what to fix next.")}
          </table>
        </td></tr>

        <tr><td align="center" style="background:#FFFFFF;padding:16px 32px 36px;">
          <a href="${escapeHtml(base)}/dashboard" style="display:inline-block;background:#0F1923;color:#22C78E;text-decoration:none;font-size:15px;font-weight:800;letter-spacing:0.02em;padding:16px 36px;border-radius:12px;">Open Edgecipline &rarr;</a>
          <p style="margin:18px 0 0;color:#94A3B8;font-size:12px;line-height:1.6;">Questions? Just reply to this email &mdash; a real person reads it.</p>
        </td></tr>

        <tr><td style="background:#F8FAFC;border-top:1px solid #E8EEF4;border-radius:0 0 20px 20px;padding:24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="40" valign="middle"><img src="${escapeHtml(markUrl)}" width="32" height="32" alt="" style="display:block;border:0;" /></td>
              <td valign="middle" style="padding-left:10px;font-size:12px;line-height:1.6;color:#94A3B8;">
                <strong style="color:#64748B;">Edgecipline</strong> &middot; Discipline over emotion<br />
                <a href="mailto:${escapeHtml(supportEmail)}" style="color:#64748B;">${escapeHtml(supportEmail)}</a>${support.whatsappNumber ? ` &middot; WhatsApp +${escapeHtml(support.whatsappNumber)}` : ""}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:#B0BCC9;">&copy; 2026 Edgecipline. You are receiving this because you just created an Edgecipline account.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</div>`;

  return { subject: `Welcome to Edgecipline, ${firstName} 👋`, html };
}

// Never throws: a welcome email must never be the reason a signup fails.
exports.sendWelcomeEmail = async ({ to, userName, trialEndsAt }) => {
  if (!getProvider()) {
    logger.warn("No email provider configured — skipping welcome email");
    return { sent: false, reason: "not_configured" };
  }
  if (!to) return { sent: false, reason: "no_recipient" };

  try {
    const { subject, html } = buildWelcomeEmail({ userName, trialEndsAt });
    const { error, provider } = await deliver({ to, subject, html });
    if (error) {
      logger.error("WELCOME_EMAIL_FAILED", {
        provider,
        recipientId: hashRecipient(to),
        senderDomain: getSenderDomain(),
        providerStatus: error.providerStatus,
        providerErrorName: error.providerErrorName,
        permanent: error.permanent,
        operatorAction: operatorActionFor(error, "Welcome email"),
        error: error.message,
      });
      return { sent: false, reason: error.permanent ? "permanent" : "transient" };
    }
    return { sent: true };
  } catch (error) {
    logger.error("WELCOME_EMAIL_THREW", { recipientId: hashRecipient(to), error: error.message });
    return { sent: false, reason: "exception" };
  }
};

exports.buildWelcomeEmail = buildWelcomeEmail;
