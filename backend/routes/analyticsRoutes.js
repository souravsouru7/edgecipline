const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");

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
    getPsychologyAnalytics,
    getTradeQualityAnalysis,
    getSelfAwarenessScore,
    getPsychologyCost,
    getTradingDNA,
} = require("../controllers/analyticsController");

const { getPatterns } = require("../controllers/patternController");
const { getCoachFeed } = require("../controllers/aiCoachController");
const { getPsychologyTimeline } = require("../controllers/timelineController");
const { getDisciplineAnalytics } = require("../controllers/disciplineController");
const { getAnalyticsSnapshot } = require("../controllers/analyticsSnapshotController");

const cacheMiddleware = require("../middleware/cacheMiddleware");

// Basic analytics
router.get("/snapshot", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "snapshot", ttlSeconds: 120 }), getAnalyticsSnapshot);
router.get("/summary", protect, cacheMiddleware({ namespace: "dashboard", scope: "forex_summary", ttlSeconds: 45 }), getSummary);
router.get("/weekly", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "weekly", ttlSeconds: 90 }), getWeeklyStats);

// Advanced analytics
router.get("/risk-reward", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "risk_reward", ttlSeconds: 90 }), getRiskRewardAnalysis);
router.get("/distribution", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "distribution", ttlSeconds: 90 }), getTradeDistribution);
router.get("/performance", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "performance", ttlSeconds: 90 }), getPerformanceMetrics);
router.get("/time-analysis", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "time_analysis", ttlSeconds: 90 }), getTimeAnalysis);
router.get("/quality", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "quality", ttlSeconds: 90 }), getTradeQuality);
router.get("/drawdown", protect, getDrawdownAnalysis); // No cache for real-time
router.get("/ai-insights", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "ai_insights", ttlSeconds: 120 }), getAIInsights);

// All-in-one endpoint
router.get("/advanced", protect, cacheMiddleware({ namespace: "dashboard", scope: "forex_advanced", ttlSeconds: 60 }), getAdvancedAnalytics);

// Psychology analytics
router.get("/psychology", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "psychology", ttlSeconds: 90 }), getPsychologyAnalytics);

// Trade quality & self-awareness
router.get("/trade-quality-analysis", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "trade_quality_analysis", ttlSeconds: 90 }), getTradeQualityAnalysis);
router.get("/self-awareness", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "self_awareness", ttlSeconds: 90 }), getSelfAwarenessScore);

// Psychology Cost Calculator (time-filtered — short cache because ?days param varies)
router.get("/psychology-cost", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "psychology_cost", ttlSeconds: 90 }), getPsychologyCost);

// Trading DNA Engine
router.get("/trading-dna", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "trading_dna", ttlSeconds: 120 }), getTradingDNA);

// Pattern Detection Engine
router.get("/patterns", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "patterns", ttlSeconds: 120 }), getPatterns);

// AI Coach Feed
router.get("/ai-coach-feed", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "ai_coach_feed", ttlSeconds: 120 }), getCoachFeed);

// Psychology Timeline
router.get("/psychology-timeline", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "psychology_timeline", ttlSeconds: 120 }), getPsychologyTimeline);

// Discipline Analytics
router.get("/discipline", protect, cacheMiddleware({ namespace: "analytics:forex", scope: "discipline", ttlSeconds: 120 }), getDisciplineAnalytics);

module.exports = router;
