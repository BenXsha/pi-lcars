export type Locale = "en" | "zh";
export type Scale = 0.9 | 1 | 1.1;

export type Settings = {
  scale: Scale;
  motion: "system" | "reduced";
  /** opt-in starship backdrop; default off so the LCARS black stays canonical */
  backdrop: "off" | "on";
  locale: Locale;
};

const KEY = "lcars.settings";

const DEFAULTS: Settings = { scale: 1, motion: "system", backdrop: "off", locale: "en" };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw);
    return {
      scale: p.scale === 0.9 || p.scale === 1.1 ? p.scale : 1,
      motion: p.motion === "reduced" ? "reduced" : "system",
      backdrop: p.backdrop === "on" ? "on" : "off",
      locale: p.locale === "zh" ? "zh" : "en",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let state: Settings = load();
const subs = new Set<() => void>();

export const getSettings = () => state;

/** UI zoom is a real layout scale (zoom, not font-size) so px values stay intact. */
export function applySettings() {
  const root = document.documentElement;
  root.style.setProperty("--ui-scale", String(state.scale));
  root.dataset.motion = state.motion;
  root.dataset.locale = state.locale;
  root.dataset.backdrop = state.backdrop === "on" ? "1" : "0";
}

export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
  applySettings();
  for (const fn of subs) fn();
}

export function subscribeSettings(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function initSettings() {
  applySettings();
  return state;
}
