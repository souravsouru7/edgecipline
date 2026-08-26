require("dotenv").config();

const { sendOTPEmail } = require("../services/mailService");

async function main() {
  const to = process.argv[2] || process.env.RESEND_TEST_TO;

  if (!to) {
    console.error("Usage: npm run mail:test -- you@example.com");
    process.exitCode = 1;
    return;
  }

  try {
    await sendOTPEmail(to, "123456");
    console.log(`Resend test email accepted for ${to}`);
  } catch (error) {
    console.error("Resend test email failed:");
    console.error(error?.message || error);
    if (error?.permanent) {
      // Distinguishing these matters: a permanent failure means every password
      // reset is already broken in this environment, not that Resend blipped.
      console.error("");
      console.error("This is a configuration fault — retrying will not help.");
      console.error(`Current RESEND_FROM: ${process.env.RESEND_FROM || "(default) Stratedge <noreply@stratedge.live>"}`);
      console.error("Verify that domain at https://resend.com/domains, or use");
      console.error('RESEND_FROM="Edgecipline <onboarding@resend.dev>" to test against your own inbox.');
    }
    process.exitCode = 1;
  }
}

main();
