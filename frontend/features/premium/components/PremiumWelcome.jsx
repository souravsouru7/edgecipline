"use client";

import { useEffect, useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Crown, Check } from "lucide-react";

// Shown once, immediately after a payment is verified. This is the only moment
// the app gets to make the purchase feel like it landed, so it is deliberately
// louder than anything else in the product.
//
// Particle positions are computed with a seeded generator rather than
// Math.random() so the server and client render the same markup — random
// values here produce a hydration mismatch and React discards the tree.
function seededParticles(count) {
  let seed = 1337;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const palette = ["#0D9E6E", "#22C78E", "#B8860B", "#F5D272", "#7C3AED", "#38BDF8"];
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + next() * 0.5;
    const distance = 120 + next() * 190;
    return {
      id: i,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance - 40,   // bias upward so it reads as a burst
      rotate: next() * 720 - 360,
      size: 6 + next() * 8,
      color: palette[Math.floor(next() * palette.length)],
      delay: next() * 0.22,
      round: next() > 0.5,
    };
  });
}

const PERKS = [
  "Unlimited trade logging on both markets",
  "Full analytics, psychology and Trading DNA",
  "AI coach with your complete history",
];

export default function PremiumWelcome({ open, onClose, planLabel = "Premium", expiresAt = null }) {
  const reduceMotion = useReducedMotion();
  const particles = useMemo(() => seededParticles(reduceMotion ? 0 : 34), [reduceMotion]);

  // Escape closes, matching every other modal in the app.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="premium-welcome-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          style={{
            position: "fixed", inset: 0, zIndex: 1100,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
            background: "rgba(6,12,18,0.72)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          {/* Burst — sits behind the card, anchored to its centre. */}
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
            {particles.map((p) => (
              <motion.span
                key={p.id}
                initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
                animate={{ opacity: [0, 1, 1, 0], x: p.x, y: [0, p.y, p.y + 220], scale: [0, 1, 1, 0.6], rotate: p.rotate }}
                transition={{ duration: 2.1, delay: p.delay, ease: [0.2, 0.7, 0.3, 1] }}
                style={{
                  position: "absolute", left: "50%", top: "50%",
                  width: p.size, height: p.size,
                  borderRadius: p.round ? "50%" : 2,
                  background: p.color,
                }}
              />
            ))}
          </div>

          <motion.div
            onClick={(event) => event.stopPropagation()}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.86, y: 24 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 12 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            style={{
              position: "relative",
              width: "100%", maxWidth: 440,
              borderRadius: 26,
              padding: "38px 30px 28px",
              textAlign: "center",
              color: "#F8FAFC",
              background: "linear-gradient(160deg,#0F1923 0%,#12232F 55%,#0C1A18 100%)",
              border: "1px solid rgba(34,199,142,0.35)",
              boxShadow: "0 40px 120px -24px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04) inset",
              overflow: "hidden",
              fontFamily: "'Plus Jakarta Sans',sans-serif",
            }}
          >
            {/* Slow breathing glow behind the crown. */}
            {!reduceMotion && (
              <motion.div
                aria-hidden="true"
                animate={{ opacity: [0.35, 0.6, 0.35], scale: [1, 1.14, 1] }}
                transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  position: "absolute", top: -110, left: "50%", marginLeft: -150,
                  width: 300, height: 300, borderRadius: "50%",
                  background: "radial-gradient(circle,rgba(34,199,142,0.5) 0%,rgba(34,199,142,0) 70%)",
                  pointerEvents: "none",
                }}
              />
            )}

            <motion.div
              initial={reduceMotion ? {} : { scale: 0, rotate: -35 }}
              animate={reduceMotion ? {} : { scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 12, delay: 0.12 }}
              style={{
                position: "relative",
                width: 76, height: 76, margin: "0 auto 18px",
                borderRadius: 22,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "linear-gradient(145deg,#22C78E,#0D9E6E)",
                boxShadow: "0 16px 40px -12px rgba(34,199,142,0.7)",
              }}
            >
              <Crown size={36} color="#06231A" strokeWidth={2.4} />
            </motion.div>

            <motion.p
              initial={reduceMotion ? {} : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28 }}
              style={{
                margin: "0 0 8px", fontSize: 11, fontWeight: 800, letterSpacing: "0.16em",
                color: "#22C78E", textTransform: "uppercase",
              }}
            >
              You&apos;re in
            </motion.p>

            <motion.h2
              id="premium-welcome-title"
              initial={reduceMotion ? {} : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.34 }}
              style={{ margin: "0 0 10px", fontSize: 27, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15 }}
            >
              Welcome to {planLabel}
            </motion.h2>

            <motion.p
              initial={reduceMotion ? {} : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              style={{ margin: "0 0 22px", fontSize: 13.5, lineHeight: 1.6, color: "#94A3B8" }}
            >
              Every limit is lifted. Your journal, your analytics and your coach are
              now working with the full picture.
            </motion.p>

            <div style={{ textAlign: "left", margin: "0 0 24px", display: "flex", flexDirection: "column", gap: 10 }}>
              {PERKS.map((perk, index) => (
                <motion.div
                  key={perk}
                  initial={reduceMotion ? {} : { opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.48 + index * 0.09 }}
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <span style={{
                    width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                    background: "rgba(34,199,142,0.16)", color: "#22C78E",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Check size={12} strokeWidth={3.2} />
                  </span>
                  <span style={{ fontSize: 13, color: "#CBD5E1", lineHeight: 1.45 }}>{perk}</span>
                </motion.div>
              ))}
            </div>

            {expiryLabel && (
              <motion.p
                initial={reduceMotion ? {} : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                style={{ margin: "0 0 16px", fontSize: 11.5, color: "#64748B", fontFamily: "'JetBrains Mono',monospace" }}
              >
                Active until {expiryLabel}
              </motion.p>
            )}

            <motion.button
              type="button"
              onClick={onClose}
              initial={reduceMotion ? {} : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.86 }}
              whileHover={reduceMotion ? {} : { scale: 1.02 }}
              whileTap={reduceMotion ? {} : { scale: 0.98 }}
              style={{
                width: "100%", padding: 15, border: "none", borderRadius: 14,
                background: "linear-gradient(135deg,#22C78E,#0D9E6E)",
                color: "#06231A", fontSize: 14.5, fontWeight: 800,
                cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.01em",
              }}
            >
              Start trading
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
