import { loadSdk } from "../pi/sdk.mjs";
import { queryHistory, startHistoryScan, historyCache as historyCacheRef, deleteHistoryFile, renameHistoryFile } from "../pi/history.mjs";
import {query} from "../http.mjs";

/**
 * Persisted transcripts: cached scan, delete, rename for closed sessions.
 *
 * A factory, not a singleton: every module receives the same ctx the shell
 * built, so a station cannot reach around it for state.
 */
export function historyRoutes(ctx) {
  const { ok, fail, body, cfg, registry } = ctx;
  return {
  "GET /api/history": async (req, res) => {
    const q = query(req);
    if (q.get("refresh") === "1") {
      historyCacheRef.at = 0;
    }
    startHistoryScan({ sdk: await loadSdk(), sessionDir: cfg.sessionDir });
    ok(res, queryHistory({ query: q.get("q") || "", limit: q.get("limit") || 80 }));
  },

  "POST /api/history": async (req, res) => {
    const b = await body(req);
    const sdk = await loadSdk();
    if (b.op === "delete") {
      const open = [...registry.sessions.values()].find((s) => s.path === b.path);
      if (open) await registry.remove(open.id);
      else await deleteHistoryFile(b.path);
      historyCacheRef.at = 0;
      return ok(res, { ok: true });
    }
    if (b.op === "rename") {
      const open = [...registry.sessions.values()].find((s) => s.path === b.path);
      if (open) return ok(res, await registry.rename(open.id, b.name));
      const r = await renameHistoryFile({ sdk, path: b.path, name: b.name });
      historyCacheRef.at = 0;
      return ok(res, r);
    }
    fail(res, 400, `unknown op: ${b.op}`, { code: "E_HISTORY" });
  },
  };
}
