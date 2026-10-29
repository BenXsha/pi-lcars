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

export async function addServer({ agentDir, cwd, name, command, args, url, scope = "global", exposure = "codemode" }) {
  if (!NAME_RE.test(name || "")) throw Object.assign(new Error("name must be [a-z0-9_-]"), { status: 400, code: "E_MCP" });
  if (!command && !url) throw Object.assign(new Error("command or url required"), { status: 400, code: "E_MCP" });

  const p = paths({ agentDir, cwd });
  const target = scope === "project" ? p.project : p.global;
  const doc = (await readJson(target)).data ?? { mcpServers: {} };
  doc.mcpServers = doc.mcpServers ?? {};
  if (doc.mcpServers[name]) throw Object.assign(new Error(`server exists: ${name}`), { status: 409, code: "E_MCP" });

  doc.mcpServers[name] = command
    ? { command, args: args?.trim() ? args.trim().split(/\s+/) : undefined, exposure }
    : { url, exposure };
  if (!doc.mcpServers[name].args) delete doc.mcpServers[name].args;

  await writeAtomic(target, doc, true);
  return { path: target, name };
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
