"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const Influencer = require("../models/Influencer");
const Campaign = require("../models/Campaign");
const AttributionTouch = require("../models/AttributionTouch");
const User = require("../models/Users");
const { normalizeSlug } = require("../constants/promotions");
const { logger } = require("../utils/logger");

function readAnonymousId(req) {
  const header = String(req.headers?.["x-attribution-id"] || "").trim();
  if (header && header.length <= 80) return header;
  const cookie = String(req.cookies?.ec_aid || "").trim();
  if (cookie && cookie.length <= 80) return cookie;
  return null;
}

function newAnonymousId() {
  return crypto.randomUUID();
}

async function resolveRef(refSlug) {
  const slug = normalizeSlug(refSlug);
  if (!slug || mongoose.connection.readyState !== 1) return { influencer: null, campaign: null };
  const influencer = await Influencer.findOne({ slug, status: "active" }).lean();
  if (!influencer) return { influencer: null, campaign: null };
  const campaign = await Campaign.findOne({
    influencer: influencer._id,
    status: "active",
    type: "influencer",
  })
    .sort({ createdAt: -1 })
    .lean();
  return { influencer, campaign };
}

function touchPayload({ anonymousId, userId, source, refSlug, influencer, campaign, utm, landingPath }) {
  return {
    anonymousId,
    user: userId || null,
    source,
    refSlug: refSlug || "",
    influencer: influencer?._id || null,
    campaign: campaign?._id || null,
    utmSource: utm?.source || "",
    utmMedium: utm?.medium || "",
    utmCampaign: utm?.campaign || "",
    landingPath: String(landingPath || "").slice(0, 200),
  };
}

async function recordTouch(input) {
  const anonymousId = input.anonymousId || newAnonymousId();
  if (mongoose.connection.readyState !== 1) {
    return { anonymousId, touch: null, influencer: null, campaign: null };
  }
  const { influencer, campaign } = input.refSlug
    ? await resolveRef(input.refSlug)
    : { influencer: null, campaign: null };

  const source = input.refSlug ? "ref" : input.utm?.source ? "utm" : "direct";
  const doc = await AttributionTouch.create(
    touchPayload({
      ...input,
      anonymousId,
      source: input.source || source,
      influencer,
      campaign,
    })
  );
  return { anonymousId, touch: doc, influencer, campaign };
}

async function attachUser(userId, anonymousId) {
  if (!userId || !anonymousId || mongoose.connection.readyState !== 1) return;
  try {
    await AttributionTouch.updateMany(
      { anonymousId, user: null },
      { $set: { user: userId } }
    );

    const user = await User.findById(userId).select("attribution").lean();
    if (!user) return;

    const first = await AttributionTouch.findOne({
      $or: [{ anonymousId }, { user: userId }],
      source: { $in: ["ref", "utm"] },
    })
      .sort({ createdAt: 1 })
      .lean();

    const latest = await AttributionTouch.findOne({
      $or: [{ anonymousId }, { user: userId }],
    })
      .sort({ createdAt: -1 })
      .lean();

    const set = { "attribution.anonymousId": anonymousId };
    if (!user.attribution?.firstTouch?.at && first) {
      set["attribution.firstTouch"] = {
        source: first.source,
        refSlug: first.refSlug || "",
        influencer: first.influencer,
        campaign: first.campaign,
        at: first.createdAt,
      };
    }
    if (latest) {
      set["attribution.signupTouch"] = {
        source: latest.source,
        refSlug: latest.refSlug || "",
        influencer: latest.influencer,
        campaign: latest.campaign,
        at: latest.createdAt,
      };
    }
    await User.updateOne({ _id: userId }, { $set: set });
  } catch (error) {
    logger.warn("[Attribution] attachUser failed", { error: error?.message });
  }
}

module.exports = {
  readAnonymousId,
  newAnonymousId,
  recordTouch,
  attachUser,
  resolveRef,
};
