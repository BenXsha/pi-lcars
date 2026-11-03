import { loadSdk, agentDir, sdkSpec, sdkInfo, MIN_NODE } from "../pi/sdk.mjs";
import { listCommands } from "../pi/commands.mjs";
import { now } from "../pi/format.mjs";

/**
 * Session reads, model/thinking switches, policy, faults — the console's status surface.
 *
 * A factory, not a singleton: every module receives the same ctx the shell
 * built, so a station cannot reach around it for state.
 */
export function coreRoutes(ctx) {
  const { ok, fail, body, cfg, clients, clientErrors, payload, registry, queue, approvals, sessionOf } = ctx;
  return {
  "GET /api/bootstrap": async (req, res) => {
    const entry = sessionOf(req);
    ok(res, payload(entry));
  },

  "GET /api/state": async (req, res) => {
    const entry = sessionOf(req);
    ok(res, { ...payload(entry), queue: queue.snapshot, policy: approvals.snapshot, cwd: cfg.cwd });
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

  "GET /api/models": async (req, res) => {
    const entry = sessionOf(req);
    if (!entry) return fail(res, 404, "no session");
    const rt = entry.session.modelRuntime;
    let models = [];
    try {
      models = rt.getAvailableSnapshot?.() ?? [];
      if (!models.length) models = await rt.getAvailable();
    } catch {
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
        cost: m.cost ? { input: m.cost.input ?? 0, output: m.cost.output ?? 0 } : null,
      })),
    });
  },

  "GET /api/system": async (req, res) => {
    const sdk = await loadSdk();
    let sdkPath = sdkSpec();
    if (sdkPath && !sdkPath.startsWith("/")) {
      try {
        sdkPath = await import("node:module").then((m) => m.createRequire(import.meta.url).resolve(sdkPath));
      } catch {
        /* keep the bare specifier */
      }
    }
    ok(res, {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      piVersion: sdk.VERSION ?? null,
      sdkVersion: sdkInfo()?.selected?.version ?? sdk.VERSION ?? null,
      nodeMin: MIN_NODE,
      sdk: sdkPath,
      agentDir: agentDir(),
      cwd: cfg.cwd,
      port: cfg.port,
      mcpEnabled: process.env.LCARS_MCP !== "0",
      clientErrors: clientErrors.slice(-5),
      approvals: approvals.snapshot,
    });
  },

  "POST /api/client-error": async (req, res) => {
    const b = await body(req).catch(() => ({}));
    const message = String(b?.message ?? "unknown").slice(0, 500);
    const stack = String(b?.stack ?? "").split("\n").slice(0, 12).join("\n");
    console.error(`[client] ${message}${stack ? `\n${stack}` : ""}`);
    clientErrors.push({ at: Date.now(), message });
    if (clientErrors.length > 20) clientErrors.shift();
    ok(res, { recorded: true });
  },

  "GET /api/commands": async (req, res) => {
    const entry = sessionOf(req);
    ok(res, { commands: listCommands({ entry }) });
  },
  };
}
