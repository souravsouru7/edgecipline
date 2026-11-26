"use client";

import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { success as hapticSuccess } from "@/utils/haptics";
import { registerDismissable } from "@/utils/backNavigation";

// Seeded so server and client agree (no hydration mismatch) — same approach as
// PremiumWelcome. A level-up gets the bigger burst.
function seededParticles(count, seedBase) {
  let seed = seedBase;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const palette = ["#22C78E", "#0D9E6E", "#F5D272", "#E9B44C", "#38BDF8", "#A78BFA"];
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + next() * 0.6;
    const distance = 110 + next() * 170;
    return {
      id: i,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance - 50,
      rotate: next() * 540 - 270,
      size: 5 + next() * 7,
      color: palette[Math.floor(next() * palette.length)],
      delay: next() * 0.2,
      round: next() > 0.5,
    };
  });
}

const EMOJI_BY_KIND = { level_up: null, unlock: "🧠", win: "🏅" };
const LEVEL_EMOJI = { 1: "🌱", 2: "👀", 3: "🧊", 4: "🔥", 5: "🧘", 6: "👑" };

/**
 * One celebration at a time. `item` = { id, kind, level, title, body }.
 * The host advances the queue on close.
 */
export default function MindCelebration({ item, onClose, remaining = 0 }) {
  const reduceMotion = useReducedMotion();
  const isLevel = item?.kind === "level_up";
  const particles = useMemo(
    () => (item && !reduceMotion ? seededParticles(isLevel ? 36 : 22, 7 + (item.level || 1)) : []),
    [item, reduceMotion, isLevel]
  );
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!item) return undefined;
    void hapticSuccess();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const unregister = registerDismissable(onClose);
    const t = setTimeout(() => buttonRef.current?.focus(), 50);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (typeof unregister === "function") unregister();
      clearTimeout(t);
    };
  }, [item, onClose]);

  const emoji = item ? (isLevel ? LEVEL_EMOJI[item.level] || "🎉" : EMOJI_BY_KIND[item.kind] || "🎉") : null;

  return (
    <AnimatePresence>
      {item && (
        <motion.div
          key={item.id}
          className="ec-mind-celebrate"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mind-celebrate-title"
          aria-describedby="mind-celebrate-body"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <div className="ec-mind-celebrate__burst" aria-hidden="true">
            {particles.map((p) => (
              <motion.span
                key={p.id}
                initial={{ x: 0, y: 0, opacity: 0, scale: 0.4, rotate: 0 }}
                animate={{ x: p.x, y: p.y, opacity: [0, 1, 1, 0], scale: 1, rotate: p.rotate }}
                transition={{ duration: 1.5, delay: 0.1 + p.delay, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  position: "absolute", width: p.size, height: p.size * (p.round ? 1 : 0.5),
                  borderRadius: p.round ? "50%" : 2, background: p.color,
                }}
              />
            ))}
          </div>

          <motion.div
            className={`ec-mind-celebrate__card${isLevel ? " is-level" : ""}`}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.94 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
          >
            <motion.div
              className="ec-mind-celebrate__emoji"
              aria-hidden="true"
              initial={reduceMotion ? false : { scale: 0.3, rotate: -20 }}
              animate={reduceMotion ? undefined : { scale: [0.3, 1.2, 1], rotate: [-20, 8, 0] }}
              transition={{ duration: 0.7, delay: 0.1 }}
            >
              {emoji}
            </motion.div>
            <p className="ec-mind-celebrate__eyebrow">
              {isLevel ? "Level up" : item.kind === "unlock" ? "Unlocked" : "Mind Win"}
            </p>
            <h2 id="mind-celebrate-title" className="ec-mind-celebrate__title">{item.title}</h2>
            <p id="mind-celebrate-body" className="ec-mind-celebrate__body">{item.body}</p>
            {item.kind === "unlock" && (
              // One-time intro: this popup shows once, when the score first unlocks.
              <ul className="ec-mind-celebrate__intro">
                <li><span aria-hidden="true">🧠</span> It measures how calm and disciplined you trade, not your profit.</li>
                <li><span aria-hidden="true">📅</span> It updates each day you journal. Breaks never lower it.</li>
                <li><span aria-hidden="true">ⓘ</span> Tap the ⓘ next to Mind Score anytime to see how it works.</li>
              </ul>
            )}
            <button ref={buttonRef} type="button" className="ec-btn ec-btn--primary ec-mind-celebrate__cta ec-focusable" onClick={onClose}>
              {remaining > 0 ? "Nice! Next 🔥" : "Let's go 🔥"}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
