"use strict";

/**
 * Mission Progress Service
 *
 * Updates MissionAssignment.currentProgress whenever a trade is saved,
 * updated, or deleted. Also handles day-based and reflection-based missions.
 *
 * Integration hooks:
 *   - onTradeSaved(userId, trade)
 *   - onTradeDeleted(userId, trade)
 *   - onTradeUpdated(userId, oldTrade, newTrade)
 *   - onReflectionSaved(userId, reflection, tradingDayKey)
 *   - onWeeklyReportSaved(userId, weekKey)
 *   - evaluateDayBasedMissions(userId, dayKey) — called by cron
 */

const MissionAssignment = require("../models/MissionAssignment");
const DailyReflection = require("../models/DailyReflection");
const { completeMission } = require("./missionService");
const { sendMissionNotification } = require("./missionNotificationService");
const { logger } = require("../utils/logger");

// Cap on stored progress events per assignment
const MAX_PROGRESS_EVENTS = 200;

// ─── Optimistic-concurrency retry ────────────────────────────────────────────
// Mongoose's `optimisticConcurrency: true` on the schema throws a VersionError
// when two concurrent saves race on the same document. Rather than merging stale
// state, we reload and re-run the entire mutation function on the fresh document.
const MAX_SAVE_RETRIES = 3;

function isVersionConflict(err) {
  return (
    err.name === "VersionError" ||
    (err.name === "MongoServerError" && err.code === 112)
  );
}

/**
 * Run `mutateFn(assignment)` then save, retrying on VersionError by reloading
 * the document and re-running the mutation from scratch.
 *
 * @param {mongoose.Document} assignment   - Live Mongoose document to mutate
 * @param {Function}          mutateFn     - async (doc) => void; modifies doc in place
 */
async function retryOnConflict(assignment, mutateFn) {
  for (let attempt = 0; attempt < MAX_SAVE_RETRIES; attempt++) {
    try {
      await mutateFn(assignment);
      await assignment.save();
      return;
    } catch (err) {
      if (!isVersionConflict(err) || attempt === MAX_SAVE_RETRIES - 1) throw err;

      logger.debug("[MissionProgress] Version conflict — reloading and retrying", {
        assignmentId: assignment._id,
        attempt: attempt + 1,
      });

      const fresh = await MissionAssignment.findById(assignment._id);
      if (!fresh) return; // deleted mid-flight
      // Replace the local document reference with the fresh one for next loop
      Object.assign(assignment, fresh.toObject());
      assignment.__v = fresh.__v;
    }
  }
}

// ─── Validation functions (per validationType) ────────────────────────────────

/**
 * Returns { passed: boolean, reason: string } for a single trade against
 * a mission's snapshot config.
 */
function validateTradeForMission(trade, snapshot) {
  const { validationType, validationConfig = {} } = snapshot;

  switch (validationType) {
    case "risk_per_trade": {
      const rp = Number(trade.riskPercent);
      const max = validationConfig.riskPercentMax ?? 1.0;
      if (!Number.isFinite(rp) || rp <= 0) return { passed: false, reason: "Risk % not recorded" };
      return rp <= max
        ? { passed: true, reason: `Risk ${rp.toFixed(2)}% ≤ ${max}%` }
        : { passed: false, reason: `Risk ${rp.toFixed(2)}% exceeds ${max}%` };
    }

    case "stop_loss_required": {
      const hasSL = trade.stopLoss && Number(trade.stopLoss) !== 0;
      return hasSL
        ? { passed: true, reason: "Stop loss placed" }
        : { passed: false, reason: "No stop loss" };
    }

    case "risk_reward_minimum": {
      const rr = Number(trade.riskRewardRatio);
      const min = validationConfig.rrMin ?? 1.5;
      if (!Number.isFinite(rr) || rr <= 0) return { passed: false, reason: "R:R not recorded" };
      return rr >= min
        ? { passed: true, reason: `R:R ${rr.toFixed(2)} ≥ ${min}` }
        : { passed: false, reason: `R:R ${rr.toFixed(2)} < ${min}` };
    }

    case "checklist_every_trade": {
      const hasChecklist = Array.isArray(trade.setupRules) && trade.setupRules.length > 0;
      return hasChecklist
        ? { passed: true, reason: "Checklist completed" }
        : { passed: false, reason: "No checklist used" };
    }

    case "lesson_on_loss": {
      const profit = Number(trade.profit);
      if (!Number.isFinite(profit) || profit >= 0) return { passed: null, reason: "Not a losing trade" };
      const hasNotes = trade.notes && String(trade.notes).trim().length > 5;
      return hasNotes
        ? { passed: true, reason: "Lesson note added" }
        : { passed: false, reason: "No lesson note on losing trade" };
    }

    case "psychology_fields_complete": {
      // Mark as pending — validated when reflection is saved
      return { passed: null, reason: "Pending reflection" };
    }

    case "plan_adherence": {
      // Validated via reflection — mark pending
      return { passed: null, reason: "Pending reflection" };
    }

    case "high_confidence_only": {
      // Validated via reflection — mark pending
      return { passed: null, reason: "Pending reflection" };
    }

    default:
      return { passed: null, reason: "Not a trade-level mission" };
  }
}

// ─── Progress writer ──────────────────────────────────────────────────────────

async function pushProgressEvent(assignment, event) {
  const events = assignment.progressEvents || [];
  events.push(event);
  // Evict oldest events beyond cap
  if (events.length > MAX_PROGRESS_EVENTS) {
    events.splice(0, events.length - MAX_PROGRESS_EVENTS);
  }
  assignment.progressEvents = events;
}

async function applyTradeProgress(assignment, trade, validation) {
  const snap = assignment.missionSnapshot;
  const mode = snap.progressMode;
  const target = snap.target;
  const tradeIdStr = String(trade._id);

  // Prevent double-counting
  const alreadyProcessed = assignment.processedTradeIds.some(id => String(id) === tradeIdStr);
  if (alreadyProcessed) return false;

  if (validation.passed === null) return false; // day/reflection-based — skip

  assignment.processedTradeIds.push(trade._id);

  let changed = false;

  if (mode === "consecutive_trades") {
    if (validation.passed) {
      assignment.consecutiveCount += 1;
      assignment.currentProgress = assignment.consecutiveCount;
    } else {
      assignment.consecutiveCount = 0;
      assignment.currentProgress = 0;
    }
    changed = true;
  } else if (mode === "total_trades") {
    if (validation.passed) {
      assignment.currentProgress += 1;
    }
    changed = validation.passed;
  } else if (mode === "percentage") {
    if (validation.passed !== null) {
      assignment.percentDenominator += 1;
      if (validation.passed) assignment.percentNumerator += 1;
      // Progress = trades evaluated so far
      assignment.currentProgress = assignment.percentDenominator;
      changed = true;
    }
  }

  if (changed) {
    await pushProgressEvent(assignment, {
      eventType: validation.passed ? "trade_pass" : "trade_fail",
      referenceId: trade._id,
      delta: validation.passed ? 1 : 0,
      progressAfter: assignment.currentProgress,
      passed: !!validation.passed,
      reason: validation.reason,
    });
  }

  return changed;
}

// ─── Hook: Trade Saved ────────────────────────────────────────────────────────

async function onTradeSaved(userId, trade) {
  if (!userId || !trade) return;

  const activeMissions = await MissionAssignment.find({
    user: userId,
    status: "active",
    "missionSnapshot.progressMode": { $in: ["consecutive_trades", "total_trades", "percentage"] },
  });

  for (const assignment of activeMissions) {
    let completed = false;
    let pctAfter = 0;

    await retryOnConflict(assignment, async (doc) => {
      const snap = doc.missionSnapshot;
      const validation = validateTradeForMission(trade, snap);
      const changed = await applyTradeProgress(doc, trade, validation);
      if (!changed) return;
      pctAfter = Math.round((doc.currentProgress / snap.target) * 100);
      completed = isMissionComplete(doc);
    });

    if (completed) {
      await completeMission(String(userId), String(assignment._id));
      sendMissionNotification(userId, assignment, "completed").catch(() => {});
      logger.info("[Mission] Completed via trade save", { userId, missionId: assignment._id });
    } else if (pctAfter === 50) {
      sendMissionNotification(userId, assignment, "halfway").catch(() => {});
    }
  }
}

// ─── Hook: Trade Deleted ──────────────────────────────────────────────────────

async function onTradeDeleted(userId, trade) {
  if (!userId || !trade) return;

  const tradeIdStr = String(trade._id);

  const affectedMissions = await MissionAssignment.find({
    user: userId,
    status: { $in: ["active", "completed"] },
    processedTradeIds: trade._id,
  });

  for (const assignment of affectedMissions) {
    await retryOnConflict(assignment, async (doc) => {
      const snap = doc.missionSnapshot;
      const mode = snap.progressMode;

      doc.processedTradeIds = doc.processedTradeIds.filter(
        id => String(id) !== tradeIdStr
      );

      const eventIndex = (doc.progressEvents || []).findIndex(
        e => String(e.referenceId) === tradeIdStr
      );
      if (eventIndex === -1) return;

      const [event] = doc.progressEvents.splice(eventIndex, 1);
      const wasPass = !!event.passed;

      if (mode === "consecutive_trades") {
        let streak = 0;
        for (const e of doc.progressEvents) {
          if (["trade_pass", "day_pass", "week_pass"].includes(e.eventType)) streak++;
          else if (["trade_fail", "day_fail"].includes(e.eventType)) streak = 0;
        }
        doc.consecutiveCount = streak;
        doc.currentProgress = streak;
      } else if (mode === "total_trades" && wasPass) {
        doc.currentProgress = Math.max(0, doc.currentProgress - 1);
      } else if (mode === "percentage") {
        doc.percentDenominator = Math.max(0, doc.percentDenominator - 1);
        if (wasPass) doc.percentNumerator = Math.max(0, doc.percentNumerator - 1);
        doc.currentProgress = doc.percentDenominator;
      }

      if (doc.status === "completed" && !isMissionComplete(doc)) {
        doc.status = "active";
        doc.completedAt = null;
        doc.reward = null;
        doc.rewardGrantedAt = null;
      }

      await pushProgressEvent(doc, {
        eventType: "rollback",
        referenceId: trade._id,
        delta: wasPass ? -1 : 0,
        progressAfter: doc.currentProgress,
        passed: false,
        reason: "Trade deleted",
      });
    });

    logger.info("[Mission] Progress rolled back after trade delete", {
      userId, missionId: assignment._id, tradeId: tradeIdStr,
    });
  }
}

// ─── Hook: Trade Updated ──────────────────────────────────────────────────────

async function onTradeUpdated(userId, oldTrade, newTrade) {
  // Delete the old trade's contribution, then re-evaluate with new data
  await onTradeDeleted(userId, oldTrade);
  await onTradeSaved(userId, newTrade);
}

// ─── Hook: Reflection Saved ───────────────────────────────────────────────────

async function onReflectionSaved(userId, reflection) {
  if (!userId || !reflection) return;

  const activeMissions = await MissionAssignment.find({
    user: userId,
    status: "active",
    "missionSnapshot.validationType": { $in: [
      "daily_reflection",
      "plan_adherence",
      "high_confidence_only",
      "calm_mood_percentage",
      "psychology_fields_complete",
    ]},
  });

  const dayKey = reflection.day || reflection.date || new Date().toISOString().slice(0, 10);

  for (const assignment of activeMissions) {
    let completed = false;

    await retryOnConflict(assignment, async (doc) => {
      // Re-check on every retry — a parallel save may have already marked the day
      if (doc.processedDays.includes(dayKey)) return;

      const snap = doc.missionSnapshot;
      const vType = snap.validationType;
      const mode = snap.progressMode;
      let passed = false;
      let reason = "";

      switch (vType) {
        case "daily_reflection":
          passed = true;
          reason = "Daily reflection completed";
          break;
        case "plan_adherence":
          passed = reflection.followedPlan === "yes";
          reason = passed ? "Plan followed" : `Plan not fully followed (${reflection.followedPlan})`;
          break;
        case "high_confidence_only": {
          const min = snap.validationConfig?.confidenceMin ?? 4;
          passed = Number.isFinite(reflection.confidence) && reflection.confidence >= min;
          reason = passed ? `Confidence ${reflection.confidence}/${min}` : `Confidence ${reflection.confidence} < ${min}`;
          break;
        }
        case "calm_mood_percentage": {
          const min = snap.validationConfig?.moodMin ?? 4;
          if (mode === "percentage") {
            doc.percentDenominator += 1;
            const moodPass = Number.isFinite(reflection.mood) && reflection.mood >= min;
            if (moodPass) doc.percentNumerator += 1;
            doc.currentProgress = doc.percentDenominator;
            doc.processedDays.push(dayKey);
            await pushProgressEvent(doc, {
              eventType: "day_pass",
              referenceDate: dayKey,
              delta: 1,
              progressAfter: doc.currentProgress,
              passed: moodPass,
              reason: `Mood ${reflection.mood}/5`,
            });
            completed = isMissionComplete(doc);
            return; // exits the retryOnConflict mutator (save still runs)
          }
          passed = Number.isFinite(reflection.mood) && reflection.mood >= min;
          reason = `Mood ${reflection.mood}/${min}`;
          break;
        }
        case "psychology_fields_complete":
          passed = reflection.mood > 0 && reflection.confidence > 0;
          reason = passed ? "Psychology fields complete" : "Psychology fields incomplete";
          break;
      }

      doc.processedDays.push(dayKey);

      if (mode === "consecutive_days") {
        if (passed) {
          doc.consecutiveCount += 1;
          doc.currentProgress = doc.consecutiveCount;
        } else {
          doc.consecutiveCount = 0;
          doc.currentProgress = 0;
        }
      } else if (mode === "total_days" && passed) {
        doc.currentProgress += 1;
      }

      await pushProgressEvent(doc, {
        eventType: passed ? "day_pass" : "day_fail",
        referenceDate: dayKey,
        delta: passed ? 1 : 0,
        progressAfter: doc.currentProgress,
        passed,
        reason,
      });

      completed = isMissionComplete(doc);
    });

    if (completed) {
      await completeMission(String(userId), String(assignment._id));
      sendMissionNotification(userId, assignment, "completed").catch(() => {});
    }
  }
}

// ─── Hook: Weekly Report Saved ────────────────────────────────────────────────

async function onWeeklyReportSaved(userId, weekKey) {
  if (!userId) return;

  const missions = await MissionAssignment.find({
    user: userId,
    status: "active",
    "missionSnapshot.validationType": "weekly_review_completed",
  });

  for (const assignment of missions) {
    let completed = false;

    await retryOnConflict(assignment, async (doc) => {
      // Re-check on every retry — a parallel save may have already marked the week
      if (doc.processedDays.includes(weekKey)) return;

      const mode = doc.missionSnapshot.progressMode;
      doc.processedDays.push(weekKey);

      if (mode === "consecutive_days") {
        doc.consecutiveCount += 1;
        doc.currentProgress = doc.consecutiveCount;
      } else {
        doc.currentProgress += 1;
      }

      await pushProgressEvent(doc, {
        eventType: "week_pass",
        referenceDate: weekKey,
        delta: 1,
        progressAfter: doc.currentProgress,
        passed: true,
        reason: "Weekly review completed",
      });

      completed = isMissionComplete(doc);
    });

    if (completed) {
      await completeMission(String(userId), String(assignment._id));
      sendMissionNotification(userId, assignment, "completed").catch(() => {});
    }
  }
}

// ─── Day-based evaluation (called by cron for no_revenge_trade, daily_loss_limit, etc.) ──

async function evaluateDayBasedMissions(userId, dayKey, dayData) {
  // dayData: { hasRevengeTrade, hasFomoTrade, dailyPnl, dailyLossLimit, tradeCount }
  if (!userId) return;

  const missions = await MissionAssignment.find({
    user: userId,
    status: "active",
    "missionSnapshot.validationType": { $in: [
      "no_revenge_trade",
      "no_fomo_trade",
      "trade_logged",
      "daily_loss_limit",
    ]},
  });

  for (const assignment of missions) {
    let completed = false;
    let dayPassed = false;

    await retryOnConflict(assignment, async (doc) => {
      // Re-check on every retry — a parallel cron run may have already marked the day
      if (doc.processedDays.includes(dayKey)) return;

      const snap = doc.missionSnapshot;
      const vType = snap.validationType;
      const mode = snap.progressMode;
      let passed = false;
      let reason = "";

      switch (vType) {
        case "no_revenge_trade":
          passed = !dayData.hasRevengeTrade;
          reason = passed ? "No revenge trade today" : "Revenge trade detected";
          break;
        case "no_fomo_trade":
          passed = !dayData.hasFomoTrade;
          reason = passed ? "No FOMO trade today" : "FOMO trade detected";
          break;
        case "trade_logged":
          passed = (dayData.tradeCount || 0) > 0 || dayData.satOut === true;
          reason = passed ? "Trade logged (or sat out)" : "No trade logged today";
          break;
        case "daily_loss_limit": {
          const limit = dayData.dailyLossLimit;
          if (limit == null || dayData.tradeCount === 0) {
            passed = true;
            reason = "No trades — daily limit respected";
          } else {
            passed = (dayData.dailyPnl || 0) >= -(Math.abs(limit));
            reason = passed ? "Daily loss limit respected" : "Daily loss limit exceeded";
          }
          break;
        }
      }

      doc.processedDays.push(dayKey);

      if (mode === "consecutive_days") {
        if (passed) {
          doc.consecutiveCount += 1;
          doc.currentProgress = doc.consecutiveCount;
        } else {
          doc.consecutiveCount = 0;
          doc.currentProgress = 0;
        }
      } else if (mode === "total_days" && passed) {
        doc.currentProgress += 1;
      }

      await pushProgressEvent(doc, {
        eventType: passed ? "day_pass" : "day_fail",
        referenceDate: dayKey,
        delta: passed ? 1 : 0,
        progressAfter: doc.currentProgress,
        passed,
        reason,
      });

      completed = isMissionComplete(doc);
      dayPassed = passed;
    });

    if (completed) {
      await completeMission(String(userId), String(assignment._id));
      sendMissionNotification(userId, assignment, "completed").catch(() => {});
    } else if (!dayPassed) {
      sendMissionNotification(userId, assignment, "streak_broken").catch(() => {});
    }
  }
}

// ─── Completion check ─────────────────────────────────────────────────────────

function isMissionComplete(assignment) {
  const snap = assignment.missionSnapshot;
  if (!snap) return false;
  const mode = snap.progressMode;
  const target = snap.target;

  if (mode === "percentage") {
    const threshold = snap.validationConfig?.moodPercentage ?? 80;
    if (assignment.percentDenominator < target) return false;
    const pct = (assignment.percentNumerator / assignment.percentDenominator) * 100;
    return pct >= threshold;
  }

  return assignment.currentProgress >= target;
}

module.exports = {
  onTradeSaved,
  onTradeDeleted,
  onTradeUpdated,
  onReflectionSaved,
  onWeeklyReportSaved,
  evaluateDayBasedMissions,
  validateTradeForMission,
  isMissionComplete,
};
