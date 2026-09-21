"use client";

import { useSyncExternalStore } from "react";

/**
 * The market switch as one choreographed interaction.
 *
 * MarketContext owns *which* market is active (the route decides, see
 * MarketSync). This module owns the few hundred milliseconds *between* the tap
 * and the route settling, so the switcher pill, the dashboard content and the
 * URL update read as a single gesture instead of three unrelated changes:
 *
 *   tap → "out"    the pill glides immediately, market content fades out
 *       → "commit" the URL flips (in place on the dashboard, router.push
 *                  elsewhere); content stays hidden for the frame it re-renders
 *       → "in"     the route reflects the new market, content fades back in
 *       → "idle"
 *
 * It is a module-level store rather than context state so the desktop header
 * and the mobile drawer switcher share one sequence, and so a burst of rapid
 * taps is serialised here: every request supersedes the previous one and the
 * last tap always wins.
 */

export const MARKET_SWITCH_TIMING = Object.freeze({
  pill: 200,   // active pill glide
  out: 120,    // content fade-out before the URL changes
  in: 180,     // content fade-in once the new market is on screen
  settle: 8000 // failsafe: never leave the store mid-transition
});

const IDLE = Object.freeze({ phase: "idle", target: null, fromPath: null, commitPath: null });

let state = IDLE;
let seq = 0;
let timer = null;
const listeners = new Set();

function emit(next) {
  state = next;
  for (const listener of listeners) listener();
}

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;
const getServerSnapshot = () => IDLE;

export function useMarketTransition() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function getMarketTransition() {
  return state;
}

export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Start (or redirect) a switch. `commit` performs the actual URL/state change
 * and runs once, after the out phase, unless a newer request replaced this one.
 *
 * Returns false when nothing needed to happen (already heading there).
 */
export function requestMarketSwitch({ target, routeMarket, fromPath, commit }) {
  const selected = state.phase === "idle" ? routeMarket : state.target;
  if (target === selected) return false;

  clearTimer();
  const mySeq = ++seq;

  // Tapped back to the market the route is still on before the switch
  // committed: nothing to commit, just let the content fade back in.
  if (state.phase === "out" && target === routeMarket) {
    emit(IDLE);
    return true;
  }

  emit({ phase: "out", target, fromPath, commitPath: null });

  const run = () => {
    if (mySeq !== seq) return;
    const commitPath = commit();
    if (commitPath === false) {
      emit(IDLE);
      return;
    }
    emit({ phase: "commit", target, fromPath, commitPath });
    timer = setTimeout(() => {
      if (mySeq === seq) emit(IDLE);
    }, MARKET_SWITCH_TIMING.settle);
  };

  if (prefersReducedMotion()) run();
  else timer = setTimeout(run, MARKET_SWITCH_TIMING.out);
  return true;
}

/**
 * Called by the switcher once the route reflects the committed target. Moves
 * to "in" (content animates back) and then to idle.
 */
export function settleMarketSwitch() {
  if (state.phase !== "commit") return;
  clearTimer();
  const mySeq = seq;
  emit({ ...state, phase: "in" });
  timer = setTimeout(() => {
    if (mySeq === seq) emit(IDLE);
  }, prefersReducedMotion() ? 0 : MARKET_SWITCH_TIMING.in);
}

/** Abandon an in-flight switch (e.g. the user navigated elsewhere). */
export function cancelMarketSwitch() {
  if (state.phase === "idle") return;
  clearTimer();
  seq += 1;
  emit(IDLE);
}
