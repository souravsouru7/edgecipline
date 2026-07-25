export function hideNativeSplash({ fadeOutDuration = 220, retries = 4 } = {}) {
  if (typeof window === "undefined") return;

  const hide = (attempt = 0) => {
    const splash = window.Capacitor?.Plugins?.SplashScreen;
    if (!splash?.hide) {
      if (attempt < retries) {
        window.setTimeout(() => hide(attempt + 1), 120);
      }
      return;
    }

    Promise.resolve(splash.hide({ fadeOutDuration })).catch(() => {
      if (attempt < retries) {
        window.setTimeout(() => hide(attempt + 1), 120);
      }
    });
  };

  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => hide()));
    return;
  }

  window.setTimeout(() => hide(), 0);
}
