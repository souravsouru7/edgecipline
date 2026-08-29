#!/usr/bin/env node
"use strict";

/**
 * ensureAdminUser - provision, promote, or rotate an administrator account.
 *
 * Idempotent by design: re-running against an already-valid admin changes
 * nothing and exits 0, so it is safe to call from a deploy hook or container
 * entrypoint. Anything that would overwrite an existing credential, convert a
 * Google account to password login, or re-enable a disabled account requires
 * an explicit --force.
 *
 * Usage:
 *   node scripts/ensureAdminUser.js --email <email> --generate
 *   node scripts/ensureAdminUser.js --email <email> --password-stdin
 *   ADMIN_SEED_PASSWORD=... node scripts/ensureAdminUser.js --email <email>
 *   node scripts/ensureAdminUser.js --list
 *
 * Password sources, in order of preference:
 *   --generate           mint a 24-char random password and print it ONCE
 *   --password-stdin     read from a pipe, or prompt with echo off on a TTY
 *   ADMIN_SEED_PASSWORD  environment variable
 *   positional argv      legacy; leaks into shell history and `ps` - warns
 *
 * Options:
 *   --email <email>   account to create or promote (required unless --list)
 *   --name <name>     display name for a newly created account
 *   --force           overwrite an existing password / promote / re-enable
 *   --dry-run         print the plan, write nothing
 *   --list            audit every admin account and exit
 *   --yes             skip the confirmation prompt on a non-local database
 *   --cost <n>        bcrypt cost factor (default 10 - see DEFAULT_BCRYPT_COST)
 *   --accept-terms    record Terms & Privacy acceptance for a new account
 *   --help
 *
 * Exit codes: 0 ok/no-op | 2 usage or validation | 3 refused by a safety guard
 *             4 database | 1 unexpected
 */

require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const readline = require("readline");

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const { appConfig, maskSecret } = require("../config");
const User = require("../models/Users");
const { logger } = require("../utils/logger");
const { CURRENT_TERMS_VERSION } = require("../constants/terms");
const { revokeAllUserTokens } = require("../services/tokenService");
const { invalidateAuthCache } = require("../services/authCacheService");
const { connectRedis, client: redisClient, isRedisReady } = require("../config/redis");

const EXIT = { OK: 0, UNEXPECTED: 1, USAGE: 2, REFUSED: 3, DB: 4 };

// adminAuthController compares every login attempt against a cost-10 dummy
// hash so an unknown email costs the same to reject as a real one. Hashing a
// real admin at a different cost re-opens that enumeration channel: a valid
// admin email would take measurably longer than an invalid one. Change this
// only in lockstep with DUMMY_HASH in
// backend/admin/controllers/adminAuthController.js.
const DEFAULT_BCRYPT_COST = 10;

// bcrypt hashes only the first 72 BYTES of its input; everything past that is
// discarded, so a long passphrase silently collapses to its 72-byte prefix and
// two different passwords can share a hash. Refuse rather than store a
// credential that is weaker than the operator believes it to be.
const BCRYPT_MAX_PASSWORD_BYTES = 72;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 80;

// Deliberately stricter than the 8-character minimum users get: an admin
// credential is long-lived, unlocks every account, and is typed rarely.
const MIN_PASSWORD_LENGTH = 12;
const USER_MIN_PASSWORD_LENGTH = 8;

const MONGO_SERVER_SELECTION_TIMEOUT_MS = 10000;
const REDIS_CONNECT_TIMEOUT_MS = 5000;
const AUTH_CACHE_TTL_SECONDS = Math.max(
  30,
  parseInt(process.env.AUTH_CACHE_TTL_SECONDS || "300", 10)
);

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "admin", "admin123",
  "administrator", "letmein", "welcome", "welcome1", "qwerty", "qwerty123",
  "iloveyou", "changeme", "secret", "root", "toor", "test", "test123",
  "abc123", "123456", "12345678", "123456789", "1234567890", "monkey",
  "dragon", "sunshine", "princess", "football", "baseball", "superman",
]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);

// --- Output -----------------------------------------------------------------

const say = (...args) => console.log(...args);
const warn = (msg) => console.log(`  ! ${msg}`);
const fail = (msg) => console.error(`  x ${msg}`);
const rule = () => say("-".repeat(64));

class ScriptError extends Error {
  constructor(code, message, hints = []) {
    super(message);
    this.code = code;
    this.hints = hints;
  }
}

// --- Argument parsing -------------------------------------------------------

const BOOLEAN_FLAGS = new Set([
  "generate", "password-stdin", "force", "dry-run", "list",
  "yes", "accept-terms", "help",
]);
const VALUE_FLAGS = new Set(["email", "name", "cost"]);

function parseArgs(argv) {
  const flags = Object.create(null);
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    const key = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).toLowerCase();
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1);

    if (BOOLEAN_FLAGS.has(key)) {
      if (inlineValue !== null && !["true", "false"].includes(inlineValue)) {
        throw new ScriptError(EXIT.USAGE, `--${key} does not take a value`);
      }
      flags[key] = inlineValue !== "false";
      continue;
    }

    if (VALUE_FLAGS.has(key)) {
      const value = inlineValue !== null ? inlineValue : argv[++i];
      // Without this, `--email --force` would silently swallow the next flag
      // as the email address and then fail with a confusing message.
      if (value === undefined || value.startsWith("--")) {
        throw new ScriptError(EXIT.USAGE, `--${key} requires a value`);
      }
      flags[key] = value;
      continue;
    }

    throw new ScriptError(EXIT.USAGE, `Unknown option: --${key}`, [
      "Run with --help to see the supported options.",
    ]);
  }

  return { flags, positionals };
}

// --- Validation -------------------------------------------------------------

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validateEmail(email) {
  if (!email) {
    throw new ScriptError(EXIT.USAGE, "An email address is required.", [
      "node scripts/ensureAdminUser.js --email admin@example.com --generate",
    ]);
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    throw new ScriptError(EXIT.USAGE, `Email exceeds ${MAX_EMAIL_LENGTH} characters.`);
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new ScriptError(EXIT.USAGE, `Not a valid email address: ${email}`);
  }
  return email;
}

function normalizeName(value, fallback = "Admin") {
  const name = String(value === undefined || value === null ? "" : value)
    .trim()
    .replace(/\s+/g, " ");
  if (!name) return fallback;
  return name.slice(0, MAX_NAME_LENGTH);
}

/**
 * Mirrors validatePasswordStrength() in controllers/authController.js, plus the
 * constraints that only matter when a human picks a long-lived admin credential
 * at a shell. Returns every problem at once so the operator does not discover
 * them one retry at a time.
 */
function passwordProblems(password, email) {
  if (typeof password !== "string" || password.length === 0) {
    return ["Password is empty."];
  }

  const problems = [];

  if (password !== password.trim()) {
    problems.push("Password has leading or trailing whitespace - almost always a copy/paste artefact.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters ` +
      `(admin accounts are held above the ${USER_MIN_PASSWORD_LENGTH}-character user minimum).`
    );
  }
  if (Buffer.byteLength(password, "utf8") > BCRYPT_MAX_PASSWORD_BYTES) {
    problems.push(
      `Password exceeds ${BCRYPT_MAX_PASSWORD_BYTES} bytes; bcrypt would silently ` +
      "ignore everything past that point, so the stored hash would be weaker than it looks."
    );
  }
  if (!/[A-Z]/.test(password)) problems.push("Password must contain at least one uppercase letter.");
  if (!/[a-z]/.test(password)) problems.push("Password must contain at least one lowercase letter.");
  if (!/[0-9]/.test(password)) problems.push("Password must contain at least one number.");
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    problems.push("Password must contain at least one special character.");
  }
  if (/[\x00-\x1f\x7f]/.test(password)) {
    problems.push("Password contains control characters that a browser login form cannot reproduce.");
  }

  const lowered = password.toLowerCase();
  // Check the bare alphabetic stem too, otherwise the decorations people add
  // to satisfy a complexity rule ("Password123!") walk straight past a
  // denylist that only holds the root word.
  const stem = lowered.replace(/[^a-z]/g, "");
  if (COMMON_PASSWORDS.has(lowered) || COMMON_PASSWORDS.has(stem)) {
    problems.push("Password is a common password with decorations stripped - pick something unrelated to a dictionary word.");
  }

  const localPart = String(email || "").split("@")[0].toLowerCase();
  if (localPart.length >= 3 && lowered.includes(localPart)) {
    problems.push("Password contains the email local-part, which is the first thing an attacker tries.");
  }
  if (/^(.)\1+$/.test(password)) {
    problems.push("Password is a single repeated character.");
  }

  return problems;
}

function generatePassword(length = 24) {
  // Draw one character from each class first so the result always satisfies
  // the policy above, then fill the remainder from the full alphabet.
  const classes = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",  // no I or O - misread in terminals
    "abcdefghijkmnopqrstuvwxyz", // no l
    "23456789",                  // no 0 or 1
    "!@#$%^&*_-+=?",
  ];
  const alphabet = classes.join("");
  const chars = classes.map((set) => set[crypto.randomInt(set.length)]);
  while (chars.length < length) {
    chars.push(alphabet[crypto.randomInt(alphabet.length)]);
  }
  // Fisher-Yates with a CSPRNG, so the four guaranteed characters are not
  // pinned to the first four positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const swap = chars[i];
    chars[i] = chars[j];
    chars[j] = swap;
  }
  return chars.join("");
}

function parseCost(raw) {
  if (raw === undefined) return DEFAULT_BCRYPT_COST;
  const cost = Number(raw);
  if (!Number.isInteger(cost) || cost < 4 || cost > 15) {
    throw new ScriptError(EXIT.USAGE, "--cost must be an integer between 4 and 15.");
  }
  return cost;
}

// --- Password acquisition ---------------------------------------------------

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
    process.stdin.on("error", reject);
  });
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Repaint the prompt on every keystroke so the password never appears.
    const onKeypress = () => {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(question);
    };
    process.stdin.on("data", onKeypress);

    const cleanup = () => {
      process.stdin.removeListener("data", onKeypress);
      rl.close();
    };

    // Without this the operator's shell is left with echo disabled after Ctrl-C.
    rl.on("SIGINT", () => {
      cleanup();
      process.stdout.write("\n");
      reject(new ScriptError(EXIT.REFUSED, "Cancelled at the password prompt."));
    });

    rl.question(question, (answer) => {
      cleanup();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function resolvePassword(flags, positionalPassword, email) {
  const sources = [];
  if (flags.generate) sources.push("--generate");
  if (flags["password-stdin"]) sources.push("--password-stdin");
  if (process.env.ADMIN_SEED_PASSWORD) sources.push("ADMIN_SEED_PASSWORD");
  if (positionalPassword) sources.push("argv");

  if (sources.length === 0) {
    throw new ScriptError(EXIT.USAGE, "No password source given.", [
      "--generate            mint a strong password and print it once",
      "--password-stdin      read it from a pipe or a hidden prompt",
      "ADMIN_SEED_PASSWORD   read it from the environment",
    ]);
  }
  if (sources.length > 1) {
    throw new ScriptError(
      EXIT.USAGE,
      `Multiple password sources supplied (${sources.join(", ")}); pick one.`
    );
  }

  if (flags.generate) {
    return { password: generatePassword(), generated: true };
  }

  if (flags["password-stdin"]) {
    if (process.stdin.isTTY) {
      const first = await promptHidden("Admin password: ");
      const second = await promptHidden("Confirm password: ");
      if (first !== second) {
        throw new ScriptError(EXIT.USAGE, "Passwords did not match.");
      }
      return { password: first, generated: false };
    }
    const piped = await readStdin();
    if (!piped) throw new ScriptError(EXIT.USAGE, "stdin was empty.");
    return { password: piped, generated: false };
  }

  if (process.env.ADMIN_SEED_PASSWORD) {
    return { password: process.env.ADMIN_SEED_PASSWORD, generated: false };
  }

  warn("Password was passed on the command line - it is now in your shell history");
  warn("and was visible to every process on this machine via `ps`. Rotate it when");
  warn("you are done, or use --generate / --password-stdin instead.");
  return { password: positionalPassword, generated: false };
}

// --- Target inspection ------------------------------------------------------

/** Extracts the host list from a mongodb URI without exposing credentials. */
function describeTarget(uri) {
  const withoutScheme = String(uri).replace(/^mongodb(\+srv)?:\/\//, "");
  // A password may itself contain '@', so split on the LAST one.
  const afterCredentials = withoutScheme.includes("@")
    ? withoutScheme.slice(withoutScheme.lastIndexOf("@") + 1)
    : withoutScheme;
  const hostSection = afterCredentials.split(/[/?]/)[0];
  const hosts = hostSection.split(",").map((h) => h.split(":")[0]).filter(Boolean);
  const isLocal = hosts.length > 0 && hosts.every((h) => LOOPBACK_HOSTS.has(h));
  return { hosts, isLocal };
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function guardTarget(flags) {
  const { hosts, isLocal } = describeTarget(appConfig.mongoUri);
  const isProductionEnv = appConfig.env === "production";

  say(`Target:   ${maskSecret(appConfig.mongoUri, 24, 6)}`);
  say(`Host(s):  ${hosts.join(", ") || "unknown"}${isLocal ? " (local)" : ""}`);
  say(`NODE_ENV: ${appConfig.env}`);
  say("");

  if (isLocal && !isProductionEnv) return;

  const label = isProductionEnv ? "NODE_ENV=production" : "a non-local database";

  if (flags.yes) {
    warn(`Writing admin credentials to ${label} - proceeding because --yes was passed.`);
    say("");
    return;
  }
  // A CI job has no TTY: refuse rather than hang forever on a prompt nobody
  // will ever answer.
  if (!process.stdin.isTTY) {
    throw new ScriptError(
      EXIT.REFUSED,
      `Refusing to write admin credentials to ${label} without confirmation.`,
      ["Re-run with --yes once you are certain this is the intended database."]
    );
  }

  warn(`You are about to write admin credentials to ${label}.`);
  const answer = await confirm('Type "yes" to continue: ');
  if (answer !== "yes") {
    throw new ScriptError(EXIT.REFUSED, "Aborted at the confirmation prompt.");
  }
  say("");
}

// --- Account auditing -------------------------------------------------------

function auditAdmin(user) {
  const issues = [];
  const ok = [];

  if (!user) return { valid: false, issues: ["User not found"], ok };

  if (user.role !== "admin") issues.push(`role is "${user.role}" (expected "admin")`);
  else ok.push('role is "admin"');

  if (user.authProvider === "google") {
    issues.push("authProvider is google - admin login requires a local password");
  } else if (user.authProvider !== "local") {
    issues.push(`authProvider is "${user.authProvider}" (expected "local")`);
  } else {
    ok.push('authProvider is "local"');
  }

  if (!user.password) issues.push("no password hash - cannot use email/password login");
  else ok.push("password hash present");

  if (user.accountStatus === "disabled") issues.push("accountStatus is disabled");
  if (user.pendingDeletion) issues.push("account is pending deletion");
  if (user.loginLockedUntil && new Date(user.loginLockedUntil) > new Date()) {
    issues.push(`locked out until ${new Date(user.loginLockedUntil).toISOString()}`);
  }

  return { valid: issues.length === 0, issues, ok };
}

async function listAdmins() {
  const admins = await User.find({ role: "admin" })
    .select("+password +loginAttempts +loginLockedUntil")
    .sort({ createdAt: 1 })
    .lean();

  if (admins.length === 0) {
    warn('No accounts with role "admin" exist.');
    say("");
    say("Create one with:");
    say("  node scripts/ensureAdminUser.js --email admin@example.com --generate");
    return;
  }

  say(`${admins.length} admin account(s):`);
  say("");
  for (const admin of admins) {
    const { valid, issues, ok } = auditAdmin(admin);
    rule();
    say(`Email:      ${admin.email}`);
    say(`Name:       ${admin.name}`);
    say(`ID:         ${admin._id}`);
    say(`Provider:   ${admin.authProvider}`);
    say(`Status:     ${admin.accountStatus || "active"}`);
    say(`Last login: ${admin.lastLogin ? new Date(admin.lastLogin).toISOString() : "never"}`);
    say(`Login:      ${valid ? "OK - can sign in at /admin/login" : "BLOCKED"}`);
    if (ok.length) say(`  passing: ${ok.join("; ")}`);
    if (issues.length) say(`  issues:  ${issues.join("; ")}`);
  }
  rule();
  say("");

  const healthy = admins.filter((a) => auditAdmin(a).valid).length;
  if (healthy === 0) {
    warn("No admin can currently sign in. Repair one with --force.");
  } else {
    say(`${healthy} of ${admins.length} admin account(s) can sign in.`);
  }
}

// --- Change planning --------------------------------------------------------

/**
 * Decides what this run will do without touching the database, so --dry-run and
 * the real path can never disagree about the outcome.
 */
function planChanges(existing, { email, name, force, acceptTerms }) {
  const changes = [];
  const warnings = [];

  if (!existing) {
    changes.push(`create account ${email} with role "admin"`);
    if (acceptTerms) {
      changes.push(`record Terms & Privacy acceptance (${CURRENT_TERMS_VERSION})`);
    } else {
      warnings.push(
        "Terms & Privacy are NOT recorded - the account will be prompted on its " +
        "first user-app login. Pass --accept-terms to pre-record them."
      );
    }
    return { action: "create", changes, warnings };
  }

  // Never resurrect an account that is mid-deletion. accountDeletionService
  // reads pendingDeletion as "a purge is in flight or was interrupted"; handing
  // it a fresh admin credential re-admits an account the user asked us to
  // destroy, and the next purge sweep would delete the admin out from under us.
  if (existing.pendingDeletion) {
    throw new ScriptError(
      EXIT.REFUSED,
      `${email} is pending account deletion; refusing to promote it.`,
      [
        "Finish or roll back the deletion first:",
        "  node scripts/repairStrandedDeletion.js",
        "then re-run this script, or pick a different email.",
      ]
    );
  }

  const audit = auditAdmin(existing);
  const isGoogleAccount = existing.authProvider === "google";
  const isDisabled = existing.accountStatus === "disabled";
  const needsPromotion = existing.role !== "admin";

  if (audit.valid && !force) {
    return { action: "noop", changes: [], warnings: [] };
  }

  const blockers = [];
  if (isGoogleAccount) {
    blockers.push(
      `${email} signs in with Google. Converting it to a local password lets ` +
      "anyone holding that password in, bypassing the MFA on the Google account."
    );
  }
  if (isDisabled) {
    blockers.push(
      `${email} is disabled. Someone disabled it deliberately - confirm why before re-enabling.`
    );
  }
  if (needsPromotion) {
    blockers.push(
      `${email} is an existing "${existing.role}" account with real data attached; ` +
      "promoting it grants that person admin over every user."
    );
  }
  // Any existing hash is a credential someone may still be using. A merely
  // locked-out admin fails the audit above but is otherwise healthy, so
  // without this it would have its password silently replaced when the
  // operator only meant to clear the lock.
  if (existing.password) {
    blockers.push(
      audit.valid
        ? `${email} is already a working admin; continuing replaces its password.`
        : `${email} already has a password set; continuing replaces it.`
    );
  }

  if (blockers.length > 0 && !force) {
    throw new ScriptError(EXIT.REFUSED, "Refusing to modify an existing account.", [
      ...blockers,
      "",
      "Re-run with --force if that is what you intend.",
    ]);
  }

  if (needsPromotion) changes.push(`promote role "${existing.role}" -> "admin"`);
  if (isGoogleAccount) {
    changes.push('switch authProvider "google" -> "local"');
    warnings.push(
      "Google sign-in for this account is replaced by a password. Its Google MFA " +
      "no longer protects the admin panel."
    );
  }
  if (isDisabled) changes.push('re-enable accountStatus "disabled" -> "active"');
  changes.push(existing.password ? "replace password hash" : "set password hash");
  if (name) changes.push(`rename to "${name}"`);
  if (existing.loginAttempts) changes.push(`clear ${existing.loginAttempts} failed login attempt(s)`);
  if (existing.loginLockedUntil && new Date(existing.loginLockedUntil) > new Date()) {
    changes.push("clear the active lockout");
  }
  changes.push("bump tokenVersion (invalidates every issued admin and user JWT)");
  changes.push("revoke all refresh tokens");
  changes.push("clear the cached auth record in Redis");

  return { action: "update", changes, warnings };
}

// --- Session teardown -------------------------------------------------------

/**
 * A credential change is only real once the old sessions are gone. tokenVersion
 * kills issued JWTs, refresh-token revocation stops silent re-issue, and the
 * Redis auth cache has to be cleared or the middleware keeps serving the
 * pre-change user document for up to AUTH_CACHE_TTL_SECONDS.
 */
async function revokeExistingSessions(userId) {
  const results = { refreshTokens: false, authCache: false };

  try {
    await revokeAllUserTokens(userId);
    results.refreshTokens = true;
  } catch (error) {
    warn(`Could not revoke refresh tokens: ${error.message}`);
    warn("Existing sessions may survive until their refresh tokens expire.");
  }

  try {
    // The script never boots the app, so Redis is lazy-connected and idle here.
    // Without this connect, invalidateAuthCache() would no-op and a stale
    // cached session would outlive the password change.
    if (!isRedisReady()) {
      await Promise.race([
        connectRedis(),
        new Promise((resolve) => setTimeout(resolve, REDIS_CONNECT_TIMEOUT_MS)),
      ]);
    }
    results.authCache = await invalidateAuthCache(userId);
  } catch (error) {
    warn(`Auth-cache invalidation failed: ${error.message}`);
  }

  if (!results.authCache) {
    warn("Redis was unreachable - a cached copy of this account may keep serving the");
    warn(`pre-change record for up to ${AUTH_CACHE_TTL_SECONDS}s. Restart the API to be certain.`);
  }

  return results;
}

// --- Write paths ------------------------------------------------------------

async function createAdmin({ email, name, hash, acceptTerms }) {
  const doc = {
    name,
    email,
    password: hash,
    role: "admin",
    authProvider: "local",
    accountStatus: "active",
    loginAttempts: 0,
    loginLockedUntil: null,
  };

  if (acceptTerms) {
    doc.termsAcceptance = {
      acceptedTerms: true,
      acceptedPrivacy: true,
      acceptedAt: new Date(),
      termsVersion: CURRENT_TERMS_VERSION,
    };
  }

  try {
    return await User.create(doc);
  } catch (error) {
    // Two concurrent runs, or a signup that landed between our findOne and this
    // insert, both surface as a duplicate-key error on the unique email index.
    // Fall through to the update path rather than failing a deploy.
    if (error && error.code === 11000) {
      warn("Another process created this account concurrently - switching to update.");
      return null;
    }
    throw error;
  }
}

async function updateAdmin({ email, name, hash, existing }) {
  const set = {
    password: hash,
    role: "admin",
    authProvider: "local",
    accountStatus: "active",
    loginAttempts: 0,
    loginLockedUntil: null,
  };
  // Only rename on an explicit --name; a promoted user keeps their own name.
  if (name) set.name = name;

  // updateOne rather than save(): a targeted $set cannot trip full-document
  // validation on unrelated legacy fields, so a stale enum value elsewhere in
  // the document can't block an emergency password reset.
  const result = await User.updateOne(
    { _id: existing._id },
    { $set: set, $inc: { tokenVersion: 1 } }
  );

  if (result.matchedCount === 0) {
    throw new ScriptError(
      EXIT.DB,
      `${email} disappeared between read and write; re-run the script.`
    );
  }
  return result;
}

// --- Main -------------------------------------------------------------------

function printHelp() {
  const header = fs
    .readFileSync(__filename, "utf8")
    .split("*/")[0]
    .split("\n")
    .filter((line) => line.startsWith(" *"))
    .map((line) => line.replace(/^ \* ?/, "").replace(/^ \*$/, ""))
    .join("\n");
  say(header.trim());
}

async function connectMongo() {
  await mongoose.connect(appConfig.mongoUri, {
    serverSelectionTimeoutMS: MONGO_SERVER_SELECTION_TIMEOUT_MS,
    family: 4,
  });
}

async function run(flags, positionals) {
  // Legacy positional form: ensureAdminUser.js <email> <password> [name]
  const [legacyEmail, legacyPassword, legacyName] = positionals;

  const email = validateEmail(normalizeEmail(flags.email !== undefined ? flags.email : legacyEmail));
  const explicitName = flags.name !== undefined ? flags.name : legacyName;
  const cost = parseCost(flags.cost);
  const dryRun = Boolean(flags["dry-run"]);
  const acceptTerms = Boolean(flags["accept-terms"]);

  if (cost !== DEFAULT_BCRYPT_COST) {
    warn(`bcrypt cost ${cost} differs from the cost-${DEFAULT_BCRYPT_COST} dummy hash in`);
    warn("adminAuthController, so login timing will now reveal whether an email");
    warn("belongs to a real admin. Update DUMMY_HASH there to match, or drop --cost.");
    say("");
  }

  await guardTarget(flags);

  const { password, generated } = await resolvePassword(flags, legacyPassword, email);
  const problems = passwordProblems(password, email);
  if (problems.length > 0) {
    throw new ScriptError(EXIT.USAGE, "Password rejected:", problems);
  }

  await connectMongo();

  const existing = await User.findOne({ email })
    .select("+password +loginAttempts +loginLockedUntil")
    .lean();

  const plan = planChanges(existing, {
    email,
    name: explicitName ? normalizeName(explicitName) : null,
    force: Boolean(flags.force),
    acceptTerms,
  });

  if (plan.action === "noop") {
    say(`${email} is already a valid admin. Nothing to do.`);
    say("Pass --force to rotate its password anyway.");
    return EXIT.OK;
  }

  say(`Plan for ${email} (${plan.action}):`);
  for (const change of plan.changes) say(`  - ${change}`);
  if (plan.warnings.length) {
    say("");
    for (const message of plan.warnings) warn(message);
  }
  say("");

  if (dryRun) {
    say("--dry-run: nothing was written.");
    return EXIT.OK;
  }

  const hash = await bcrypt.hash(password, cost);
  const createName = normalizeName(explicitName);
  const renameTo = explicitName ? normalizeName(explicitName) : null;

  let userId;
  let replacedAnAccount = plan.action === "update";

  if (plan.action === "create") {
    const created = await createAdmin({ email, name: createName, hash, acceptTerms });
    if (created) {
      userId = created._id;
      say(`Created admin ${email}`);
    } else {
      // Lost the create race - re-read and update the winner's document.
      const raced = await User.findOne({ email })
        .select("+password +loginAttempts +loginLockedUntil")
        .lean();
      if (!raced) {
        throw new ScriptError(EXIT.DB, "Duplicate key but no document found; re-run the script.");
      }
      await updateAdmin({ email, name: renameTo, hash, existing: raced });
      userId = raced._id;
      replacedAnAccount = true;
      say(`Updated existing admin ${email}`);
    }
  } else {
    await updateAdmin({ email, name: renameTo, hash, existing });
    userId = existing._id;
    say(`Updated ${email}`);
  }

  if (replacedAnAccount) {
    await revokeExistingSessions(userId);
    say("Revoked every existing session for this account.");
  }

  logger.info("ADMIN_CREDENTIAL_PROVISIONED", {
    email,
    userId: String(userId),
    action: plan.action,
    forced: Boolean(flags.force),
    actor: `${os.userInfo().username}@${os.hostname()}`,
  });

  // Read the account back rather than trusting the write: this is the same
  // check adminLogin performs, so a pass here means login genuinely works.
  const verification = await User.findOne({ email })
    .select("+password +loginAttempts +loginLockedUntil")
    .lean();
  const audit = auditAdmin(verification);
  if (!audit.valid) {
    throw new ScriptError(EXIT.DB, "Post-write verification failed.", audit.issues);
  }

  say("");
  rule();
  say(`Email:    ${verification.email}`);
  say(`Name:     ${verification.name}`);
  say(`ID:       ${verification._id}`);
  if (generated) {
    say(`Password: ${password}`);
    say("");
    say("Shown once - it is stored only as a bcrypt hash. Save it now.");
  } else {
    say("Password: (as supplied - not echoed)");
  }
  rule();
  say("");
  say("Verified: this account can sign in at /admin/login.");
  say("Note: 3 failed attempts lock the account for 1 hour.");

  return EXIT.OK;
}

async function main() {
  let code = EXIT.OK;

  try {
    const { flags, positionals } = parseArgs(process.argv.slice(2));

    if (flags.help) {
      printHelp();
    } else if (flags.list) {
      await connectMongo();
      await listAdmins();
    } else {
      code = await run(flags, positionals);
    }
  } catch (error) {
    say("");
    if (error instanceof ScriptError) {
      fail(error.message);
      for (const hint of error.hints) say(`    ${hint}`);
      code = error.code;
    } else if (error && error.name === "MongooseServerSelectionError") {
      fail(`Cannot reach MongoDB at ${maskSecret(appConfig.mongoUri, 24, 6)}`);
      say("    Is mongod running, and is MONGO_URI correct in backend/.env?");
      code = EXIT.DB;
    } else if (error && error.code === 11000) {
      fail("Duplicate key error writing the account; re-run the script.");
      code = EXIT.DB;
    } else {
      fail((error && error.message) || String(error));
      if (process.env.DEBUG) console.error(error);
      code = EXIT.UNEXPECTED;
    }
  } finally {
    // Always tear the connections down. A half-open pool keeps the process
    // alive, and a CI job would hang instead of reporting its exit code.
    await mongoose.disconnect().catch(() => {});
    if (redisClient.status !== "end") {
      await redisClient.quit().catch(() => redisClient.disconnect());
    }
  }

  process.exit(code);
}

main();
