// Server-safe theme constants (no React). app/layout.tsx inlines
// THEME_BOOT_SCRIPT so the saved appearance applies before first paint;
// utils/theme.js handles reading/changing it on the client.
//
// Preference ("dark" | "light" | "system") is what the user picked and what
// is stored. The resolved theme ("dark" | "light") is what is painted:
//   <html data-theme="<resolved>" data-theme-pref="<preference>">

export const THEMES = ["dark", "light"];
export const THEME_PREFERENCES = ["dark", "light", "system"];
export const DEFAULT_THEME = "dark";
export const THEME_STORAGE_KEY = "ec-theme";

// Kept in sync with --ec-bg in app/design-system.css.
export const THEME_SURFACE = { dark: "#0A0D12", light: "#F7F7F5" };

export function normalizePreference(pref) {
  return THEME_PREFERENCES.includes(pref) ? pref : DEFAULT_THEME;
}

export function resolveTheme(pref, prefersLight = false) {
  const p = normalizePreference(pref);
  if (p === "system") return prefersLight ? "light" : "dark";
  return p;
}

export const THEME_BOOT_SCRIPT = `(function(){var d=document.documentElement,p="${DEFAULT_THEME}";try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");if(s==="dark"||s==="light"||s==="system")p=s}catch(e){}var r=p;if(p==="system"){try{r=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}catch(e){r="dark"}}d.dataset.theme=r;d.dataset.themePref=p;try{var bg=r==="light"?"${THEME_SURFACE.light}":"${THEME_SURFACE.dark}";d.style.background=bg;d.style.colorScheme=r;var ms=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<ms.length;i++){ms[i].setAttribute("content",bg);ms[i].removeAttribute("media")}}catch(e){}})();`;
