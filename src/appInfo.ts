/**
 * Build-time facts for the ABOUT station, injected by vite.config.ts.
 * Nothing here is fetched at runtime except the live pi/system values.
 */
export type Credit = { name: string; version: string; license: string; note: string };

export type AppInfo = {
  name: string;
  version: string;
  license: string;
  repo: string | null;
  homepage: string | null;
  deps: Credit[];
};

declare const __APP_INFO__: AppInfo;

const devFallback: AppInfo = {
  name: "pi-lcars",
  version: "dev",
  license: "MIT",
  repo: null,
  homepage: null,
  deps: [],
};

export const appInfo: AppInfo = typeof __APP_INFO__ === "undefined" ? devFallback : __APP_INFO__;

/** git+https://host/x/y.git → https://host/x/y */
export function repoUrl(repo: string | null): string | null {
  if (!repo) return null;
  return repo.replace(/^git\+/, "").replace(/\.git$/, "");
}

export const npmUrl = `https://www.npmjs.com/package/${appInfo.name}`;
