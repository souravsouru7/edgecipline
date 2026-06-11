const express = require("express");
const router = express.Router();

const {
    createTrade,
    createTradesBatch,
    getTrades,
    getTrade,
    getTradeStatus,
    updateTrade,
    deleteTrade,
    restoreTrade,
    debugTrades,
} = require("../controllers/tradeController");

const { protect } = require("../middleware/authMiddleware");
const { statusRateLimiter } = require("../middleware/rateLimiter");
const { validateNumbers } = require("../middleware/validateNumbers");
const { validateObjectId } = require("../middleware/validateObjectId");

router.get("/debug", protect, debugTrades);
router.post("/", protect, validateNumbers, createTrade);
router.post("/batch", protect, validateNumbers, createTradesBatch);

router.get("/", protect, getTrades);

router.get("/status/:id", protect, statusRateLimiter, validateObjectId("id"), getTradeStatus);

router.get("/:id", protect, validateObjectId("id"), getTrade);

router.put("/:id", protect, validateObjectId("id"), validateNumbers, updateTrade);

router.post("/:id/restore", protect, validateObjectId("id"), restoreTrade);

router.delete("/:id", protect, validateObjectId("id"), deleteTrade);


module.exports = router;
