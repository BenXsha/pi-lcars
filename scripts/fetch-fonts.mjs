#!/usr/bin/env node
/**
 * Fetch the bundled typefaces — verbatim, from canonical OFL upstreams.
 *
 *   node scripts/fetch-fonts.mjs          # (re)download into public/fonts
 *   node scripts/fetch-fonts.mjs --check  # verify what is on disk, download nothing
 *
 * Why not the catalogue sites: fontspace.io is a WordPress aggregator that
 * redistributes commercial faces (Helvetica Neue, Microgramma, Eurostile,
 * Lucida Grande…) as "free" downloads. A page that claims OFL is not a licence
 * grant, and the download has no OFL.txt next to it. OFL §1 requires the
 * licence to travel with the font, so the bundle is built from the upstream
 * that actually publishes licence + glyphs:
 *
 *   D-DIN          github.com/amcchord/datto-d-din   (mirror of Datto's OFL release)
 *   Michroma       github.com/google/fonts  ofl/michroma
 *   IBM Plex Mono  github.com/google/fonts  ofl/ibmplexmono
 *
 * Everything lands in `public/fonts/`, which Vite copies to `dist/fonts/`
 * verbatim, so the fonts and their licences ship inside the npm tarball.
 * `src/fontPack.ts` is generated from the bytes on disk — ABOUT reports real
 * sizes instead of a hand-written number (AGENTS §7.6).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "fonts");
const PACK = join(ROOT, "src", "fontPack.ts");
const CHECK = process.argv.includes("--check");

/* A browser UA is required: gstatic only serves woff2 + unicode-range blocks
 * to clients that advertise woff2 support. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/**
 * One entry per shipped file. `kind:"css"` resolves the google-fonts CSS and
 * keeps the `/* latin *​/` block only — these faces are used for Latin labels,
 * numerals and code, so the cyrillic/greek/vietnamese subsets are dead weight
 * (~2/3 of the payload).
 */
const SPECS = [
  {
    file: "d-din-400.woff2",
    family: "D-DIN",
    weight: 400,
    role: "instrument",
    license: "OFL-1.1",
    project: "https://github.com/amcchord/datto-d-din",
    kind: "url",
    url: "https://raw.githubusercontent.com/amcchord/datto-d-din/master/D-DIN.woff2",
  },
  {
    file: "d-din-700.woff2",
    family: "D-DIN",
    weight: 700,
    role: "instrument",
    license: "OFL-1.1",
    project: "https://github.com/amcchord/datto-d-din",
    kind: "url",
    url: "https://raw.githubusercontent.com/amcchord/datto-d-din/master/D-DIN-Bold.woff2",
  },
  {
    file: "michroma-400.woff2",
    family: "Michroma",
    weight: 400,
    role: "deco",
    license: "OFL-1.1",
    project: "https://github.com/google/fonts/tree/main/ofl/michroma",
    kind: "css",
    css: "https://fonts.googleapis.com/css2?family=Michroma&display=swap",
  },
  {
    file: "ibm-plex-mono-400.woff2",
    family: "IBM Plex Mono",
    weight: 400,
    role: "code",
    license: "OFL-1.1",
    project: "https://github.com/google/fonts/tree/main/ofl/ibmplexmono",
    kind: "css",
    css: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&display=swap",
  },
  {
    file: "ibm-plex-mono-600.woff2",
    family: "IBM Plex Mono",
    weight: 600,
    role: "code",
    license: "OFL-1.1",
    project: "https://github.com/google/fonts/tree/main/ofl/ibmplexmono",
    kind: "css",
    css: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@600&display=swap",
  },
];

/** OFL §1: the licence text has to travel with the font. One file per family. */
const LICENSES = [
  {
    file: "OFL-D-DIN.txt",
    url: "https://raw.githubusercontent.com/amcchord/datto-d-din/master/OFL-1.1.txt",
  },
  {
    file: "OFL-Michroma.txt",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/michroma/OFL.txt",
  },
  {
    file: "OFL-IBM-Plex-Mono.txt",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/OFL.txt",
  },
];

async function get(url, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
      return res;
    } catch (err) {
      last = err;
      // gstatic/raw.githubusercontent drop connections now and then; a retry
      // costs seconds, a half-written font folder costs a confused debug session
      if (i < attempts - 1) await new Promise((done) => setTimeout(done, 800 * (i + 1)));
    }
  }
  throw last;
}

/** the `/* latin *​/` face of a google-fonts stylesheet */
function latinUrl(css) {
  const block = /\/\*\s*latin\s*\*\/\s*@font-face\s*\{([^}]*)\}/.exec(css)?.[1];
  const url = block && /url\((https:[^)]+\.woff2)\)/.exec(block)?.[1];
  if (!url) throw new Error("no latin woff2 in stylesheet");
  return url;
}

async function download(spec) {
  const url = spec.kind === "css" ? latinUrl(await (await get(spec.css)).text()) : spec.url;
  const buf = Buffer.from(await (await get(url)).arrayBuffer());
  if (buf.subarray(0, 4).toString("latin1") !== "wOF2") {
    throw new Error(`${spec.file}: not a woff2 (${buf.subarray(0, 4).toString("latin1")})`);
  }
  return { buf, url };
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

async function main() {
  if (!CHECK) await mkdir(OUT, { recursive: true });

  /* download first, write later: a network failure halfway through must not
   * leave a folder with three new faces and two stale ones */
  const staged = [];
  for (const spec of SPECS) {
    const path = join(OUT, spec.file);
    if (CHECK) {
      if (!existsSync(path)) throw new Error(`missing ${spec.file} — run node scripts/fetch-fonts.mjs`);
      staged.push({ spec, buf: await readFile(path), url: spec.kind === "css" ? spec.css : spec.url });
    } else {
      const got = await download(spec);
      staged.push({ spec, buf: got.buf, url: got.url });
    }
  }

  const licences = [];
  if (!CHECK) {
    for (const spec of LICENSES) {
      const text = await (await get(spec.url)).text();
      if (!/SIL OPEN FONT LICENSE/i.test(text)) throw new Error(`${spec.file}: not an OFL text`);
      licences.push({ spec, text });
    }
  }

  const rows = [];
  for (const { spec, buf, url } of staged) {
    if (!CHECK) await writeFile(join(OUT, spec.file), buf);
    rows.push({ ...spec, bytes: buf.length, sha256: sha(buf), resolved: url });
    console.log(`${CHECK ? "ok  " : "get "} ${spec.file.padEnd(26)} ${String(buf.length).padStart(7)} B`);
  }
  for (const { spec, text } of licences) {
    await writeFile(join(OUT, spec.file), text);
    console.log(`get  ${spec.file.padEnd(26)} ${String(Buffer.byteLength(text)).padStart(7)} B`);
  }

  const total = rows.reduce((n, r) => n + r.bytes, 0);
  const byFamily = new Map();
  for (const r of rows) {
    const entry = byFamily.get(r.family) ?? { family: r.family, role: r.role, license: r.license, project: r.project, weights: [], bytes: 0 };
    entry.weights.push(r.weight);
    entry.bytes += r.bytes;
    byFamily.set(r.family, entry);
  }
  const pack = [...byFamily.values()];

  /* provenance note inside the shipped folder — readable without node_modules */
  const notes = [
    "BUNDLED TYPEFACES — provenance",
    "",
    "Every file here is an unmodified download from the upstream that publishes both",
    "the glyphs and the SIL Open Font License 1.1 text. Nothing was edited, renamed or",
    "re-subsetted, so no Reserved Font Name is violated.",
    "",
    ...pack.map(
      (p) =>
        `${p.family}  (${p.role}, weights ${p.weights.join("/")})\n  ${p.license} — ${p.project}`,
    ),
    "",
    "Licence texts: OFL-D-DIN.txt · OFL-Michroma.txt · OFL-IBM-Plex-Mono.txt",
    `Total payload: ${total} B (${pack.length} families, ${rows.length} files).`,
    "",
    "Regenerate with `node scripts/fetch-fonts.mjs`; verify with `--check`.",
    "",
  ].join("\n");
  if (!CHECK) await writeFile(join(OUT, "README.txt"), notes);

  /* digests, so `--check` and test/fonts.mjs can prove the bytes did not drift */
  const sums = rows.map((r) => `${r.sha256}  ${r.file}`).join("\n") + "\n";
  const sumsPath = join(OUT, "SHA256SUMS");
  if (CHECK) {
    if (!existsSync(sumsPath)) throw new Error("no SHA256SUMS — run without --check to generate it");
    const recorded = await readFile(sumsPath, "utf8");
    for (const r of rows) {
      if (!recorded.includes(`${r.sha256}  ${r.file}`)) throw new Error(`${r.file}: digest drift (re-run without --check)`);
    }
  } else {
    await writeFile(sumsPath, sums);
  }

  const ts = `/* GENERATED by scripts/fetch-fonts.mjs — do not edit.
   Real byte counts and digests of the files in public/fonts, so ABOUT can report
   what actually shipped instead of a hand-written number (AGENTS §7.6). */

export type FontPackEntry = {
  family: string;
  role: "instrument" | "deco" | "code";
  license: string;
  project: string;
  weights: number[];
  bytes: number;
};

export const FONT_PACK: FontPackEntry[] = ${JSON.stringify(pack, null, 2)};

/** total bytes of the shipped woff2 payload */
export const FONT_PACK_BYTES = ${total};

/** licence texts that travel with the fonts (public/fonts/…) */
export const FONT_LICENSES = ${JSON.stringify(LICENSES.map((l) => l.file))} as const;
`;
  if (!CHECK) await writeFile(PACK, ts);

  console.log(`\n${CHECK ? "verified" : "fetched"} ${rows.length} faces · ${pack.length} families · ${total} B`);
}

main().catch((err) => {
  console.error(`\nfetch-fonts: ${err.message}`);
  process.exit(1);
});
