#!/usr/bin/env node
/**
 * LCARS Agent Console — pi-web shell
 *
 * - Node http server (zero deps)
 * - pi SDK driven in-process
 * - SSE pushes normalized UI events to the browser
 *
 *   node demo/server.mjs            # real pi session
 *   node demo/server.mjs --mock     # scripted replay, no tokens
 *
 * env:
 *   PORT, PI_CWD, PI_SDK
 *   PI_APPROVAL         off | risky | all   (default off — flip it here or on station 06)
 *   PI_APPROVAL_TIMEOUT ms to wait for an operator decision (default 120000)
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");
const PORT = Number(process.env.PORT || 4173);
const CWD = process.env.PI_CWD || "/Users/liuyunkai/Projects/design";
const MOCK = process.argv.includes("--mock");

/* ---------------------------------------------------- approval gate cfg */
const POLICY_DEFAULT = (process.env.PI_APPROVAL || "off").toLowerCase();
const APPROVAL_TIMEOUT = Math.max(5000, Number(process.env.PI_APPROVAL_TIMEOUT || 120000));
/** tools that mutate the machine or the repo — the "risky" policy set */
const RISKY = new Set(["bash", "powershell", "write", "edit", "patch"]);

/* ---------------------------------------------------------------- pi sdk */
async function loadSdk() {
  const tries = [
    process.env.PI_SDK,
    "@earendil-works/pi-coding-agent",
    `${process.env.HOME}/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js`,
  ].filter(Boolean);
  let last;
  for (const spec of tries) {
    try {
      return await import(spec);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`cannot load pi SDK. tried:\n${tries.join("\n")}\n${last?.message}`);
}

/* ----------------------------------------------------------------- state */
const S = {
  session: null,
  sdk: null,
  items: [],
  byId: new Map(),
  seq: 0,
  clients: new Set(),
  meta: { running: false, model: "-", thinking: "-", queue: { steering: 0, followUp: 0 } },
  usage: { input: 0, output: 0, cost: 0, total: 0 },
  policy: POLICY_DEFAULT,
  always: new Set(),
  pending: new Map(), // approval item id -> { tool, resolve, timer }
  loader: null,
  t0: Date.now(),
};

function broadcast(msg) {
  S.seq += 1;
  const payload = `data: ${JSON.stringify({ seq: S.seq, ...msg })}\n\n`;
  for (const res of S.clients) res.write(payload);
}

function emit(item) {
  const i = S.items.findIndex((x) => x.id === item.id);
  if (i === -1) S.items.push(item);
  else S.items[i] = item;
  S.byId.set(item.id, item);
  broadcast({ e: "item", item });
}

function patch(id, fields) {
  const it = S.byId.get(id);
  if (!it) return;
  Object.assign(it, fields);
  broadcast({ e: "patch", id, patch: fields });
}

function delta(id, field, d) {
  const it = S.byId.get(id);
  if (!it) return;
  it[field] = (it[field] || "") + d;
  broadcast({ e: "delta", id, field, d });
}

/* --------------------------------------------------------------- helpers */
const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c && c.type === "text")
    .map((c) => c.text)
    .join("");
};

function shortArgs(name, args) {
  if (!args || typeof args !== "object") return "";
  if (name === "bash" && typeof args.command === "string") return args.command;
  if (typeof args.path === "string") {
    const extra =
      name === "read" && args.offset ? ` / lines ${args.offset}-${args.offset + (args.limit || 0)}` : "";
    return args.path + extra;
  }
  if (typeof args.query === "string") return `"${args.query}"`;
  const s = JSON.stringify(args);
  return s.length > 140 ? s.slice(0, 139) + "…" : s;
}

const truncationOf = (result, text) => {
  const d = result?.details;
  if (d && typeof d === "object" && (d.truncated || d.truncatedLines)) return true;
  return /warning: truncated|truncated output|\[truncated/i.test(text || "");
};

/* ------------------------------------------------------- approval gate */
const gated = (name) =>
  S.policy !== "off" && !S.always.has(name) && (S.policy === "all" || RISKY.has(name));

/**
 * Hold a tool call until the operator answers on the console.
 * Resolves with "approve" | "always" | "deny" | "timeout".
 */
function askApproval(name, input, callId) {
  const id = `ap${callId}`;
  const promise = new Promise((resolve) => {
    const timer = setTimeout(() => settleApproval(id, "timeout"), APPROVAL_TIMEOUT);
    S.pending.set(id, { tool: name, resolve, timer });
  });
  emit({
    kind: "approval",
    id,
    callId,
    tool: name,
    args: shortArgs(name, input),
    status: "pending",
    timeoutMs: APPROVAL_TIMEOUT,
    ts: Date.now(),
  });
  pushApprovalMeta();
  return promise;
}

function pushApprovalMeta() {
  S.meta.policy = S.policy;
  S.meta.pending = S.pending.size;
  S.meta.always = [...S.always];
  broadcast({ e: "meta", meta: S.meta });
}

function settleApproval(id, decision) {
  const p = S.pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  S.pending.delete(id);

  const it = S.byId.get(id);
  const status =
    decision === "approve" ? "approved" : decision === "always" ? "always" : decision === "timeout" ? "timeout" : "denied";
  patch(id, { status, decidedMs: it ? Date.now() - it.ts : 0 });

  if (decision === "always") {
    S.always.add(p.tool);
    emit({
      kind: "notice",
      id: `alw-${Date.now()}`,
      tone: "warn",
      label: "POLICY",
      text: `${p.tool} auto-approved for the rest of this session`,
      ts: Date.now(),
    });
  }
  pushApprovalMeta();
  p.resolve(decision);
  return true;
}

function denyAllPending(reason) {
  for (const id of [...S.pending.keys()]) settleApproval(id, reason);
}

/** inline extension: turns `tool_call` into a UI round-trip */
function approvalGate(pi) {
  pi.on("tool_call", async (ev) => {
    // nested calls (a tool calling another tool) inherit the parent decision
    if (ev.parentToolCallId || !gated(ev.toolName)) return;
    const decision = await askApproval(ev.toolName, ev.input, ev.toolCallId);
    if (decision === "approve" || decision === "always") return;
    return {
      block: true,
      reason:
        decision === "timeout"
          ? `approval gate: no operator response in ${Math.round(APPROVAL_TIMEOUT / 1000)}s`
          : "denied by operator on the LCARS console",
    };
  });
}

function syncMeta() {
  const m = S.session?.model;
  if (!MOCK) {
    S.meta.model = m ? `${m.provider}/${m.id}` : "-";
    S.meta.modelId = m?.id || "-";
    S.meta.thinking = String(S.session?.thinkingLevel ?? "-");
    S.meta.tools = S.session?.getActiveToolNames?.() ?? [];
    S.meta.contextWindow = m?.contextWindow || 200000;
  }
  S.meta.cwd = CWD;
  S.meta.usage = S.usage;
  S.meta.contextPct = Math.min(
    100,
    Math.round((S.usage.total / (S.meta.contextWindow || 200000)) * 1000) / 10,
  );
  S.meta.uptime = Math.round((Date.now() - S.t0) / 1000);
  S.meta.t0 = S.t0;
  S.meta.mock = MOCK;
  S.meta.policy = S.policy;
  S.meta.pending = S.pending.size;
  S.meta.always = [...S.always];
  S.meta.approvalWired = true;
  S.meta.approvalTimeout = APPROVAL_TIMEOUT;
  syncResources();
  broadcast({ e: "meta", meta: S.meta });
}

/** real resource-loader inventory: skills / prompt templates / extensions */
function syncResources() {
  if (!S.loader) {
    S.meta.skills = [];
    S.meta.prompts = [];
    S.meta.extensions = [];
    return;
  }
  try {
    S.meta.skills = (S.loader.getSkills().skills || []).map((s) => ({
      name: s.name,
      description: (s.description || "").replace(/\s+/g, " ").slice(0, 180),
      path: s.filePath || "",
      manual: !!s.disableModelInvocation,
    }));
    S.meta.prompts = (S.loader.getPrompts().prompts || []).map((p) => p.name);
    S.meta.extensions = (S.loader.getExtensions().extensions || [])
      .map((e) => e.name || e.path || "")
      .filter(Boolean);
  } catch (e) {
    console.error("[loader] inventory failed:", e.message);
  }
}

/* ------------------------------------------------------- event -> items */
function onEvent(ev) {
  switch (ev.type) {
    case "message_start":
      if (ev.message?.role === "assistant") {
        emit({
          kind: "assistant",
          id: `a${S.seq}-${Date.now()}`,
          text: "",
          thinking: "",
          streaming: true,
          ts: Date.now(),
        });
        S.cur = S.items[S.items.length - 1].id;
        S.meta.running = true;
        syncMeta();
      }
      break;

    case "message_update": {
      const a = ev.assistantMessageEvent;
      if (!S.cur) break;
      if (a?.type === "text_delta") delta(S.cur, "text", a.delta);
      else if (a?.type === "thinking_delta") delta(S.cur, "thinking", a.delta);
      break;
    }

    case "message_end": {
      const msg = ev.message;
      if (msg?.role === "assistant" && S.cur) {
        const text =
          textOf(msg.content) || S.byId.get(S.cur)?.text || "";
        const thinking =
          (msg.content || [])
            .filter((c) => c?.type === "thinking")
            .map((c) => c.thinking)
            .join("") || S.byId.get(S.cur)?.thinking || "";
        patch(S.cur, {
          text,
          thinking,
          streaming: false,
          stopReason: msg.stopReason,
          errorMessage: msg.errorMessage,
          usage: msg.usage
            ? {
                input: msg.usage.input,
                output: msg.usage.output,
                cost: msg.usage.cost?.total ?? 0,
                total: msg.usage.totalTokens,
              }
            : undefined,
        });
        if (msg.usage) {
          S.usage.input += msg.usage.input || 0;
          S.usage.output += msg.usage.output || 0;
          S.usage.cost += msg.usage.cost?.total || 0;
          S.usage.total = msg.usage.totalTokens || S.usage.total;
        }
        syncMeta();
        S.cur = null;
      }
      break;
    }

    case "tool_execution_start":
      emit({
        kind: "tool",
        id: `t${ev.toolCallId}`,
        callId: ev.toolCallId,
        name: ev.toolName,
        args: shortArgs(ev.toolName, ev.args),
        status: "run",
        output: "",
        ts: Date.now(),
      });
      break;

    case "tool_execution_update": {
      const it = S.byId.get(`t${ev.toolCallId}`);
      if (!it) break;
      const t = textOf(ev.partialResult?.content);
      if (t && t.length > (it.output?.length || 0)) patch(`t${ev.toolCallId}`, { output: t });
      break;
    }

    case "tool_execution_end": {
      const out = textOf(ev.result?.content);
      patch(`t${ev.toolCallId}`, {
        status: ev.isError ? "error" : "ok",
        output: out,
        ms: ev.durationMs,
        truncated: truncationOf(ev.result, out),
      });
      break;
    }

    case "auto_retry_start":
      emit({
        kind: "notice",
        id: `r${ev.attempt}-${Date.now()}`,
        tone: "warn",
        label: "RETRY",
        text: `${ev.attempt}/${ev.maxAttempts} · ${ev.errorMessage}`,
        ts: Date.now(),
      });
      break;

    case "auto_retry_end":
      if (!ev.success)
        emit({
          kind: "notice",
          id: `rf${Date.now()}`,
          tone: "error",
          label: "RETRY",
          text: `gave up after ${ev.attempt} · ${ev.finalError || "unknown"}`,
          ts: Date.now(),
        });
      break;

    case "compaction_start":
      emit({
        kind: "notice",
        id: `c${Date.now()}`,
        tone: "info",
        label: "COMPACT",
        text: `compacting context (${ev.reason})`,
        ts: Date.now(),
      });
      break;

    case "queue_update":
      S.meta.queue = { steering: ev.steering?.length || 0, followUp: ev.followUp?.length || 0 };
      broadcast({ e: "meta", meta: S.meta });
      break;

    case "agent_end":
      S.meta.running = false;
      syncMeta();
      break;

    case "agent_settled":
      S.meta.running = false;
      if (S.cur) {
        patch(S.cur, { streaming: false });
        S.cur = null;
      }
      syncMeta();
      break;

    case "turn_end":
      if (ev.message?.role === "assistant") S.cur = null;
      break;

    default:
      break;
  }
}

/* ------------------------------------------------------------ session */
async function newSession() {
  if (S.session) {
    try {
      S.session.dispose();
    } catch {}
  }
  S.items = [];
  S.byId = new Map();
  S.cur = null;
  S.usage = { input: 0, output: 0, cost: 0, total: 0 };
  S.t0 = Date.now();
  S.pending.clear();
  S.always.clear();

  const { createAgentSession, SessionManager, DefaultResourceLoader } = S.sdk;

  // Own the resource loader so the approval extension can be injected and so the
  // console can list the skills/prompts/extensions that actually got loaded.
  let loader = null;
  if (DefaultResourceLoader) {
    try {
      loader = new DefaultResourceLoader({
        cwd: CWD,
        agentDir: join(process.env.HOME || "", ".pi", "agent"),
        extensionFactories: [{ name: "lcars-approval", factory: approvalGate, hidden: true }],
      });
      await loader.reload({ resolveProjectTrust: async () => true });
    } catch (e) {
      console.error("[loader] falling back to the default loader:", e.message);
      loader = null;
    }
  }
  if (!loader) console.warn("[approval] no inline extension host — the gate will not fire");

  const { session } = await createAgentSession({
    cwd: CWD,
    sessionManager: SessionManager.inMemory(),
    ...(loader ? { resourceLoader: loader } : {}),
  });
  S.session = session;
  S.loader = loader;
  session.subscribe(onEvent);
  syncMeta();
  broadcast({ e: "snap", items: [], meta: S.meta });
  console.log(`[pi] session ready · ${S.meta.model} · ${CWD}`);
}

/* ------------------------------------------------------------- mock mode */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => Date.now();
function finishMock() {
  S.meta.running = false;
  syncMeta();
}

async function runMock(promptText) {
  S.mockAbort = false;
  S.meta.running = true;
  S.meta.model = "mock/deepseek-v4-flash";
  S.meta.modelId = "deepseek-v4-flash";
  S.meta.thinking = "off";
  S.meta.tools = ["read", "bash", "edit", "write"];
  syncMeta();

  emit({ kind: "user", id: `u${ts()}`, text: promptText, ts: ts() });
  await sleep(220);
  if (S.mockAbort) return finishMock();

  const a1 = `a${ts()}`;
  if (S.mockAbort) return finishMock();
  emit({ kind: "assistant", id: a1, text: "", thinking: "", streaming: true, ts: ts() });
  delta(a1, "thinking", "先看现有中间件和测试结构，再决定改哪几个文件。");
  await sleep(420);
  for (const t of ["在 ", "这个仓库里 ", "先确认 login 路由和现有的 limit 逻辑。"]) {
    delta(a1, "text", t);
    await sleep(190);
  }
  patch(a1, { streaming: false, stopReason: "toolUse" });

  const tools = [
    { name: "bash", args: 'rg -n "login" src/ --type ts', out: "src/auth/login.ts:14\nsrc/routes/index.ts:9", ms: 412 },
    { name: "read", args: "src/auth/login.ts / lines 1-48", out: "1  import { Router } from 'express';\n2  const router = Router();\n…", ms: 12 },
  ];
  for (const t of tools) {
    if (S.mockAbort) return finishMock();
    const id = `t${ts()}`;
    emit({ kind: "tool", id, name: t.name, args: t.args, status: "run", output: "", ts: ts() });
    await sleep(520);
    patch(id, { status: "ok", output: t.out, ms: t.ms });
  }

  const a2 = `a${ts()}`;
  emit({ kind: "assistant", id: a2, text: "", thinking: "", streaming: true, ts: ts() });
  for (const t of ["按 IP 建令牌桶，", "60 秒 10 次，", "超限返回 429。", "中间件按路由挂载。"]) {
    delta(a2, "text", t);
    await sleep(200);
  }
  patch(a2, { streaming: false, stopReason: "toolUse" });

  // the operator gate, same round-trip the live tool_call hook makes
  if (gated("bash")) {
    const decision = await askApproval("bash", { command: "npm test -- --run" }, `mock${ts()}`);
    if (S.mockAbort) return finishMock();
    if (decision === "deny" || decision === "timeout") {
      emit({
        kind: "notice",
        id: `blk${ts()}`,
        tone: "error",
        label: "BLOCKED",
        text: `bash held then not released (${decision}) — the run stops here instead of touching the repo`,
        ts: ts(),
      });
      return finishMock();
    }
  }

  const eid = `t${ts()}`;
  emit({
    kind: "tool",
    id: eid,
    name: "bash",
    args: "npm test -- --run",
    status: "run",
    output: "",
    ts: ts(),
  });
  await sleep(700);
  patch(eid, {
    status: "error",
    output: "",
    errorText: "Command failed with exit code 1\nFAIL src/auth/login.test.ts > rejects over limit\nAssertionError: expected 200 to be 429",
    ms: 2140,
  });
  await sleep(260);
  if (S.mockAbort) return finishMock();

  emit({
    kind: "notice",
    id: `r${ts()}`,
    tone: "warn",
    label: "RETRY",
    text: "1/2 · tool timed out after 120s",
    ts: ts(),
  });
  await sleep(400);
  if (S.mockAbort) return finishMock();

  const tid = `t${ts()}`;
  emit({ kind: "tool", id: tid, name: "bash", args: "npm test -- --run", status: "run", output: "", ts: ts() });
  await sleep(900);
  patch(tid, {
    status: "ok",
    output: "Test Files  12 passed (12)\nTests  148 passed (148)",
    ms: 8420,
    truncated: true,
    truncatedNote: "warning: truncated output (original token count: 4142)",
  });

  if (S.mockAbort) return finishMock();
  const a3 = `a${ts()}`;
  emit({ kind: "assistant", id: a3, text: "", thinking: "", streaming: true, ts: ts() });
  for (const t of ["修好了：", "把 key 从 req.ip 换成", " forwarded-for 首段。", "148 个测试全过。"]) {
    delta(a3, "text", t);
    await sleep(210);
  }
  patch(a3, {
    streaming: false,
    stopReason: "stop",
    usage: { input: 21540, output: 612, cost: 0.0042, total: 22152 },
  });

  S.usage = { input: 21540, output: 612, cost: 0.0042, total: 22152 };
  S.meta.running = false;
  syncMeta();
}

/* ---------------------------------------------------------------- server */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 1500\n\n");
    res.write(`data: ${JSON.stringify({ e: "snap", seq: S.seq, items: S.items, meta: S.meta, mock: MOCK })}\n\n`);
    S.clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(ping);
      S.clients.delete(res);
    });
    return;
  }

  if (url.pathname === "/api/prompt" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const text = String(body.text || "").trim();
    if (!text) {
      res.writeHead(400).end("empty");
      return;
    }
    res.writeHead(202).end("accepted");
    if (MOCK) {
      if (!S.meta.running) runMock(text).catch((e) => console.error(e));
      return;
    }
    try {
      if (S.meta.running) {
        emit({
          kind: "user",
          id: `u${ts()}-${Math.random().toString(36).slice(2, 6)}`,
          text,
          steer: true,
          ts: ts(),
        });
        await S.session.steer(text);
      } else {
        emit({
          kind: "user",
          id: `u${ts()}-${Math.random().toString(36).slice(2, 6)}`,
          text,
          ts: ts(),
        });
        S.meta.running = true;
        broadcast({ e: "meta", meta: S.meta });
        S.session.prompt(text).catch((e) => {
          emit({
            kind: "notice",
            id: `x${ts()}`,
            tone: "error",
            label: "ERROR",
            text: String(e?.message || e),
            ts: ts(),
          });
          S.meta.running = false;
          syncMeta();
        });
      }
    } catch (e) {
      console.error(e);
    }
    return;
  }

  if (url.pathname === "/api/approve" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const decision = ["approve", "deny", "always"].includes(body.decision) ? body.decision : "deny";
    const ok = settleApproval(String(body.id || ""), decision);
    res.writeHead(ok ? 202 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok, decision, pending: S.pending.size }));
    return;
  }

  if (url.pathname === "/api/policy" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const mode = String(body.mode || "").toLowerCase();
    if (!["off", "risky", "all"].includes(mode)) {
      res.writeHead(400).end("mode must be off | risky | all");
      return;
    }
    S.policy = mode;
    // turning the gate off releases whatever it was holding — the operator said "stop asking"
    if (mode === "off") for (const id of [...S.pending.keys()]) settleApproval(id, "approve");
    else pushApprovalMeta();
    res.writeHead(202).end(mode);
    return;
  }

  if (url.pathname === "/api/abort" && req.method === "POST") {
    res.writeHead(202).end("aborting");
    denyAllPending("deny"); // a blocked tool call must not outlive the run it belongs to
    if (!MOCK && S.session) S.session.abort().catch(() => {});
    else {
      S.mockAbort = true;
      emit({
        kind: "notice",
        id: `ab${Date.now()}`,
        tone: "warn",
        label: "ABORT",
        text: "run interrupted by operator (ESC)",
        ts: Date.now(),
      });
      S.meta.running = false;
      syncMeta();
    }
    return;
  }

  if (url.pathname === "/api/reset" && req.method === "POST") {
    res.writeHead(202).end("resetting");
    denyAllPending("deny");
    if (MOCK) {
      S.items = [];
      S.byId = new Map();
      S.usage = { input: 0, output: 0, cost: 0, total: 0 };
      broadcast({ e: "snap", seq: S.seq, items: [], meta: S.meta });
    } else await newSession();
    return;
  }

  if (url.pathname === "/api/state") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: S.items, meta: S.meta, mock: MOCK }));
    return;
  }

  /* static */
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = join(PUBLIC, rel.replace(/\.\./g, ""));
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
});

server.listen(PORT, "127.0.0.1", async () => {
  console.log(`\n  LCARS Agent Console  →  http://127.0.0.1:${PORT}`);
  console.log(`  mode: ${MOCK ? "MOCK (replay)" : "LIVE pi session"}   cwd: ${CWD}\n`);
  if (MOCK) {
    // mock is a demo harness: the gate starts on so the flow is visible without a live session
    S.policy = (process.env.PI_APPROVAL || "risky").toLowerCase();
    S.meta = {
      ...S.meta,
      model: "mock/deepseek-v4-flash",
      modelId: "deepseek-v4-flash",
      thinking: "off",
      tools: ["read", "bash", "edit", "write"],
      contextWindow: 200000,
      cwd: CWD,
      policy: S.policy,
      always: [],
      pending: 0,
      skills: [],
      prompts: [],
      extensions: [],
      approvalWired: true,
      approvalTimeout: APPROVAL_TIMEOUT,
    };
  } else {
    S.sdk = await loadSdk();
    await newSession();
  }
});
