const asyncHandler = require("../utils/asyncHandler");
const reflectionService = require("../services/reflectionService");
const reflectionInsightService = require("../services/reflectionInsightService");
const { onReflectionSaved } = require("../services/missionProgressService");
const { logger } = require("../utils/logger");

// Fire-and-forget AI insight generation. We never block the submit response on
// Gemini latency — the frontend reads the insight on the next fetch of
// /reflections/today or via the dashboard snapshot.
function scheduleInsightGeneration({ reflection, context, day }) {
  setImmediate(() => {
    reflectionInsightService
      .generateInsight({ reflection, context, day })
      .then((result) =>
        reflectionService.attachAiInsight(reflection._id, result)
      
      )
      .catch((error) =>
        logger.warn("REFLECTION_INSIGHT_ATTACH_FAILED", {
          reflectionId: reflection?._id ? String(reflection._id) : null,
          error: error?.message,
        })
      );
  });
}

exports.getTodayReflection = asyncHandler(async (req, res) => {
  const data = await reflectionService.getTodayContext(req.user._id);
  res.json(data);
});

exports.submitReflection = asyncHandler(async (req, res) => {
  const payload = req.validated?.body || req.body;
  const result = await reflectionService.upsertReflection({
    userId: req.user._id,
    payload,
  });

  // Update mission progress for psychology/reflection-based missions
  if (!result.reflection?.skipped) {
    onReflectionSaved(req.user._id, result.reflection).catch(err =>
      logger.warn("MISSION_PROGRESS_REFLECTION_FAILED", { error: err?.message })
    );
  }

  const skipInsight = result.reflection?.skipped || false;
  if (!skipInsight) {
    scheduleInsightGeneration({
      reflection: result.reflection,
      context: result.context,
      day: result.day,
    });
  }

  res.status(201).json({
    reflection: result.reflection,
    context: result.context,
    day: result.day,
    insightPending: !skipInsight,
  });
});

exports.skipReflection = asyncHandler(async (req, res) => {
  const payload = req.validated?.body || req.body || {};
  const result = await reflectionService.skipReflection({
    userId: req.user._id,
    payload,
  });
  res.status(201).json(result);
});

exports.listReflections = asyncHandler(async (req, res) => {
  const days = req.validated?.query?.days ?? req.query?.days;
  const data = await reflectionService.getRecentReflections(req.user._id, days);
  res.json(data);
});

exports.getReflectionSummary = asyncHandler(async (req, res) => {
  const summary = await reflectionService.getSummarySnapshot(req.user._id);
  res.json(summary);
});
