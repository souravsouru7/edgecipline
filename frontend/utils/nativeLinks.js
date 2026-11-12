"use client";

// Links that would leave the app inside the Android/iOS shell.
//
// In the Capacitor WebView a target="_blank" link either does nothing or
// replaces the app with a browser page, and there is no way back. On native,
// this opens them in the in-app browser (Chrome Custom Tab / Safari View
// Controller), which the user closes to return exactly where they were.
//
// - External http(s) links (WhatsApp, attachment downloads…) open as-is.
// - The app's own pages opened "in a new tab" (Terms/Privacy from sign-up)
//   open from the public website, so a half-filled form isn't thrown away.
// - mailto:/tel: and same-tab internal links are left alone.

// Public copy of the app's own pages, for opening them beside the app.
export const PUBLIC_SITE_ORIGIN = "https://edgecipline.com";

function isNative() {
  return typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
}

export async function openExternal(url) {
  if (!url) return;
  if (!isNative()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url, presentationStyle: "popover" });
  } catch {
    window.location.href = url;
  }
}

let installed = false;

/** Call once at start-up. No-op on the web. */
export function initNativeLinks() {
  if (installed || !isNative()) return;
  installed = true;
  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const anchor = event.target?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (/^(mailto|tel|sms):/i.test(href) || href.startsWith("#")) return;

      let url;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      const sameOrigin = url.origin === window.location.origin;
      const newTab = anchor.getAttribute("target") === "_blank";

      if (sameOrigin && !newTab) return; // normal in-app navigation
      if (!/^https?:$/.test(url.protocol) && !sameOrigin) return;

      event.preventDefault();
      const target = sameOrigin ? `${PUBLIC_SITE_ORIGIN}${url.pathname}${url.search}${url.hash}` : url.href;
      void openExternal(target);
    },
    true,
  );
}
