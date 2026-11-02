import { execFileSync } from "node:child_process";
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

type AuthorField = string | { name?: string; email?: string; url?: string } | null;

type PackageJson = {
  name?: string;
  version?: string;
  license?: string;
  homepage?: string;
  author?: AuthorField;
  repository?: { url?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * npm allows `Name <mail> (url)` or an object; ABOUT wants the parts split.
 *
 * The address is shipped as two halves (`local` + `domain`) rather than one
 * string, so the bundle never contains a token a harvester's regex can match.
 * The UI joins them only at the moment the operator asks for the address.
 */
type EmailParts = { local: string; domain: string };
function splitEmail(email: string | null): EmailParts | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at > 0 ? { local: email.slice(0, at), domain: email.slice(at + 1) } : null;
}

function parseAuthor(
  raw: AuthorField | undefined,
): { name: string; email: EmailParts | null; url: string | null } | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const email = /<([^>]*)>/.exec(raw)?.[1]?.trim() || null;
    const url = /\(([^)]*)\)/.exec(raw)?.[1]?.trim() || null;
    const name = raw.replace(/<[^>]*>/g, "").replace(/\([^)]*\)/g, "").trim();
    if (!name && !email && !url) return null;
    return { name: name || email || "unknown", email: splitEmail(email), url };
  }
  const name = raw.name?.trim() || raw.email?.trim() || raw.url?.trim() || "";
  if (!name) return null;
  return { name, email: splitEmail(raw.email?.trim() ?? null), url: raw.url?.trim() || null };
}

/** Best-effort: a tarball install or a non-git checkout simply has no commit. */
function gitCommit(): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: fileURLToPath(ROOT),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

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
  author: parseAuthor(pkg.author),
  commit: gitCommit(),
  builtAt: new Date().toISOString().slice(0, 10),
  deps: CREDITED.map(({ name, note }) => ({ name, note, ...packageInfo(name) })),
};

export default defineConfig({
  plugins: [preact()],
  define: { __APP_INFO__: JSON.stringify(appInfo) },
  server: { port: 5173, proxy: { "/api": api } },
  build: { outDir: "dist", emptyOutDir: true },
  resolve: { alias: { preact: "preact" } },
});
