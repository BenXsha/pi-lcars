/**
 * Build-time facts for the ABOUT station, injected by vite.config.ts.
 * Nothing here is fetched at runtime except the live pi/system values.
 */
export type Credit = { name: string; version: string; license: string; note: string };

export type Author = { name: string; email: string | null; url: string | null };

export type AppInfo = {
  name: string;
  version: string;
  license: string;
  repo: string | null;
  homepage: string | null;
  /** null when package.json carries no author field — never invent one. */
  author: Author | null;
  /** short git sha of the UI build, null for tarball installs. */
  commit: string | null;
  /** build date (YYYY-MM-DD) of the dist/ bundle. */
  builtAt: string;
  deps: Credit[];
};

declare const __APP_INFO__: AppInfo;

const devFallback: AppInfo = {
  name: "pi-lcars",
  version: "dev",
  license: "MIT",
  repo: null,
  homepage: null,
  author: null,
  commit: null,
  builtAt: "dev",
  deps: [],
};

export const appInfo: AppInfo = typeof __APP_INFO__ === "undefined" ? devFallback : __APP_INFO__;

/** git+https://host/x/y.git → https://host/x/y */
export function repoUrl(repo: string | null): string | null {
  if (!repo) return null;
  return repo.replace(/^git\+/, "").replace(/\.git$/, "");
}

export const npmUrl = `https://www.npmjs.com/package/${appInfo.name}`;

/** `0.3.2+261f880` — the exact UI bundle this tab is running. */
export function uiBuildStamp(info: AppInfo = appInfo): string {
  const sha = info.commit ?? "no-git";
  return `${info.version}+${sha}`;
}
