import { readFile, writeFile, copyFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/**
 * Provider surface.
 *
 * Reads come from the live ModelRuntime (same source the session uses), so the
 * console can never disagree with what a turn will actually pick. Writes touch
 * the two files pi itself owns — settings.json (default model) and auth.json
 * (api key) — atomically, with a .bak beside them.
 */

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw new Error(`${path}: ${e.message}`);
  }
}

async function writeAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await copyFile(path, `${path}.bak`).catch(() => {});
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

const mask = (key) => {
  if (typeof key !== "string" || !key) return null;
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
};

export async function listProviders({ session, agentDir }) {
  const rt = session?.modelRuntime;
  if (!rt) return { providers: [], current: null, files: {} };

  const auth = await readJson(join(agentDir, "auth.json"), {});
  const settings = await readJson(join(agentDir, "settings.json"), {});
  const modelsDoc = await readJson(join(agentDir, "models.json"), { providers: {} });
  const custom = new Set(Object.keys(modelsDoc.providers ?? {}));

  const providers = (rt.getProviders?.() ?? []).map((p) => {
    const models = rt.getAllModels?.(p.id) ?? [];
    const oauth = !!rt.isUsingOAuth?.(p.id);
    const configured = !!rt.hasConfiguredAuth?.(p.id);
    return {
      id: p.id,
      name: p.name ?? p.id,
      auth: oauth ? "oauth" : configured ? "api_key" : "none",
      models: models.length,
      keyMask: mask(auth?.[p.id]?.key) ?? mask(modelsDoc.providers?.[p.id]?.apiKey),
      current: session?.model?.provider === p.id,
      custom: custom.has(p.id),
      baseUrl: modelsDoc.providers?.[p.id]?.baseUrl ?? p.baseUrl ?? null,
    };
  });

  const cur = session?.model;
  return {
    providers,
    current: cur ? { provider: cur.provider, model: cur.id, name: cur.name ?? cur.id } : null,
    defaultModel: settings.defaultModel ?? null,
    defaultProvider: settings.defaultProvider ?? null,
    files: { auth: join(agentDir, "auth.json"), settings: join(agentDir, "settings.json") },
  };
}

export async function testProvider({ session, providerId }) {
  const rt = session?.modelRuntime;
  if (!rt) {
    const e = new Error("no live session to test against");
    e.status = 409;
    e.code = "E_NO_SESSION";
    throw e;
  }
  const t0 = Date.now();
  let result = null;
  let error = null;
  try {
    result = await rt.checkAuth(providerId);
  } catch (e) {
    error = e.message;
  }
  return {
    provider: providerId,
    ms: Date.now() - t0,
    status: error ? "error" : (result?.status ?? (result ? "ready" : "unknown")),
    reason: error ?? result?.reason ?? null,
    authType: result?.authType ?? null,
  };
}

export async function setDefaultModel({ agentDir, provider, model }) {
  if (!provider || !model) {
    const e = new Error("provider and model are required");
    e.status = 400;
    e.code = "E_ARGS";
    throw e;
  }
  const path = join(agentDir, "settings.json");
  const settings = await readJson(path, {});
  settings.defaultProvider = provider;
  settings.defaultModel = model;
  await writeAtomic(path, settings);
  return { path, defaultProvider: provider, defaultModel: model };
}

export async function setProviderKey({ agentDir, provider, key }) {
  if (!provider || !key) {
    const e = new Error("provider and key are required");
    e.status = 400;
    e.code = "E_ARGS";
    throw e;
  }
  const path = join(agentDir, "auth.json");
  const auth = await readJson(path, {});
  const prev = auth[provider] ?? {};
  auth[provider] = { ...prev, type: prev.type ?? "api_key", key };
  await writeAtomic(path, auth);
  return { path, provider, keyMask: mask(key) };
}

export async function listProviderModels({ session, providerId }) {
  const rt = session?.modelRuntime;
  const models = rt?.getAllModels?.(providerId) ?? [];
  return models.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name ?? m.id,
    contextWindow: m.contextWindow,
    reasoning: !!m.reasoning,
    current: session?.model?.id === m.id && session?.model?.provider === m.provider,
  }));
}

/** APIs pi can speak to; anything else needs a provider extension. */
const APIS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];

const SLUG = /^[a-z0-9][a-z0-9._-]{0,40}$/i;

/**
 * Add or update a custom provider in models.json.
 *
 * Setting only baseUrl on a provider that already exists is the documented way
 * to route a built-in provider through a proxy — its models and auth stay.
 */
export async function addProvider({ agentDir, id, name, baseUrl, api, apiKey, models }) {
  const slug = String(id || "").trim();
  if (!SLUG.test(slug)) {
    const e = new Error("id must be a slug like 'my-proxy'");
    e.status = 400;
    e.code = "E_ARGS";
    throw e;
  }
  if (!/^https?:\/\//i.test(String(baseUrl || ""))) {
    const e = new Error("baseUrl must start with http:// or https://");
    e.status = 400;
    e.code = "E_ARGS";
    throw e;
  }
  if (api && !APIS.includes(api)) {
    const e = new Error(`api must be one of ${APIS.join(", ")}`);
    e.status = 400;
    e.code = "E_ARGS";
    throw e;
  }

  const path = join(agentDir, "models.json");
  const doc = await readJson(path, { providers: {} });
  doc.providers = doc.providers ?? {};
  const prev = doc.providers[slug] ?? {};
  const entry = { ...prev, baseUrl: String(baseUrl).trim() };
  if (name) entry.name = String(name).trim();
  if (api) entry.api = api;
  if (apiKey) entry.apiKey = String(apiKey);
  const list = Array.isArray(models)
    ? models
    : typeof models === "string"
      ? models.split(/[,\s]+/).filter(Boolean)
      : [];
  if (list.length) {
    const existing = new Map((prev.models ?? []).map((m) => [m.id, m]));
    entry.models = list.map((m) => (typeof m === "string" ? { ...(existing.get(m) ?? {}), id: m } : m));
  }
  doc.providers[slug] = entry;
  await writeAtomic(path, doc);
  return { path, id: slug, proxied: Object.keys(prev).length > 0 };
}

/** Only user-defined entries can be removed; built-in providers are catalog-owned. */
export async function removeProvider({ agentDir, id }) {
  const path = join(agentDir, "models.json");
  const doc = await readJson(path, { providers: {} });
  if (!doc.providers?.[id]) {
    const e = new Error(`${id} is not defined in models.json (built-in providers cannot be removed)`);
    e.status = 404;
    e.code = "E_NOT_CUSTOM";
    throw e;
  }
  delete doc.providers[id];
  await writeAtomic(path, doc);
  return { path, id };
}

/** After writing models.json the running runtime has to re-read it. */
export async function reloadProviders({ session }) {
  const rt = session?.modelRuntime;
  if (!rt?.refresh) return { reloaded: false };
  try {
    await rt.refresh();
    return { reloaded: true };
  } catch (e) {
    return { reloaded: false, error: e.message };
  }
}

