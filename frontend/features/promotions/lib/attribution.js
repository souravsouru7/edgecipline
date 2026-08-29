const AID_KEY = "ec_aid";

export function getAttributionId() {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(AID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(AID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function captureLandingParams() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref") || "";
  const utmSource = params.get("utm_source") || "";
  const utmMedium = params.get("utm_medium") || "";
  const utmCampaign = params.get("utm_campaign") || "";
  if (!ref && !utmSource && !utmCampaign) return null;
  return { ref, utmSource, utmMedium, utmCampaign, landingPath: window.location.pathname };
}
