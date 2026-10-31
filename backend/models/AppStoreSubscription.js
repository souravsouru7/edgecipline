"use strict";

const mongoose = require("mongoose");
const { SUBSCRIPTION_STATE_VALUES, SUBSCRIPTION_STATES } = require("../constants/googlePlay");

// One row per Apple subscription chain. Apple identifies a chain by its
// originalTransactionId, which stays the same across every renewal, upgrade
// and downgrade within the group — so it is the natural unique key, the way
// purchaseToken is for PlaySubscription.
const appStoreSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    // Set when the owning account is deleted. The chain stays bound to nobody
    // forever, exactly like PlaySubscription.detachedAt.
    detachedAt: {
      type: Date,
      default: null,
    },

    originalTransactionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    latestTransactionId: {
      type: String,
      default: null,
      trim: true,
    },
    // The UUID the app passed to StoreKit at purchase time. Apple echoes it in
    // every transaction for this chain; it must match the claiming user.
    appAccountToken: {
      type: String,
      default: null,
      trim: true,
    },

    productId: {
      type: String,
      required: true,
      trim: true,
    },
    planType: {
      type: String,
      default: null,
    },

    state: {
      type: String,
      enum: SUBSCRIPTION_STATE_VALUES,
      default: SUBSCRIPTION_STATES.PENDING,
      required: true,
    },
    appleStatus: {
      type: Number,
      default: null,
    },
    // null = not known yet (no Server API key and no renewal info received).
    autoRenewing: {
      type: Boolean,
      default: null,
    },

    environment: {
      type: String,
      enum: ["Production", "Sandbox", "Xcode", "LocalTesting"],
      default: "Production",
    },

    purchaseDate: {
      type: Date,
      default: null,
    },
    expiryTime: {
      type: Date,
      default: null,
      index: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },

    lastSyncedAt: {
      type: Date,
      default: null,
    },
    lastNotificationType: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

appStoreSubscriptionSchema.index({ user: 1, detachedAt: 1 });

module.exports =
  mongoose.models.AppStoreSubscription ||
  mongoose.model("AppStoreSubscription", appStoreSubscriptionSchema);
