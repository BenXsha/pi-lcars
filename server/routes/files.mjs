import { readdir, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { listTree, openPath, readTextFile, streamFile, listBackdropDir, backdropFile, searchFiles } from "../pi/fs.mjs";
import {query} from "../http.mjs";

/**
 * Workspace reads: tree, file index, file/raw bytes, backdrop picker, OS hand-off.
 *
 * A factory, not a singleton: every module receives the same ctx the shell
 * built, so a station cannot reach around it for state.
 */
export function filesRoutes(ctx) {
  const { ok, fail, body, cfg } = ctx;
  return {
  "GET /api/tree": async (req, res) => {
    const q = query(req);
    ok(res, await listTree({
      cwd: cfg.cwd,
      target: q.get("path") || "",
      showHidden: q.get("hidden") === "1",
    }));
  },

  "GET /api/files": async (req, res) => {
    const q = query(req);
    ok(res, await searchFiles({
      cwd: cfg.cwd,
      q: q.get("q") || "",
      limit: Math.min(Number(q.get("limit") || 40) || 40, 200),
    }));
  },

  "GET /api/file": async (req, res) => {
    const q = query(req);
    const target = q.get("path");
    if (!target) return fail(res, 400, "path is required", { code: "E_ARGS" });
    ok(res, await readTextFile({ cwd: cfg.cwd, target }));
  },

  "GET /api/raw": async (req, res) => {
    const q = query(req);
    const target = q.get("path");
    if (!target) return fail(res, 400, "path is required", { code: "E_ARGS" });
    const r = await streamFile({ cwd: cfg.cwd, target, range: req.headers.range });
    if (r.partial) {
      res.writeHead(206, {
        "content-type": r.mime,
        "content-length": r.partial.end - r.partial.start + 1,
        "content-range": `bytes ${r.partial.start}-${r.partial.end}/${r.size}`,
        "accept-ranges": "bytes",
      });
    } else {
      res.writeHead(200, { "content-type": r.mime, "content-length": r.size, "accept-ranges": "bytes" });
    }
    r.stream.pipe(res);
  },

  "POST /api/open": async (req, res) => {
    const b = await body(req);
    const mode = ["editor", "reveal", "default"].includes(b.mode) ? b.mode : "editor";
    const r = await openPath({ cwd: cfg.cwd, target: b.path, mode });
    ok(res, r);
  },

  "GET /api/fs": async (req, res) => {
    const q = query(req);
    // no path → start at the filesystem home: this is a picker, not a cwd viewer
    const target = resolve(q.get("path") || (process.env.HOME || "/"));
    try {
      const entries = await readdir(target, { withFileTypes: true });
      const dirs = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith(".") && e.name !== ".pi") continue;
        const full = join(target, e.name);
        let items = null;
        try {
          items = (await readdir(full)).length;
        } catch {
          items = null;
        }
        dirs.push({ name: e.name, path: full, items });
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      const info = await stat(target);
      const home = process.env.HOME || "/";
      const roots = [
        { label: "HOME", path: home },
        { label: "ROOT", path: "/" },
        { label: "PROJECTS", path: join(home, "Projects") },
      ].filter((r) => r.path);
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
      ok(res, {
        path: target,
        parent: dirname(target) === target ? null : dirname(target),
        dirs,
        home,
        roots,
        readable: info.isDirectory(),
      });
    } catch (e) {
      fail(res, 400, `cannot read ${target}: ${e.code || e.message}`, { code: "E_FS" });
    }
  },

  "GET /api/backdrop": async (req, res) => {
    const q = query(req);
    // no dir → home/Pictures when it exists, else home: this is a picker
    ok(res, await listBackdropDir({
      dir: q.get("dir") || "",
      showHidden: q.get("hidden") === "1",
    }));
  },

  "GET /api/backdrop/file": async (req, res) => {
    const q = query(req);
    const target = q.get("path");
    if (!target) return fail(res, 400, "path is required", { code: "E_ARGS" });
    const r = await backdropFile({ path: target });
    res.writeHead(200, {
      "content-type": r.mime,
      "content-length": r.size,
      "cache-control": "private, max-age=300",
      "last-modified": new Date(r.mtime).toUTCString(),
    });
    r.stream.pipe(res);
  },
  };
}
