import { unlink } from "node:fs/promises";
import { applyEvent } from "./stream.mjs";
import { httpError } from "./errors.mjs";

let SEQ = 0;
const nextSeq = () => ++SEQ;
const MAX_ITEMS = 4000;

/**
 * Session registry: every open conversation, its transcript items, and its meta.
 *
 * Disk is the source of truth for conversation content (SessionManager writes
 * JSONL). This object keeps the derived UI state — items, per-session counters,
 * queue flags — and fans it out to the single SSE channel.
 */
export class Registry {
  constructor({ sdk, agentDir, sink, approvals, queue, sessionDir, trustProject = true }) {
    this.sdk = sdk;
    this.agentDir = agentDir;
    this.sink = sink;
    this.approvals = approvals;
    this.queue = queue;
    this.sessionDir = sessionDir;
    this.trustProject = trustProject;
    /** @type {Map<string, any>} */
    this.sessions = new Map();
    this.activeId = null;
    this.counter = 0;
  }

  /* ------------------------------------------------------------ entries */

  #entry({ manager, cwd }) {
    const reg = this;
    const entry = {
      id: `s${++reg.counter}-${Math.random().toString(36).slice(2, 6)}`,
      cwd,
      manager,
      session: null,
      loader: null,
      path: manager.getSessionFile?.() ?? null,
      name: manager.getSessionName?.() ?? undefined,
      items: [],
      byId: new Map(),
      cur: null,
      n: 0,
      usage: { input: 0, output: 0, cost: 0, total: 0 },
      loaderSkills: 0,
      running: false, // raw agent state; meta.running is derived
      meta: {
        running: false,
        queued: false,
        queue: { steering: 0, followUp: 0 },
        model: "—",
        modelId: "—",
        thinking: "off",
        tools: [],
        contextWindow: 200000,
        contextPct: 0,
        usage: { input: 0, output: 0, cost: 0, total: 0 },
        skills: 0,
      },
      nextId() {
        return `${++entry.n}`;
      },
      emit(item) {
        const i = entry.items.findIndex((x) => x.id === item.id);
        if (i === -1) entry.items.push(item);
        else entry.items[i] = item;
        if (entry.items.length > MAX_ITEMS) {
          for (const gone of entry.items.splice(0, entry.items.length - MAX_ITEMS)) entry.byId.delete(gone.id);
        }
        entry.byId.set(item.id, item);
        reg.sink({ seq: nextSeq(), sessionId: entry.id, e: "item", item });
      },
      patch(id, fields) {
        const it = entry.byId.get(id);
        if (!it) return;
        Object.assign(it, fields);
        reg.sink({ seq: nextSeq(), sessionId: entry.id, e: "patch", id, patch: fields });
      },
      delta(id, field, d) {
        const it = entry.byId.get(id);
        if (!it) return;
        it[field] = (it[field] || "") + d;
        reg.sink({ seq: nextSeq(), sessionId: entry.id, e: "delta", id, field, d });
      },
      pushMeta() {
        reg.refreshMeta(entry);
        reg.sink({ seq: nextSeq(), sessionId: entry.id, e: "meta", meta: entry.meta });
      },
    };
    return entry;
  }

  refreshMeta(entry) {
    const s = entry.session;
    const m = s?.model;
    const appr = this.approvals.snapshot;
    const win = m?.contextWindow || 200000;
    Object.assign(entry.meta, {
      name: entry.name,
      path: entry.path,
      cwd: entry.cwd,
      model: m ? `${m.provider}/${m.id}` : "—",
      modelId: m?.id ?? "—",
      thinking: String(s?.thinkingLevel ?? "off"),
      tools: s?.getActiveToolNames?.() ?? [],
      contextWindow: win,
      contextPct: Math.min(100, Math.round((entry.usage.total / win) * 1000) / 10),
      usage: entry.usage,
      running: entry.running || this.queue.runningId === entry.id,
      queued: this.queue.waiting(entry.id),
      policy: appr.policy,
      pending: appr.pending,
      approvalWired: appr.wired,
      skills: entry.loaderSkills,
    });
    return entry.meta;
  }

  /* ----------------------------------------------------------- lifecycle */

  async #load(manager, cwd) {
    const { createAgentSession, DefaultResourceLoader } = this.sdk;
    const entry = this.#entry({ manager, cwd });

    // The loader is created after the entry so the approval extension can
    // emit into the real transcript.
    if (DefaultResourceLoader) {
      try {
        entry.loader = new DefaultResourceLoader({
          cwd,
          agentDir: this.agentDir,
          extensionFactories: [
            { name: "lcars-approval", factory: this.approvals.factoryFor(entry), hidden: true },
          ],
        });
        await entry.loader.reload({ resolveProjectTrust: async () => this.trustProject });
        entry.loaderSkills = (entry.loader.getSkills?.().skills ?? []).length;
      } catch (e) {
        console.warn(`[loader] falling back to defaults: ${e.message}`);
        entry.loader = null;
        this.approvals.wired = false;
      }
    }

    const { session } = await createAgentSession({
      cwd,
      sessionManager: manager,
      ...(entry.loader ? { resourceLoader: entry.loader } : {}),
    });

    entry.session = session;
    entry.path = manager.getSessionFile?.() ?? entry.path;
    session.subscribe((ev) => applyEvent(entry, ev));

    this.sessions.set(entry.id, entry);
    this.activeId = entry.id;
    this.refreshMeta(entry);
    return entry;
  }

  async boot(cwd) {
    try {
      const list = await this.sdk.SessionManager.list(cwd, this.sessionDir);
      const recent = [...list].sort((a, b) => new Date(b.modified) - new Date(a.modified))[0];
      if (recent?.path) return this.open(recent.path);
    } catch (e) {
      console.warn(`[boot] cannot scan sessions: ${e.message}`);
    }
    return this.create({ cwd });
  }

  async create({ cwd } = {}) {
    const manager = this.sdk.SessionManager.create(cwd, this.sessionDir);
    return this.#load(manager, cwd);
  }

  async open(path) {
    const existing = [...this.sessions.values()].find((s) => s.path === path);
    if (existing) {
      this.activeId = existing.id;
      return existing;
    }
    const manager = this.sdk.SessionManager.open(path, this.sessionDir);
    return this.#load(manager, manager.getCwd());
  }

  async fork(id) {
    const src = this.get(id);
    if (!src?.path) throw httpError(409, "E_EMPTY", "this session has no transcript yet — send a message first");
    let manager;
    try {
      manager = this.sdk.SessionManager.forkFrom(src.path, src.cwd, this.sessionDir);
    } catch (e) {
      throw httpError(409, "E_EMPTY", e.message);
    }
    return this.#load(manager, src.cwd);
  }

  async rename(id, name) {
    const entry = this.get(id);
    if (!entry) throw httpError(404, "E_NO_SESSION", "unknown session");
    entry.manager.appendSessionInfo(name);
    entry.name = name;
    entry.pushMeta();
    return entry.meta;
  }

  async remove(id) {
    const entry = this.get(id);
    if (!entry) throw httpError(404, "E_NO_SESSION", "unknown session");
    this.queue.cancel(id);
    this.approvals.denyAll(entry, "deny");
    try {
      entry.session?.dispose();
    } catch {}
    this.sessions.delete(id);
    if (this.activeId === id) this.activeId = [...this.sessions.keys()][0] ?? null;
    if (entry.path) await unlink(entry.path).catch(() => {});
    this.sink({ seq: nextSeq(), e: "sessions", sessions: this.list() });
    return { ok: true };
  }

  /* --------------------------------------------------------------- query */

  get(id) {
    return (id && this.sessions.get(id)) || this.sessions.get(this.activeId) || null;
  }

  setActive(id) {
    if (!this.sessions.has(id)) throw new Error("unknown session");
    this.activeId = id;
    return this.get(id);
  }

  list() {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      name: s.name,
      path: s.path,
      cwd: s.cwd,
      modelId: s.meta.modelId,
      thinking: s.meta.thinking,
      running: s.meta.running,
      queued: s.meta.queued,
      items: s.items.length,
      active: s.id === this.activeId,
    }));
  }

  bootstrap() {
    const active = this.get();
    return {
      sessions: this.list(),
      activeId: active?.id ?? null,
      meta: active?.meta ?? null,
      policy: this.approvals.snapshot,
      queue: this.queue.snapshot,
    };
  }

  get active() {
    return this.get();
  }

  async closeAll() {
    for (const s of this.sessions.values()) {
      this.approvals.denyAll(s, "deny");
      try {
        s.session?.dispose();
      } catch {}
    }
    this.sessions.clear();
  }
}
