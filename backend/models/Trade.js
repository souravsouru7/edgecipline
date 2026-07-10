const mongoose = require("mongoose");

const tradeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    pair: {
      type: String,
    },

    type: {
      type: String,
      enum: ["BUY", "SELL"],
    },

    quantity: Number,

    lotSize: Number,

    entryPrice: Number,

    exitPrice: Number,

    stopLoss: Number,

    takeProfit: Number,

    profit: Number,

    commission: Number,

    swap: Number,

    balance: Number,

    strategy: { type: String, maxlength: 100 },

    session: String,

    tradeDate: {
      type: Date,
      default: null
    },
    // Persist the fallback used by trade lists so MongoDB can satisfy both
    // filtering and sorting from an index (computed $addFields cannot).
    effectiveTradeDate: {
      type: Date,
      default: Date.now,
    },

    notes: { type: String, maxlength: 2000 },

    riskRewardRatio: {
      type: String,
      enum: ["1:1", "1:2", "1:3", "1:4", "1:5", "custom", null],
      default: null,
      set: (v) => (v === "" ? null : v),
    },

    riskRewardCustom: {
      type: String,
      default: "",
      maxlength: 50,
    },

    screenshot: {
      type: String,
      default: ""
    },

    imageUrl: {
      type: String,
      default: ""
    },

    // Trade evidence images (multi-image gallery): entry, TradingView, MSS, exit, etc.
    // Up to 20 per trade. Stored as Cloudinary URLs with derived thumb/medium variants.
    tradeImages: {
      type: [
        new mongoose.Schema(
          {
            url:          { type: String, required: true },
            publicId:     { type: String, default: "" },
            fileName:     { type: String, default: "", maxlength: 200 },
            uploadedAt:   { type: Date,   default: Date.now },
            order:        { type: Number, default: 0 },
            size:         { type: Number, default: 0 },
            thumbnailUrl: { type: String, default: "" },
            mediumUrl:    { type: String, default: "" },
          },
          { _id: false }
        ),
      ],
      default: [],
      validate: {
        validator(arr) { return Array.isArray(arr) && arr.length <= 20; },
        message: "tradeImages cannot exceed 20 items",
      },
    },

    marketType: {
      type: String,
      default: "Forex"
    },

    // For Indian_Market: "OPTION" (default) or "EQUITY" (intraday stocks)
    tradeSubType: {
      type: String,
      enum: ["OPTION", "EQUITY", null],
      default: null,
      set: (v) => (v === "" ? null : v),
    },

    broker: {
      type: String,
      default: ""
    },

    segment: {
      type: String,
      default: ""
    },

    instrumentType: {
      type: String,
      default: ""
    },

    strikePrice: Number,

    expiryDate: {
      type: String,
      default: ""
    },

    extractedText: {
      type: String,
      default: ""
    },

    rawOCRText: {
      type: String,
      default: ""
    },

    aiRawResponse: {
      type: String,
      default: ""
    },

    parsedData: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },

    extractionConfidence: {
      type: Number,
      default: 0
    },

    isValid: {
      type: Boolean,
      default: true
    },

    needsReview: {
      type: Boolean,
      default: false
    },

    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending"
    },

    ocrJobId: {
      type: String,
      default: ""
    },

    ocrJobName: {
      type: String,
      default: "processTrade"
    },

    ocrAttempts: {
      type: Number,
      default: 0
    },

    queuedAt: {
      type: Date,
      default: null
    },

    processingStartedAt: {
      type: Date,
      default: null
    },

    error: {
      type: String,
      default: null
    },

    processedAt: {
      type: Date,
      default: null
    },

    // Per-trade setup checklist: rules and how many were followed
    setupRules: {
      type: [
        {
          label: { type: String, trim: true, maxlength: 100 },
          followed: { type: Boolean, default: false },
        },
      ],
      validate: {
        validator(arr) { return arr.length <= 20; },
        message: "setupRules cannot have more than 20 items",
      },
      default: [],
    },

    setupScore: {
      // 0–100 percentage of rules followed for this trade
      type: Number,
      default: null
    },

    // ── Psychology / Emotional Tracking ──
    entryBasis: {
      type: String,
      enum: ["Plan", "Emotion", "Impulsive", "Custom", ""],
      default: ""
    },

    entryBasisCustom: {
      type: String,
      default: "",
      maxlength: 200,
    },

    mood: {
      // 1–5 scale (1 = stressed, 5 = peak focus)
      type: Number,
      min: 1,
      max: 5,
      default: null
    },

    confidence: {
      type: String,
      enum: ["Low", "Medium", "High", "Overconfident", ""],
      default: ""
    },

    emotionalTags: {
      type: [String],
      default: [],
      validate: {
        validator(arr) {
          return arr.length <= 10 && arr.every(tag => typeof tag === "string" && tag.length <= 50);
        },
        message: "emotionalTags must have at most 10 items, each at most 50 characters",
      },
    },

    mistakeTag: {
      type: String,
      default: ""
    },

    lesson: {
      type: String,
      default: "",
      maxlength: 2000,
    },

    wouldRetake: {
      type: String,
      enum: ["Yes", "No", ""],
      default: ""
    },

    tradeQuality: {
      type: String,
      enum: ["Great", "Average", "Poor", ""],
      default: ""
    },

    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    deleteReason: {
      type: String,
      default: "",
      maxlength: 500,
    },
    deletedSource: {
      type: String,
      default: "",
      maxlength: 50,
    },

  },
  { timestamps: true }
);

tradeSchema.pre("validate", function syncEffectiveTradeDate() {
  if (this.isModified("tradeDate") || !this.effectiveTradeDate) {
    this.effectiveTradeDate = this.tradeDate || this.createdAt || new Date();
  }
});

// ─── 2026-06 INDEX CLEANUP ──────────────────────────────────────────────────
// Dropped: { user: 1 }                — fully covered by every {user:1,...} compound
// Dropped: { createdAt: -1 }          — global scan, never used at scale
// Dropped: { tradeDate: -1 }          — global scan, never used at scale
// Dropped: { strategy: 1 }            — global scan; analytics always filter by user first
// Dropped: { user: 1, createdAt: -1 } — covered by {user:1, marketType:1, deletedAt:1, createdAt:-1, _id:-1}
// Dropped: { user: 1, tradeDate: -1 } — covered by {user:1, marketType:1, deletedAt:1, tradeDate:-1, _id:-1}
//
// To remove from production (in mongo shell):
//   db.trades.dropIndex("user_1")
//   db.trades.dropIndex("createdAt_-1")
//   db.trades.dropIndex("tradeDate_-1")
//   db.trades.dropIndex("strategy_1")
//   db.trades.dropIndex("user_1_createdAt_-1")
//   db.trades.dropIndex("user_1_tradeDate_-1")
// Removes ~30 % write-amplification, ~15 % storage, no read-path regression.
tradeSchema.index({ user: 1, marketType: 1, createdAt: -1 });
tradeSchema.index({ user: 1, marketType: 1, tradeDate: -1 });
tradeSchema.index({ user: 1, marketType: 1, deletedAt: 1, createdAt: -1, _id: -1 });
tradeSchema.index({ user: 1, marketType: 1, deletedAt: 1, tradeDate: -1, _id: -1 });
tradeSchema.index({ user: 1, deletedAt: 1, effectiveTradeDate: -1, _id: -1 });
tradeSchema.index({ user: 1, marketType: 1, deletedAt: 1, status: 1, tradeDate: -1 });
tradeSchema.index({ user: 1, deletedAt: 1, tradeDate: 1, createdAt: 1 });
tradeSchema.index({ user: 1, deletedAt: 1, setupScore: 1, tradeDate: 1 });
// Covers checkSetupDisciplineDrop countDocuments — includes marketType for Forex partition
tradeSchema.index({ user: 1, marketType: 1, deletedAt: 1, setupScore: 1, tradeDate: 1 });
tradeSchema.index({ user: 1, deletedAt: 1, mistakeTag: 1, tradeDate: 1 });
tradeSchema.index({ user: 1, deletedAt: 1, tradeDate: 1, profit: 1 });
tradeSchema.index({ user: 1, deletedAt: 1, entryBasis: 1, tradeDate: 1 });
tradeSchema.index({ user: 1, deletedAt: 1, "setupRules.followed": 1, "setupRules.label": 1 });
tradeSchema.index({ user: 1, status: 1, createdAt: -1 });
tradeSchema.index({ user: 1, marketType: 1, status: 1, createdAt: -1 });
tradeSchema.index({ deletedAt: 1 }, { sparse: true });

module.exports = mongoose.model("Trade", tradeSchema);
