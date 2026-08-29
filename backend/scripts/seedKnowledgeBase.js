#!/usr/bin/env node
"use strict";

/**
 * seedKnowledgeBase — publish a starter set of Edgecipline help articles.
 *
 * The Help Center is the first thing a customer sees and the first thing an
 * app-store reviewer opens. An empty one is a worse experience than no Help
 * Center at all, so this ships a real starting set written against what the
 * product actually does — two market workspaces, an OCR import pipeline, a
 * journal, AI analytics, and Razorpay subscriptions.
 *
 * Idempotent: articles are matched on slug and updated in place, so re-running
 * after an edit refreshes the copy rather than creating duplicates. Articles a
 * human has since edited are left alone unless --force is passed, so a deploy
 * hook cannot silently overwrite the support team's wording.
 *
 * Usage:
 *   node scripts/seedKnowledgeBase.js              # create missing, skip existing
 *   node scripts/seedKnowledgeBase.js --force      # also overwrite existing
 *   node scripts/seedKnowledgeBase.js --dry-run    # report, change nothing
 */

require("dotenv").config();

const crypto = require("crypto");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const KnowledgeBaseArticle = require("../models/KnowledgeBaseArticle");

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY_RUN = args.includes("--dry-run");

// The fields the seeder owns. A change to any of them is what "edited" means.
const SEEDED_FIELDS = ["title", "excerpt", "bodyMarkdown", "category", "order", "tags", "relatedSlugs"];

/**
 * Fingerprint of the seeder-owned content.
 *
 * Written to `seedHash` after every write, and recomputed from the stored
 * article on the next run. Equal means nobody has touched it; different means
 * a human has, and the seeder leaves it alone.
 */
function contentHash(source) {
  const canonical = SEEDED_FIELDS.map((field) => {
    const value = source?.[field];
    if (Array.isArray(value)) return `${field}:${value.join(",")}`;
    return `${field}:${value ?? ""}`;
  }).join("|");

  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

const ARTICLES = [
  {
    slug: "getting-started-with-edgecipline",
    title: "Getting started with Edgecipline",
    category: "getting_started",
    order: 1,
    excerpt: "Set up your account, pick your market, and log your first trade.",
    tags: ["onboarding", "setup", "first trade"],
    bodyMarkdown: `Edgecipline is a trading journal built around discipline rather than prediction. Here is the shortest path to something useful.

## 1. Choose your market

Edgecipline keeps **Forex** and **Indian Market** as separate workspaces, with their own trades, setups and analytics. Pick the one you trade most; you can switch any time from the market switcher in the header.

## 2. Create a setup

A setup is your written definition of a trade you are willing to take — the conditions, the rules, and the checklist you run before entering. Analytics later tells you which of your setups actually make money.

## 3. Log your first trade

Two ways:

- **Add trade** — type it in.
- **Import** — upload a broker screenshot and let the extraction read it for you.

## 4. Read your first insight

Once you have a handful of trades, the Dashboard and Analytics start showing patterns: your best session, your worst mistake, your discipline streak.

> The journal is only as honest as what you put in it. Log the losses too — that is where the edge is.`,
    relatedSlugs: ["importing-trades-from-a-screenshot", "understanding-your-analytics"],
  },
  {
    slug: "importing-trades-from-a-screenshot",
    title: "Importing trades from a broker screenshot",
    category: "trade_import",
    order: 1,
    excerpt: "How screenshot extraction works, what it supports, and what to do when it gets something wrong.",
    tags: ["ocr", "import", "screenshot", "upload"],
    bodyMarkdown: `Upload a screenshot of your broker's trade history and Edgecipline reads the values out of it.

## What to upload

- **Formats:** JPG, PNG or WEBP.
- **One screenshot at a time** for the cleanest read.
- Crop to the trade rows. Full-screen captures with menus and sidebars are harder to read.

## Check before you save

Extraction is very good, not perfect. Every imported trade opens in a confirmation screen first — check the entry, exit, quantity and date, correct anything that looks wrong, then save.

## When extraction gets it wrong

Use **Report an issue** on the confirmation screen. That sends us the screenshot together with what was extracted and what you corrected, which is exactly what we need to improve it.

## Common causes of a poor read

| Cause | Fix |
|---|---|
| Dark mode with low contrast | Switch the broker to light mode and re-capture |
| Photo of a screen | Use the device's screenshot function instead |
| Heavily compressed image | Send the original, not a forwarded copy |
| Cropped mid-row | Include the full row including headers |`,
    relatedSlugs: ["getting-started-with-edgecipline", "trade-import-limits"],
  },
  {
    slug: "trade-import-limits",
    title: "How many trades can I log?",
    category: "subscription_billing",
    order: 2,
    excerpt: "What the free tier includes and what changes on a paid plan.",
    tags: ["limits", "free", "premium", "plan"],
    bodyMarkdown: `Free accounts can log a limited number of trades in **each** market — Forex and Indian Market are counted separately.

Premium removes the limit entirely and unlocks the AI features: Trading DNA, the weekly report generator, and the coach.

## Checking where you stand

Your current plan is shown in **Settings**. If you are on a paid plan, the renewal date is shown there too.

## If you have paid but still see a limit

Give it a minute — activation is near-instant but not always immediate. If it persists after a few minutes, open a support ticket with your payment reference and we will sort it out. Do not pay again.`,
    relatedSlugs: ["payment-taken-but-plan-not-active", "cancelling-or-changing-your-plan"],
  },
  {
    slug: "payment-taken-but-plan-not-active",
    title: "I paid but my plan is not active",
    category: "payments",
    order: 1,
    excerpt: "What to do when money has left your account but Edgecipline still shows the free tier.",
    tags: ["payment", "razorpay", "billing", "failed"],
    bodyMarkdown: `First: **do not pay a second time.** Almost every case of this resolves on its own or with one message to us.

## Give it two minutes

Payment confirmation arrives from the payment provider, not from your browser. Closing the tab immediately after paying does not cancel anything, but confirmation can take up to a couple of minutes to land.

## Then check Settings

Pull down to refresh and look at your plan in **Settings**. If it now shows the paid plan, you are done.

## If it still shows free

Open a support ticket in the **Payments** category and include:

- The payment reference or order id from your bank or UPI app
- The amount and the time you paid
- The email address on your Edgecipline account

Payment tickets are treated as high priority automatically. We can see the transaction from our side and activate the plan manually.

> Never send us your card number, CVV, UPI PIN or a bank password. We will never ask for them, and we do not need them to find your payment.`,
    relatedSlugs: ["trade-import-limits", "cancelling-or-changing-your-plan"],
  },
  {
    slug: "cancelling-or-changing-your-plan",
    title: "Cancelling or changing your plan",
    category: "subscription_billing",
    order: 1,
    excerpt: "How renewals work and what happens to your data if you stop paying.",
    tags: ["cancel", "renew", "downgrade", "subscription"],
    bodyMarkdown: `## Your data stays

Ending a subscription does not delete anything. Your trades, setups, checklists and reports remain exactly where they are. You return to the free tier's logging limit, and the AI features become unavailable until you resubscribe.

## Renewals

Your renewal date is shown in **Settings**. We email you before a plan expires so nothing lapses without warning.

## Changing plan

Open a support ticket in **Subscription & Billing** and tell us what you would like to move to. We will arrange it and confirm the change on the ticket.`,
    relatedSlugs: ["payment-taken-but-plan-not-active", "deleting-your-account"],
  },
  {
    slug: "understanding-your-analytics",
    title: "Making sense of your analytics",
    category: "analytics_reports",
    order: 1,
    excerpt: "What the dashboard numbers mean and which ones actually matter.",
    tags: ["analytics", "metrics", "win rate", "discipline"],
    bodyMarkdown: `Analytics is not a scoreboard. It is a mirror.

## The numbers worth watching

- **Discipline score** — how often you followed your own rules. This predicts your results better than win rate does.
- **Setup performance** — which of your written setups actually make money. Most traders discover they have one profitable setup and three expensive hobbies.
- **Session and time-of-day** — when you trade well, and when you should not be at the screen.
- **R:R realised vs planned** — whether you actually let winners run.

## Why win rate is not at the top

A 70% win rate with a 1:0.3 risk-reward loses money. A 35% win rate with 1:3 makes it. Edgecipline shows win rate, but it deliberately does not lead with it.

## Data you need before this is meaningful

Roughly 20–30 logged trades before the patterns stop being noise. Below that, treat every chart as a first impression rather than a conclusion.`,
    relatedSlugs: ["getting-started-with-edgecipline", "weekly-reports-and-ai-insights"],
  },
  {
    slug: "weekly-reports-and-ai-insights",
    title: "Weekly reports and AI insights",
    category: "analytics_reports",
    order: 2,
    excerpt: "How the AI report is generated, what it reads, and how often you can run it.",
    tags: ["ai", "weekly report", "insights", "coach"],
    bodyMarkdown: `The weekly report reads your logged trades, checklists and reflections for the period and writes a plain-language review.

## Generating one

Reports are generated **on demand** — open Reports and press Generate. We send a reminder notification when a week's worth of data is ready, but nothing runs automatically, so you are never charged for a report you did not ask for.

## What the AI can see

Only your own journal data: trades, setups, checklist results and reflections. It does not see other users, and it does not see your payment details.

## If a report looks wrong

The report is only as good as the data underneath it. A week where trades were logged late, or exits were estimated, produces a confident-sounding report built on rough numbers. If something reads as clearly wrong rather than merely unflattering, open a ticket and include the report.`,
    relatedSlugs: ["understanding-your-analytics"],
  },
  {
    slug: "signing-in-problems",
    title: "I cannot sign in",
    category: "account_profile",
    order: 1,
    excerpt: "Password resets, Google sign-in, and being logged out unexpectedly.",
    tags: ["login", "password", "google", "otp", "session"],
    bodyMarkdown: `## Forgotten password

Use **Forgot password** on the sign-in screen. We email a 6-digit code that is valid for 10 minutes.

If the email does not arrive:

- Check spam and promotions.
- Confirm you are using the address you registered with.
- Wait a minute before requesting another — repeated requests are rate-limited, and a new code invalidates the one you are typing.

## Signed up with Google

If you created your account with **Continue with Google**, there is no password to reset. Use the same Google button to sign back in.

## Logged out unexpectedly

Sessions refresh silently in the background. Being signed out usually means one of:

- The password was changed, or **Sign out everywhere** was used
- The account was signed in on too many devices and older sessions were rotated out
- A long period with no network access

Signing in again is safe and loses nothing.

## Still stuck

Open a ticket in **Account & Profile**. Include the email address on the account and roughly when it started. Never include your password.`,
    relatedSlugs: ["keeping-your-account-secure", "deleting-your-account"],
  },
  {
    slug: "keeping-your-account-secure",
    title: "Keeping your account secure",
    category: "security_privacy",
    order: 1,
    excerpt: "What we will never ask for, and what to do if something looks wrong.",
    tags: ["security", "phishing", "privacy", "data"],
    bodyMarkdown: `## What Edgecipline support will never ask for

- Your password
- A password-reset code (the OTP we email you)
- Card numbers, CVV, UPI PIN, or bank credentials
- Remote access to your device

If a message claiming to be from Edgecipline asks for any of these, it is not us. Forward it to our support email and we will look at it.

## Where to reach real support

- In-app: **Help & Support**
- WhatsApp and email: the numbers and addresses shown on the Help Center

Anything else — a different number, a lookalike domain, a message in a trading group — is not us.

## If you think your account is compromised

1. Change your password immediately, which signs out every other session.
2. Open a ticket in **Security & Privacy**.

We can see sign-in activity on our side and will tell you what we find.`,
    relatedSlugs: ["signing-in-problems", "deleting-your-account"],
  },
  {
    slug: "deleting-your-account",
    title: "Deleting your account and your data",
    category: "security_privacy",
    order: 2,
    excerpt: "What deletion removes, what is retained, and how to do it.",
    tags: ["delete", "data", "privacy", "gdpr"],
    bodyMarkdown: `You can delete your account from **Settings → Delete account**, or from the public deletion page without signing in first.

## What is removed

Everything personal: trades in both markets, setups, checklists, reflections, reports, notifications, uploaded screenshots, support tickets and their attachments.

## What is retained

Payment and invoice records, which we are required to keep. Once your account is gone these hold no personal information beyond an anonymous identifier.

## This cannot be undone

There is no recovery window and no backup restore for an individual account. Export anything you want to keep first.

> If you only want to stop paying, you do not need to delete your account — see *Cancelling or changing your plan*. Your data stays and you keep read access to your journal.`,
    relatedSlugs: ["cancelling-or-changing-your-plan", "keeping-your-account-secure"],
  },
  {
    slug: "notifications-and-reminders",
    title: "Notifications and reminders",
    category: "mobile_app",
    order: 1,
    excerpt: "Which notifications Edgecipline sends and how to control them.",
    tags: ["notifications", "push", "quiet hours", "reminders"],
    bodyMarkdown: `## The categories

- **Risk alerts** — revenge trading, overtrading, missing stop-loss
- **Discipline** — setup checklist and trade-quality warnings
- **Insights** — weekly summaries and repeated-mistake patterns
- **Coaching** — morning mentor, streaks, evening reflection
- **Session reminders** — market opens
- **OCR results** — screenshot import finished or failed
- **Support** — replies on your tickets

Each is a separate switch in notification settings, so turning off coaching nudges does not silence a reply from support.

## Quiet hours

Set a window and nothing is pushed during it. Notifications are still recorded and waiting in the app when you next open it — quiet hours suppress the interruption, not the message.

## Not receiving anything

1. Check notification permission is granted in your device settings.
2. Check the category is enabled in the app.
3. Check quiet hours is not covering the time you expect them.
4. Battery optimisation on some Android devices delays or drops notifications for backgrounded apps. Excluding Edgecipline from battery optimisation fixes it.`,
    relatedSlugs: ["app-is-slow-or-crashing"],
  },
  {
    slug: "app-is-slow-or-crashing",
    title: "The app is slow, blank, or crashing",
    category: "technical_issue",
    order: 1,
    excerpt: "First steps that resolve most problems, and what to send us if they do not.",
    tags: ["crash", "performance", "bug", "blank screen"],
    bodyMarkdown: `## Try these first

1. **Force close and reopen.** Clears the majority of one-off glitches.
2. **Check for an update.** Fixes ship regularly.
3. **Switch network.** Mobile data instead of Wi-Fi, or the reverse.
4. **Restart the device.** Genuinely does help more often than it should.

## If it persists

Open a ticket in **Technical Issues** and include:

- What you were doing when it happened
- Whether it happens every time or occasionally
- Your device and OS version
- A screenshot or screen recording if you can capture one

That last one is worth more than any description — a screenshot of the actual error tells us in seconds what a paragraph cannot.

## Blank screen after signing in

Usually a stale cached bundle. Force close, reopen, and if it survives that, reinstall — your data lives on our servers, not on the device, so nothing is lost.`,
    relatedSlugs: ["notifications-and-reminders", "getting-started-with-edgecipline"],
  },
  {
    slug: "how-support-tickets-work",
    title: "How support tickets work",
    category: "getting_started",
    order: 2,
    excerpt: "What happens after you open a ticket, and how long things take.",
    tags: ["support", "ticket", "response time", "help"],
    bodyMarkdown: `## Opening one

**Help & Support → Create a support ticket.** Choose the category that fits best — it decides who picks it up and how quickly.

You get a ticket code like \`EC-4K2P9M\`. Quote it in any email or WhatsApp message about the same problem.

## What happens next

1. The ticket lands in the support queue and an agent picks it up.
2. You get a notification and an email when they reply.
3. The ticket moves to **Waiting for you** if we need something from you — replying moves it straight back to us.
4. When it is sorted we mark it **Resolved** with a summary of what we did.

## Response times

Most tickets get a first reply within 24 hours. Payment and billing tickets are prioritised automatically.

## After it is resolved

You can reopen a resolved ticket for **7 days** just by replying to it. After that it closes and a new ticket is the cleaner route — it keeps the history readable for whoever picks it up.

## Other ways to reach us

WhatsApp for quick questions, email for anything long or with documents attached. Both are on the Help Center. For anything account-specific a ticket is still best, because it keeps a written record attached to your account.`,
    relatedSlugs: ["signing-in-problems", "payment-taken-but-plan-not-active"],
  },
];

async function seed() {
  await connectDB();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const article of ARTICLES) {
    const nextHash = contentHash(article);

    const existing = await KnowledgeBaseArticle.findOne({ slug: article.slug })
      .select(`_id status ${SEEDED_FIELDS.join(" ")} +seedHash`)
      .lean();

    if (!existing) {
      if (DRY_RUN) {
        console.log(`  would create  ${article.slug}`);
      } else {
        await KnowledgeBaseArticle.create({
          ...article,
          status: "published",
          publishedAt: new Date(),
          seedHash: nextHash,
        });
        console.log(`  created       ${article.slug}`);
      }
      created += 1;
      continue;
    }

    const currentHash = contentHash(existing);

    // Three cases, and only the middle one is safe to overwrite:
    //
    //   no seedHash            hand-written article that happens to share a
    //                          slug. Never clobber it.
    //   seedHash == current    exactly what we last wrote, untouched. Safe.
    //   seedHash != current    a human has edited it since. Leave it alone —
    //                          a deploy hook must not silently discard the
    //                          support team's wording.
    let reason = null;
    if (!existing.seedHash) reason = "hand-written (no seed fingerprint)";
    else if (existing.seedHash !== currentHash) reason = "edited since seeding";

    if (reason && !FORCE) {
      console.log(`  skipped       ${article.slug} (${reason} — pass --force to overwrite)`);
      skipped += 1;
      continue;
    }

    if (currentHash === nextHash && existing.seedHash === nextHash) {
      console.log(`  unchanged     ${article.slug}`);
      skipped += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  would update  ${article.slug}${reason ? ` (--force over ${reason})` : ""}`);
    } else {
      await KnowledgeBaseArticle.updateOne(
        { _id: existing._id },
        {
          $set: {
            ...article,
            // Never demotes a live article to draft, and never re-stamps
            // publishedAt — a refreshed article is not a new one.
            status: existing.status === "archived" ? "archived" : "published",
            seedHash: nextHash,
          },
        }
      );
      console.log(`  updated       ${article.slug}`);
    }
    updated += 1;
  }

  console.log(
    `\n${DRY_RUN ? "[dry run] " : ""}${created} created, ${updated} updated, ${skipped} skipped (${ARTICLES.length} total).`
  );

  await mongoose.connection.close();
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Knowledge-base seeding failed:", error.message);
    process.exit(1);
  });
