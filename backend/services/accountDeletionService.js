"use strict";

// Account deletion — required by Google Play's User Data policy and Apple
// App Store Review Guideline 5.1.1(v) for any app that lets users create an
// account. Both stores require that the user can start this from inside the
// app; Play additionally requires a publicly reachable web URL describing it.
//
// Design notes:
//
//   * The user is locked out FIRST (status flipped + refresh tokens revoked)
//     and the Users document is removed LAST. If a step in between throws, the
//     failure mode is a disabled account that can be retried — never a live,
//     usable account whose data has been half-erased.
//
//     "Can be retried" is load-bearing and does not come for free: the lockout
//     would otherwise block the retry itself, since protect() rejects disabled
//     accounts. That is why step 1 also sets `pendingDeletion` — authMiddleware
//     reads it to re-admit this user for THIS endpoint alone. Never drop that
//     flag from the lockout write, or a failed purge becomes a permanent limbo
//     where the account is unusable and the data is still there.
//
//   * Cloudinary public IDs are collected BEFORE the trades are deleted.
//     Deleting the rows first would lose the only pointer to the stored
//     images and orphan them in the asset account forever.
//
//   * Payment records are deliberately RETAINED. They carry no personal data
//     beyond the (now dangling) user ObjectId, and financial records are
//     subject to statutory retention. Deleting the Users document is what
//     makes them anonymous.

const Users = require("../models/Users");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const RefreshToken = require("../models/RefreshToken");

const { getFirebaseAdmin } = require("../config/firebaseAdmin");
const { destroyImages } = require("../utils/cloudinaryHelpers");
const { logger } = require("../utils/logger");

// Every collection that stores data belonging to a user, paired with the field
// that holds the owner's _id.
//
// Models are required directly rather than looked up via mongoose.model(name).
// A string lookup only resolves models that some other module happened to
// require first, so a collection nobody else imports would be silently skipped
// and the user's data would survive deletion — a compliance hole that would
// not surface in testing. A bad path here is a startup crash instead.
//
// Payment and WebhookEvent are deliberately absent: they hold no personal data
// beyond the (now dangling) user id and are subject to statutory retention.
//
// Each entry must be the MODEL ITSELF, not the module that holds it. Most model
// files `module.exports = mongoose.model(...)`, but a few export a bag of named
// values instead (OCRJob ships its status enum alongside the model), so those
// have to be unwrapped here. Getting this wrong throws
// "Model.deleteMany is not a function" mid-purge, which aborts the deletion
// after the account has already been locked out — see accountDeletionModels
// in the unit tests, which asserts every entry is a real model.
const USER_OWNED_COLLECTIONS = [
  ["user",   require("../models/AnalyticsEvent")],
  ["user",   require("../models/ChecklistNotificationSetting")],
  ["user",   require("../models/ChecklistTracking")],
  ["user",   require("../models/CoachConversation")],
  ["user",   require("../models/CoachMessage")],
  ["user",   require("../models/DailyDisciplineEntry")],
  ["user",   require("../models/DailyReflection")],
  ["user",   require("../models/DeviceToken")],
  ["user",   require("../models/ExtractionLog")],
  ["user",   require("../models/Feedback")],
  ["user",   IndianTrade],
  ["user",   require("../models/IssueReport")],
  ["user",   require("../models/MissionAssignment")],
  ["user",   require("../models/NotificationDebugLog")],
  ["user",   require("../models/NotificationHistory")],
  ["user",   require("../models/NotificationPreference")],
  ["user",   require("../models/OCRJob").OCRJob],
  ["user",   require("../models/RescueDispatch")],
  ["user",   require("../models/SetupStrategy")],
  ["user",   Trade],
  ["user",   require("../models/TradingDnaReport")],
  ["user",   require("../models/WeeklyReport")],
  ["userId", require("../models/Notification")],
  ["userId", RefreshToken],
];

// Fail at startup, not halfway through a user's deletion. Same reasoning as the
// direct requires above: a broken entry here is invisible until someone deletes
// their account, and by then the account is already locked out and the purge has
// aborted. A boot crash is loud, immediate, and costs nobody their data.
for (const [field, Model] of USER_OWNED_COLLECTIONS) {
  if (typeof Model?.deleteMany !== "function") {
    throw new Error(
      `accountDeletionService: entry ["${field}", ...] is not a mongoose model. ` +
      `Check whether that model file exports the model directly or as a named property.`
    );
  }
}

// Pull every Cloudinary public ID this user owns, across both trade types.
async function collectImagePublicIds(userId) {
  const publicIds = [];

  const push = (docs) => {
    for (const doc of docs) {
      for (const img of doc.tradeImages || []) {
        if (img?.publicId) publicIds.push(img.publicId);
      }
    }
  };

  push(await Trade.find({ user: userId }).select("tradeImages").lean());
  push(await IndianTrade.find({ user: userId }).select("tradeImages").lean());

  return [...new Set(publicIds)];
}

// Remove the Firebase Auth user so the same Google account can register fresh
// afterwards. Looked up by email rather than the stored googleId: that field
// holds either the google.com identity sub or the Firebase uid depending on
// the sign-in path, so it is not a reliable key.
//
// Best-effort by design — a Firebase outage must not strand a half-deleted
// account. The Mongo purge is the part that carries the compliance weight.
async function deleteFirebaseUser(email) {
  if (!email) return { deleted: false, reason: "no-email" };

  try {
    const admin = getFirebaseAdmin();
    const record = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(record.uid);
    return { deleted: true };
  } catch (err) {
    if (err?.code === "auth/user-not-found") {
      return { deleted: false, reason: "not-found" };
    }
    logger.warn("Firebase user deletion failed during account deletion", {
      error: err.message,
      code: err.code,
    });
    return { deleted: false, reason: err.code || "error" };
  }
}

async function purgeUserDocuments(userId) {
  const deleted = {};

  for (const [field, Model] of USER_OWNED_COLLECTIONS) {
    const result = await Model.deleteMany({ [field]: userId });
    if (result.deletedCount) deleted[Model.modelName] = result.deletedCount;
  }

  return deleted;
}

/**
 * Permanently delete a user and all of their personal data.
 *
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @returns {Promise<{email: string, documentsDeleted: object, images: object, firebase: object}>}
 */
async function deleteAccount(userId) {
  const user = await Users.findById(userId).select("email name").lean();
  if (!user) {
    const err = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  logger.info("Account deletion started", { userId: String(userId) });

  // 1. Lock the account out immediately. If anything below fails, the user
  //    cannot keep using a partially-erased account.
  //
  //    `pendingDeletion` records WHY the account was disabled. Without it the
  //    lockout is indistinguishable from an admin ban, and authMiddleware would
  //    reject the retry with ACCOUNT_DISABLED before the controller ever ran —
  //    leaving the account permanently locked but NOT deleted, which is the
  //    worst of both outcomes. The flag is what lets protect() re-admit this
  //    user for the deletion endpoint alone.
  await Users.updateOne(
    { _id: userId },
    { $set: { accountStatus: "disabled", pendingDeletion: true } }
  );
  await RefreshToken.deleteMany({ userId });

  // 2. Capture image pointers before the rows that hold them are removed.
  const publicIds = await collectImagePublicIds(userId);

  // 3. Drop the Firebase Auth identity.
  const firebase = await deleteFirebaseUser(user.email);

  // 4. Purge every user-scoped collection.
  const documentsDeleted = await purgeUserDocuments(userId);

  // 5. Remove the account record itself — last, so the operation stays
  //    retryable if any earlier step threw.
  await Users.deleteOne({ _id: userId });

  // 6. Storage cleanup. Runs after the account is gone: a Cloudinary failure
  //    leaves orphaned blobs to sweep later, which is far better than leaving
  //    the account alive because an image delete timed out.
  const images = await destroyImages(publicIds);

  logger.info("Account deletion completed", {
    userId: String(userId),
    documentsDeleted,
    imagesDestroyed: images.destroyed,
    imagesFailed: images.failed,
    firebaseDeleted: firebase.deleted,
  });

  return { email: user.email, documentsDeleted, images, firebase };
}

// USER_OWNED_COLLECTIONS is exported for the coverage guard in the unit tests,
// which asserts every model referenced here is real and purged on the right field.
module.exports = { deleteAccount, USER_OWNED_COLLECTIONS };
