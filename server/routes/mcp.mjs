import { agentDir } from "../pi/sdk.mjs";
import { mcpStatus, setEnabled, addServer, removeServer } from "../pi/mcpConfig.mjs";

/**
 * MCP servers: status, enable, add, remove, connect.
 *
 * A factory, not a singleton: every module receives the same ctx the shell
 * built, so a station cannot reach around it for state.
 */
export function mcpRoutes(ctx) {
  const { ok, fail, body, cfg, registry, sessionOf } = ctx;
  return {
  "GET /api/mcp": async (req, res) => {
    const entry = sessionOf(req);
    const status = await mcpStatus({ agentDir: agentDir(), cwd: cfg.cwd, session: entry?.session });
    ok(res, { ...status, bound: !!entry?.bound });
  },

  "POST /api/mcp": async (req, res) => {
    const b = await body(req);
    const ctx = { agentDir: agentDir(), cwd: cfg.cwd };
    switch (b.op) {
      case "toggle":
        ok(res, await setEnabled({ ...ctx, name: b.name, enabled: !!b.enabled }));
        break;
      case "add":
        ok(
          res,
          await addServer({
            ...ctx,
            name: b.name,
            command: b.command,
            args: b.args,
            url: b.url,
            env: b.env,
            headers: b.headers,
            dir: b.dir,
            timeout: b.timeout,
            description: b.description,
            scope: b.scope,
            exposure: b.exposure,
          }),
        );
        break;
      case "remove":
        ok(res, await removeServer({ ...ctx, name: b.name }));
        break;
      case "connect": {
        const entry = registry.get(b.session);
        if (!entry?.bind) return fail(res, 409, "no session to bind", { code: "E_NO_SESSION" });
        const r = await entry.bind();
        // MCP connects in the background after session_start: poll until tools
        // exist (or give up and report what we have — never claim success).
        const started = Date.now();
        const deadline = started + Math.min(30_000, Number(b.timeout) || 15_000);
        let status = await mcpStatus({ agentDir: agentDir(), cwd: cfg.cwd, session: entry.session });
        // MCP connects per server in the background; keep waiting while any
        // enabled server is still without tools, but never past the deadline.
        while (status.totals.connected < status.totals.enabled && Date.now() < deadline) {
          await new Promise((res2) => setTimeout(res2, 500));
          status = await mcpStatus({ agentDir: agentDir(), cwd: cfg.cwd, session: entry.session });
        }
        entry.pushMeta();
        ok(res, {
          ...status,
          bound: true,
          connectMs: Date.now() - started,
          pending: status.totals.connected < status.totals.enabled,
          bindMs: r.ms,
        });
        break;
      }
      default:
        fail(res, 400, `unknown op: ${b.op}`, { code: "E_MCP" });
    }
  },
  };
}
