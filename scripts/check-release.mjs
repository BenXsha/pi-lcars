#!/usr/bin/env node
/**
 * Pre-publish gate — `npm publish` runs this before anything is packed.
 *
 *   node scripts/check-release.mjs
 *
 * Five things have to be true at the moment a version goes out, and all five
 * are the kind of thing you only notice after it is on the registry:
 *
 *   1. CHANGELOG.md has notes for THIS version (and they are the newest section,
 *      so a forgotten bump cannot republish old notes under a new number);
 *   2. the working tree is clean — the tarball must be reproducible from a commit;
 *   3. `bin/` is executable (install-time npm links it; a 644 file is a bad habit);
 *   4. LICENSE travels with the package (MIT requires it);
 *   5. everything named in `files` exists — a typo silently shrinks the package.
 *
 * `npm test` is chained after this in `prepublishOnly`: notes first (fast), then
 * the full gate.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const results = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  results.push(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/* 1. release notes for this exact version, as the newest section */
const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const sections = changelog
  .split(/^## /m)
  .slice(1)
  .map((chunk) => chunk.split("\n")[0].trim());
const mine = sections.findIndex((head) => head.startsWith(`[${pkg.version}]`));
check("CHANGELOG.md has notes for this version", mine === 0, `## ${sections[0] ?? "(no sections)"} · want ## [${pkg.version}]`);
check(
  "the notes are the newest section",
  mine === 0 && sections.length > 1,
  mine > 0 ? `## [${pkg.version}] is section ${mine + 1}` : `${sections.length} sections`,
);

/* 2. a clean tree: what is packed must be what is committed */
let dirty = "";
try {
  dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
} catch {
  dirty = "(not a git checkout)";
}
check("the working tree is clean", dirty === "", dirty ? dirty.split("\n").slice(0, 3).join(" · ") : "clean");

/* 3. the launcher keeps its executable bit */
const binMode = statSync(join(ROOT, "bin", "pi-lcars.mjs")).mode & 0o111;
check("bin/pi-lcars.mjs is executable", binMode !== 0, `mode ${(statSync(join(ROOT, "bin", "pi-lcars.mjs")).mode & 0o777).toString(8)}`);

/* 4. licence travels with the package */
check("LICENSE is present", existsSync(join(ROOT, "LICENSE")));

/* 5. `files` names real paths (and the ones npm needs anyway).
 *    `dist/` is gitignored and built by `prepack`, which runs AFTER this gate —
 *    so it is only missing on a fresh clone, not on a broken package. */
const BUILD_OUT = new Set(["dist/"]);
const missing = (pkg.files ?? []).filter((f) => !BUILD_OUT.has(f) && !existsSync(join(ROOT, f)));
check("every entry in files[] exists", missing.length === 0, missing.join(", ") || `${pkg.files.length} entries`);
check(
  "the package carries its readme, notes and launcher",
  ["README.md", "CHANGELOG.md", "bin/", "dist/", "server/"].every((f) => (pkg.files ?? []).includes(f)),
  (pkg.files ?? []).join(" "),
);
/* 6. README images must be ABSOLUTE. npm renders a relative path against the
 *    published tarball and pi.dev rewrites it to jsDelivr of that tarball — both
 *    404 as soon as the file is not shipped (0.5.0 shipped exactly that bug). */
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const relImages = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
  .map((m) => m[1])
  .filter((src) => !/^https:\/\//.test(src));
check("README images are absolute urls", relImages.length === 0, relImages.join(", ") || "all absolute");
check(
  "the preview image is served from a cdn",
  /^https:\/\/cdn\.jsdelivr\.net\/gh\//.test(pkg.pi?.image ?? ""),
  pkg.pi?.image ?? "(no pi.image)",
);
check(
  "the canonical repo is the public one",
  /github\.com\/BenXsha\/pi-lcars/.test(pkg.repository?.url ?? "") && /github\.com/.test(pkg.bugs?.url ?? ""),
  `${pkg.repository?.url ?? "?"} · ${pkg.bugs?.url ?? "?"}`,
);

check(
  "publishing is pinned to the public registry",
  pkg.publishConfig?.registry === "https://registry.npmjs.org" && pkg.publishConfig?.access === "public",
  JSON.stringify(pkg.publishConfig ?? null),
);

console.log(`\n  pi-lcars ${pkg.version} — release readiness\n`);
console.log(results.join("\n"));
console.log(failures ? `\n  ${failures} check(s) failed — fix them before publishing\n` : "\n  ready to publish\n");
process.exit(failures ? 1 : 0);
