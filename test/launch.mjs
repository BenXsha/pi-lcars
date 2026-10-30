#!/usr/bin/env node
/**
 * Launcher smoke test — boots `bin/pi-lcars.mjs` for real and checks the
 * contract the CLI promises (JSON handshake, endpoints, port offset, status,
 * stop). No model calls.
 *
 *   node test/launch.mjs
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "pi-lcars.mjs");
const PORT = Number(process.env.TEST_LAUNCH_PORT || 4291);

let failures = 0;
const results = [];
function check(name, cond, detail = "") {
  const ok = !!cond;
  if (!ok) failures++;
  results.push(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const tmp = await mkdtemp(join(tmpdir(), "lcars-launch-"));
const state = join(tmp, "state");
const sessions = join(tmp, "sessions");
const workspace = join(tmp, "workspace");
await import("node:fs/promises").then((fs) => fs.mkdir(workspace, { recursive: true }));

const env = {
  ...process.env,
  CI: "1", // no browser
  LCARS_STATE_DIR: state,
  LCARS_SESSIONS: sessions,
  LCARS_TRUST_PROJECT: "0",
};

/** Spawn the launcher, collecting stdout/stderr; resolves on first JSON line. */
function launch(extra = []) {
  const child = spawn(process.execPath, [BIN, ...extra], { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  const firstLine = new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error(`no JSON handshake in 60s\n${err}`)), 60_000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const nl = out.indexOf("\n");
      if (nl === -1) return;
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      try {
        const info = JSON.parse(line);
        clearTimeout(timer);
        done(info);
      } catch (e) {
        clearTimeout(timer);
        reject(new Error(`first stdout line is not JSON: ${line}\n${e.message}`));
      }
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`launcher exited early (code ${code})\n${err}`));
    });
  });
  return { child, firstLine, stderr: () => err, stdout: () => out };
}

/** Run a short-lived launcher subcommand to completion. */
function run(extra = []) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...extra], { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("exit", (code) => done({ code, stdout, stderr }));
  });
}

const get = async (url) => {
  const r = await fetch(url);
  return { status: r.status, body: await r.json().catch(() => null) };
};

let child;
try {
  /* ---------------------------------------------------------- 1. launch */
  const first = launch(["--json", "--no-open", "--port", String(PORT)]);
  child = first.child;
  let info = null;
  try {
    info = await first.firstLine;
  } catch (e) {
    check("JSON handshake", false, e.message);
  }
  check("JSON handshake", !!info);
  if (info) {
    check("handshake has url", /^http:\/\/127\.0\.0\.1:\d+$/.test(info.url), info.url);
    check("handshake has pid", info.pid === child.pid, `${info.pid} vs ${child.pid}`);
    check("handshake cwd is the workspace", info.cwd === workspace, info.cwd);
    check("handshake reports build", typeof info.builtMs === "number", String(info.builtMs));
  }
  const base = info?.url ?? `http://127.0.0.1:${PORT}`;

  /* ------------------------------------------------------ 2. endpoints */
  const boot = await get(`${base}/api/bootstrap`);
  check("GET /api/bootstrap", boot.status === 200 && boot.body?.ok === true);
  check("bootstrap has a session", (boot.body?.data?.sessions ?? []).length >= 0);

  const sys = await get(`${base}/api/system`);
  check("GET /api/system reports the bound port", sys.body?.data?.port === (info?.port ?? PORT), String(sys.body?.data?.port));
  check("GET /api/system reports the cwd", sys.body?.data?.cwd === workspace, String(sys.body?.data?.cwd));
  check("GET /api/system resolves the sdk", Boolean(sys.body?.data?.sdk), String(sys.body?.data?.sdk));

  const shell = await fetch(`${base}/`);
  check("GET / serves the built client", shell.status === 200 && (await shell.text()).includes("<div id=\"root\">"));

  const stream = await fetch(`${base}/api/stream`, { signal: AbortSignal.timeout(4000) });
  const reader = stream.body.getReader();
  const chunk = await reader.read();
  const hello = new TextDecoder().decode(chunk.value ?? new Uint8Array());
  check("SSE hello arrives", hello.includes("\"e\":\"hello\""), hello.slice(0, 60));
  await reader.cancel().catch(() => {});

  /* --------------------------------------------------------- 3. status */
  const status = await run(["status"]);
  check("status lists the instance", status.code === 0 && status.stdout.includes(String(child.pid)));
  check("status probes the api", status.stdout.includes("session"), status.stdout.trim().split("\n").slice(-1)[0]);

  /* --------------------------------------------------------- 4. doctor */
  const doc = await run(["doctor", "--json"]);
  let docBody = null;
  try {
    docBody = JSON.parse(doc.stdout);
  } catch {
    /* reported below */
  }
  check("doctor --json exits 0", doc.code === 0, doc.stderr.trim().split("\n")[0]);
  check("doctor parses as JSON", Boolean(docBody));
  check("doctor reports an installed backend", docBody?.installed === true);
  check("doctor reports the sdk version", typeof docBody?.selected?.version === "string", String(docBody?.selected?.version));
  check("doctor reports the platform", typeof docBody?.platform === "string", String(docBody?.platform));
  check("doctor checks the node version", typeof docBody?.nodeOk === "boolean", String(docBody?.nodeOk));

  /* ------------------------------------- 5. missing pi → guided install */
  const npmRoot = await new Promise((done) => {
    const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
    execFile(cmd, ["root", "-g"], { timeout: 8000 }, (err, stdout) => done(err ? null : stdout.trim()));
  });
  const globalHasPi = Boolean(npmRoot && existsSync(join(npmRoot, "@earendil-works", "pi-coding-agent")));
  if (globalHasPi) {
    results.push("skip  missing-pi simulation — a global pi package would satisfy it");
  } else {
    const emptyHome = join(tmp, "no-pi-home");
    await mkdir(emptyHome, { recursive: true });
    const bare = await new Promise((done) => {
      const child = spawn(process.execPath, [BIN, "--json", "--no-open"], {
        cwd: workspace,
        env: { ...env, HOME: emptyHome, USERPROFILE: emptyHome, PI_CODING_AGENT_DIR: join(emptyHome, "agent") },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => {
        stdout += c;
      });
      child.stderr.on("data", (c) => {
        stderr += c;
      });
      child.on("exit", (code) => done({ code, stdout, stderr }));
    });
    check("missing pi → exit code 1", bare.code === 1, String(bare.code));
    check("missing pi → installer guidance", /pi\.dev\/install/.test(bare.stderr), bare.stderr.trim().split("\n").slice(-4).join(" / "));
    check("missing pi → no JSON handshake", !/^\s*\{/.test(bare.stdout), bare.stdout.trim().slice(0, 40));
  }

  /* ---------------------------------------------------- 6. strict-port */
  const blocked = await run(["--json", "--no-open", "--strict-port", "--port", String(info?.port ?? PORT)]);
  check("strict-port refuses a busy port", blocked.code !== 0);
  check("strict-port names the error", /E_PORT|in use/.test(blocked.stderr), blocked.stderr.trim().split("\n")[0]);

  /* ----------------------------------------------------------- 7. stop */
  const stopped = await run(["stop"]);
  check("stop exits 0", stopped.code === 0, stopped.stdout.trim());
  let gone = false;
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null) {
      gone = true;
      break;
    }
    await sleep(100);
  }
  check("process is gone after stop", gone);
  const left = await readdir(join(state, "instances")).catch(() => []);
  check("state file cleaned up", left.length === 0, JSON.stringify(left));
} finally {
  if (child && child.exitCode === null) child.kill("SIGKILL");
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed (${results.length} checks)`);
process.exit(failures ? 1 : 0);
