const express = require("express");
const router = express.Router();

const {
  getSummary,
  getWeeklyStats,
  getRiskRewardAnalysis,
  getTradeDistribution,
  getPerformanceMetrics,
  getTimeAnalysis,
  getTradeQuality,
  getDrawdownAnalysis,
  getAIInsights,
  getAdvancedAnalytics,
  getPnLBreakdown,
  getPsychologyAnalytics,
  getTradeQualityAnalysis,
  getSelfAwarenessScore,
  getPsychologyCost,
  getTradingDNA,
} = require("../controllers/indianAnalyticsController");

const { getPatterns } = require("../controllers/patternController");
const { getCoachFeed } = require("../controllers/aiCoachController");
const { getPsychologyTimeline } = require("../controllers/timelineController");
const { getDisciplineAnalytics } = require("../controllers/disciplineController");
const { getAnalyticsSnapshot } = require("../controllers/analyticsSnapshotController");

const { protect } = require("../middleware/authMiddleware");
const cacheMiddleware = require("../middleware/cacheMiddleware");

// Indian Market only — uses IndianTrade model
router.use(protect);

router.get("/snapshot", cacheMiddleware({ namespace: "analytics:indian", scope: "snapshot", ttlSeconds: 120 }), getAnalyticsSnapshot);
router.get("/summary", cacheMiddleware({ namespace: "dashboard", scope: "indian_summary", ttlSeconds: 45 }), getSummary);
router.get("/weekly", cacheMiddleware({ namespace: "analytics:indian", scope: "weekly", ttlSeconds: 90 }), getWeeklyStats);
router.get("/risk-reward", cacheMiddleware({ namespace: "analytics:indian", scope: "risk_reward", ttlSeconds: 90 }), getRiskRewardAnalysis);
router.get("/distribution", cacheMiddleware({ namespace: "analytics:indian", scope: "distribution", ttlSeconds: 90 }), getTradeDistribution);
router.get("/performance", cacheMiddleware({ namespace: "analytics:indian", scope: "performance", ttlSeconds: 90 }), getPerformanceMetrics);
router.get("/time-analysis", cacheMiddleware({ namespace: "analytics:indian", scope: "time_analysis", ttlSeconds: 90 }), getTimeAnalysis);
router.get("/quality", cacheMiddleware({ namespace: "analytics:indian", scope: "quality", ttlSeconds: 90 }), getTradeQuality);
router.get("/drawdown", cacheMiddleware({ namespace: "analytics:indian", scope: "drawdown", ttlSeconds: 60 }), getDrawdownAnalysis);
router.get("/ai-insights", cacheMiddleware({ namespace: "analytics:indian", scope: "ai_insights", ttlSeconds: 120 }), getAIInsights);
router.get("/advanced", cacheMiddleware({ namespace: "dashboard", scope: "indian_advanced", ttlSeconds: 60 }), getAdvancedAnalytics);
router.get("/pnl-breakdown", cacheMiddleware({ namespace: "analytics:indian", scope: "pnl_breakdown", ttlSeconds: 90 }), getPnLBreakdown);
router.get("/psychology", cacheMiddleware({ namespace: "analytics:indian", scope: "psychology", ttlSeconds: 90 }), getPsychologyAnalytics);
router.get("/trade-quality-analysis", cacheMiddleware({ namespace: "analytics:indian", scope: "trade_quality_analysis", ttlSeconds: 90 }), getTradeQualityAnalysis);
router.get("/self-awareness", cacheMiddleware({ namespace: "analytics:indian", scope: "self_awareness", ttlSeconds: 90 }), getSelfAwarenessScore);
router.get("/psychology-cost", cacheMiddleware({ namespace: "analytics:indian", scope: "psychology_cost", ttlSeconds: 90 }), getPsychologyCost);

// Trading DNA Engine
router.get("/trading-dna", cacheMiddleware({ namespace: "analytics:indian", scope: "trading_dna", ttlSeconds: 120 }), getTradingDNA);

// Pattern Detection Engine
router.get(
  "/patterns",
  (req, _res, next) => { req.isIndianMarket = true; next(); },
  cacheMiddleware({ namespace: "analytics:indian", scope: "patterns", ttlSeconds: 120 }),
  getPatterns
);

// AI Coach Feed
router.get(
  "/ai-coach-feed",
  (req, _res, next) => { req.isIndianMarket = true; next(); },
  cacheMiddleware({ namespace: "analytics:indian", scope: "ai_coach_feed", ttlSeconds: 120 }),
  getCoachFeed
);

// Psychology Timeline
router.get(
  "/psychology-timeline",
  (req, _res, next) => { req.isIndianMarket = true; next(); },
  cacheMiddleware({ namespace: "analytics:indian", scope: "psychology_timeline", ttlSeconds: 120 }),
  getPsychologyTimeline
);

// Discipline Analytics
router.get(
  "/discipline",
  (req, _res, next) => { req.isIndianMarket = true; next(); },
  cacheMiddleware({ namespace: "analytics:indian", scope: "discipline", ttlSeconds: 120 }),
  getDisciplineAnalytics
);

module.exports = router;
