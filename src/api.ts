/** Typed client for the console server. */

export type Item =
  | { kind: "user"; id: string; text: string; steer?: boolean; queued?: boolean; ts: number }
  | {
      kind: "assistant";
      id: string;
      text: string;
      thinking: string;
      streaming: boolean;
      stopReason?: string;
      errorMessage?: string;
      usage?: { input: number; output: number; cost: number; total: number };
      ts: number;
    }
  | {
      kind: "tool";
      id: string;
      callId: string;
      name: string;
      args: string;
      status: "run" | "ok" | "error";
      output?: string;
      errorText?: string;
      ms?: number;
      truncated?: boolean;
      diff?: DiffData;
      children?: SubCall[];
      agent?: AgentMeta;
      ts: number;
    }
  | { kind: "notice"; id: string; tone?: "info" | "warn" | "error"; label: string; text: string; ts: number }
  | {
      kind: "approval";
      id: string;
      callId: string;
      tool: string;
      args: string;
      status: "pending" | "approved" | "denied" | "always" | "timeout";
      decidedMs?: number;
      ts: number;
    };

export type DiffLine = { t: "+" | "-" | " " | "\\"; o?: number; n?: number; text: string };
export type AgentMeta = {
  name: string;
  type: string;
  model: string;
  tools: number;
  /** the SDK reports a preformatted string here, e.g. "16.0k token" */
  tokens: string | number;
  cost: number | string;
  turns: number;
  status: string;
  agentId: string;
};

export type DiffData = {
  path?: string;
  hunks: { hdr: string; oldNo: number; newNo: number; lines: DiffLine[] }[];
  stat: { add: number; del: number };
  truncated?: boolean;
};

export type SubCall = { id: string; name: string; args: string; status: "run" | "ok" | "error"; ms?: number; ts: number };

export type SessionSummary = {
  id: string;
  name?: string;
  title?: string | null;
  path?: string;
  cwd: string;
  modelId: string;
  thinking: string;
  running: boolean;
  queued: boolean;
  items: number;
  lastTs: number | null;
  pending: boolean;
  active: boolean;
};

export type Meta = {
  name?: string;
  title?: string | null;
  path?: string | null;
  cwd: string;
  model: string;
  modelId: string;
  thinking: string;
  tools: string[];
  contextWindow: number;
  contextPct: number;
  usage: { input: number; output: number; cost: number; total: number };
  running: boolean;
  queued: boolean;
  queue: { steering: number; followUp: number };
  policy: string;
  pending: number;
  approvalWired: boolean;
  skills: number;
};

export type Bootstrap = {
  sessions: SessionSummary[];
  activeId: string | null;
  meta: Meta | null;
  items: Item[];
  policy?: { policy: string; pending: number; always: string[]; timeoutMs: number };
  queue?: { running: string | null; waiting: string[] };
};

export type ProviderRow = {
  id: string;
  name: string;
  auth: "oauth" | "api_key" | "none";
  models: number;
  keyMask: string | null;
  current: boolean;
  custom: boolean;
  baseUrl: string | null;
};

export type SkillRow = {
  name: string;
  description: string;
  heading: string | null;
  path: string;
  dir: string;
  manualOnly: boolean;
  trigger: "manual" | "description";
  bytes: number | null;
};

export type SystemInfo = {
  node: string;
  platform: string;
  piVersion: string | null;
  sdk: string | null;
  agentDir: string;
  cwd: string;
  port: number;
  mcpEnabled: boolean;
  approvals: { policy: string; pending: number; always: string[]; timeoutMs: number };
};

export type SkillsResult = {
  available: boolean;
  skills: SkillRow[];
  prompts: { name: string; path: string }[];
  extensions: { name: string; path: string }[];
  diagnostics: { level: string; message: string }[];
  error?: string;
  ms?: number;
};

export type ProvidersResult = {
  providers: ProviderRow[];
  current: { provider: string; model: string; name: string } | null;
  defaultProvider: string | null;
  defaultModel: string | null;
  files: { auth: string; settings: string };
};

export type ModelInfo = {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
};

export type DirEntry = { name: string; path: string; items: number | null };

export type FileResult = {
  path: string;
  rel: string;
  size: number;
  kind: "text" | "image" | "audio" | "video" | "other";
  mime: string;
  ext: string;
  lines: number;
  truncated: boolean;
  reason: string | null;
  text: string;
  mtime?: string;
};

export type TreeEntry = { name: string; path: string; rel: string; type: "dir" | "file" | "other"; size: number | null };
export type TreeResult = { path: string; rel: string; parent: string | null; root: string; entries: TreeEntry[] };

export type McpTool = { name: string; exposure: "direct" | "deferred"; description: string };

export type McpServer = {
  name: string;
  transport: "stdio" | "http" | "unknown";
  command: string | null;
  args: string[];
  url: string | null;
  exposure: string;
  enabled: boolean;
  toolExposure: number;
  description: string;
  scope: "global" | "project";
  override?: string;
  connected: boolean;
  tools: McpTool[];
  toolCount: number;
  pinned: { name: string; exposure: string }[];
};

export type McpConfig = {
  servers: McpServer[];
  bound: boolean;
  totals: { servers: number; connected: number; enabled: number; tools: number };
  paths: { global: string; project: string };
  exists: { global: boolean; project: boolean };
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok === false) {
    const err = new Error(body?.error || `HTTP ${res.status}`) as Error & { code?: string; status?: number };
    err.code = body?.code;
    err.status = res.status;
    throw err;
  }
  return body.data as T;
}

const post = <T>(path: string, payload?: unknown) =>
  call<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}) });

export const api = {
  bootstrap: (session?: string | null) =>
    call<Bootstrap>(`/api/bootstrap${session ? `?session=${encodeURIComponent(session)}` : ""}`),
  newSession: (cwd?: string) => post<Bootstrap>("/api/session", { op: "new", cwd }),
  openSession: (path: string) => post<Bootstrap>("/api/session", { op: "open", path }),
  fork: (id: string) => post<Bootstrap>("/api/session", { op: "fork", id }),
  activate: (id: string) => post<Bootstrap>("/api/session", { op: "activate", id }),
  rename: (id: string, name: string) => post<Bootstrap>("/api/session", { op: "rename", id, name }),
  remove: (id: string) => post<Bootstrap>("/api/session", { op: "delete", id }),
  prompt: (text: string) => post<{ mode: string }>("/api/prompt", { text }),
  abort: () => post<unknown>("/api/abort", {}),
  approve: (id: string, decision: "approve" | "deny" | "always") => post<unknown>("/api/approve", { id, decision }),
  policy: (mode: "off" | "risky" | "all") => post<{ policy: string }>("/api/policy", { mode }),
  thinking: (level: string) =>
    post<{ thinking: string; requested: string; clamped: boolean }>("/api/thinking", { level }),
  setModel: (provider: string, model: string) => post<{ modelId: string }>("/api/model", { provider, model }),
  models: () => call<{ current: string; models: ModelInfo[] }>("/api/models"),
  system: () => call<SystemInfo>("/api/system"),
  skills: () => call<SkillsResult>("/api/skills"),
  reloadSkills: () => post<SkillsResult>("/api/skills", { op: "reload" }),
  providers: () => call<ProvidersResult>("/api/providers"),
  providerTest: (provider: string) =>
    post<{ provider: string; ms: number; status: string; reason: string | null; authType: string | null }>("/api/providers", { op: "test", provider }),
  providerModels: (provider: string) => post<ModelInfo[]>("/api/providers", { op: "models", provider }),
  providerDefault: (provider: string, model: string) => post<unknown>("/api/providers", { op: "default", provider, model }),
  providerKey: (provider: string, key: string) => post<{ keyMask: string }>("/api/providers", { op: "key", provider, key }),
  providerAdd: (b: { id: string; name?: string; baseUrl: string; api?: string; apiKey?: string; models?: string }) =>
    post<{ id: string; proxied: boolean }>("/api/providers", { op: "add", ...b }),
  providerRemove: (id: string) => post<unknown>("/api/providers", { op: "remove", id }),
  providerReload: () => post<{ reloaded: boolean }>("/api/providers", { op: "reload" }),
  mcp: () => call<McpConfig>("/api/mcp"),
  mcpToggle: (name: string, enabled: boolean) => post<unknown>("/api/mcp", { op: "toggle", name, enabled }),
  mcpAdd: (payload: { name: string; command?: string; args?: string; url?: string; scope?: string }) =>
    post<unknown>("/api/mcp", { op: "add", ...payload }),
  mcpRemove: (name: string) => post<unknown>("/api/mcp", { op: "remove", name }),
  mcpConnect: () => post<McpConfig & { connectMs: number; pending: boolean }>("/api/mcp", { op: "connect" }),
  tree: (path?: string) => call<TreeResult>(`/api/tree${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  file: (path: string) => call<FileResult>(`/api/file?path=${encodeURIComponent(path)}`),
  openPath: (path: string, mode: "editor" | "reveal" | "default" = "editor") =>
    post<{ cmd: string; args: string[] }>("/api/open", { path, mode }),
  fs: (path?: string) =>
    call<{ path: string; parent: string | null; dirs: DirEntry[]; home: string; roots: { label: string; path: string }[] }>(
      `/api/fs${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),
};

export type StreamEvent =
  | { e: "hello"; seq: number } & Bootstrap
  | { e: "sessions"; sessions: SessionSummary[] }
  | { e: "item"; sessionId: string; item: Item }
  | { e: "patch"; sessionId: string; id: string; patch: Partial<Item> }
  | { e: "delta"; sessionId: string; id: string; field: "text" | "thinking"; d: string }
  | { e: "meta"; sessionId: string; meta: Meta };

export function openStream(onEvent: (ev: StreamEvent) => void, onState: (s: "open" | "down") => void) {
  const es = new EventSource("/api/stream");
  es.onopen = () => onState("open");
  es.onerror = () => onState("down");
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as StreamEvent);
    } catch {
      /* ignore keep-alives / partial frames */
    }
  };
  return es;
}
