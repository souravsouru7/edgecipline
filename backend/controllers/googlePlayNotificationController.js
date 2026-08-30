"use strict";

const asyncHandler = require("../utils/asyncHandler");
const { processGooglePlayNotification } = require("../services/googlePlayNotificationService");

exports.handleGooglePlayNotification = asyncHandler(async (req, res) => {
  // Pub/Sub only needs a 2xx to consider the message delivered. Internal
  // processing detail stays in our logs — echoing it back would leak whether a
  // given purchase token is known to us to anyone who can reach the endpoint,
  // even though they cannot authenticate past it.
  await processGooglePlayNotification({
    rawBody: req.body,
    authorizationHeader: req.get("authorization"),
  });

  res.status(200).json({ received: true });
});
