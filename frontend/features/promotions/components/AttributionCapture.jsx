"use client";

import { useEffect } from "react";
import { recordPromoTouch } from "@/services/api";
import { captureLandingParams, getAttributionId } from "../lib/attribution";

export default function AttributionCapture() {
  useEffect(() => {
    const payload = captureLandingParams();
    if (!payload) return;
    const anonymousId = getAttributionId();
    recordPromoTouch({ anonymousId, ...payload });
  }, []);

  return null;
}
