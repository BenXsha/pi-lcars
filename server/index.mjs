/**
 * LCARS agent console — server shell.
 *
 *   node server/index.mjs
 *
 * Zero runtime dependencies beyond the pi SDK. This file owns the process:
 * runtime config, the shared objects every route needs, and the HTTP/SSE
 * lifecycle. The endpoints themselves live in ./routes/*, each a factory that
 * receives this shell's context — so a station cannot reach around it.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSdk, agentDir } from "./pi/sdk.mjs";
import { Approvals } from "./pi/approval.mjs";
import { createQueue } from "./pi/queue.mjs";
import { Registry } from "./pi/registry.mjs";
import { Dialogs } from "./pi/dialogs.mjs";
import { startHistoryScan } from "./pi/history.mjs";
import { ok, fail, body, query, MIME } from "./http.mjs";
import { coreRoutes } from "./routes/core.mjs";
import { sessionRoutes } from "./routes/session.mjs";
import { filesRoutes } from "./routes/files.mjs";
import { providersRoutes } from "./routes/providers.mjs";
import { mcpRoutes } from "./routes/mcp.mjs";
import { skillsRoutes } from "./routes/skills.mjs";
import { historyRoutes } from "./routes/history.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");

/* Runtime config. Env defaults keep `node server/index.mjs` working on its own;
 * start(opts) overrides them before anything is created. */
let PORT = Number(process.env.PORT || 4173);
let HOST = process.env.HOST || "127.0.0.1";
let CWD = resolve(process.env.PI_CWD || process.cwd());
let SESSION_DIR = process.env.LCARS_SESSIONS || undefined;
let TRUST = process.env.LCARS_TRUST_PROJECT !== "0";
let RESUME = process.env.LCARS_RESUME === "1";
let POLICY = (process.env.LCARS_POLICY || "off").toLowerCase();
let LOG = true;

/* --------------------------------------------------------------- plumbing */
const clients = new Set();
/** last client-side faults, newest last — shown by /api/system */
const clientErrorsRef = [];
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

/* ------------------------------------------------------------------- app */
/** resolved in the listen callback; every route waits for it */
let bootPromise = null;
const booted = () => bootPromise ?? Promise.resolve();
const sdk = await loadSdk();
const approvals = new Approvals({
  policy: POLICY,
  timeoutMs: Number(process.env.LCARS_APPROVAL_TIMEOUT || 120_000),
});
const queue = createQueue({
  onChange: () => {
    for (const entry of registry.sessions.values()) {
      entry.pushMeta();
    }
  },
});
const dialogs = new Dialogs({ timeoutMs: Number(process.env.LCARS_ASK_TIMEOUT || 300_000) });
const registry = new Registry({
  sdk,
  agentDir: agentDir(),
  sink,
  approvals,
  queue,
  sessionDir: SESSION_DIR,
  trustProject: TRUST,
  mcp: process.env.LCARS_MCP !== "0",
});
registry.dialogs = dialogs;

const payload = (entry) => ({
  ...registry.bootstrap(),
  activeId: entry?.id ?? registry.activeId,
  meta: entry?.meta ?? null,
  items: entry?.items ?? [],
});

/* ------------------------------------------------------------------- ctx */
/**
 * The one object every route module receives. Config is read through getters
 * because start() rewrites it after the modules were built.
 */
const cfg = {
  get port() { return PORT; },
  get host() { return HOST; },
  get cwd() { return CWD; },
  get sessionDir() { return SESSION_DIR; },
  get policy() { return POLICY; },
};

/**
 * A route addresses a session with `?session=<id>`; absent means the active
 * one. Kept here so no station invents its own lookup.
 */
const sessionOf = (req) => registry.get(query(req).get("session") || undefined);

const ctx = { ok, fail, body, query, sessionOf, cfg, sink, clients, clientErrors: clientErrorsRef,
              payload, sdk, registry, queue, approvals, dialogs };

/* ---------------------------------------------------------------- routes */
const routes = {
  ...coreRoutes(ctx),
  ...sessionRoutes(ctx),
  ...filesRoutes(ctx),
  ...providersRoutes(ctx),
  ...mcpRoutes(ctx),
  ...skillsRoutes(ctx),
  ...historyRoutes(ctx),
};

/* ---------------------------------------------------------------- server */
let server = null;
const handler = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const key = `${req.method} ${url.pathname}`;

  if (routes[key]) {
    try {
      await booted();
      await routes[key](req, res);
    } catch (e) {
      // constant format string: `key` carries the request path, and a "%s" in it
      // would otherwise be interpreted by console.error's util.format
      if (!e.status) console.error("[route]", key, e);
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
    const ext = extname(file);
    const immutable = url.pathname.startsWith("/assets/") && ext !== ".html";
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      // the shell must never be reused after a rebuild; hashed assets never change
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-store",
    });
    res.end(buf);
  } catch {
    /* A missing asset must NOT fall back to index.html: the browser would
       receive HTML where it expects JS/CSS (a stale tab after a rebuild), fail
       to parse it, and the screen goes white. Only extension-less routes get
       the shell. */
    const looksLikeAsset = extname(file) !== "" || url.pathname.startsWith("/assets/");
    if (looksLikeAsset) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`not found: ${url.pathname}\n\nthe client was rebuilt — reload the page\n`);
      return;
    }
    try {
      const shell = await readFile(join(DIST, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(shell);
    } catch {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end("client not built yet\n\n  pi-lcars          # builds on demand\n  npm run build      # or build by hand\n");
    }
  }
};

/* --------------------------------------------------------------- lifecycle */
function listenOnce(srv, port, host) {
  return new Promise((done, reject) => {
    const onError = (e) => {
      srv.off("listening", onListening);
      reject(e);
    };
    const onListening = () => {
      srv.off("error", onError);
      done(srv.address().port);
    };
    srv.once("error", onError);
    srv.once("listening", onListening);
    srv.listen(port, host);
  });
}

/**
 * Boot the console. Safe to call once per process.
 *
 * opts: { port, host, cwd, sessionDir, trust, resume, policy, log, strictPort }
 *   strictPort — fail on EADDRINUSE instead of walking up to port+16.
 * returns { url, port, host, cwd, close() }
 */
export async function start(opts = {}) {
  if (server) throw new Error("server already started");
  if (opts.port !== undefined) PORT = Number(opts.port);
  if (opts.host) HOST = opts.host;
  if (opts.cwd) CWD = resolve(opts.cwd);
  if (opts.sessionDir !== undefined) SESSION_DIR = opts.sessionDir || undefined;
  if (opts.trust !== undefined) TRUST = !!opts.trust;
  if (opts.resume !== undefined) RESUME = !!opts.resume;
  if (opts.policy) POLICY = String(opts.policy).toLowerCase();
  if (opts.log !== undefined) LOG = !!opts.log;

  /* the objects were built at import time from the env defaults */
  approvals.policy = POLICY;
  registry.sessionDir = SESSION_DIR;
  registry.trustProject = TRUST;

  server = createServer(handler);

  const strict = opts.strictPort === true;
  const tries = strict ? 1 : 17;
  let lastError = null;
  for (let i = 0; i < tries; i++) {
    try {
      await listenOnce(server, PORT + i, HOST);
      PORT = server.address().port;
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      if (e.code !== "EADDRINUSE") throw e;
    }
  }
  if (lastError) {
    const e = new Error(`port ${PORT}…${PORT + tries - 1} all in use on ${HOST}`);
    e.code = "E_PORT";
    throw e;
  }

  if (LOG) {
    console.log(`\n  LCARS console  →  http://${HOST}:${PORT}`);
    console.log(`  cwd: ${CWD}`);
    console.log(`  sessions: ${SESSION_DIR || "~/.pi/agent/sessions"}`);
    console.log(`  approval policy: ${approvals.policy}${TRUST ? " · project trusted" : ""}\n`);
  }

  startHistoryScan({ sdk, sessionDir: SESSION_DIR });
  bootPromise = registry
    .boot(CWD, { resume: RESUME })
    .then((entry) => {
      if (LOG) console.log(`[pi] session ready · ${entry.meta.model} · ${entry.id}`);
      return entry;
    })
    .catch((e) => {
      console.error(`[pi] boot failed: ${e.message}`);
      return null;
    });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await registry.closeAll().catch(() => {});
    await new Promise((done) => server.close(done));
  };

  const onSignal = async () => {
    if (LOG) console.log("\n[shutdown]");
    const bail = setTimeout(() => process.exit(0), 1500);
    bail.unref();
    await close().catch(() => {});
    process.exit(0);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  return { url: `http://${HOST}:${PORT}`, port: PORT, host: HOST, cwd: CWD, close };
}

/* direct execution (`node server/index.mjs`) still works */
const MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (MAIN) {
  start().catch((e) => {
    console.error(`[fatal] ${e.code ? `${e.code}: ` : ""}${e.message}`);
    process.exit(1);
  });
}
