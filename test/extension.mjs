#!/usr/bin/env node
/**
 * The `/lcars` pi extension, exercised without pi.
 *
 *   node test/extension.mjs
 *
 * The extension is a thin shell around `bin/pi-lcars.mjs`, so the things that
 * can silently break are behavioural, not visual:
 *
 *   1. it starts a console for the session's cwd and hands back a URL that
 *      actually answers;
 *   2. a second `/lcars` REATTACHES to that instance instead of walking to the
 *      next free port and leaving the operator with two consoles;
 *   3. `/lcars stop` stops only the instance that belongs to this workspace;
 *   4. the package manifest advertises the extension, or `pi install` would
 *      install a package whose command does not exist.
 *
 * Node runs the .ts file directly (type stripping), which is exactly how pi's
 * jiti loads it — no build step sits between the test and the shipped code.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = join(ROOT, "bin", "pi-lcars.mjs");
const run = promisify(execFile);

const results = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  results.push(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stop = () => {};

try {
  /* ------------------------------------------------- a throwaway workspace */
  const tmp = await mkdtemp(join(tmpdir(), "lcars-ext-"));
  const workspace = join(tmp, "workspace");
  await mkdir(workspace, { recursive: true });
  process.env.LCARS_STATE_DIR = join(tmp, "state");
  process.env.LCARS_SESSIONS = join(tmp, "sessions");
  process.env.LCARS_TRUST_PROJECT = "0";
  process.env.CI = "1";
  stop = async () => {
    await run(process.execPath, [LAUNCHER, "stop"], { timeout: 20_000 }).catch(() => {});
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  };

  /* ------------------------------------ the extension registers one command */
  const mod = await import(join(ROOT, "extensions", "lcars.ts"));
  check("the extension has a default factory", typeof mod.default === "function");

  let registered = null;
  mod.default({ registerCommand: (name, command) => (registered = { name, ...command }) });
  check("it registers /lcars", registered?.name === "lcars", registered?.name);
  check(
    "the command explains itself",
    typeof registered?.description === "string" && registered.description.length > 20,
    registered?.description,
  );

  /* ------------------------------------------------ the pieces-a-fake-ctx */
  const notes = [];
  const statuses = [];
  const ctx = (cwd) => ({
    cwd,
    ui: {
      notify: (message, type) => notes.push({ message, type }),
      setStatus: (key, text) => statuses.push({ key, text }),
    },
  });
  const lastNote = () => notes[notes.length - 1]?.message ?? "";
  const called = async (args, cwd = workspace) => {
    notes.length = 0;
    statuses.length = 0;
    await registered.handler(args, ctx(cwd));
    return lastNote();
  };
  const instances = async () => {
    const { stdout } = await run(process.execPath, [LAUNCHER, "status", "--json"], { timeout: 20_000 });
    return JSON.parse(stdout.trim() || "[]");
  };

  /* ----------------------------------------------- 1. start, and it answers */
  const started = await called("");
  const url = /http:\/\/127\.0\.0\.1:\d+/.exec(started)?.[0] ?? "";
  check("/lcars starts a console and names its url", !!url, started);
  check("it leaves the port in the footer", statuses.some((s) => /^:\d+$/.test(s.text ?? "")), JSON.stringify(statuses.slice(-1)));

  const boot = await fetch(`${url}/api/bootstrap`).then((r) => r.json()).catch(() => null);
  check("that url really serves the console", boot?.ok === true, JSON.stringify(boot?.data?.meta?.model ?? null));

  const first = (await instances())[0];
  check(
    "the instance record carries cwd + port",
    !!first && first.url === url && first.cwd === workspace,
    JSON.stringify(first && { url: first.url, cwd: first.cwd, ok: first.ok }),
  );

  /* ------------------------------------------- 2. a second /lcars reattaches */
  const again = await called("");
  const rows = await instances();
  check("a second /lcars reattaches to the same console", /http:\/\/127\.0\.0\.1:\d+/.exec(again)?.[0] === url, again);
  check("...instead of starting a second one", rows.length === 1, `${rows.length} instance(s)`);

  /* ------------------------------------------------------ 3. status / stop */
  const listed = await called("status");
  check("status reports the running console", listed.includes(url) && listed.includes(workspace), listed);

  const wrongDir = await called("stop", join(tmp, "elsewhere"));
  const survived = await instances();
  check("stop refuses a workspace that owns no console", /no console/i.test(wrongDir) && survived.length === 1, wrongDir);

  const stopped = await called("stop");
  await sleep(400);
  const after = await instances();
  const dead = await fetch(`${url}/api/bootstrap`).then(() => true).catch(() => false);
  check("stop shuts this workspace's console down", /stopped/i.test(stopped) && after.length === 0 && !dead, stopped);

  /* ------------------------------------------------------- 4. completions */
  const all = registered.getArgumentCompletions("") ?? [];
  const st = registered.getArgumentCompletions("st") ?? [];
  check(
    "completions list the subcommands",
    all.length === 4 && st.length === 2 && st.every((i) => i.value.startsWith("st")),
    `${all.map((i) => i.value || "(start)").join(", ")} · "st" → ${st.map((i) => i.value).join(", ")}`,
  );

  /* ------------------------------------- 5. the manifest advertises all this */
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const ext = pkg.pi?.extensions ?? [];
  check("package.json declares the extension", ext.includes("./extensions/lcars.ts"), JSON.stringify(pkg.pi ?? null));
  check("the declared file exists and ships", existsSync(join(ROOT, "extensions", "lcars.ts")) && (pkg.files ?? []).includes("extensions/"));
  check(
    "the package is eligible for the pi gallery",
    (pkg.keywords ?? []).includes("pi-package") && typeof pkg.pi?.image === "string" && /^https:\/\//.test(pkg.pi.image),
    JSON.stringify({ keywords: pkg.keywords, image: pkg.pi?.image }),
  );
} catch (e) {
  check("extension harness", false, e.message);
} finally {
  await stop();
}

console.log(results.join("\n"));
console.log(failures ? `\n  ${failures} check(s) failed\n` : `\n  ${results.length} checks passed\n`);
process.exit(failures ? 1 : 0);
