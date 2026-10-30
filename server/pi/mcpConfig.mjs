import { readFile, writeFile, rename, copyFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/**
 * mcp.json reader/writer.
 *
 * Shape (documented by pi): `{ mcpServers: { name: {command,args} | {url,headers} , enabled?, exposure? } }`
 * Global lives in the agent dir; a project file may override only enabled/exposure.
 * We never rewrite on read, always back up before write, and write atomically.
 */

const asArray = (v) => (Array.isArray(v) ? v : []);

async function readJson(path) {
  try {
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw);
    return { data, raw };
  } catch (e) {
    if (e.code === "ENOENT") return { data: { mcpServers: {} }, raw: null };
    throw new Error(`${path}: ${e.message}`);
  }
}

export function paths({ agentDir, cwd }) {
  return {
    global: join(agentDir, "mcp.json"),
    project: join(cwd, ".pi", "mcp.json"),
  };
}

function describe(name, cfg, extra = {}) {
  const transport = cfg.command ? "stdio" : cfg.url ? "http" : "unknown";
  return {
    name,
    transport,
    command: cfg.command ?? null,
    args: asArray(cfg.args),
    url: cfg.url ?? null,
    dir: cfg.cwd ?? null,
    timeout: typeof cfg.timeout === "number" ? cfg.timeout : null,
    // counts only: env/header values often carry credentials and must not be echoed
    envKeys: cfg.env ? Object.keys(cfg.env).length : 0,
    headerKeys: cfg.headers ? Object.keys(cfg.headers).length : 0,
    exposure: cfg.exposure ?? "codemode",
    enabled: cfg.enabled !== false,
    toolExposure: cfg.toolExposure ? Object.keys(cfg.toolExposure).length : 0,
    description: cfg.description ?? "",
    ...extra,
  };
}

/** Merge global + project (project may only override enabled/exposure/toolExposure). */
export async function readMcp({ agentDir, cwd }) {
  const p = paths({ agentDir, cwd });
  const global = await readJson(p.global);
  const project = await readJson(p.project);

  const g = global.data?.mcpServers ?? {};
  const pr = project.data?.mcpServers ?? {};
  const names = new Set([...Object.keys(g), ...Object.keys(pr)]);

  const servers = [...names].sort().map((name) => {
    const base = g[name];
    const over = pr[name];
    if (base && over?.enabled === undefined && over?.exposure === undefined && !over?.command && !over?.url) {
      return describe(name, base, { scope: "global" });
    }
    if (base) {
      const merged = { ...base };
      if (over?.enabled !== undefined) merged.enabled = over.enabled;
      if (over?.exposure !== undefined) merged.exposure = over.exposure;
      return describe(name, merged, { scope: "global", override: p.project });
    }
    if (over) return describe(name, over, { scope: "project" });
    return null;
  }).filter(Boolean);

  return {
    servers,
    paths: p,
    exists: { global: global.raw !== null, project: project.raw !== null },
    errors: [],
  };
}

async function writeAtomic(path, data, backup) {
  await mkdir(dirname(path), { recursive: true });
  if (backup) await copyFile(path, `${path}.bak`).catch(() => {});
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,40}$/i;

/** Toggle enabled: write into the file that defines the server (global unless project-only). */
export async function setEnabled({ agentDir, cwd, name, enabled }) {
  const p = paths({ agentDir, cwd });
  const global = await readJson(p.global);
  const project = await readJson(p.project);
  const inGlobal = !!global.data?.mcpServers?.[name];
  const inProject = !!project.data?.mcpServers?.[name];
  if (!inGlobal && !inProject) throw Object.assign(new Error(`unknown server: ${name}`), { status: 404, code: "E_MCP" });

  const target = inGlobal ? p.global : p.project;
  const doc = inGlobal ? global.data : project.data;
  const cfg = doc.mcpServers[name] ?? {};
  if (enabled) delete cfg.enabled;
  else cfg.enabled = false;
  doc.mcpServers[name] = cfg;
  await writeAtomic(target, doc, true);
  return { path: target, name, enabled };
}

const EXPOSURES = new Set(["codemode", "codemode-deferred", "deferred", "direct", "hidden"]);

const bad = (message) => Object.assign(new Error(message), { status: 400, code: "E_MCP" });

/** Split a shell-ish argument string; JSON arrays are accepted verbatim. */
export function parseArgs(input) {
  const text = String(input ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw bad(`args: invalid JSON array (${e.message})`);
    }
    if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string")) throw bad("args: JSON array of strings expected");
    return parsed;
  }
  const out = [];
  let cur = "";
  let quote = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (quote) throw bad(`args: unterminated ${quote} quote`);
  if (cur) out.push(cur);
  return out;
}

/** `KEY=VALUE` lines (env) or `Name: value` lines (headers); JSON objects too. */
export function parsePairs(input, kind) {
  const sep = kind === "env" ? "=" : ":";
  const text = String(input ?? "").trim();
  if (!text) return undefined;
  if (text.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw bad(`${kind}: invalid JSON object (${e.message})`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw bad(`${kind}: JSON object expected`);
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
  }
  const out = {};
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const at = raw.indexOf(sep);
    if (at <= 0) throw bad(`${kind} line ${i + 1}: expected ${kind === "env" ? "KEY=VALUE" : "Name: value"}`);
    const key = raw.slice(0, at).trim();
    const value = raw.slice(at + 1).trim();
    if (!key) throw bad(`${kind} line ${i + 1}: empty key`);
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export async function addServer({
  agentDir,
  cwd,
  name,
  command,
  args,
  url,
  env,
  headers,
  dir,
  timeout,
  description,
  scope = "global",
  exposure = "codemode",
}) {
  if (!NAME_RE.test(name || "")) throw bad("name must match [a-z0-9][a-z0-9._-]*");
  if (!command && !url) throw bad("command (stdio) or url (http) required");
  if (command && url) throw bad("command and url are mutually exclusive — pick one transport");
  if (exposure && !EXPOSURES.has(exposure)) throw bad(`exposure must be one of ${[...EXPOSURES].join(", ")}`);

  let timeoutNum;
  if (timeout !== undefined && timeout !== null && String(timeout).trim() !== "") {
    timeoutNum = Number(timeout);
    if (!Number.isFinite(timeoutNum) || timeoutNum < 1 || timeoutNum > 3600) throw bad("timeout must be 1…3600 seconds");
  }

  const entry = command
    ? {
        command: command.trim(),
        args: parseArgs(args),
        env: parsePairs(env, "env"),
        cwd: dir?.trim() || undefined,
      }
    : { url: url.trim(), headers: parsePairs(headers, "headers") };

  for (const key of Object.keys(entry)) if (entry[key] === undefined) delete entry[key];
  if (entry.args && !entry.args.length) delete entry.args;
  if (description?.trim()) entry.description = description.trim();
  if (timeoutNum !== undefined) entry.timeout = timeoutNum;
  entry.exposure = exposure || "codemode";

  const p = paths({ agentDir, cwd });
  const target = scope === "project" ? p.project : p.global;
  const doc = (await readJson(target)).data ?? { mcpServers: {} };
  doc.mcpServers = doc.mcpServers ?? {};
  if (doc.mcpServers[name]) throw Object.assign(new Error(`server exists: ${name}`), { status: 409, code: "E_MCP" });
  doc.mcpServers[name] = entry;

  await writeAtomic(target, doc, true);
  return { path: target, name, transport: entry.command ? "stdio" : "http" };
}

export async function removeServer({ agentDir, cwd, name }) {
  const p = paths({ agentDir, cwd });
  const hits = [];
  for (const path of [p.global, p.project]) {
    const { data, raw } = await readJson(path);
    if (raw === null) continue;
    if (!data?.mcpServers?.[name]) continue;
    delete data.mcpServers[name];
    await writeAtomic(path, data, true);
    hits.push(path);
  }
  if (!hits.length) throw Object.assign(new Error(`unknown server: ${name}`), { status: 404, code: "E_MCP" });
  return { removed: hits };
}

/**
 * Config + live wiring, in one view.
 *
 * pi connects MCP servers when the session starts and registers their tools as
 * `mcp__<server>__<tool>`. That naming is the only honest connection signal we
 * have: a server is "connected" when at least one such tool exists in the
 * session. Config alone would claim servers are up when they are not.
 */
export async function mcpStatus({ agentDir, cwd, session }) {
  const base = await readMcp({ agentDir, cwd });
  const active = new Set(session?.getActiveToolNames?.() ?? []);
  const callable = new Set(session?.getCallableToolNames?.() ?? []);
  const all = new Set([...active, ...callable]);
  // descriptions come from the registered tool definitions, not from config
  const infos = new Map();
  try {
    for (const t of session?.getAllTools?.() ?? []) infos.set(t.name, t);
  } catch {
    /* older session without getAllTools */
  }

  const servers = base.servers.map((s) => {
    const prefix = `mcp__${s.name}__`;
    const tools = [];
    for (const full of all) {
      if (!full.startsWith(prefix)) continue;
      const info = infos.get(full);
      tools.push({
        name: full.slice(prefix.length),
        exposure: active.has(full) ? "direct" : "deferred",
        description: (info?.description ?? "").replace(/\s+/g, " ").trim(),
      });
    }
    tools.sort((a, b) => a.name.localeCompare(b.name));
    return {
      ...s,
      tools,
      toolCount: tools.length,
      connected: s.enabled && tools.length > 0,
      pinned: s.toolExposure ? Object.entries(s.toolExposure ?? {}).map(([k, v]) => ({ name: k, exposure: v })) : [],
    };
  });

  return {
    ...base,
    servers,
    totals: {
      servers: servers.length,
      connected: servers.filter((s) => s.connected).length,
      enabled: servers.filter((s) => s.enabled).length,
      tools: servers.reduce((n, s) => n + s.toolCount, 0),
    },
  };
}
