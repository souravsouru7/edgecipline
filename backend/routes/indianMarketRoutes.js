const express = require("express");
const router = express.Router();

const {
  createTrade,
  createTradesBatch,
  getTrades,
  getTrade,
  updateTrade,
  deleteTrade,
  restoreTrade
} = require("../controllers/indianTradeController");

const { protect } = require("../middleware/authMiddleware");
const cacheMiddleware = require("../middleware/cacheMiddleware");
const { validateNumbers } = require("../middleware/validateNumbers");
const { validateObjectId } = require("../middleware/validateObjectId");

// Indian Market only — uses IndianTrade model, no shared Forex logic
router.post("/", protect, validateNumbers, createTrade);
router.post("/batch", protect, validateNumbers, createTradesBatch);
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
router.put("/:id", protect, validateObjectId("id"), validateNumbers, updateTrade);
router.post("/:id/restore", protect, validateObjectId("id"), restoreTrade);
router.delete("/:id", protect, validateObjectId("id"), deleteTrade);

module.exports = router;
