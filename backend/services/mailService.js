const { Resend } = require("resend");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

function getResendClient() {
  return new Resend(appConfig.resend.apiKey);
}

const FROM_ADDRESS = appConfig.resend.from;

exports.sendOTPEmail = async (email, otp) => {
  if (!appConfig.resend.apiKey) {
    logger.warn("RESEND_API_KEY missing — OTP email was not sent", {
      recipientConfigured: Boolean(email),
    });
    return true;
  }

  const { error } = await getResendClient().emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: "Your Stratedge Password Reset OTP",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #0d9e6e; text-align: center;">STRATEDGE</h2>
        <p>Hello,</p>
        <p>You requested a password reset. Use the following 6-digit OTP to reset your password. It expires in <strong>10 minutes</strong>.</p>
        <div style="background-color: #f0fdf9; border: 1px dashed #0d9e6e; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <h1 style="color: #0d9e6e; font-size: 40px; letter-spacing: 8px; margin: 0;">${otp}</h1>
        </div>
        <p>If you didn't request this, you can safely ignore this email — your password will not change.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #94a3b8; text-align: center;">&copy; 2026 Stratedge. All rights reserved.</p>
      </div>
    `,
  });

  if (error) {
    logger.error("Resend OTP email failed", { email, error: error.message });
    throw new Error("Failed to send OTP email");
  }

  return true;
};

// Subscription Rescue Funnel — one templated function for all 7 touchpoints.
// `intro` is the touchpoint-specific opener written by subscriptionRescueService.
// `context` is the rescue context payload; we render the metric block from it
// so every email shows the user their *own* numbers, not generic copy.
//
// Required fields on `context`:
//   disciplineStreak, longestStreak, tradesLogged, weeklyReportsCount,
//   bestSetup ({ name, winRate } | null), latestInsightLine (string | null)
exports.sendRescueEmail = async ({ to, userName, touchpoint, subject, intro, context }) => {
  if (!appConfig.resend.apiKey) {
    logger.warn("RESEND_API_KEY missing — skipping rescue email", { touchpoint });
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

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px 24px;background:#FFFFFF;color:#0F1923;">
      <div style="text-align:center;margin-bottom:24px;">
        <h2 style="color:#0D9E6E;margin:0;letter-spacing:0.04em;">STRATEDGE</h2>
      </div>

      <p style="font-size:15px;line-height:1.55;margin:0 0 12px;">Hi ${userName || "trader"},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#334155;">${intro}</p>

      ${rows.length > 0
        ? `<table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #E2E8F0;border-radius:10px;border-collapse:separate;border-spacing:0;margin:8px 0 20px;">${rows.join("")}</table>`
        : ""}

      ${insightBlock}

      <div style="text-align:center;margin:28px 0 12px;">
        <a href="https://stratedge.live/pricing"
           style="background:#0F1923;color:#22C78E;padding:14px 32px;text-decoration:none;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:0.02em;display:inline-block;">
          REACTIVATE PREMIUM
        </a>
      </div>
      <p style="text-align:center;color:#94A3B8;font-size:11px;margin:0;">₹50/month · Cancel anytime · Your data stays exactly where it is</p>

      <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 16px;" />
      <p style="font-size:11px;color:#94A3B8;text-align:center;margin:0;">
        You're receiving this because you have notifications enabled for your Stratedge account.<br />
        Manage preferences in <a href="https://stratedge.live/profile" style="color:#64748B;">Settings</a>.
      </p>
    </div>
  `;

  const { error } = await getResendClient().emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
  });

  if (error) {
    logger.error("Resend rescue email failed", { to, touchpoint, error: error.message });
    throw new Error("Failed to send rescue email");
  }

  return true;
};

exports.sendRenewalReminder = async (email, userName, expiryDate) => {
  if (!appConfig.resend.apiKey) {
    logger.warn("RESEND_API_KEY missing — skipping renewal reminder email");
    return true;
  }

  const formattedDate = new Date(expiryDate).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });

  const { error } = await getResendClient().emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: "Your Stratedge Subscription Has Expired",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #b8860b; text-align: center;">STRATEDGE</h2>
        <p>Hello ${userName},</p>
        <p>Your Stratedge subscription expired on <strong>${formattedDate}</strong>.</p>
        <p>Renew today to keep tracking your performance and accessing AI trade insights.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="https://stratedge.live/pricing" style="background-color: #0d9e6e; color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">RENEW NOW</a>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #94a3b8; text-align: center;">&copy; 2026 Stratedge. All rights reserved.</p>
      </div>
    `,
  });

  if (error) {
    logger.error("Resend renewal reminder failed", { email, error: error.message });
    throw new Error("Failed to send renewal reminder email");
  }

  return true;
};
