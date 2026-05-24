const DEFAULT_REMOTE_API_BASE_URL = "https://api.stratedge.live";
const isCapacitorRuntime = () => {
  return typeof window !== "undefined" && !!window.Capacitor;
};

const isLocalhostUrl = (value) => {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value);
};

function normalizeApiBaseUrl(value) {
  const raw = String(value || "").trim();
  

  if (!raw) {
    return DEFAULT_REMOTE_API_BASE_URL;
  }

  const cleaned = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  const hasScheme = raw.startsWith("http://") || raw.startsWith("https://");
  const isExplicitLocalhost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleaned);


  const normalized = hasScheme
    ? raw.replace(/\/+$/, "")
    : `${isExplicitLocalhost ? "http" : "https"}://${cleaned}`;

  // Guard against env vars that include the /api suffix.
  const withoutApiSuffix = normalized.replace(/\/api$/i, "");

  if (isCapacitorRuntime() && isLocalhostUrl(withoutApiSuffix)) {
    return DEFAULT_REMOTE_API_BASE_URL;
  }

  return withoutApiSuffix;
}

export const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);
export const API_URL = `${API_BASE_URL}/api`;
