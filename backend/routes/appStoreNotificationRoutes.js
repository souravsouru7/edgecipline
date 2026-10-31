"use strict";

const express = require("express");
const router = express.Router();
const { handleAppStoreNotification } = require("../controllers/appStoreBillingController");
const { webhookRateLimiter } = require("../middleware/rateLimiter");

router.post("/", webhookRateLimiter, handleAppStoreNotification);

module.exports = router;
