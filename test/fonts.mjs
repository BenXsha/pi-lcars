#!/usr/bin/env node
/**
 * The bundled typefaces must stay licensable and stay wired.
 *
 *   node test/fonts.mjs
 *
 * Three things can silently rot and each one is a compliance or a rendering bug:
 *
 *   1. a woff2 disappears from public/fonts while fonts.css still points at it
 *      (the console keeps working — in the fallback face — so nobody notices);
 *   2. a family ships without its OFL text next to it (OFL §1 violated, and
 *      `files: ["dist/"]` means that text is what the tarball carries);
 *   3. fonts.css and the token stacks drift apart, so a "bundled" family is
 *      declared but never used, or used but never declared.
 *
 * No pi process, no browser: this is a file-level gate in `npm test`.
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONTS = join(ROOT, "public", "fonts");

const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  results.push(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const fontsCss = await readFile(join(ROOT, "src", "styles", "fonts.css"), "utf8");
const tokens = await readFile(join(ROOT, "src", "styles", "tokens.css"), "utf8");
const packSrc = await readFile(join(ROOT, "src", "fontPack.ts"), "utf8");

/* fonts.css → [family, weight, file] */
const faces = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const body = m[1];
  return {
    family: /font-family:\s*"([^"]+)"/.exec(body)?.[1] ?? "",
    weight: Number(/font-weight:\s*(\d+)/.exec(body)?.[1] ?? 0),
    file: /url\("\/fonts\/([^"]+\.woff2)"\)/.exec(body)?.[1] ?? "",
  };
});

check("fonts.css declares faces", faces.length >= 3, `${faces.length} faces`);
check(
  "every declared file exists and is a woff2",
  faces.every((f) => f.file && existsSync(join(FONTS, f.file)) && !/^$/.test(f.family)),
  faces
    .filter((f) => !existsSync(join(FONTS, f.file || "x")))
    .map((f) => f.file || "(no url)")
    .join(" ") || "all present",
);

const magic = await Promise.all(
  faces.map(async (f) => {
    const buf = await readFile(join(FONTS, f.file));
    return [f.file, buf.subarray(0, 4).toString("latin1")];
  }),
);
check(
  "woff2 magic",
  magic.every(([, m]) => m === "wOF2"),
  magic.filter(([, m]) => m !== "wOF2").map(([f]) => f).join(" ") || "wOF2 ×" + magic.length,
);

/* the licence has to travel with the font — one OFL text per family */
const families = [...new Set(faces.map((f) => f.family))];
const shipped = await readdir(FONTS);
const oflFiles = shipped.filter((f) => /^OFL-.*\.txt$/.test(f));
const oflBlob = (
  await Promise.all(oflFiles.map((f) => readFile(join(FONTS, f), "utf8")))
).join("\n");
check("one OFL text per family", oflFiles.length === families.length, `${oflFiles.length} texts / ${families.length} families`);
check(
  "OFL texts are real OFL 1.1",
  oflFiles.length > 0 && (await Promise.all(oflFiles.map(async (f) => /SIL OPEN FONT LICENSE/i.test(await readFile(join(FONTS, f), "utf8"))))).every(Boolean),
  oflFiles.join(" "),
);
check(
  "each family is claimed by a licence text",
  families.every((fam) => {
    const key = fam.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return oflBlob.length > 0 && shipped.some((f) => f.toLowerCase().includes(key.toLowerCase()) || oflBlob.includes(fam));
  }),
  families.join(" / "),
);

/* tokens must actually lead with the bundled faces, or bundling is decoration */
const lead = (token) => new RegExp(`${token}:\\s*"([^"]+)"`).exec(tokens)?.[1] ?? "";
check("--din leads with D-DIN", lead("--din") === "D-DIN", lead("--din"));
check("--deco leads with Michroma", lead("--deco") === "Michroma", lead("--deco"));
check("--mono leads with IBM Plex Mono", lead("--mono") === "IBM Plex Mono", lead("--mono"));

/* fontPack.ts is generated from the bytes on disk: sizes must not be stale */
const packSizes = [...packSrc.matchAll(/"bytes":\s*(\d+)/g)].map((m) => Number(m[1]));
const realSizes = families.map((fam) =>
  faces.filter((f) => f.family === fam).reduce((n, f) => n + (existsSync(join(FONTS, f.file)) ? statSync(join(FONTS, f.file)).size : 0), 0),
);
check(
  "fontPack.ts byte counts match the files",
  packSizes.length === realSizes.length && packSizes.every((n, i) => n === realSizes[i]),
  `${packSizes.join(",")} vs ${realSizes.join(",")}`,
);

const total = realSizes.reduce((a, b) => a + b, 0);
check("payload stays under 120 KB", total < 120 * 1024, `${total} B`);

/* nothing ships if the build forgot them */
if (existsSync(join(ROOT, "dist"))) {
  const distFonts = existsSync(join(ROOT, "dist", "fonts")) ? await readdir(join(ROOT, "dist", "fonts")) : [];
  check("dist/fonts carries the faces + licences", faces.every((f) => distFonts.includes(f.file)) && oflFiles.every((f) => distFonts.includes(f)), `${distFonts.length} files`);
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} font check(s) failed` : `\n${faces.length} faces · ${families.length} families · ${total} B`);
process.exit(failures ? 1 : 0);
