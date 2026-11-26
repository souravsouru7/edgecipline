"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { getMindMicro, markMindWinsSeen } from "@/features/mind-progress/api/mindProgressApi";
import { MIND_KEY } from "@/features/mind-progress/hooks/useMindProgress";
import { enqueueCelebrations, subscribeCelebrations, subscribeJournalSaved } from "@/features/mind-progress/rewardBus";
import { DeltaChip, ReasonList, UnlockDots } from "@/features/mind-progress/components/MindBits";
import MindCelebration from "@/features/mind-progress/components/MindCelebration";

// Save screens redirect ~1–1.2s after success; wait for that so the sheet
// lands on the next screen instead of flashing on the one being left.
const SETTLE_MS = 1500;
const SHEET_MS = 4500;
const MODAL_WAIT_MAX_MS = 20000;

function anotherModalOpen() {
  return Boolean(document.querySelector('[aria-modal="true"]:not(.ec-mind-celebrate)'));
}

/**
 * Mounted once (app/providers). Two jobs:
 *  1. After any journal save: fetch the instant reward and show a short,
 *     non-blocking sheet ("Mind Score 64 → 66 ▲ +2 — calm after your loss").
 *  2. Own the one celebration queue (level-ups, Mind Wins), deduped by id,
 *     and mark them seen in one call when the queue drains.
 */
export default function MindRewardHost() {
  const qc = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [micro, setMicro] = useState(null);
  const [queue, setQueue] = useState([]);
  const shownIds = useRef(new Set());
  const seenBatch = useRef([]);
  const settleTimer = useRef(null);
  const hideTimer = useRef(null);
  const inFlight = useRef(null);

  const flushSeen = useCallback(() => {
    const ids = seenBatch.current.splice(0);
    if (!ids.length) return;
    markMindWinsSeen(ids)
      .catch(() => {}) // worst case it shows again next visit
      .finally(() => qc.invalidateQueries({ queryKey: MIND_KEY }));
  }, [qc]);

  // ── Celebration queue
  useEffect(() => subscribeCelebrations((list) => {
    const fresh = list.filter((c) => c?.id && !shownIds.current.has(c.id));
    if (!fresh.length) return;
    fresh.forEach((c) => shownIds.current.add(c.id));
    setQueue((q) => [...q, ...fresh]);
  }), []);

  const closeCelebration = useCallback(() => {
    setQueue((q) => {
      const [done, ...rest] = q;
      if (done) seenBatch.current.push(done.id);
      if (!rest.length) setTimeout(flushSeen, 0);
      return rest;
    });
  }, [flushSeen]);

  // ── Instant reward after a save
  const runMicro = useCallback(async () => {
    const started = Date.now();
    while (anotherModalOpen() && Date.now() - started < MODAL_WAIT_MAX_MS) {
      // e.g. the "last free trade" sheet: wait for it, don't stack on it
      await new Promise((r) => setTimeout(r, 1000));
    }
    inFlight.current?.abort?.();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    inFlight.current = controller;
    const result = await getMindMicro(controller?.signal);
    if (controller && controller.signal.aborted) return;
    qc.invalidateQueries({ queryKey: MIND_KEY });
    if (!result) return; // couldn't compute in budget: the save toast already said "saved"
    setMicro(result);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setMicro(null), SHEET_MS);
    if (result.celebrations?.length) {
      // Let the sheet register first; the celebration follows it.
      setTimeout(() => enqueueCelebrations(result.celebrations), 900);
    }
  }, [qc]);

  useEffect(() => subscribeJournalSaved(() => {
    // A batch of saves (multi-trade review, bulk import) → one reward.
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => { void runMicro(); }, SETTLE_MS);
  }), [runMicro]);

  useEffect(() => () => {
    clearTimeout(settleTimer.current);
    clearTimeout(hideTimer.current);
    inFlight.current?.abort?.();
  }, []);

  const current = queue[0] || null;

  return (
    <>
      <AnimatePresence>
        {micro && !current && (
          <motion.div
            className="ec-mind-micro"
            role="status"
            aria-live="polite"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={() => setMicro(null)}
          >
            {micro.status === "locked" ? (
              <>
                <div className="ec-mind-micro__row">
                  <span className="ec-mind-micro__title">🧠 Mind Score</span>
                  <UnlockDots have={micro.journaledDays} need={micro.unlockDays} />
                </div>
                <p className="ec-mind-micro__line">{micro.line}</p>
              </>
            ) : (
              <>
                <div className="ec-mind-micro__row">
                  <span className="ec-mind-micro__title">
                    🧠 Mind Score {micro.delta !== 0 && <span className="ec-mind-micro__from">{micro.before} →</span>} <strong>{micro.score}</strong>
                  </span>
                  <DeltaChip delta={micro.delta} size="sm" />
                </div>
                <p className="ec-mind-micro__line">{micro.line}</p>
                {micro.reasons?.length > 1 && <ReasonList reasons={micro.reasons.slice(0, 2)} />}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <MindCelebration item={current} remaining={Math.max(0, queue.length - 1)} onClose={closeCelebration} />
    </>
  );
}
