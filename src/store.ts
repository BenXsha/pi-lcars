import { api, openStream, type ImageAttachment, type Item, type Meta, type SessionSummary, type StreamEvent } from "./api";

export type State = {
  sessions: SessionSummary[];
  activeId: string | null;
  meta: Meta | null;
  items: Item[];
  policy: string;
  queue: { running: string | null; waiting: string[] };
  link: "connecting" | "open" | "down";
  error: string | null;
};

const byId = new Map<string, Item>();
const itemsBySession = new Map<string, Item[]>();

let state: State = {
  sessions: [],
  activeId: null,
  meta: null,
  items: [],
  policy: "off",
  queue: { running: null, waiting: [] },
  link: "connecting",
  error: null,
};

const subs = new Set<() => void>();
let frame = 0;

function emit() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    state = { ...state };
    for (const fn of subs) fn();
  });
}

export function subscribe(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export const getState = () => state;

/* ------------------------------------------------------------ mutations */

function setBootstrap(b: {
  sessions: SessionSummary[];
  activeId: string | null;
  meta: Meta | null;
  items: Item[];
  policy?: { policy: string };
  queue?: { running: string | null; waiting: string[] };
}) {
  if (b.activeId) {
    itemsBySession.set(b.activeId, b.items ?? []);
    for (const it of b.items ?? []) byId.set(it.id, it);
  }
  state = {
    ...state,
    sessions: b.sessions,
    activeId: b.activeId,
    meta: b.meta,
    items: b.activeId ? itemsBySession.get(b.activeId) ?? [] : [],
    policy: b.policy?.policy ?? state.policy,
    queue: b.queue ?? state.queue,
    error: null,
  };
  emit();
}

function upsertItem(sessionId: string, item: Item) {
  const list = itemsBySession.get(sessionId) ?? [];
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) list.push(item);
  else list[i] = item;
  itemsBySession.set(sessionId, list);
  byId.set(item.id, item);
  if (sessionId === state.activeId) {
    state.items = list;
    const s = state.sessions.find((x) => x.id === sessionId);
    if (s) s.items = list.length;
  }
  emit();
}

function patchItem(sessionId: string, id: string, patch: Partial<Item>) {
  const it = byId.get(id);
  if (!it) return;
  Object.assign(it, patch);
  if (sessionId === state.activeId) emit();
}

function deltaItem(sessionId: string, id: string, field: "text" | "thinking", d: string) {
  const it = byId.get(id);
  if (!it) return;
  const rec = it as unknown as Record<string, unknown>;
  rec[field] = String(rec[field] ?? "") + d;
  if (sessionId === state.activeId) emit();
}

function applyEvent(ev: StreamEvent) {
  switch (ev.e) {
    case "hello":
      setBootstrap(ev);
      break;
    case "sessions":
      state.sessions = ev.sessions;
      emit();
      break;
    case "items": {
      itemsBySession.set(ev.sessionId, ev.items);
      for (const it of ev.items) byId.set(it.id, it);
      if (ev.sessionId === state.activeId) state.items = ev.items;
      emit();
      break;
    }
    case "item":
      upsertItem(ev.sessionId, ev.item);
      break;
    case "patch":
      patchItem(ev.sessionId, ev.id, ev.patch);
      break;
    case "delta":
      deltaItem(ev.sessionId, ev.id, ev.field, ev.d);
      break;
    case "meta": {
      if (ev.sessionId === state.activeId) state.meta = ev.meta;
      const s = state.sessions.find((x) => x.id === ev.sessionId);
      if (s) {
        s.running = ev.meta.running;
        s.queued = ev.meta.queued;
        s.modelId = ev.meta.modelId;
        s.thinking = ev.meta.thinking;
        // the first prompt becomes the session title
        if (ev.meta.title !== undefined) s.title = ev.meta.title;
      }
      emit();
      break;
    }
  }
}

/* ---------------------------------------------------------------- boot */

let stream: EventSource | null = null;

export function connect() {
  if (stream) stream.close();
  stream = openStream(applyEvent, (s) => {
    state.link = s;
    emit();
  });
}

async function withError<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    state.error = null;
    return await fn();
  } catch (e) {
    state.error = (e as Error).message;
    emit();
    return null;
  }
}

export const actions = {
  async send(text: string, images?: ImageAttachment[]) {
    const trimmed = text.trim();
    if (!trimmed && !images?.length) return null;
    return withError(() => api.prompt(trimmed, images));
  },
  async abort() {
    await withError(() => api.abort());
  },
  async goto(entryId: string) {
    const b = await withError(() => api.goto(entryId));
    if (b) setBootstrap(b);
    return b;
  },
  async compact() {
    await withError(() => api.compact());
  },
  async answer(id: string, value: string | null) {
    await withError(() => api.answer(id, value));
  },
  async approve(id: string, decision: "approve" | "deny" | "always") {
    await withError(() => api.approve(id, decision));
  },
  async policy(mode: "off" | "risky" | "all") {
    const r = await withError(() => api.policy(mode));
    if (r) {
      state.policy = mode;
      emit();
    }
    return r;
  },
  async thinking(level: string) {
    const r = await withError(() => api.thinking(level));
    if (r && state.meta) {
      state.meta.thinking = r.thinking;
      emit();
    }
    return r;
  },
  async setModel(provider: string, model: string) {
    const r = await withError(() => api.setModel(provider, model));
    if (r && state.meta) {
      state.meta.modelId = r.modelId;
      emit();
    }
    return r;
  },
  async activate(id: string) {
    const b = await withError(() => api.activate(id));
    if (b) setBootstrap(b);
    return b;
  },
  async newSession(cwd?: string) {
    const b = await withError(() => api.newSession(cwd));
    if (b) setBootstrap(b);
    return b;
  },
  async openPath(path: string) {
    const b = await withError(() => api.openSession(path));
    if (b) setBootstrap(b);
    return b;
  },
  async forkPath(path: string) {
    const b = await withError(() => api.forkPath(path));
    if (b) setBootstrap(b);
    return b;
  },
  async fork() {
    const id = state.activeId;
    if (!id) return null;
    const b = await withError(() => api.fork(id));
    if (b) setBootstrap(b);
    return b;
  },
  /** rewind to just before exchange `turn`; the session keeps its id */
  async rewind(turn: number) {
    const b = await withError(() => api.rewind(turn));
    if (b) setBootstrap(b);
    return b;
  },

  async rename(name: string) {
    const id = state.activeId;
    if (!id) return null;
    const b = await withError(() => api.rename(id, name));
    if (b) setBootstrap(b);
    return b;
  },
  async remove(id: string) {
    const b = await withError(() => api.remove(id));
    if (b) setBootstrap(b);
    return b;
  },
  async refresh() {
    const b = await withError(() => api.bootstrap(state.activeId));
    if (b) setBootstrap(b);
    return b;
  },
};
