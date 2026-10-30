#!/usr/bin/env node
/**
 * Theme contrast gate.
 *
 * Every block colour carries black type, and several roles are also used as
 * text on the darkest surface. This script parses themes.css and fails when a
 * pair drops below its WCAG threshold — so a new palette cannot ship half
 * readable.
 *
 *   node scripts/check-themes.mjs
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = await readFile(join(HERE, "..", "src", "styles", "themes.css"), "utf8");

/* ---------- parse: selector blocks → { role: hex } ---------- */
function parse(css) {
  const themes = [];
  const re = /(\[data-theme="([a-z0-9]+)"\])\s*\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const vars = {};
    for (const line of m[3].split("\n")) {
      const v = line.match(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/i);
      if (v) vars[v[1]] = v[2];
    }
    themes.push({ id: m[2], vars });
  }
  const root = {};
  const rootBlock = css.split(":root,")[1]?.split("}")[0] ?? "";
  for (const line of rootBlock.split("\n")) {
    const v = line.match(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/i);
    if (v) root[v[1]] = v[2];
  }
  themes.unshift({ id: "tng", vars: root });
  // :root, [data-theme="tng"] matches twice — keep the first of each id
  return themes.filter((t, i) => themes.findIndex((x) => x.id === t.id) === i);
}

/* ---------- WCAG ---------- */
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const BLOCK_ROLES = ["orange", "amber", "tang", "tomato", "lilac", "lav", "ice", "moon", "cyan"];
const checks = [
  // black type on every block (the LCARS convention)
  ...BLOCK_ROLES.map((r) => ({ a: "#000000", b: r, min: 4.5, why: `black on --${r}` })),
  { a: "w", b: "bg", min: 7, why: "body text on background" },
  { a: "g3", b: "bg", min: 4.5, why: "secondary text" },
  // small labels use --g2, so it has to clear AA for normal text, not just 3:1
  { a: "g2", b: "bg", min: 4.5, why: "small labels on background" },
  { a: "cyan", b: "g1", min: 4.5, why: "tool duration on meta block" },
  { a: "orange", b: "bg", min: 4.5, why: "streaming label" },
  { a: "amber", b: "bg", min: 4.5, why: "panel header text / warnings" },
  { a: "w", b: "g1", min: 4.5, why: "text on neutral block" },
];

let failed = 0;
for (const { id, vars } of parse(css)) {
  const rows = [];
  for (const c of checks) {
    const a = c.a.startsWith("#") ? c.a : vars[c.a];
    const b = c.b.startsWith("#") ? c.b : vars[c.b];
    if (!a || !b) {
      rows.push(`  MISSING  ${c.why} (${c.a} / ${c.b})`);
      failed++;
      continue;
    }
    const ratio = contrast(a, b);
    const ok = ratio >= c.min;
    if (!ok) failed++;
    rows.push(`  ${ok ? "ok  " : "FAIL"}  ${ratio.toFixed(2).padStart(5)}:1  (min ${c.min})  ${c.why}`);
  }
  console.log(`\n[${id}]`);
  console.log(rows.join("\n"));
}

console.log(failed ? `\n${failed} pair(s) below threshold` : `\nall pairs above threshold`);
process.exit(failed ? 1 : 0);
