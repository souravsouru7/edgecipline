"use client";

import { usePlayBillingReconcile } from "@/features/premium/hooks/usePlayBillingReconcile";

// Mounted once, inside the authenticated app shell.
//
// Its whole job is to close the window between "Google took the money" and
// "our backend knows about it" — on every launch and every resume it asks Play
// what purchases this device holds and has the backend re-verify them.
//
// This is what makes the failure modes in Phase 18 recoverable without the
// user doing anything: a dropped network after payment, the app being killed
// mid-purchase, a backend blip, a reinstall, a new phone, cleared app data, or
// signing back in. It renders nothing and never surfaces an error — a user
// with no purchase to restore must not see anything at all.
//
// No-ops instantly on web and on non-Android natives.
export default function PlayBillingBootstrap() {
  usePlayBillingReconcile();
  return null;
}
