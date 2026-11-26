const express = require("express");
const router = express.Router();

const {
  createTrade,
  createTradesBatch,
  getTradeQuota,
  getTrades,
  getTrade,
  updateTrade,
  deleteTrade,
  restoreTrade
} = require("../controllers/indianTradeController");

const { protect } = require("../middleware/authMiddleware");
const cacheMiddleware = require("../middleware/cacheMiddleware");
const { validateNumbers } = require("../middleware/validateNumbers");
const { idempotency } = require("../middleware/idempotency");
const { validateObjectId } = require("../middleware/validateObjectId");
const { validateRequest } = require("../middleware/validateRequest");
const { indianTradeSchemas } = require("../validation/indianTradeSchemas");

// Indian Market only — uses IndianTrade model, no shared Forex logic
router.get("/quota", protect, getTradeQuota);
// See tradeRoutes.js — same ordering rationale.
router.post("/", protect, validateNumbers, validateRequest(indianTradeSchemas.create), idempotency, createTrade);
router.post("/batch", protect, validateRequest(indianTradeSchemas.batchCreate), idempotency, createTradesBatch);
router.get(
  "/",
  protect,
  cacheMiddleware({
    namespace: "trades",
    scope: "indian_list",
    ttlSeconds: 45,
  }),
  getTrades
);
router.get("/:id", protect, validateObjectId("id"), getTrade);
router.put("/:id", protect, validateObjectId("id"), validateNumbers, validateRequest(indianTradeSchemas.update), updateTrade);
router.post("/:id/restore", protect, validateObjectId("id"), restoreTrade);
router.delete("/:id", protect, validateObjectId("id"), deleteTrade);

module.exports = router;
