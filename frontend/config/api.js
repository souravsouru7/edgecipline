import { validateEnvironment } from "./environment";

let environment;
try {
  environment = validateEnvironment();
} catch {
  // EnvironmentGuard renders the actionable startup error. Empty URLs ensure
  // no request can escape before that guard takes over.
  environment = { apiBaseUrl: "", apiUrl: "" };
}

export const API_BASE_URL = environment.apiBaseUrl;
export const API_URL = environment.apiUrl;
