"use strict";

const express = require("express");
const router = express.Router();
const { handleGooglePlayNotification } = require("../controllers/googlePlayNotificationController");
const { webhookRateLimiter } = require("../middleware/rateLimiter");

// Unauthenticated by middleware on purpose — the caller is Google, not a user.
// Authentication is the OIDC push token, verified inside the service before
// anything is parsed or written. See googlePlayNotificationService.
router.post("/", webhookRateLimiter, handleGooglePlayNotification);

module.exports = router;
