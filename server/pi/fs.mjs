import { readdir, stat, realpath, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, relative, sep, join, dirname, isAbsolute } from "node:path";

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
