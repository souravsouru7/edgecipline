const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { getBanner, recordEvent } = require("../controllers/rescueController");

router.get("/banner", protect, getBanner);
router.post("/event", protect, recordEvent);

module.exports = router;
