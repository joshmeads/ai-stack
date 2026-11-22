import { useSyncExternalStore } from "react";

// The studio's two themes, light and dark (Inspector.module.css holds their values). The first time, the theme is
// the computer's (prefers-color-scheme); once the person picks one, that choice is kept for the site's address, on
// the site's own page and in the editor alike. It is set on <html data-studio-theme>, which only the studio's own
// styles read: the site's look never changes with it.

export type Theme = "light" | "dark";
const KEY = "uberdesigner-studio-theme";
const EVENT = "uberdesigner-studio-theme";

function stored(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return stored() ?? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
}

export function applyTheme(theme: Theme = currentTheme()) {
  document.documentElement.dataset.studioTheme = theme;
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private window: it holds for this page only */
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (fn: () => void) => {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    applyTheme(); // picked in another tab of the same site (the editor and the site's own page)
    fn();
  };
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", onStorage);
  };
};

export const useTheme = (): Theme => useSyncExternalStore(subscribe, currentTheme);
