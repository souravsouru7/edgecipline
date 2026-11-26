const express = require("express");

const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const { mindProgressSchemas } = require("../validation/mindProgressSchemas");
const {
  cancelTarget,
  getCard,
  getMicro,
  getProgress,
  getSuggestions,
  markSeen,
  setTarget,
} = require("../controllers/mindProgressController");

router.get("/", protect, getProgress);
router.get("/card", protect, getCard);
router.get("/micro", protect, getMicro);
router.post("/wins/seen", protect, validateRequest(mindProgressSchemas.seen), markSeen);
router.get("/targets/suggestions", protect, getSuggestions);
router.put("/target", protect, validateRequest(mindProgressSchemas.setTarget), setTarget);
router.delete("/target", protect, cancelTarget);

module.exports = router;
