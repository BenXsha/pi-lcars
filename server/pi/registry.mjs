import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { applyEvent } from "./stream.mjs";
import { imagesOf, shortArgs, textOf } from "./format.mjs";
import { httpError } from "./errors.mjs";

/** Exit status from a persisted tool result: details first, then pi's own text. */
function exitCodeOf(message) {
  const details = message?.details;
  if (typeof details?.exitCode === "number") return details.exitCode;
  if (typeof details?.structuredContent?.exit_code === "number") return details.structuredContent.exit_code;
  const match = /Command exited with code (\d+)/.exec(textOf(message?.content) ?? "");
  return match ? Number(match[1]) : undefined;
}

let SEQ = 0;
const nextSeq = () => ++SEQ;
const MAX_ITEMS = 4000;

/** settings.json is advisory: a missing or broken file must not block a session. */
async function readSettings(agentDir) {
  try {
    return JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Session registry: every open conversation, its transcript items, and its meta.
 *
 * Disk is the source of truth for conversation content (SessionManager writes
 * JSONL). This object keeps the derived UI state — items, per-session counters,
 * queue flags — and fans it out to the single SSE channel.
 */
export class Registry {
  constructor({ sdk, agentDir, sink, approvals, queue, sessionDir, trustProject = true, mcp = true }) {
    this.sdk = sdk;
    this.agentDir = agentDir;
    this.sink = sink;
    this.approvals = approvals;
    this.queue = queue;
    this.sessionDir = sessionDir;
    this.trustProject = trustProject;
    this.mcp = mcp;
    this.dialogs = null; // wired by the server after construction
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
      title: "",
      items: [],
      byId: new Map(),
      cur: null,
      n: 0,
      rawCalls: new Map(), // callId -> args, for write→diff synthesis
      childOwner: new Map(), // nested callId -> parent item id
      usage: { input: 0, output: 0, cost: 0, total: 0 },
      loaderSkills: 0,
      running: false, // raw agent state; meta.running is derived
      meta: {
        running: false,
        queued: false,
        // arrays, not counts: the composer renders the queued texts (§7.6j).
        // `queue_update` replaces this wholesale; a number here crashed the
        // client's spread on every render before the first update arrived.
        queue: { steering: [], followUp: [] },
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
      title: entry.name ?? (entry.title || null),
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

  /**
   * A brand-new session has no model yet. Take pi's own defaults from
   * settings.json, fall back to the first model with valid credentials, and
   * carry over the default thinking level. Existing sessions keep theirs.
   */
  async #applyDefaults(session) {
    const current = session?.model;
    const resolved = current?.id && current.id !== "unknown" && current.provider !== "unknown";
    if (resolved) return;
    const runtime = session?.modelRuntime;
    if (!runtime) return;

    const settings = await readSettings(this.agentDir);
    let model = null;
    if (settings.defaultProvider && settings.defaultModel) {
      model = runtime.getModel(settings.defaultProvider, settings.defaultModel) ?? null;
    }
    if (!model) {
      try {
        model = (await runtime.getAvailable())?.[0] ?? null;
      } catch {
        model = null;
      }
    }
    if (!model) {
      console.error("[session] no model resolved — run /login in pi, or pick one in PROVIDERS");
      return;
    }
    await session.setModel(model);

    const level = settings.defaultThinkingLevel;
    if (level && level !== "off" && String(session.thinkingLevel ?? "off") === "off") {
      session.setThinkingLevel?.(level);
    }
  }

  /* ----------------------------------------------------------- lifecycle */

  async #load(manager, cwd) {
    const { createAgentSession, DefaultResourceLoader, createMcpExtension, createToolSearchExtension } = this.sdk;
    const entry = this.#entry({ manager, cwd });

    // The loader is created after the entry so the approval extension can
    // emit into the real transcript.
    if (DefaultResourceLoader) {
      try {
        const factories = [{ name: "lcars-approval", factory: this.approvals.factoryFor(entry), hidden: true }];
        // SDK sessions do not load MCP by default; the console wants the real
        // servers (and their tools) in the session it drives.
        if (this.mcp && createMcpExtension) {
          factories.push({ name: "lcars-mcp", factory: createMcpExtension(), hidden: true });
          if (createToolSearchExtension) {
            factories.push({ name: "lcars-tool-search", factory: createToolSearchExtension(), hidden: true });
          }
        }
        entry.loader = new DefaultResourceLoader({ cwd, agentDir: this.agentDir, extensionFactories: factories });
        await entry.loader.reload({ resolveProjectTrust: async () => this.trustProject });
        entry.loaderSkills = (entry.loader.getSkills?.().skills ?? []).length;
      } catch (e) {
        console.error(`[loader] falling back to defaults: ${e.message}`);
        entry.loader = null;
        this.approvals.wired = false;
      }
    }

    const options = { cwd, sessionManager: manager };
    if (entry.loader) options.resourceLoader = entry.loader;
    const { session } = await createAgentSession(options);

    entry.session = session;
    entry.path = manager.getSessionFile?.() ?? entry.path;
    // createAgentSession() without an explicit model leaves the session on
    // pi's "unknown/unknown" placeholder until the first setModel() — which
    // showed up in the shelf and in `pi-lcars status`. Resolve it once, here.
    await this.#applyDefaults(session);
    session.subscribe((ev) => applyEvent(entry, ev));

    // Extensions are loaded but not bound yet: MCP connects its servers on
    // session_start, and that costs seconds. The operator starts it from the
    // MCP panel instead (entry.bind()).
    entry.bound = false;
    // Bind lazily (MCP costs seconds at session_start), but always through the
    // dialog-capable uiContext. With `mode: "print"` and no uiContext,
    // extensions see hasUI === false — and rpiv-ask-user-question then STRIPS
    // ask_user_question from the active tool set. `mode: "rpc"` + select/input
    // is the package's documented headless path.
    entry.bind = async () => {
      if (entry.bound) return { bound: true, ms: 0, already: true };
      const t0 = Date.now();
      await entry.session.bindExtensions?.({ mode: "rpc", uiContext: this.dialogs?.context(entry) });
      entry.bound = true;
      entry.pushMeta();
      return { bound: true, ms: Date.now() - t0 };
    };

    this.sessions.set(entry.id, entry);
    this.activeId = entry.id;
    this.refreshMeta(entry);
    return entry;
  }

  async boot(cwd, { resume = false } = {}) {
    // Resuming by default would adopt whatever session the pi CLI wrote last in
    // this workspace — wrong context and a surprising token bill. Opt in only.
    if (!resume) return this.create({ cwd });
    try {
      const list = await this.sdk.SessionManager.list(cwd, this.sessionDir);
      const recent = [...list].sort((a, b) => new Date(b.modified) - new Date(a.modified))[0];
      if (recent?.path) return this.open(recent.path);
    } catch (e) {
      console.error(`[boot] cannot scan sessions: ${e.message}`);
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

  async fork(id, pathArg) {
    if (pathArg) {
      // forking straight from history: no open session needed
      try {
        const cwd = this.sdk.SessionManager.open(pathArg).getCwd();
        const manager = this.sdk.SessionManager.forkFrom(pathArg, cwd, this.sessionDir);
        return await this.#load(manager, cwd);
      } catch (e) {
        throw httpError(409, "E_EMPTY", e.message);
      }
    }
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

  /**
   * pi is append-only: moving the leaf is `manager.branch(id)`, and the live
   * session must then be recreated from the branched transcript. Both rewind
   * and goto go through here.
   */
  async #rebuild(entry) {
    const manager = entry.manager;
    const { createAgentSession } = this.sdk;
    try {
      entry.session.dispose();
    } catch {}
    const options = { cwd: entry.cwd, sessionManager: manager };
    if (entry.loader) options.resourceLoader = entry.loader;
    const { session } = await createAgentSession(options);
    entry.session = session;
    entry.bound = false;
    try {
      await session.bindExtensions?.({ mode: "rpc", uiContext: this.dialogs?.context(entry) });
      entry.bound = true;
    } catch {
      /* extensions are optional */
    }
    session.subscribe((ev) => applyEvent(entry, ev));

    entry.items = [];
    entry.byId = new Map();
    entry.cur = null;
    const calls = new Map();
    let n = 0;
    const push = (item) => {
      entry.items.push(item);
      entry.byId.set(item.id, item);
    };
    for (const m of session.messages ?? []) {
      if (m.role === "user") {
        push({
          kind: "user",
          id: `u${m.timestamp}-${++n}`,
          text: textOf(m.content),
          // a re-opened transcript still says which turns carried images
          attachments: imagesOf(m.content).length ? imagesOf(m.content) : undefined,
          ts: m.timestamp,
        });
      } else if (m.role === "assistant") {
        const content = m.content ?? [];
        for (const c of content) if (c?.type === "toolCall") calls.set(c.id, c);
        const text = textOf(content);
        const thinking = content.filter((c) => c?.type === "thinking").map((c) => c.thinking).join("");
        if (text || thinking) {
          push({
            kind: "assistant",
            id: `a${m.timestamp}-${++n}`,
            text,
            thinking,
            streaming: false,
            ts: m.timestamp,
            usage: m.usage
              ? { input: m.usage.input, output: m.usage.output, cost: m.usage.cost?.total ?? 0, total: m.usage.totalTokens }
              : undefined,
          });
        }
      } else if (m.role === "toolResult") {
        const call = calls.get(m.toolCallId);
        const out = textOf(m.content);
        push({
          kind: "tool",
          id: `t${m.toolCallId}`,
          callId: m.toolCallId,
          name: m.toolName,
          args: call ? shortArgs(m.toolName, call.arguments) : "",
          status: m.isError ? "error" : "ok",
          output: out,
          // persisted messages keep details; older ones only carry pi's own text
          exitCode: exitCodeOf(m),
          ts: m.timestamp,
        });
      } else if (m.role === "compactionSummary") {
        push({
          kind: "summary",
          id: `sm${m.timestamp}-${++n}`,
          summary: m.summary ?? "",
          tokensBefore: m.tokensBefore ?? null,
          tokensAfter: null,
          reason: "restored",
          ts: m.timestamp,
        });
      }
    }

    this.refreshMeta(entry);
    this.sink({ seq: nextSeq(), sessionId: entry.id, e: "items", items: entry.items });
    return entry;
  }

  async rewind(id, turn) {
    const entry = this.get(id);
    if (!entry) throw httpError(404, "E_NO_SESSION", "unknown session");
    if (entry.meta.running) throw httpError(409, "E_BUSY", "stop the run before rewinding");

    const manager = entry.manager;
    const messages = manager.getEntries().filter((e) => e.type === "message");
    const users = messages.filter((e) => e.message?.role === "user");
    const target = users[Number(turn) - 1];
    if (!target) throw httpError(400, "E_TURN", `no exchange ${turn}`);
    const idx = messages.findIndex((e) => e.id === target.id);
    if (idx <= 0) throw httpError(409, "E_FIRST", "the first exchange has nothing before it to rewind to");

    manager.branch(messages[idx - 1].id);
    return this.#rebuild(entry);
  }

  /** Move the leaf to an arbitrary entry (tree navigation). */
  async goto(id, entryId) {
    const entry = this.get(id);
    if (!entry) throw httpError(404, "E_NO_SESSION", "unknown session");
    if (entry.meta.running) throw httpError(409, "E_BUSY", "stop the run before switching branches");
    const exists = entry.manager.getEntries().some((e) => e.id === entryId);
    if (!exists) throw httpError(404, "E_ENTRY", "unknown entry");
    entry.manager.branch(entryId);
    return this.#rebuild(entry);
  }

  /** The session's entry graph, flattened for rendering.
   *  Bookkeeping entries (model_change, thinking_level_change, system,
   *  context_edit, usage) are structural noise to a reader, so they are hidden
   *  and their children are lifted to the nearest visible ancestor. */
  tree(id) {
    const entry = this.get(id);
    if (!entry) throw httpError(404, "E_NO_SESSION", "unknown session");
    const leaf = entry.manager.getLeafId?.() ?? null;
    const flat = [];
    const visibleKinds = new Set(["user", "assistant", "toolResult", "compaction", "branch_summary", "custom"]);

    const describe = (e) => {
      if (e.type === "message") {
        const m = e.message ?? {};
        const text = textOf(m.content);
        if (m.role === "toolResult") return { kind: "toolResult", label: m.toolName ?? "tool" };
        if (m.role === "assistant") return { kind: "assistant", label: text || (m.content ?? []).some((c) => c?.type === "toolCall") ? text || "tool calls" : "" };
        return { kind: m.role ?? "message", label: text };
      }
      if (e.type === "compaction") return { kind: "compaction", label: "context compacted" };
      if (e.type === "branch_summary") return { kind: "branch_summary", label: e.summary ?? "branch summary" };
      if (e.type === "custom") return { kind: "custom", label: textOf(e.content) || e.customType || "custom" };
      return null;
    };

    const walk = (node, depth, visibleParent) => {
      const e = node.entry;
      const d = describe(e);
      const isVisible = !!d && visibleKinds.has(d.kind);
      if (isVisible) {
        flat.push({
          id: e.id,
          parentId: visibleParent,
          depth,
          kind: d.kind,
          label: String(d.label ?? "").replace(/\s+/g, " ").slice(0, 120),
          ts: e.timestamp,
          current: e.id === leaf,
          isLeafPath: false,
        });
      }
      for (const c of node.children ?? []) walk(c, isVisible ? depth + 1 : depth, isVisible ? e.id : visibleParent);
    };
    for (const n of entry.manager.getTree?.() ?? []) walk(n, 0, null);

    const byId = new Map(flat.map((n) => [n.id, n]));
    let cur = leaf ? byId.get(leaf) : null;
    while (cur) {
      cur.isLeafPath = true;
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return { count: flat.length, leaf, nodes: flat };
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
    this.dialogs?.cancelFor(entry);
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
      title: s.name ?? (s.title || null),
      path: s.path,
      cwd: s.cwd,
      modelId: s.meta.modelId,
      thinking: s.meta.thinking,
      running: s.meta.running,
      queued: s.meta.queued,
      items: s.items.length,
      lastTs: s.items.at(-1)?.ts ?? null,
      pending: !!s.meta.pending,
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
