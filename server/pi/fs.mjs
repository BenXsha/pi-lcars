import { readdir, stat, realpath, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, relative, sep, join, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";

const SKIP = new Set(["node_modules", ".git", "dist", ".turbo", ".next"]);

/** Resolve a client path and refuse anything outside the workspace. */
export async function guardPath(cwd, target = "") {
  const abs = resolve(cwd, target || ".");
  const root = await realpath(cwd).catch(() => cwd);
  const real = await realpath(abs).catch(() => abs);
  if (real !== root && !real.startsWith(root + sep)) {
    const e = new Error(`outside workspace: ${target}`);
    e.status = 403;
    e.code = "E_OUTSIDE";
    throw e;
  }
  return { abs: real, root };
}

const kindOf = (d) => (d.isDirectory() ? "dir" : d.isFile() ? "file" : "other");

export async function listTree({ cwd, target, showHidden = false }) {
  const { abs, root } = await guardPath(cwd, target);
  const dirents = await readdir(abs, { withFileTypes: true });

  const entries = [];
  for (const d of dirents) {
    if (!showHidden && d.name.startsWith(".")) continue;
    if (SKIP.has(d.name)) continue;
    const full = join(abs, d.name);
    const kind = kindOf(d);
    let size = null;
    if (kind === "file") {
      try {
        size = (await stat(full)).size;
      } catch {
        size = null;
      }
    }
    entries.push({
      name: d.name,
      path: full,
      rel: relative(root, full),
      type: kind,
      size,
    });
  }

  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));

  return {
    path: abs,
    rel: relative(root, abs) || ".",
    parent: abs === root ? null : dirname(abs),
    root,
    entries,
  };
}

/* ------------------------------------------------------- @ completions */
/*
 * The composer's `@` palette needs a flat file list, not a per-directory tree:
 * the operator types `@regist` and expects `server/pi/registry.mjs` even though
 * they never expanded two folders. One walk, cached, so typing does not hammer
 * the disk; the cache is invalidated by age, not by watchers.
 */
const INDEX_TTL_MS = 20_000;
const fileIndex = new Map();

async function walkFiles(root, maxFiles, maxDepth) {
  const out = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length && out.length < maxFiles) {
    const { dir, depth } = stack.pop();
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      if (d.name.startsWith(".") || SKIP.has(d.name)) continue;
      const full = join(dir, d.name);
      if (d.isDirectory()) {
        if (depth + 1 <= maxDepth) stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!d.isFile()) continue;
      out.push(relative(root, full).split(sep).join("/"));
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

/**
 * Ranked workspace files for `@` completion.
 *
 * 0 = the file name starts with the query, 1 = it contains it, 2 = the path
 * does. Ties fall back to depth then length, so `src/api.ts` beats
 * `src/views/deep/nested/api.ts` for the same query.
 */
export async function searchFiles({ cwd, q = "", limit = 40, maxFiles = 8000, maxDepth = 12 }) {
  const root = await realpath(cwd).catch(() => cwd);
  const hit = fileIndex.get(root);
  const fresh = hit && Date.now() - hit.at < INDEX_TTL_MS;
  const files = fresh ? hit.files : await walkFiles(root, maxFiles, maxDepth);
  if (!fresh) fileIndex.set(root, { at: Date.now(), files });

  const needle = String(q).toLowerCase().replace(/^@/, "").trim();
  const rows = [];
  for (const rel of files) {
    const lower = rel.toLowerCase();
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    const score = !needle
      ? rel.split("/").length - 1
      : base.startsWith(needle)
        ? 0
        : base.includes(needle)
          ? 1
          : lower.includes(needle)
            ? 2
            : -1;
    if (score < 0) continue;
    rows.push({ rel, base: rel.slice(rel.lastIndexOf("/") + 1), dir: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "", score });
  }
  rows.sort((a, b) =>
    a.score !== b.score ? a.score - b.score : a.rel.length - b.rel.length || a.rel.localeCompare(b.rel),
  );

  return {
    query: needle,
    root,
    total: rows.length,
    scanned: files.length,
    truncated: files.length >= maxFiles,
    files: rows.slice(0, limit),
  };
}

/** Ordered candidates; the first one that actually spawns wins. */
const TOOL = {
  editor: [
    { cmd: "code", args: (p) => ["-g", p] },
    { cmd: "open", args: (p) => ["-a", "Visual Studio Code", p] },
    { cmd: "open", args: (p) => [p] },
  ],
  reveal: [{ cmd: "open", args: (p) => ["-R", p] }],
  default: [{ cmd: "open", args: (p) => [p] }],
};

/**
 * Hand a file to the OS or to an editor. Detached on purpose: the console must
 * not wait on a GUI app, and its output is not ours to read.
 */
export async function openPath({ cwd, target, mode = "editor" }) {
  const { abs } = await guardPath(cwd, target);
  const chain = TOOL[mode] ?? TOOL.editor;

  const run = (spec) =>
    new Promise((ok, fail) => {
      try {
        const args = spec.args(abs);
        const child = spawn(spec.cmd, args, { detached: true, stdio: "ignore" });
        // resolve on 'spawn', not immediately: ENOENT arrives asynchronously
        child.once("spawn", () => {
          child.unref();
          ok({ cmd: spec.cmd, args });
        });
        child.once("error", fail);
      } catch (e) {
        fail(e);
      }
    });

  let lastErr;
  for (const spec of chain) {
    try {
      return await run(spec);
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error(`cannot open with any known tool: ${lastErr?.message ?? "unknown"}`);
  err.status = 500;
  err.code = "E_OPEN";
  throw err;
}

/* Only what a browser can render: text, images, audio, video. Everything else
   is reported as "other" and left to the OS. */
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico"]);
const AUDIO = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"]);
const VIDEO = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv"]);
const TEXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".md", ".mdx", ".txt", ".log",
  ".css", ".scss", ".sass", ".less", ".html", ".htm", ".vue", ".svelte", ".xml", ".svg", ".yml",
  ".yaml", ".toml", ".ini", ".env", ".sh", ".zsh", ".bash", ".py", ".rb", ".go", ".rs", ".java",
  ".kt", ".swift", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".php", ".sql", ".graphql", ".diff",
  ".patch", ".gitignore", ".editorconfig", ".lock", "",
]);

const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif", ".bmp": "image/bmp",
  ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac", ".opus": "audio/opus",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4",
  ".ogv": "video/ogg",
};

/** What the viewer can do with this path. */
export function classify(absPath) {
  const ext = (absPath.match(/\.[^./]+$/)?.[0] || "").toLowerCase();
  const kind = IMAGE.has(ext) ? "image" : AUDIO.has(ext) ? "audio" : VIDEO.has(ext) ? "video" : TEXT.has(ext) ? "text" : "other";
  return { ext, kind, mime: MIME[ext] ?? (kind === "text" ? "text/plain; charset=utf-8" : "application/octet-stream") };
}

/** Read a file for the in-app viewer: text inline, media by URL, else metadata. */
export async function readTextFile({ cwd, target, maxBytes = 512 * 1024, maxLines = 6000 }) {
  const { abs, root } = await guardPath(cwd, target);
  const st = await stat(abs);
  if (!st.isFile()) {
    const e = new Error(`not a file: ${target}`);
    e.status = 400;
    e.code = "E_NOT_FILE";
    throw e;
  }
  const { ext, kind, mime } = classify(abs);
  const base = { path: abs, rel: relative(root, abs), size: st.size, kind, mime, ext, mtime: st.mtime };

  if (kind !== "text") return { ...base, lines: 0, truncated: false, reason: null, text: "" };

  if (st.size > maxBytes) {
    return { ...base, truncated: true, reason: "size", text: "", lines: 0 };
  }
  const buf = await readFile(abs);
  if (buf.subarray(0, 8000).includes(0)) {
    return { ...base, kind: "other", mime: "application/octet-stream", truncated: true, reason: "binary", text: "", lines: 0 };
  }
  const text = buf.toString("utf8");
  const all = text.split("\n");
  const clipped = all.length > maxLines;
  const shown = clipped ? all.slice(0, maxLines).join("\n") : text;
  return { ...base, lines: all.length, truncated: clipped, reason: clipped ? "lines" : null, text: shown };
}

export const isInside = (root, p) => {
  const abs = isAbsolute(p) ? p : resolve(root, p);
  return abs === root || abs.startsWith(root + sep);
};

/* ------------------------------------------------------------- backdrop */
/*
 * The backdrop is the one thing the console reads from outside the workspace:
 * the operator picks a still from their own disk. Nothing is copied into the
 * project, nothing is stored server-side — the chosen path is kept in the
 * client's settings and the bytes are read in place, so moving or deleting the
 * file simply turns the backdrop off. The endpoint is local-only (the server
 * binds 127.0.0.1) and refuses anything that is not a plain image file.
 */
const BACKDROP_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".bmp"]);
const BACKDROP_MAX = 64 * 1024 * 1024;
const BACKDROP_ROWS = 400;

const extOf = (p) => (p.match(/\.[^./\\]+$/)?.[0] || "").toLowerCase();
const isBackdropImage = (p) => BACKDROP_EXT.has(extOf(p));

const backdropError = (message, status, code) => {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
};

const isDir = async (p) => {
  try {
    const st = await stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
};

/** Roots the picker offers: only paths that actually exist on this machine. */
async function backdropRoots(home) {
  const roots = [];
  const add = async (label, p) => {
    if (await isDir(p)) roots.push({ label, path: p });
  };
  await add("HOME", home);
  await add("PICTURES", join(home, "Pictures"));
  await add("DESKTOP", join(home, "Desktop"));
  await add("DOWNLOADS", join(home, "Downloads"));
  await add("ROOT", process.platform === "win32" ? `${process.env.SystemDrive || "C:"}\\` : "/");
  if (process.platform === "darwin") {
    try {
      for (const v of await readdir("/Volumes")) {
        if (v === "Macintosh HD") continue;
        roots.push({ label: `VOL ${v}`, path: join("/Volumes", v) });
      }
    } catch {
      /* no volumes */
    }
  }
  return roots;
}

/** One directory of the picker: sub-folders plus the images it can show. */
export async function listBackdropDir({ dir, showHidden = false } = {}) {
  const home = homedir();
  let start = dir ? resolve(dir) : join(home, "Pictures");
  if (!dir && !(await isDir(start))) start = home;

  let dirents;
  try {
    dirents = await readdir(start, { withFileTypes: true });
  } catch (e) {
    throw backdropError(`cannot read ${start}: ${e.code || e.message}`, 400, "E_BACKDROP");
  }

  const dirs = [];
  const images = [];
  for (const d of dirents) {
    if (!showHidden && d.name.startsWith(".")) continue;
    const full = join(start, d.name);
    if (d.isDirectory()) {
      if (!SKIP.has(d.name)) dirs.push({ name: d.name, path: full });
      continue;
    }
    if (!d.isFile() || !isBackdropImage(d.name)) continue;
    try {
      const st = await stat(full);
      images.push({ name: d.name, path: full, size: st.size, mtime: Math.round(st.mtimeMs) });
    } catch {
      /* unreadable entry — skip it rather than fail the listing */
    }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  // newest first: the still somebody just downloaded is the one they want
  images.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));

  return {
    path: start,
    parent: dirname(start) === start ? null : dirname(start),
    home,
    roots: await backdropRoots(home),
    dirs: dirs.slice(0, BACKDROP_ROWS),
    images: images.slice(0, BACKDROP_ROWS),
    truncated: dirs.length > BACKDROP_ROWS || images.length > BACKDROP_ROWS,
  };
}

/** Stream the chosen still. Absolute image path only; no workspace guard on purpose. */
export async function backdropFile({ path: target }) {
  if (!target || !isAbsolute(target)) throw backdropError("an absolute image path is required", 400, "E_ARGS");
  const abs = await realpath(target).catch(() => target);
  if (!isBackdropImage(abs)) throw backdropError(`not an image file: ${target}`, 415, "E_NOT_IMAGE");
  const st = await stat(abs).catch(() => null);
  if (!st || !st.isFile()) throw backdropError(`not a file: ${target}`, 400, "E_NOT_FILE");
  if (st.size > BACKDROP_MAX) throw backdropError(`image is larger than ${BACKDROP_MAX / 1048576} MB`, 413, "E_TOO_LARGE");
  const { mime } = classify(abs);
  const { createReadStream } = await import("node:fs");
  return { abs, size: st.size, mime, mtime: Math.round(st.mtimeMs), stream: createReadStream(abs) };
}

/** Stream raw bytes with range support (video scrubbing needs it). */
export async function streamFile({ cwd, target, range }) {
  const { abs } = await guardPath(cwd, target);
  const st = await stat(abs);
  if (!st.isFile()) {
    const e = new Error(`not a file: ${target}`);
    e.status = 400;
    e.code = "E_NOT_FILE";
    throw e;
  }
  const { mime } = classify(abs);
  const { createReadStream } = await import("node:fs");
  if (!range) return { size: st.size, mime, stream: createReadStream(abs), partial: null };
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return { size: st.size, mime, stream: createReadStream(abs), partial: null };
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : st.size - 1;
  return { size: st.size, mime, stream: createReadStream(abs, { start, end }), partial: { start, end } };
}
