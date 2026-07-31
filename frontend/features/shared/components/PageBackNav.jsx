"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/**
 * Back control + page title for detail pages reached from a hub.
 *
 * The app header has no back affordance and Android has no browser chrome, so
 * a module opened from the Intelligence Hub was a dead end — the only way out
 * was the OS gesture, which in the Capacitor shell can drop the user out of the
 * app entirely.
 *
 * `router.back()` is used when there is real history to pop; a cold entry
 * (deep link, push notification, restored session) falls back to `fallbackHref`
 * so the button is never a no-op.
 *
 * @param {string} title         Page title — the app header does not render one.
 * @param {string} [subtitle]    Optional one-line description.
 * @param {string} [fallbackHref] Where to go when there is no history to pop.
 * @param {string} [accent]      Accent colour for the title highlight.
 */
export default function PageBackNav({
  title,
  subtitle,
  fallbackHref = "/intelligence",
  accent = "#0D9E6E",
}) {
  const router = useRouter();

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
      <button
        onClick={goBack}
        aria-label="Go back"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 38, height: 38, borderRadius: 10,
          border: "1px solid #E2E8F0", background: "#FFFFFF",
          cursor: "pointer", flexShrink: 0,
        }}
      >
        <ChevronLeft size={18} color="#64748B" />
      </button>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: "-0.02em", color: "#0F1923" }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontSize: 11, color: "#94A3B8", margin: "3px 0 0", lineHeight: 1.45 }}>
            {subtitle}
          </p>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <button
        onClick={() => router.push(fallbackHref)}
        style={{
          fontSize: 11, fontWeight: 800, color: accent,
          border: `1px solid ${accent}33`, background: `${accent}0D`,
          borderRadius: 8, padding: "7px 12px", cursor: "pointer",
          whiteSpace: "nowrap", flexShrink: 0,
        }}
      >
        Intelligence
      </button>
    </div>
  );
}
