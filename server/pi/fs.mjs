import { readdir, stat, realpath } from "node:fs/promises";
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

export const isInside = (root, p) => {
  const abs = isAbsolute(p) ? p : resolve(root, p);
  return abs === root || abs.startsWith(root + sep);
};
