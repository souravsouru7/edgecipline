const { Resend } = require("resend");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

function getResendClient() {
  return new Resend(appConfig.resend.apiKey);
}

const FROM_ADDRESS = appConfig.resend.from;

exports.sendOTPEmail = async (email, otp) => {
  if (!appConfig.resend.apiKey) {
    logger.warn("RESEND_API_KEY missing — logging OTP to console (dev only)");
    logger.info(`[DEV] OTP for ${email}: ${otp}`);
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
