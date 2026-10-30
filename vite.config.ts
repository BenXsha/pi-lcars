import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

/* `pi-lcars --dev` sets LCARS_API to the port the server actually got (it walks
 * up when 4173 is busy), so the proxy never points at a dead port. */
const api = process.env.LCARS_API || "http://127.0.0.1:4173";

/* ---------------------------------------------------------------- credits */
const require = createRequire(import.meta.url);
const ROOT = new URL(".", import.meta.url);

type PackageJson = {
  name?: string;
  version?: string;
  license?: string;
  homepage?: string;
  repository?: { url?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** package.json is build metadata: a broken file must not take the build down. */
function readJson(path: URL | string): PackageJson {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as PackageJson) : {};
  } catch {
    return {};
  }
}

const pkg = readJson(new URL("package.json", ROOT));

/** What the ABOUT station credits, and why each package is in the build. */
const CREDITED = [
  { name: "preact", note: "client rendering" },
  { name: "marked", note: "assistant markdown" },
  { name: "highlight.js", note: "code + diff colouring" },
  { name: "remixicon", note: "inline svg icons" },
  { name: "vite", note: "build + dev server" },
  { name: "@preact/preset-vite", note: "preact jsx transform" },
  { name: "typescript", note: "type checking" },
];

function packageInfo(name: string) {
  const candidates: string[] = [];
  try {
    candidates.push(require.resolve(`${name}/package.json`));
  } catch {
    /* exports map may hide package.json */
  }
  candidates.push(join(fileURLToPath(ROOT), "node_modules", name, "package.json"));
  for (const path of candidates) {
    const mod = readJson(path);
    if (mod.version) return { version: String(mod.version), license: String(mod.license ?? "?") };
  }
  return { version: "?", license: "?" };
}

const appInfo = {
  name: pkg.name ?? "pi-lcars",
  version: pkg.version ?? "0.0.0",
  license: pkg.license ?? "MIT",
  repo: pkg.repository?.url ?? null,
  homepage: pkg.homepage ?? null,
  deps: CREDITED.map(({ name, note }) => ({ name, note, ...packageInfo(name) })),
};

export default defineConfig({
  plugins: [preact()],
  define: { __APP_INFO__: JSON.stringify(appInfo) },
  server: { port: 5173, proxy: { "/api": api } },
  build: { outDir: "dist", emptyOutDir: true },
  resolve: { alias: { preact: "preact" } },
});
