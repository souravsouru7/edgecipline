"use client";

import { useEffect, useRef } from "react";

/**
 * CandlestickBackground
 * Renders a subtle animated candlestick chart on a canvas as a page background.
 *
 * @param {string} canvasId  optional id for the canvas element (kept for
 *                           callers that style or query it; a ref is used
 *                           internally so ids no longer need to be unique).
 * @param {"fixed"|"absolute"} position  "fixed" covers the viewport (default);
 *                           "absolute" fills the nearest positioned ancestor,
 *                           for pages that place the canvas inside a wrapper.
 */
export default function CandlestickBackground({ canvasId = "bg-canvas", position = "fixed" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // The series is generated once per mount and only extended when the
    // canvas gets wider. Re-rolling it on every resize made the background
    // visibly re-shuffle whenever the Android keyboard opened (a resize
    // event) while the user was typing into a form on top of it.
    const candles = [];
    let price = 200;
    const ensureCandles = (count) => {
      while (candles.length < count) {
        const open = price + (Math.random() - 0.5) * 20;
        const close = open + (Math.random() - 0.5) * 28;
        const high = Math.max(open, close) + Math.random() * 12;
        const low = Math.min(open, close) - Math.random() * 12;
        price = close;
        candles.push({ open, close, high, low });
      }
      return candles.slice(0, count);
    };

    const draw = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const series = ensureCandles(Math.floor(W / 32));
      const candlesForDraw = series;
      const all = candlesForDraw.flatMap(c => [c.high, c.low]);
      const mx = Math.max(...all), mn = Math.min(...all), rng = mx - mn || 1;
      const toY = p => H * 0.1 + (H * 0.8 * (mx - p)) / rng;

      // Subtle grid
      ctx.strokeStyle = "rgba(0,0,0,0.04)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 7; i++) {
        ctx.beginPath(); ctx.moveTo(0, (H / 7) * i); ctx.lineTo(W, (H / 7) * i); ctx.stroke();
      }

      // Candles
      candlesForDraw.forEach((c, i) => {
        const x = i * 32 + 16, bull = c.close >= c.open;
        ctx.strokeStyle = bull ? "rgba(13,158,110,0.22)" : "rgba(214,59,59,0.18)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, toY(c.high)); ctx.lineTo(x, toY(c.low)); ctx.stroke();
        ctx.fillStyle = bull ? "rgba(13,158,110,0.14)" : "rgba(214,59,59,0.11)";
        const bTop = toY(Math.max(c.open, c.close)), bBot = toY(Math.min(c.open, c.close));
        ctx.fillRect(x - 8, bTop, 16, Math.max(bBot - bTop, 1));
      });

      // Moving average line
      const ma = candlesForDraw.map((_, i) => {
        const sl = candlesForDraw.slice(Math.max(0, i - 5), i + 1);
        return sl.reduce((a, c) => a + c.close, 0) / sl.length;
      });
      ctx.strokeStyle = "rgba(184,134,11,0.28)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ma.forEach((p, i) => {
        const x = i * 32 + 16, y = toY(p);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };

    draw();

    // Resize policy: debounced, and only when the box actually changed. The
    // Android keyboard fires a resize (height only) on every open/close; with
    // a stable series that repaint is cheap and flicker-free, and it keeps
    // the bitmap from being squashed to the shorter viewport.
    let lastWidth = canvas.offsetWidth;
    let lastHeight = canvas.offsetHeight;
    let timer = null;
    const onResize = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;
        if (width === lastWidth && height === lastHeight) return;
        lastWidth = width;
        lastHeight = height;
        draw();
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return (
    <canvas
      id={canvasId}
      ref={canvasRef}
      style={{
        position, inset: 0,
        width: "100%", height: "100%",
        opacity: 1, zIndex: 0, pointerEvents: "none",
      }}
    />
  );
}
