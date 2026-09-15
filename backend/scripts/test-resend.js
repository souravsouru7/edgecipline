require("dotenv").config();

const { getEmailConfigWarnings } = require("../config");
const { sendOTPEmail, getProvider, getFromAddress, getReplyTo } = require("../services/mailService");

async function main() {
  const to = process.argv[2] || process.env.RESEND_TEST_TO;

  if (!to) {
    console.error("Usage: npm run mail:test -- you@example.com");
    process.exitCode = 1;
    return;
  }

  const provider = getProvider();
  console.log(`Provider: ${provider || "(none configured)"}`);
  console.log(`From:     ${getFromAddress() || "(unset)"}`);
  console.log(`Reply-To: ${getReplyTo() || "(unset)"}`);
  console.log(`To:       ${to}`);

  // Same checks the server prints at boot — surfaced here so a broken sender
  // is explained before the send fails, not after.
  for (const warning of getEmailConfigWarnings()) console.warn(`WARNING: ${warning}`);
  console.log("");

  try {
    await sendOTPEmail(to, "123456");
    if (provider === "console") {
      console.log("EMAIL_CONSOLE_ONLY=true — the email above was printed, not sent. Set it to false to send for real.");
    } else {
      console.log(`Test email accepted by ${provider} for ${to}. Check the inbox (and spam) for "Your Edgecipline password reset code".`);
    }
  } catch (error) {
    console.error("Test email failed:");
    console.error(error?.message || error);
    if (error?.permanent) {
      // Distinguishing these matters: a permanent failure means every password
      // reset is already broken in this environment, not that the provider blipped.
      console.error("");
      console.error("This is a configuration fault — retrying will not help.");
      if (provider === "smtp") {
        console.error(`SMTP_HOST=${process.env.SMTP_HOST || "smtp.gmail.com"} rejected SMTP_USER=${process.env.SMTP_USER}.`);
        console.error("For Gmail, SMTP_PASS must be a 16-character app password from");
        console.error("https://myaccount.google.com/apppasswords (2-Step Verification must be on).");
      } else {
        console.error(`Current RESEND_FROM: ${getFromAddress()}`);
        console.error("RESEND_FROM must be on a domain verified at https://resend.com/domains —");
        console.error("edgecipline.com is verified, so use e.g. Edgecipline <noreply@edgecipline.com>.");
        console.error("gmail.com and other public mailbox domains can never be verified there.");
        console.error("onboarding@resend.dev only ever delivers to the Resend account owner's inbox.");
        console.error("A 401 means RESEND_API_KEY itself was rejected — create a new key at resend.com/api-keys.");
      }
    } else {
      console.error("");
      console.error("This looks transient (network/timeout/provider outage) — try again in a moment.");
    }
    process.exitCode = 1;
  }
}

main();
