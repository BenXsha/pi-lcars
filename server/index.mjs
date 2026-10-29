#!/usr/bin/env node
/**
 * LCARS agent console — server.
 *
 *   node server/index.mjs
 *
 * Zero runtime dependencies beyond the pi SDK. Serves the built client from
 * dist/ and exposes a REST + SSE surface over an in-process pi session.
 */
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSdk, agentDir } from "./pi/sdk.mjs";
import { Approvals } from "./pi/approval.mjs";
import { createQueue } from "./pi/queue.mjs";
import { Registry } from "./pi/registry.mjs";
import { now, summaryOf } from "./pi/format.mjs";
import { readMcp, setEnabled, addServer, removeServer } from "./pi/mcpConfig.mjs";
import { listTree, openPath } from "./pi/fs.mjs";
import { listProviders, listProviderModels, testProvider, setDefaultModel, setProviderKey } from "./pi/providers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 4173);
const CWD = resolve(process.env.PI_CWD || process.cwd());
const SESSION_DIR = process.env.LCARS_SESSIONS || undefined;
const TRUST = process.env.LCARS_TRUST_PROJECT !== "0";
const RESUME = process.env.LCARS_RESUME === "1";

/* --------------------------------------------------------------- plumbing */
const clients = new Set();
const sink = (msg) => {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
const ok = (res, data) => json(res, 200, { ok: true, data });
const fail = (res, code, error, extra = {}) =>
  json(res, code, { ok: false, error: String(error?.message || error), ...extra });

const body = (req) =>
  new Promise((done, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 4_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!raw) return done({});
      try {
        done(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
  });

/* ------------------------------------------------------------------- app */
/** resolved in the listen callback; every route waits for it */
let bootPromise = null;
const booted = () => bootPromise ?? Promise.resolve();
const sdk = await loadSdk();
const approvals = new Approvals({
  policy: (process.env.LCARS_POLICY || "off").toLowerCase(),
  timeoutMs: Number(process.env.LCARS_APPROVAL_TIMEOUT || 120_000),
});
const queue = createQueue({
  onChange: () => {
    for (const entry of registry.sessions.values()) {
      entry.pushMeta();
    }
  },
});
const registry = new Registry({
  sdk,
  agentDir: agentDir(),
  sink,
  approvals,
  queue,
  sessionDir: SESSION_DIR,
  trustProject: TRUST,
});

const payload = (entry) => ({
  ...registry.bootstrap(),
  activeId: entry?.id ?? registry.activeId,
  meta: entry?.meta ?? null,
  items: entry?.items ?? [],
});

/* ---------------------------------------------------------------- routes */
const routes = {
  "GET /api/bootstrap": async (req, res) => {
    const entry = registry.get(new URL(req.url, "http://x").searchParams.get("session") || undefined);
    ok(res, payload(entry));
  },

  "GET /api/state": async (req, res) => {
    const url = new URL(req.url, "http://x");
    const entry = registry.get(url.searchParams.get("session") || undefined);
    ok(res, { ...payload(entry), queue: queue.snapshot, policy: approvals.snapshot, cwd: CWD });
  },

  "GET /api/stream": async (req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 1500\n\n");
    res.write(`data: ${JSON.stringify({ e: "hello", seq: 0, ...payload(registry.active) })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* closed */
      }
    }, 15_000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
  },

  "POST /api/session": async (req, res) => {
    const b = await body(req);
    let entry;
    switch (b.op) {
      case "new":
        entry = await registry.create({ cwd: b.cwd ? resolve(b.cwd) : CWD });
        break;
      case "open":
        entry = await registry.open(b.path);
        break;
      case "fork":
        entry = await registry.fork(b.id);
        break;
      case "activate":
        entry = registry.setActive(b.id);
        break;
      case "rename":
        await registry.rename(b.id, b.name);
        entry = registry.get(b.id);
        break;
      case "delete":
        await registry.remove(b.id);
        entry = registry.get();
        break;
      default:
        return fail(res, 400, `unknown op: ${b.op}`);
    }
    sink({ seq: 0, e: "sessions", sessions: registry.list() });
    ok(res, payload(entry));
  },

  "POST /api/prompt": async (req, res) => {
    const b = await body(req);
    const entry = registry.get(b.session);
    if (!entry) return fail(res, 404, "no session");
    const text = String(b.text || "").trim();
    if (!text) return fail(res, 400, "empty prompt");
    const steerable = queue.runningId === entry.id;
    // running but not the queue's current job (settling / aborting) → reject
    if (entry.meta.running && !steerable) return fail(res, 409, "session is busy, try again in a moment");
    entry.emit({
      kind: "user",
      id: `u${++registry.counter}-${Math.random().toString(36).slice(2, 5)}`,
      text,
      steer: steerable,
      queued: !steerable && (queue.depth > 0 || queue.runningId !== null),
      ts: now(),
    });

    if (!entry.title) {
      entry.title = summaryOf(text);
      entry.pushMeta();
    }

    if (steerable) {
      entry.session.steer(text).catch((e) => {
        entry.emit({ kind: "notice", id: `e${now()}`, tone: "error", label: "ERROR", text: String(e.message || e), ts: now() });
      });
      entry.pushMeta();
      return ok(res, { mode: "steer" });
    }

    queue.submit({
      sessionId: entry.id,
      text,
      run: () => entry.session.prompt(text),
    });
    entry.pushMeta();
    ok(res, { mode: queue.runningId === entry.id ? "started" : "queued" });
  },

  "POST /api/abort": async (req, res) => {
    const b = await body(req);
    const entry = registry.get(b.session);
    if (!entry) return fail(res, 404, "no session");
    queue.cancel(entry.id);
    approvals.denyAll(entry, "deny");
    if (entry.session.isStreaming || entry.meta.running) {
      entry.session.abort().catch(() => {});
      entry.emit({
        kind: "notice",
        id: `ab${now()}`,
        tone: "warn",
        label: "ABORT",
        text: "run interrupted by operator",
        ts: now(),
      });
    }
    entry.pushMeta();
    ok(res, { ok: true });
  },

  "POST /api/approve": async (req, res) => {
    const b = await body(req);
    const decision = ["approve", "deny", "always"].includes(b.decision) ? b.decision : "deny";
    const settled = approvals.settle(String(b.id || ""), decision);
    if (!settled) return fail(res, 404, "no such pending approval");
    for (const entry of registry.sessions.values()) entry.pushMeta();
    ok(res, { decision });
  },

  "POST /api/policy": async (req, res) => {
    const b = await body(req);
    const mode = String(b.mode || "").toLowerCase();
    if (!["off", "risky", "all"].includes(mode)) return fail(res, 400, "mode must be off|risky|all", { code: "E_POLICY" });
    approvals.setPolicy(mode);
    for (const entry of registry.sessions.values()) entry.pushMeta();
    ok(res, approvals.snapshot);
  },

  "POST /api/thinking": async (req, res) => {
    const b = await body(req);
    const entry = registry.get(b.session);
    if (!entry) return fail(res, 404, "no session");
    const level = String(b.level || "").toLowerCase();
    if (!["off", "low", "medium", "high"].includes(level)) return fail(res, 400, "level must be off|low|medium|high");
    entry.session.setThinkingLevel(level);
    entry.pushMeta();
    const actual = entry.meta.thinking;
    ok(res, { thinking: actual, requested: level, clamped: actual !== level });
  },

  "GET /api/models": async (req, res) => {
    const url = new URL(req.url, "http://x");
    const entry = registry.get(url.searchParams.get("session") || undefined);
    if (!entry) return fail(res, 404, "no session");
    const rt = entry.session.modelRuntime;
    let models = [];
    try {
      models = rt.getAvailableSnapshot?.() ?? [];
      if (!models.length) models = await rt.getAvailable();
    } catch (e) {
      models = rt.getModels?.() ?? [];
    }
    ok(res, {
      current: entry.meta.modelId,
      models: models.map((m) => ({
        provider: m.provider,
        id: m.id,
        name: m.name || m.id,
        contextWindow: m.contextWindow,
        reasoning: !!m.reasoning,
      })),
    });
  },

  "POST /api/model": async (req, res) => {
    const b = await body(req);
    const entry = registry.get(b.session);
    if (!entry) return fail(res, 404, "no session");
    const rt = entry.session.modelRuntime;
    const model = rt.getModel(b.provider, b.model);
    if (!model) return fail(res, 404, `unknown model ${b.provider}/${b.model}`);
    await entry.session.setModel(model);
    entry.pushMeta();
    ok(res, { modelId: entry.meta.modelId, model: entry.meta.model });
  },

  "GET /api/providers": async (req, res) => {
    const url = new URL(req.url, "http://x");
    const entry = registry.get(url.searchParams.get("session") || undefined);
    ok(res, await listProviders({ session: entry?.session, agentDir: agentDir() }));
  },

  "POST /api/providers": async (req, res) => {
    const b = await body(req);
    const entry = registry.get(b.session);
    const ctx = { session: entry?.session, agentDir: agentDir() };
    switch (b.op) {
      case "test":
        ok(res, await testProvider({ ...ctx, providerId: b.provider }));
        break;
      case "models":
        ok(res, await listProviderModels({ ...ctx, providerId: b.provider }));
        break;
      case "default":
        ok(res, await setDefaultModel({ agentDir: ctx.agentDir, provider: b.provider, model: b.model }));
        break;
      case "key":
        ok(res, await setProviderKey({ agentDir: ctx.agentDir, provider: b.provider, key: b.key }));
        break;
      default:
        fail(res, 400, `unknown op: ${b.op}`, { code: "E_PROVIDERS" });
    }
  },

  "GET /api/mcp": async (req, res) => {
    ok(res, await readMcp({ agentDir: agentDir(), cwd: CWD }));
  },

  "POST /api/mcp": async (req, res) => {
    const b = await body(req);
    const ctx = { agentDir: agentDir(), cwd: CWD };
    switch (b.op) {
      case "toggle":
        ok(res, await setEnabled({ ...ctx, name: b.name, enabled: !!b.enabled }));
        break;
      case "add":
        ok(res, await addServer({ ...ctx, name: b.name, command: b.command, args: b.args, url: b.url, scope: b.scope, exposure: b.exposure }));
        break;
      case "remove":
        ok(res, await removeServer({ ...ctx, name: b.name }));
        break;
      default:
        fail(res, 400, `unknown op: ${b.op}`, { code: "E_MCP" });
    }
  },

  "GET /api/tree": async (req, res) => {
    const url = new URL(req.url, "http://x");
    ok(res, await listTree({
      cwd: CWD,
      target: url.searchParams.get("path") || "",
      showHidden: url.searchParams.get("hidden") === "1",
    }));
  },

  "POST /api/open": async (req, res) => {
    const b = await body(req);
    const mode = ["editor", "reveal", "default"].includes(b.mode) ? b.mode : "editor";
    const r = await openPath({ cwd: CWD, target: b.path, mode });
    ok(res, r);
  },

  "GET /api/fs": async (req, res) => {
    const url = new URL(req.url, "http://x");
    const target = resolve(url.searchParams.get("path") || CWD);
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
      ok(res, {
        path: target,
        parent: dirname(target) === target ? null : dirname(target),
        dirs,
        readable: info.isDirectory(),
      });
    } catch (e) {
      fail(res, 400, `cannot read ${target}: ${e.code || e.message}`, { code: "E_FS" });
    }
  },
};

/* ---------------------------------------------------------------- server */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const key = `${req.method} ${url.pathname}`;

  if (routes[key]) {
    try {
      await booted();
      await routes[key](req, res);
    } catch (e) {
      if (!e.status) console.error(`[${key}]`, e);
      if (!res.headersSent) fail(res, e.status || 500, e.message || e, { code: e.code || "E_ROUTE" });
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) return fail(res, 404, "unknown endpoint");

  /* static */
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = join(DIST, rel.replace(/\.\./g, ""));
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    try {
      const shell = await readFile(join(DIST, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(shell);
    } catch {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end("client not built yet\n\n  npm run build\n\nor run the dev server: npm run dev\n");
    }
  }
});

server.listen(PORT, "127.0.0.1", async () => {
  console.log(`\n  LCARS console  →  http://127.0.0.1:${PORT}`);
  console.log(`  cwd: ${CWD}`);
  console.log(`  sessions: ${SESSION_DIR || "~/.pi/agent/sessions"}`);
  console.log(`  approval policy: ${approvals.policy}${TRUST ? " · project trusted" : ""}\n`);
  bootPromise = registry
    .boot(CWD, { resume: RESUME })
    .then((entry) => {
      console.log(`[pi] session ready · ${entry.meta.model} · ${entry.id}`);
      return entry;
    })
    .catch((e) => {
      console.error(`[pi] boot failed: ${e.message}`);
      return null;
    });
});

const shutdown = async () => {
  console.log("\n[shutdown]");
  await registry.closeAll().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
