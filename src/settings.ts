export type Locale = "en" | "zh";
export type Scale = 0.9 | 1 | 1.1;

export type Settings = {
  scale: Scale;
  motion: "system" | "reduced";
  /**
   * Absolute path of the operator's own backdrop image; "" means no backdrop,
   * which is the canonical LCARS black. Stills are read in place by the server
   * (`/api/backdrop/file`), never copied into the project — nothing is bundled.
   */
  backdrop: string;
  locale: Locale;
};

const KEY = "lcars.settings";

const DEFAULTS: Settings = { scale: 1, motion: "system", backdrop: "", locale: "en" };

/** Absolute on both POSIX and Windows; anything else is not a local still. */
const isLocalPath = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && (v.startsWith("/") || /^[A-Za-z]:[\\/]/.test(v) || v.startsWith("\\\\"));

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw);
    return {
      scale: p.scale === 0.9 || p.scale === 1.1 ? p.scale : 1,
      motion: p.motion === "reduced" ? "reduced" : "system",
      // legacy `"on"` pointed at the bundled ship still, which no longer ships
      backdrop: isLocalPath(p.backdrop) ? p.backdrop : "",
      locale: p.locale === "zh" ? "zh" : "en",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let state: Settings = load();
const subs = new Set<() => void>();

export const getSettings = () => state;

/** Cache-bust on demand: the still keeps its bytes, only the URL changes. */
let stamp = 0;
export const touchBackdrop = () => {
  stamp = Date.now();
  applySettings();
};

const backdropUrl = (path: string) =>
  `/api/backdrop/file?path=${encodeURIComponent(path)}${stamp ? `&v=${stamp}` : ""}`;

/** UI zoom is a real layout scale (zoom, not font-size) so px values stay intact. */
function applySettings() {
  const root = document.documentElement;
  root.style.setProperty("--ui-scale", String(state.scale));
  root.dataset.motion = state.motion;
  root.dataset.locale = state.locale;
  root.dataset.backdrop = state.backdrop ? "1" : "0";
  // the URL is fully percent-encoded, so it is safe inside a quoted css url()
  if (state.backdrop) root.style.setProperty("--backdrop-image", `url("${backdropUrl(state.backdrop)}")`);
  else root.style.removeProperty("--backdrop-image");
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
