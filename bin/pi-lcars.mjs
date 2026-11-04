#!/usr/bin/env node
/**
 * pi-lcars — one command: boot the LCARS console (pi backend + UI + SSE) and
 * open it. The client is hosted by the same Node process, so there is nothing
 * else to start.
 *
 *   pi-lcars                 start, build the client if stale, open the browser
 *   pi-lcars web             same (alias)
 *   pi-lcars --dev           start + vite dev server with HMR
 *   pi-lcars status          list running instances
 *   pi-lcars stop            SIGTERM the newest instance
 *   pi-lcars --json          first stdout line is {url,port,pid,cwd}
 */
import { spawn } from "node:child_process";
import { unlinkSync, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const STATE_DIR = process.env.LCARS_STATE_DIR || join(homedir(), ".pi", "agent", "lcars");
const INSTANCE_DIR = join(STATE_DIR, "instances");
const LAST_URL = join(STATE_DIR, "last-url");
const PKG_NAME = "pi-lcars";
/** package.json is only used for the version string — never fail the launch on it. */
async function readPkg() {
  try {
    const raw = await readFile(join(ROOT, "package.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { name: PKG_NAME, version: "0.0.0" };
  }
}
const PKG = await readPkg();

/* ------------------------------------------------------------------ args */
function die(message, code = "E_LAUNCH") {
  process.stderr.write(`\n  ${code}: ${message}\n\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    cmd: "start",
    open: Boolean(process.stdout.isTTY) && !process.env.CI,
    dev: false,
    json: false,
    noBuild: false,
    strictPort: false,
  };
  const args = argv.slice();
  if (args[0] === "web") args.shift();
  const value = (i, flag) => {
    const v = args[i + 1];
    if (v === undefined || v.startsWith("-")) die(`${flag} needs a value`, "E_ARGS");
    return v;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "status":
      case "stop":
      case "open":
      case "version":
      case "doctor":
      case "help":
        out.cmd = a;
        break;
      case "--help":
      case "-h":
        out.cmd = "help";
        break;
      case "--version":
      case "-v":
        out.cmd = "version";
        break;
      case "--dev":
        out.dev = true;
        break;
      case "--json":
        out.json = true;
        out.open = false;
        break;
      case "--open":
        out.open = true;
        break;
      case "--no-open":
        out.open = false;
        break;
      case "--no-build":
        out.noBuild = true;
        break;
      case "--strict-port":
        out.strictPort = true;
        break;
      case "--resume":
        out.resume = true;
        break;
      case "-C":
      case "--cwd":
        out.cwd = resolve(value(i, a));
        i++;
        break;
      case "-p":
      case "--port":
        out.port = Number(value(i, a));
        i++;
        break;
      case "--host":
        out.host = value(i, a);
        i++;
        break;
      case "--policy":
        out.policy = value(i, a);
        i++;
        break;
      default: {
        const eq = a.indexOf("=");
        const key = eq === -1 ? a : a.slice(0, eq);
        const val = eq === -1 ? undefined : a.slice(eq + 1);
        if (key === "--cwd" && val) out.cwd = resolve(val);
        else if (key === "--port" && val) out.port = Number(val);
        else if (key === "--host" && val) out.host = val;
        else if (key === "--policy" && val) out.policy = val;
        else die(`unknown argument: ${a}\n  try: pi-lcars --help`, "E_ARGS");
      }
    }
  }
  if (out.port !== undefined && !Number.isFinite(out.port)) die("--port must be a number", "E_ARGS");
  return out;
}

const args = parseArgs(process.argv.slice(2));

/* -------------------------------------------------------------- instances */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** mtime in ms, or 0 when the path is missing. */
async function mtimeOf(path) {
  try {
    const info = await stat(path);
    return info.mtimeMs;
  } catch {
    return 0;
  }
}

/** Launch the browser with whatever opener the platform has; silence failures. */
function openBrowser(url) {
  const [cmd, cmdArgs] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, cmdArgs, { stdio: "ignore", detached: true });
    child.on("error", () => {}); // no opener installed: the URL is already printed
    child.unref();
  } catch {
    /* ignore */
  }
}

async function readInstances() {
  let names = [];
  try {
    names = await readdir(INSTANCE_DIR);
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = join(INSTANCE_DIR, name);
    try {
      const info = JSON.parse(await readFile(file, "utf8"));
      if (!info.pid || !alive(info.pid)) {
        await rm(file, { force: true }); // stale: SIGKILL, power loss, crash
        continue;
      }
      rows.push({ ...info, file });
    } catch {
      await rm(file, { force: true });
    }
  }
  return rows.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

async function probe(info) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 900);
  try {
    const r = await fetch(`${info.url}/api/bootstrap`, { signal: ctrl.signal });
    const body = await r.json();
    const data = body?.data ?? {};
    return {
      ok: r.ok,
      model: data.meta?.model ?? "?",
      sessions: Array.isArray(data.sessions) ? data.sessions.length : 0,
    };
  } catch {
    return { ok: false, model: "unreachable", sessions: 0 };
  } finally {
    clearTimeout(t);
  }
}

const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};

/* --------------------------------------------------------------- commands */
if (args.cmd === "help") {
  process.stdout.write(`pi-lcars ${PKG.version} — LCARS console for pi

  pi-lcars                start (builds the client when stale), open the browser
  pi-lcars web            same thing
  pi-lcars --dev          start with vite HMR on :5173
  pi-lcars status         list running instances
  pi-lcars open           open a running instance in the browser
  pi-lcars stop           stop the newest instance (--port N to pick one)
  pi-lcars doctor         check the pi backend and print the fix when it is missing
  pi-lcars --version      version + dist build time

  -C, --cwd <dir>         workspace, default: current directory
  -p, --port <n>          first port to try, default 4173 (walks up when busy)
      --strict-port       fail instead of walking up
      --host <ip>         bind address, default 127.0.0.1 (no auth!)
      --policy <mode>     off | risky | all, default off
      --resume            reopen the newest session in the workspace
      --no-build          refuse to build a stale client
      --no-open/--open    skip or force the browser
      --json              start: first stdout line is {url,port,pid,cwd}\n                          status: one JSON array on stdout
`);
  process.exit(0);
}

if (args.cmd === "version") {
  const distAt = await mtimeOf(join(ROOT, "dist", "index.html"));
  const built = distAt ? new Date(distAt).toISOString() : "missing";
  process.stdout.write(`pi-lcars ${PKG.version} · dist ${built}\n`);
  process.exit(0);
}

if (args.cmd === "status") {
  const rows = await readInstances();
  // machine-readable form: the `/lcars` pi extension reattaches to an instance
  // instead of starting a second one on the next free port
  if (args.json) {
    const live = await Promise.all(
      rows.map(async (info) => {
        const { ok, model, sessions } = await probe(info);
        return { pid: info.pid, port: info.port, url: info.url, cwd: info.cwd, startedAt: info.startedAt ?? null, ok, model, sessions };
      }),
    );
    process.stdout.write(`${JSON.stringify(live)}\n`);
    process.exit(0);
  }
  if (!rows.length) {
    process.stdout.write("no pi-lcars instance running\n");
    process.exit(0);
  }
  for (const info of rows) {
    const live = await probe(info);
    process.stdout.write(
      `\n  pid ${info.pid}  ${info.url}\n` +
        `  cwd     ${info.cwd}\n` +
        `  model   ${live.model}  ·  ${live.sessions} session(s)  ·  up ${ago(info.startedAt)}\n`,
    );
  }
  process.stdout.write("\n");
  process.exit(0);
}

if (args.cmd === "open") {
  // "I have the console running somewhere, show it to me" — the browser half of
  // `start`, without starting a second instance (the `/lcars open` command in pi)
  const rows = await readInstances();
  if (!rows.length) die("no pi-lcars instance running — start one first", "E_NO_INSTANCE");
  const target = args.port ? rows.find((r) => r.port === args.port) : rows[rows.length - 1];
  if (!target) die(`no instance on port ${args.port}`, "E_NO_INSTANCE");
  openBrowser(target.url);
  process.stdout.write(`opened ${target.url}\n`);
  process.exit(0);
}

if (args.cmd === "stop") {
  const rows = await readInstances();
  if (!rows.length) {
    process.stdout.write("no pi-lcars instance running\n");
    process.exit(0);
  }
  const target = args.port ? rows.find((r) => r.port === args.port) : rows[rows.length - 1];
  if (!target) die(`no instance on port ${args.port}`, "E_NO_INSTANCE");
  try {
    process.kill(target.pid, "SIGTERM");
  } catch (e) {
    await rm(target.file, { force: true });
    die(`could not signal pid ${target.pid}: ${e.code || e.message}`, "E_STOP");
  }
  for (let i = 0; i < 40; i++) {
    if (!alive(target.pid)) break;
    await sleep(100);
  }
  const stopped = !alive(target.pid);
  if (stopped) await rm(target.file, { force: true });
  process.stdout.write(stopped ? `stopped pid ${target.pid} (${target.url})\n` : `pid ${target.pid} is still running\n`);
  process.exit(stopped ? 0 : 1);
}

/* ---------------------------------------------------------------- preflight */
const sdk = await import("../server/pi/sdk.mjs");

/** One line per discovered SDK candidate. */
function candidateState(c) {
  if (!c.found) return "not found";
  if (c.missing.length) return `missing ${c.missing.join(", ")}`;
  return `${c.version ?? "?"} ok`;
}

/** Human-readable environment report; shared by `doctor`, the error path and start. */
function formatReport(report) {
  const mark = (ok) => (ok ? "ok" : "NO");
  const lines = [
    "",
    "  PI BACKEND",
    `  node        ${report.node}  (pi needs >= ${report.minNode})   ${mark(report.nodeOk)}`,
    `  platform    ${report.platform} ${report.arch}`,
    `  agent dir   ${report.agentDir}${report.agentDirExists ? "" : "  (missing)"}`,
    `  config      settings ${mark(report.settings)}  ·  auth ${mark(report.auth)}`,
    `  pi cli      ${report.piCli ?? "not on PATH"}`,
  ];
  if (report.selected) {
    lines.push(`  sdk         ${report.selected.version}  ·  ${report.selected.origin}`);
    lines.push(`              ${report.selected.spec}`);
  } else {
    lines.push("  sdk         none usable");
  }
  lines.push("  candidates");
  if (!report.candidates.length) lines.push("              (nothing found)");
  for (const c of report.candidates) {
    lines.push(`              ${c.origin.padEnd(22)} ${candidateState(c)}`);
  }
  for (const w of report.warnings) lines.push(`  [warn] ${w}`);
  lines.push("");
  return lines.join("\n");
}

const report = await sdk.inspect();

if (args.cmd === "doctor") {
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: report.installed && report.nodeOk, ...report })}\n`);
  } else {
    process.stdout.write(formatReport(report));
    if (!report.installed) process.stdout.write(`${sdk.installGuidance()}\n\n`);
    else if (report.warnings.length) process.stdout.write("  warnings above; the console still starts.\n\n");
  }
  process.exit(report.installed && report.nodeOk ? 0 : 1);
}

if (!report.installed) {
  process.stderr.write(`\n  E_PI_SDK${formatReport(report)}\n\n${sdk.installGuidance()}\n\n`);
  process.exit(1);
}
if (!report.nodeOk) {
  notesDev(`  [warn] node ${report.node} is older than pi's minimum ${report.minNode}`);
}

/** Used before `notes` exists further down. */
function notesDev(line) {
  process.stderr.write(`${line}\n`);
}

const distIndex = join(ROOT, "dist", "index.html");

async function newestSource() {
  let newest = 0;
  const walk = async (p) => {
    const st = await stat(p);
    if (st.isDirectory()) {
      for (const entry of await readdir(p)) await walk(join(p, entry));
    } else if (st.mtimeMs > newest) {
      newest = st.mtimeMs;
    }
  };
  for (const entry of ["src", "index.html", "vite.config.ts"]) {
    try {
      await walk(join(ROOT, entry));
    } catch {
      /* missing is fine */
    }
  }
  return newest;
}

async function buildClient() {
  let vite;
  try {
    vite = await import("vite");
  } catch {
    die(
      "the client is not built and vite is not installed.\n" +
        "  from a checkout: npm install && pi-lcars\n" +
        "  from a global install: npm i -g pi-lcars@latest",
      "E_NO_VITE",
    );
  }
  const t0 = Date.now();
  await vite.build({ root: ROOT, logLevel: "warn" });
  return Date.now() - t0;
}

/* ----------------------------------------------------------------- launch */
const cwd = args.cwd ?? process.cwd();
const host = args.host ?? "127.0.0.1";
const notes = (line) => process.stderr.write(`${line}\n`);

let built = 0;
/* Only a source checkout can be "stale": a published package ships dist/ and has
 * no src/, and its package.json mtime is the install time, not a build input. */
const isCheckout = existsSync(join(ROOT, "src")) && existsSync(join(ROOT, "index.html"));
if (!args.dev && !isCheckout) {
  if (!existsSync(distIndex)) {
    die("this install has no dist/ — reinstall: npm i -g pi-lcars@latest", "E_DIST_MISSING");
  }
} else if (!args.dev) {
  const distAt = await mtimeOf(distIndex);
  const srcAt = await newestSource();
  const stale = !distAt || srcAt > distAt;
  if (stale) {
    if (args.noBuild) {
      die(
        `client is stale and --no-build was given\n` +
          `  source newest: ${srcAt ? new Date(srcAt).toISOString() : "?"}\n` +
          `  dist built:    ${distAt ? new Date(distAt).toISOString() : "missing"}`,
        "E_DIST_STALE",
      );
    }
    const t0 = Date.now();
    built = await buildClient();
    notes(`  [build] client built in ${built}ms` + (t0 ? "" : ""));
  }
}

if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
  notes(`  [warn] binding ${host} — this console has NO AUTHENTICATION`);
}

const { start } = await import("../server/index.mjs");
let server;
try {
  server = await start({
    port: args.port ?? Number(process.env.PORT || 4173),
    host,
    cwd,
    policy: args.policy,
    resume: args.resume,
    strictPort: args.strictPort,
    log: false,
  });
} catch (e) {
  die(e.message, e.code || "E_START");
}

const info = {
  pid: process.pid,
  port: server.port,
  host: server.host,
  url: server.url,
  cwd: server.cwd,
  startedAt: Date.now(),
  version: PKG.version,
};
const instanceFile = join(INSTANCE_DIR, `${process.pid}.json`);
await mkdir(INSTANCE_DIR, { recursive: true });
await writeFile(instanceFile, `${JSON.stringify(info, null, 2)}\n`);
await writeFile(LAST_URL, `${server.url}\n`);

const cleanup = () => {
  try {
    unlinkSync(instanceFile);
  } catch {
    /* already gone */
  }
};
process.on("exit", cleanup);

/* --dev: vite serves the client with HMR, proxying /api to this process */
let dev = null;
let uiUrl = server.url;
if (args.dev) {
  let viteBin;
  try {
    // vite's exports map hides bin/vite.js, so resolve package.json and walk in
    viteBin = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
  } catch {
    die("--dev needs vite installed in this checkout (npm install)", "E_NO_VITE");
  }
  dev = spawn(process.execPath, [viteBin], {
    cwd: ROOT,
    // --json promises "first line is JSON": keep vite's banner off stdout
    stdio: args.json ? ["ignore", 2, 2] : "inherit",
    env: { ...process.env, LCARS_API: server.url },
  });
  uiUrl = "http://localhost:5173";
  const off = () => {
    if (dev && !dev.killed) dev.kill("SIGTERM");
  };
  process.on("exit", off);
  process.once("SIGTERM", off);
}

if (args.json) {
  process.stdout.write(
    `${JSON.stringify({ ...info, ui: uiUrl, dev: Boolean(args.dev), builtMs: built })}\n`,
  );
} else {
  const lines = [
    "",
    `  LCARS CONSOLE  ${PKG.version}`,
    `  ui        ${uiUrl}${args.dev ? "  (vite dev · HMR)" : ""}`,
    `  api       ${server.url}`,
    `  workspace ${server.cwd}`,
    `  pid       ${process.pid}${built ? `  ·  built in ${built}ms` : ""}`,
    "",
    "  stop with ctrl-c, or `pi-lcars stop` from another terminal",
    "",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (args.open) openBrowser(uiUrl);
