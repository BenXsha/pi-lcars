#!/usr/bin/env node
/**
 * pi backend discovery tests — no real pi install involved. Builds throwaway
 * homes with fake releases to prove the resolver picks the newest *usable*
 * release, skips broken ones, and prints install guidance when nothing works.
 *
 *   node test/pi-env.mjs
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { agentDir, cmpVersion, findPiBinary, inspect, installGuidance, MIN_PI, REQUIRED_API } from "../server/pi/sdk.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
void ROOT;

let failures = 0;
const results = [];
function check(name, cond, detail = "") {
  const ok = !!cond;
  if (!ok) failures++;
  results.push(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const tmp = await mkdtemp(join(tmpdir(), "lcars-pienv-"));
const PKG_REL = join("install", "releases");

/** Write a fake release; `api` lists the exports it provides. */
async function release(home, version, api) {
  const dir = join(home, "agent", PKG_REL, version, "node_modules", "@earendil-works", "pi-coding-agent");
  await mkdir(join(dir, "dist"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version }));
  const body = api
    .map((name) => (name === "VERSION" ? `export const VERSION = ${JSON.stringify(version)};` : `export const ${name} = {};`))
    .join("\n");
  await writeFile(join(dir, "dist", "index.js"), `${body}\nexport default {};\n`);
  return dir;
}

const FULL = [...REQUIRED_API, "VERSION", "createMcpExtension", "createToolSearchExtension"];
const envFor = (home) => ({ PATH: "", PI_CODING_AGENT_DIR: join(home, "agent") });

try {
  /* ---------------------------------------------------- version compare */
  check("1.10.0 sorts above 1.9.0", cmpVersion("1.10.0", "1.9.0") > 0);
  check("v-prefix and suffixes are ignored", cmpVersion("v1.4.0-beta", "1.4.0") === 0);

  /* ---------------------------------------------- nothing installed */
  {
    const home = join(tmp, "empty");
    const report = await inspect({ env: envFor(home), allowNpmRoot: false, includeBare: false });
    check("empty home → not installed", report.installed === false);
    check("empty home → no candidates", report.candidates.length === 0);
    check("empty home → guidance mentions the installer", /pi\.dev\/install/.test(report.guidance ?? ""));
    check("empty home → guidance names the node minimum", (report.guidance ?? "").includes(report.minNode));
    check("empty home → agent dir reported missing", report.agentDirExists === false);
  }

  /* ------------------------------------- newest broken release is skipped */
  {
    const home = join(tmp, "mixed");
    await release(home, "1.4.0", FULL);
    await release(home, "9.9.9", ["createAgentSession"]); // newer, incomplete API
    await writeFile(join(home, "agent", "settings.json"), "{}");
    const report = await inspect({ env: envFor(home), allowNpmRoot: false, includeBare: false });
    check("skips a newer release with a missing API", report.selected?.version === "1.4.0", String(report.selected?.version));
    const broken = report.candidates.find((c) => c.origin === "release 9.9.9");
    check("broken release is reported, not hidden", Boolean(broken) && broken.missing.length > 0, broken?.missing?.join(","));
    check("working release is selected", report.selected?.origin === "release 1.4.0", String(report.selected?.origin));
    check("settings.json presence is detected", report.settings === true);
  }

  /* --------------------------------------------- too old → warning only */
  {
    const home = join(tmp, "old");
    await release(home, "1.0.0", FULL);
    const report = await inspect({ env: envFor(home), allowNpmRoot: false, includeBare: false });
    check("old but working release still loads", report.installed === true);
    check("old release raises a warning", report.warnings.some((w) => w.includes(MIN_PI)), report.warnings.join(" | "));
  }

  /* ------------------------------------------------ pi cli on the agent dir */
  {
    const home = join(tmp, "cli");
    await mkdir(join(home, "agent", "bin"), { recursive: true });
    await writeFile(join(home, "agent", "bin", "pi"), "");
    const found = findPiBinary(envFor(home));
    if (process.platform === "win32") check("pi cli lookup (windows: skipped)", true);
    else check("pi cli found in <agent>/bin", typeof found === "string" && found.endsWith("pi"), String(found));
  }

  /* ------------------------------------------------------- env override */
  check("PI_CODING_AGENT_DIR wins", agentDir({ PI_CODING_AGENT_DIR: "/custom/agent" }) === "/custom/agent");

  /* ------------------------------------------------------ guidance shape */
  const guide = installGuidance();
  check("guidance is platform specific", guide.includes(process.platform === "win32" ? "install.ps1" : "install.sh"));
  check("guidance mentions PI_SDK", guide.includes("PI_SDK"));
  check("guidance mentions `pi-lcars doctor`", guide.includes("pi-lcars doctor"));
} finally {
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed (${results.length} checks)`);
process.exit(failures ? 1 : 0);
