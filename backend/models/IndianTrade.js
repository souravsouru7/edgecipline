const mongoose = require("mongoose");

/**
 * Indian Market — Options (F&O) trades (NSE/BSE).
 */
const indianTradeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    // Display symbol e.g. "NIFTY 26000 CE" or "BANKNIFTY 47000 PE"
    pair: {
      type: String,
      required: true
    },

    // Underlying: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, or stock symbol
    underlying: {
      type: String,
      default: ""
    },

    type: {
      type: String,
      enum: ["BUY", "SELL"],
      required: true
    },

    // Option type: Call or Put
    optionType: {
      type: String,
      enum: ["CE", "PE"],
      default: "CE"
    },

    // Premium (entry/exit in ₹ per share or per unit)
    entryPrice: Number,
    exitPrice: Number,
    stopLoss: Number,
    takeProfit: Number,
    profit: Number,

    strategy: String,
    session: String,
    tradeDate: {
      type: Date,
      default: null
    },
    notes: String,

    riskRewardRatio: { type: String, enum: ["1:1", "1:1.5", "1:2", "1:3", "1:4", "1:5", "custom", ""], default: "" },
    riskRewardCustom: { type: String, default: "" },
    screenshot: { type: String, default: "" },

    segment: { type: String, enum: ["F&O", "EQUITY", ""], default: "F&O" },
    instrumentType: { type: String, enum: ["OPTION", "EQUITY", ""], default: "OPTION" },

    // Equity intraday fields (populated when instrumentType === "EQUITY")
    stockSymbol: { type: String, default: "" },   // NSE/BSE ticker e.g. RELIANCE, TCS
    exchange: { type: String, enum: ["NSE", "BSE", ""], default: "NSE" },
    sharesQty: { type: Number, default: null },    // actual shares (not lots)
    sector: { type: String, default: "" },         // IT, Banking, Pharma, Auto, etc.

    strikePrice: Number,
    expiryDate: Date,
    quantity: Number, // number of lots
    lotSize: Number,  // e.g. 25 for NIFTY, 15 for BANKNIFTY

    tradeType: {
      type: String,
      enum: ["INTRADAY", "DELIVERY", "SWING", ""],
      default: "INTRADAY"
    },

    brokerage: Number,
    sttTaxes: Number,

    entryBasis: {
      type: String,
      enum: ["Plan", "Emotion", "Impulsive", "Custom", ""],
      default: "Plan"
    },
    entryBasisCustom: { type: String, default: "" },

    // Journal: setup/pattern, mistake tag, one-line lesson
    setup: { type: String, default: "" },
    mistakeTag: { type: String, default: "" },
    lesson: { type: String, default: "" },

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
    },

    setupScore: {
      // 0–100 percentage of rules followed for this trade
      type: Number,
      default: null
    },

    // ── Psychology / Emotional Tracking ──
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
    }
  },
  { timestamps: true }
);

// ─── 2026-06 INDEX CLEANUP ──────────────────────────────────────────────────
// Dropped: { user: 1, createdAt: -1 }  — covered by {user:1, instrumentType:1, deletedAt:1, createdAt:-1, _id:-1}
// Dropped: { user: 1, tradeDate: -1 }  — covered by {user:1, instrumentType:1, deletedAt:1, tradeDate:-1, _id:-1}
//
// To remove from production (mongo shell):
//   db.indiantrades.dropIndex("user_1_createdAt_-1")
//   db.indiantrades.dropIndex("user_1_tradeDate_-1")
indianTradeSchema.index({ user: 1, strategy: 1, createdAt: -1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, createdAt: -1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, tradeDate: -1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, createdAt: -1, _id: -1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, tradeDate: -1, _id: -1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, tradeDate: 1, createdAt: 1 });
indianTradeSchema.index({ user: 1, deletedAt: 1, createdAt: -1, _id: -1 });
indianTradeSchema.index({ user: 1, deletedAt: 1, tradeDate: -1, _id: -1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, deletedAt: 1, createdAt: -1, _id: -1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, deletedAt: 1, tradeDate: -1, _id: -1 });
indianTradeSchema.index({ deletedAt: 1 }, { sparse: true });
indianTradeSchema.index({ user: 1, instrumentType: 1, setupScore: 1, tradeDate: 1 });
// Covers checkSetupDisciplineDrop countDocuments — deletedAt filter without instrumentType partition
indianTradeSchema.index({ user: 1, deletedAt: 1, setupScore: 1, tradeDate: 1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, mistakeTag: 1, tradeDate: 1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, strategy: 1, createdAt: -1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, deletedAt: 1, tradeDate: 1, profit: 1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, deletedAt: 1, entryBasis: 1, tradeDate: 1 });
indianTradeSchema.index({ user: 1, instrumentType: 1, deletedAt: 1, "setupRules.followed": 1, "setupRules.label": 1 });

module.exports = mongoose.model("IndianTrade", indianTradeSchema);
