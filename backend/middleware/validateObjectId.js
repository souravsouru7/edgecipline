const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");

/**
 * Returns middleware that validates one or more route params as MongoDB ObjectIds.
 * Usage: router.get("/:id", validateObjectId("id"), handler)
 *        router.get("/:userId/:tradeId", validateObjectId("userId", "tradeId"), handler)
 */
const validateObjectId = (...params) => (req, _res, next) => {
  for (const param of params) {
    const value = req.params[param];
    if (value !== undefined && !mongoose.Types.ObjectId.isValid(value)) {
      return next(new ApiError(400, `Invalid ${param}: must be a valid ObjectId`, "INVALID_ID"));
    }
  }
  next();
};

module.exports = { validateObjectId };
