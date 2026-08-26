const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const {
  getIndianIntelligenceSummary,
  normalizeInstrumentType,
} = require("../services/indianIntelligenceService");

const getSummary = asyncHandler(async (req, res) => {
  let instrumentType;
  try {
    instrumentType = normalizeInstrumentType(req.query.instrumentType || "ALL");
  } catch (_error) {
    throw new ApiError(
      400,
      "instrumentType must be ALL, OPTION, or EQUITY",
      "INVALID_INDIAN_INSTRUMENT"
    );
  }

  const summary = await getIndianIntelligenceSummary({
    userId: req.user._id,
    instrumentType,
  });
  return res.json(summary);
});

module.exports = { getSummary };
