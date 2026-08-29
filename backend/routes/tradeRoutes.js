const express = require("express");
const router = express.Router();

const {
    createTrade,
    createTradesBatch,
    getTradeQuota,
    getTrades,
    getTrade,
    getTradeStatus,
    updateTrade,
    deleteTrade,
    restoreTrade,
} = require("../controllers/tradeController");

const { protect } = require("../middleware/authMiddleware");
const { statusRateLimiter } = require("../middleware/rateLimiter");
const { validateRequest } = require("../middleware/validateRequest");
const { tradeSchemas } = require("../validation/schemas");

// Lets the client show the remaining free allowance and open the paywall
// before the user fills in a form that would be rejected on submit.
router.get("/quota", protect, getTradeQuota);

router.post("/", protect, validateRequest(tradeSchemas.create), createTrade);
router.post("/batch", protect, validateRequest(tradeSchemas.batchCreate), createTradesBatch);

router.get("/", protect, validateRequest(tradeSchemas.list), getTrades);

router.get("/status/:id", protect, statusRateLimiter, validateRequest(tradeSchemas.getById), getTradeStatus);

router.get("/:id", protect, validateRequest(tradeSchemas.getById), getTrade);

router.put("/:id", protect, validateRequest(tradeSchemas.update), updateTrade);

router.post("/:id/restore", protect, validateRequest(tradeSchemas.getById), restoreTrade);

router.delete("/:id", protect, validateRequest(tradeSchemas.getById), deleteTrade);


module.exports = router;
