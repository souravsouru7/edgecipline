"use client";

// Keyboard handling for the Capacitor shell.
//
// The activity is `adjustResize` and @capacitor/keyboard is configured with
// resize: "body", so the WebView viewport shrinks when the keyboard opens.
// What Android does NOT do reliably is scroll the focused field above the
// keyboard when it sits in a long form. We do it here, once, for every input:
// on keyboardDidShow, bring the active element into view with a small
// margin so the label above it stays visible too.
//
// A `data-keyboard-open` attribute on <html> lets CSS react (the bottom nav
// hides so it never covers the field on short screens).

let wired = false;

function scrollActiveIntoView() {
  const el = document.activeElement;
  if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  if (el.type === "checkbox" || el.type === "radio" || el.type === "range") return;
  // Two frames: the viewport resize has to land before we measure.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth", inline: "nearest" });
    } catch {
      el.scrollIntoView(true);
    }
  }));
}

export async function initKeyboardBehaviour() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const root = document.documentElement;

  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  if (!isNative) {
    // Web/PWA: a visualViewport shrink is the keyboard signal.
    const vv = window.visualViewport;
    if (!vv) return;
    vv.addEventListener("resize", () => {
      const open = vv.height < window.innerHeight - 120;
      root.toggleAttribute("data-keyboard-open", open);
      if (open) scrollActiveIntoView();
    });
    return;
  }

  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    await Keyboard.addListener("keyboardDidShow", () => {
      root.setAttribute("data-keyboard-open", "");
      scrollActiveIntoView();
    });
    await Keyboard.addListener("keyboardDidHide", () => {
      root.removeAttribute("data-keyboard-open");
    });
  } catch {
    // Plugin unavailable — adjustResize alone still keeps inputs reachable.
  }
}
