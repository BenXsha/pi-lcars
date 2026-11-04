#!/usr/bin/env node
/**
 * The whole release, in one command.
 *
 *   npm run ship -- --dry-run     print the plan, change nothing
 *   npm run ship -- --yes         tag, push to both remotes, publish, verify
 *
 * Five steps in a fixed order, because each one can strand the others:
 *
 *   1. gates       clean tree + `check-release` (notes for THIS version, files[],
 *                  executable bin, licence, publishConfig)
 *   2. tag         `v<version>` must not exist, locally or on either remote
 *   3. push        `main` + the tag to Gitee AND GitHub (one `git push`: the
 *                  remote carries two push URLs)
 *   4. publish     `npm publish` — its own prepublishOnly runs the gate + npm test
 *   5. verify      poll the registry until `latest` is this version, then print
 *                  the three URLs a human will want next
 *
 * It refuses to run without `--yes`, and it refuses at step 1 rather than
 * half-way: a release that fails after the push leaves a tag nobody can install.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const args = new Set(process.argv.slice(2));
const dry = args.has("--dry-run");
const yes = args.has("--yes");

const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const V = pkg.version;
const TAG = `v${V}`;
const REGISTRY = "https://registry.npmjs.org";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const say = (s = "") => process.stdout.write(`${s}\n`);
const bad = (s) => {
  process.stderr.write(`\n  ✗ ${s}\n\n`);
  process.exit(1);
};
const git = (a, opts = {}) => run("git", a, { cwd: ROOT, timeout: 120_000, ...opts });
const npm = (a, opts = {}) => run("npm", a, { cwd: ROOT, timeout: 900_000, ...opts });

say(`\n  pi-lcars ${V} — release\n`);

/* ---------------------------------------------------------------- 1. gates */
const { stdout: dirty } = await git(["status", "--porcelain"]);
if (dirty.trim()) bad(`working tree is dirty:\n${dirty.trim().split("\n").slice(0, 5).join("\n")}`);
say("  ok  working tree is clean");

try {
  await run(process.execPath, [join(ROOT, "scripts", "check-release.mjs")], { cwd: ROOT, timeout: 120_000 });
  say("  ok  check-release");
} catch (e) {
  bad(`check-release failed:\n${(e.stdout ?? "") + (e.stderr ?? "")}`);
}

/* ------------------------------------------------------------------ 2. tag */
const hasTag = async () => {
  try {
    await git(["rev-parse", "--verify", `refs/tags/${TAG}`]);
    return "local";
  } catch {
    /* not here */
  }
  for (const remote of ["origin"]) {
    try {
      const { stdout } = await git(["ls-remote", "--tags", remote, TAG]);
      if (stdout.trim()) return remote;
    } catch {
      /* unreachable remote: the push below will say so */
    }
  }
  return null;
};
const where = await hasTag();
if (where) bad(`tag ${TAG} already exists (${where}) — bump the version first`);
say(`  ok  ${TAG} is free`);

/* -------------------------------------------------------------- 3. targets */
let pushUrls = [];
try {
  const { stdout } = await git(["config", "--get-all", "remote.origin.pushurl"]);
  pushUrls = stdout.trim().split("\n").filter(Boolean);
} catch {
  /* single-push setup: fall back to the fetch url */
}
if (!pushUrls.length) {
  try {
    const { stdout } = await git(["remote", "get-url", "origin"]);
    pushUrls = [stdout.trim()];
  } catch {
    bad("no origin remote");
  }
}
say(`  ·   push targets: ${pushUrls.join("  +  ")}`);

let who = "";
try {
  who = (await npm(["whoami", `--registry=${REGISTRY}`])).stdout.trim();
  say(`  ok  npm auth (${who})`);
} catch {
  bad(`npm is not authenticated for ${REGISTRY}.
      Copy a token with publish rights to the clipboard, then:
        read -rsp "token: " T; echo
        printf '//registry.npmjs.org/:_authToken=%s\\n' "$T" >> ~/.npmrc
        unset T`);
}

let published = false;
try {
  await npm(["view", `pi-lcars@${V}`, "version", `--registry=${REGISTRY}`]);
  published = true;
} catch {
  /* 404 = the good case */
}
if (published) bad(`${V} is already on ${REGISTRY} — versions are immutable, bump it`);

const pkgExists = existsSync(join(ROOT, "dist", "index.html"));
say(`  ·   dist/: ${pkgExists ? "present (prepack rebuilds it anyway)" : "missing — prepack will build it"}`);

/* ------------------------------------------------------------------ plan */
say(`\n  plan\n    1  git tag -a ${TAG} -m "pi-lcars ${V}"`);
say(`    2  git push origin main --follow-tags     → ${pushUrls.length} remote(s)`);
say(`    3  npm publish                            → ${REGISTRY} (latest)`);
say(`    4  poll the registry until latest === ${V}\n`);

if (dry || !yes) {
  say(dry ? "  dry run — nothing changed\n" : `  pass --yes to run it\n`);
  process.exit(0);
}

/* --------------------------------------------------------------- 4. do it */
await git(["tag", "-a", TAG, "-m", `pi-lcars ${V}`]);
say(`  ok  tagged ${TAG}`);

try {
  await git(["push", "origin", "main", "--follow-tags"], { timeout: 300_000 });
  say("  ok  pushed main + tags to every remote");
} catch (e) {
  bad(`push failed — the tag exists locally only:\n${(e.stderr ?? e.message).trim()}
      Fix the remote (ssh key / token), then:
        git push origin main --follow-tags
        npm publish`);
}

say("  …  npm publish (runs the gate + npm test, then builds dist)");
try {
  const { stdout } = await npm(["publish"], { timeout: 1_800_000 });
  const line = stdout.split("\n").filter(Boolean).slice(-1)[0] ?? "";
  say(`  ok  ${line}`);
} catch (e) {
  bad(`publish failed (the tag is already pushed, the version is not on npm):\n${(e.stderr ?? e.message).trim()}
      Re-run \`npm publish\` once the cause is fixed — no need to re-tag.`);
}

/* --------------------------------------------------------------- 5. verify */
for (let i = 0; i < 40; i++) {
  try {
    const { stdout } = await npm(["view", "pi-lcars", "dist-tags", `--registry=${REGISTRY}`, "--json"], { timeout: 60_000 });
    const tags = JSON.parse(stdout.replace(/'/g, '"'));
    if (tags.latest === V) break;
  } catch {
    /* registry still propagating */
  }
  await sleep(15_000);
}

say(`\n  released ${V}
    npm        https://www.npmjs.com/package/pi-lcars/v/${V}
    install    npx pi-lcars@${V}   ·   pi install npm:pi-lcars
    gallery    https://pi.dev/packages/pi-lcars   (re-indexes on its own schedule)
    bundle     npm run release  → release/pi-lcars-${V}-share.tar.gz
`);
