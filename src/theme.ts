export type ThemeId = "tng" | "voy" | "ds9" | "kelvin" | "picard" | "hull" | "mono";

export type ThemeMeta = {
  id: ThemeId;
  name: string;
  short: string;
  note: string;
  /** 4 representative swatches for the picker */
  swatch: [string, string, string, string];
};

/** Keep in sync with src/styles/themes.css */
export const THEMES: ThemeMeta[] = [
  {
    id: "tng",
    name: "TNG / OKUDA",
    short: "TNG",
    note: "31° 暖橙，原版调色板",
    swatch: ["#ff9c00", "#ffce9c", "#9999ff", "#99cccc"],
  },
  {
    id: "voy",
    name: "VOYAGER",
    short: "VOY",
    note: "210° 冷色，紫蓝焦点",
    swatch: ["#8fa9ff", "#9fd3ff", "#8fe0d0", "#e07e7e"],
  },
  {
    id: "ds9",
    name: "DEEP SPACE 9",
    short: "DS9",
    note: "30° 青铜，低明度",
    swatch: ["#e8a33d", "#c2c08a", "#a9a0c9", "#9fc2b8"],
  },
  {
    id: "kelvin",
    name: "KELVIN / FILMS",
    short: "KELVIN",
    note: "2013 · 2016 两部电影：冰白文字 + 琥珀高光，钢蓝底",
    swatch: ["#ffb25a", "#a9d4ff", "#8fb6e8", "#7fd9d2"],
  },
  {
    id: "picard",
    name: "PICARD / 25TH",
    short: "PICARD",
    note: "S3 复兴版 LCARS：石板底 + 亮青焦点 + 珊瑚告警",
    swatch: ["#41c4f7", "#d2d5df", "#8a93ad", "#ff6753"],
  },
  {
    id: "hull",
    name: "HULL / STILL",
    short: "HULL",
    note: "取自舰体静帧：钢蓝外壳 + 引擎铜光 + 冰白高光",
    swatch: ["#d28b74", "#9fc3d6", "#6e93bd", "#6fbdb8"],
  },
  {
    id: "mono",
    name: "LCARS 47 / MONO",
    short: "MONO",
    note: "去饱和中性 + 单一冰蓝",
    swatch: ["#e8e8e8", "#c8d8e8", "#a8a8d8", "#a8c8c8"],
  },
];

const KEY = "lcars.theme";

export function appliedTheme(): ThemeId {
  const t = document.documentElement.dataset.theme as ThemeId | undefined;
  return t && THEMES.some((x) => x.id === t) ? t : "tng";
}

export function applyTheme(id: ThemeId) {
  if (id === "tng") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode — theme just won't persist */
  }
}

export function restoreTheme(): ThemeId {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    saved = null;
  }
  const id = (THEMES.find((t) => t.id === saved)?.id ?? "tng") as ThemeId;
  applyTheme(id);
  return id;
}
