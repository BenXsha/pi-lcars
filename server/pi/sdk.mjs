/**
 * pi backend environment: find the SDK, prove it has the API this console
 * calls, and explain how to install pi when it is missing.
 *
 * Resolution order (first candidate that imports *and* answers the API probe
 * wins — that is the "auto-match" part):
 *
 *   1. PI_SDK                  explicit file path or package specifier
 *   2. PI_PACKAGE_DIR          pi's package dir override (Nix/Guix store paths)
 *   3. project node_modules    bare specifier, for a checkout that depends on pi
 *   4. <agent>/install/releases/<semver>   newest first — what the installer writes
 *   5. npm global root         `npm i -g @earendil-works/pi-coding-agent`
 *
 * Every path uses node:path / node:os so Windows and POSIX behave the same.
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

export const PKG = "@earendil-works/pi-coding-agent";
const REL_ENTRY = join("node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js");

/** pi 1.4.x is what this console is written against; older releases lack the API. */
export const MIN_NODE = "22.19.0";
export const MIN_PI = "1.4.0";

/** Exports we call directly. A release missing any of these is not usable. */
export const REQUIRED_API = ["createAgentSession", "DefaultResourceLoader", "SessionManager", "parseSkillBlock"];
/** Nice to have: without these the session still runs, with fewer features. */
const OPTIONAL_API = ["VERSION", "createMcpExtension", "createToolSearchExtension"];

/* --------------------------------------------------------------- versions */
const parts = (v) => String(v).replace(/^v/, "").split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);

/** negative when a < b, 0 when equal, positive when a > b */
export function cmpVersion(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/* ------------------------------------------------------------------ paths */
/** pi's config directory; honours PI_CODING_AGENT_DIR on every platform. */
export function agentDir(env = process.env) {
  return env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

/** Where the installer puts releases. */
function releasesDir(env = process.env) {
  return join(agentDir(env), "install", "releases");
}

/** Absolute entries of every installed release, newest first. */
function releasePaths(env = process.env) {
  const dir = releasesDir(env);
  let names = [];
  try {
    names = readdirSync(dir).filter((v) => /^\d+\.\d+\.\d+/.test(v));
  } catch {
    return [];
  }
  return names
    .sort((a, b) => cmpVersion(b, a))
    .map((v) => ({ version: v, spec: join(dir, v, REL_ENTRY), origin: `release ${v}` }))
    .filter((c) => existsSync(c.spec));
}

/** `pi` on PATH, for the "is the CLI installed" check (no spawning). */
export function findPiBinary(env = process.env) {
  const exts = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  const dirs = String(env.PATH || "").split(process.platform === "win32" ? ";" : ":");
  const local = join(agentDir(env), "bin");
  const names = process.platform === "win32" ? ["pi", "pi.cmd", "pi.exe"] : ["pi"];
  for (const dir of [...dirs, local]) {
    if (!dir) continue;
    for (const name of names) {
      for (const ext of exts) {
        const candidate = join(dir, `${name}${ext}`);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------- candidates */
async function npmGlobalRoot(env = process.env) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    const { stdout } = await run(npm, ["root", "-g"], { timeout: 4000, env });
    const root = String(stdout).trim().split(/\r?\n/).pop();
    return root && existsSync(join(root, PKG)) ? root : null;
  } catch {
    return null;
  }
}

function fastCandidates(env, includeBare = true) {
  const out = [];
  if (env.PI_SDK) out.push({ spec: env.PI_SDK, origin: "PI_SDK" });
  if (env.PI_PACKAGE_DIR) out.push({ spec: join(env.PI_PACKAGE_DIR, "dist", "index.js"), origin: "PI_PACKAGE_DIR" });
  if (includeBare) out.push({ spec: PKG, origin: "project node_modules" });
  out.push(...releasePaths(env));
  return out;
}

/** Version string of a candidate, from the package.json next to dist/. */
function candidateVersion(candidate, mod) {
  if (candidate.version) return candidate.version;
  const probes = [];
  if (isAbsolute(candidate.spec)) probes.push(join(dirname(candidate.spec), "..", "..", "package.json"));
  try {
    probes.push(require.resolve(`${PKG}/package.json`));
  } catch {
    /* exports map may hide it */
  }
  for (const p of probes) {
    try {
      const pkg = JSON.parse(readFileSync(p, "utf8"));
      if (pkg?.version) return pkg.version;
    } catch {
      /* try the next probe */
    }
  }
  return mod?.VERSION ?? null;
}

/** Import a candidate and check the API surface this console actually uses. */
async function probeCandidate(candidate) {
  const row = { ...candidate, found: false, version: null, missing: [], optionalMissing: [], error: null };
  let mod;
  try {
    mod = await import(candidate.spec);
  } catch (e) {
    row.error = e.message;
    return { row, mod: null };
  }
  row.found = true;
  row.version = candidateVersion(candidate, mod);
  for (const name of REQUIRED_API) {
    if (typeof mod[name] === "undefined") row.missing.push(name);
  }
  for (const name of OPTIONAL_API) {
    if (typeof mod[name] === "undefined") row.optionalMissing.push(name);
  }
  if (row.missing.length) row.error = `missing API: ${row.missing.join(", ")}`;
  return { row, mod };
}

/* ------------------------------------------------------------------ probe */
/**
 * Full environment report. Pure enough to unit-test: pass `home`, `env`,
 * `npmRoot` or `allowNpmRoot:false` to keep it off the real machine.
 */
export async function inspect(opts = {}) {
  const env = opts.env ?? process.env;
  const allowNpmRoot = opts.allowNpmRoot !== false;
  const node = process.version;
  const nodeOk = cmpVersion(node, MIN_NODE) >= 0;

  const candidates = fastCandidates(env, opts.includeBare !== false);
  const rows = [];
  let selected = null;

  for (const candidate of candidates) {
    const probed = await probeCandidate(candidate);
    rows.push(probed.row);
    if (!selected && probed.mod && !probed.row.missing.length) selected = probed.row;
  }

  if (!selected && allowNpmRoot) {
    const npmRoot = opts.npmRoot ?? (await npmGlobalRoot(env));
    if (npmRoot) {
      const candidate = { spec: join(npmRoot, PKG, "dist", "index.js"), origin: `npm -g (${npmRoot})` };
      const probed = await probeCandidate(candidate);
      rows.push(probed.row);
      if (probed.mod && !probed.row.missing.length) selected = probed.row;
    }
  }

  const dir = agentDir(env);
  const warnings = [];
  if (!nodeOk) warnings.push(`node ${node} is older than pi's minimum ${MIN_NODE}`);
  if (selected && cmpVersion(selected.version ?? "0.0.0", MIN_PI) < 0) {
    warnings.push(`${PKG}@${selected.version} is older than the supported ${MIN_PI}`);
  }
  if (selected?.optionalMissing.length) {
    warnings.push(`sdk is missing optional API: ${selected.optionalMissing.join(", ")}`);
  }
  if (rows.length && !selected) {
    const newest = rows.find((r) => r.found);
    if (newest) warnings.push(`found ${newest.origin} but it lacks the required API`);
  }

  return {
    platform: process.platform,
    arch: process.arch,
    node,
    minNode: MIN_NODE,
    minPi: MIN_PI,
    nodeOk,
    agentDir: dir,
    agentDirExists: existsSync(dir),
    settings: existsSync(join(dir, "settings.json")),
    auth: existsSync(join(dir, "auth.json")),
    piCli: findPiBinary(env),
    installed: Boolean(selected),
    selected: selected
      ? {
          spec: selected.spec,
          origin: selected.origin,
          version: selected.version,
          optionalMissing: selected.optionalMissing,
        }
      : null,
    candidates: rows,
    warnings,
    guidance: selected ? null : installGuidance(),
  };
}

/** Platform-correct install instructions (from pi's own README). */
export function installGuidance(env = process.env) {
  const windows = process.platform === "win32";
  const installer = windows
    ? '  powershell -c "irm https://pi.dev/install.ps1 | iex"'
    : "  curl -fsSL https://pi.dev/install.sh | sh";
  return [
    "pi is not installed (or no release answers the SDK API this console needs).",
    "",
    "  install it:",
    installer,
    "",
    "  or with npm (requires node >= " + MIN_NODE + "):",
    `  npm install -g --ignore-scripts ${PKG}`,
    "",
    "  then run `pi` once so it creates " + join(agentDir(env), "settings.json") + ",",
    "  and re-run `pi-lcars`. Check the result any time with `pi-lcars doctor`.",
    "",
    "  already installed somewhere unusual? point PI_SDK at",
    `  .../node_modules/${PKG}/dist/index.js`,
  ].join("\n");
}

/* ------------------------------------------------------------ the loader */
let cached;
let loadedFrom = null;
let loadedInfo = null;

/** Which specifier actually resolved — the SYSTEM station shows it. */
export const sdkSpec = () => loadedFrom;

/** Full report of the resolution that succeeded (or the last attempt). */
export const sdkInfo = () => loadedInfo;

export async function loadSdk() {
  if (cached) return cached;
  const report = await inspect();
  loadedInfo = report;

  if (!report.selected) {
    const error = new Error(
      `pi backend not found — no installed SDK answered the required API.\n` +
        `  required: ${REQUIRED_API.join(", ")}\n\n${report.guidance}`,
    );
    error.code = "E_PI_SDK";
    error.report = report;
    throw error;
  }

  cached = await import(report.selected.spec); // module cache: inspect() already loaded it
  loadedFrom = report.selected.spec;
  return cached;
}
