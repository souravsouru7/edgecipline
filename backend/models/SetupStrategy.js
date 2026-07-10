const mongoose = require("mongoose");

const setupStrategySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    marketType: {
      type: String,
      enum: ["Forex", "Indian_Market"],
      default: "Forex",
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    referenceImages: [
      {
        url: {
          type: String,
          default: "",
          trim: true,
        },
        publicId: {
          type: String,
          default: "",
          trim: true,
        },
      },
    ],
    rules: [
      {
        label: {
          type: String,
          required: true,
          trim: true,
          maxlength: 200,
        },
      },
    ],
  },
  { timestamps: true }
);

setupStrategySchema.index({ user: 1, marketType: 1, createdAt: 1 });
// M15: Prevent duplicate strategy names per user+market
setupStrategySchema.index({ user: 1, marketType: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("SetupStrategy", setupStrategySchema);

