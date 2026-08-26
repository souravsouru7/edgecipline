"use client";

import { useState, useEffect } from "react";

const formatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const subscribers = new Set();
let currentTime = "";
let intervalId = null;

function tick() {
  currentTime = formatter.format(new Date());
  subscribers.forEach((fn) => fn(currentTime));
}

function ensureInterval() {
  if (intervalId !== null || typeof window === "undefined") return;
  tick();
  intervalId = setInterval(tick, 1000);
}

function teardownIfEmpty() {
  if (subscribers.size === 0 && intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * useClock
 * Returns a live-updating time string (HH:MM:SS, 24-hour format).
 * Backed by a single shared interval — all consumers share one tick/sec.
 */
export function useClock() {
  const [time, setTime] = useState(currentTime);

  useEffect(() => {
    subscribers.add(setTime);
    ensureInterval();
    const id = requestAnimationFrame(() => {
      if (currentTime) setTime(currentTime);
    });
    return () => {
      cancelAnimationFrame(id);
      subscribers.delete(setTime);
      teardownIfEmpty();
    };
  }, []);

  return time;
}
