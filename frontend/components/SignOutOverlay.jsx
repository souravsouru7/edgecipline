"use client";

import { useEffect, useState } from "react";
import BrandOpener, { OPENER_EXIT_MS } from "@/components/BrandOpener";
import { useSignOutOverlay } from "@/features/auth/signOutOverlay";

// Full-screen brand transition while signing out. Same look as the launch
// opener, so leaving the app mirrors entering it.
export default function SignOutOverlay() {
  const active = useSignOutOverlay();
  // Stays true through the exit crossfade after `active` turns off.
  const [shown, setShown] = useState(false);
  if (active && !shown) setShown(true);
  const exiting = shown && !active;

  useEffect(() => {
    if (!exiting) return undefined;
    const t = setTimeout(() => setShown(false), OPENER_EXIT_MS);
    return () => clearTimeout(t);
  }, [exiting]);

  if (!shown) return null;
  return (
    <div className="signout-overlay">
      <style>{`
        .signout-overlay { animation: signoutIn 180ms ease-out both; }
        @keyframes signoutIn { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .signout-overlay { animation: none; } }
      `}</style>
      <BrandOpener exiting={exiting} label="Signing you out" />
    </div>
  );
}
