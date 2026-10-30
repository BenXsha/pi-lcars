import { unlink } from "node:fs/promises";

/**
 * Persisted sessions (the history station).
 *
 * All reads come from SessionManager so the console and the CLI see the same
 * transcripts. listAll() walks every project directory, so results are capped
 * and the client is expected to search rather than scroll.
 */
/**
 * Scanning every transcript on the machine takes tens of seconds (404 files
 * here), so the scan runs in the background and is cached. The endpoint never
 * blocks: it reports `scanning`/`progress` and serves whatever is cached.
 */
export const historyCache = { at: 0, rows: [], scanning: false, progress: { loaded: 0, total: 0 }, error: null };

export function startHistoryScan({ sdk, sessionDir }) {
  if (historyCache.scanning) return;
  historyCache.scanning = true;
  historyCache.progress = { loaded: 0, total: 0 };
  historyCache.error = null;
  const onProgress = (p) => {
    if (p && typeof p.loaded === "number") historyCache.progress = { loaded: p.loaded, total: p.total ?? historyCache.progress.total };
  };
  Promise.resolve(sessionDir ? sdk.SessionManager.listAll(sessionDir, onProgress) : sdk.SessionManager.listAll(onProgress))
    .then((rows) => {
      historyCache.rows = rows;
      historyCache.at = Date.now();
    })
    .catch((e) => {
      historyCache.error = e.message;
    })
    .finally(() => {
      historyCache.scanning = false;
    });
}

export function queryHistory({ query = "", limit = 80 } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const rows = q
    ? historyCache.rows.filter((r) =>
        [r.name, r.firstMessage, r.allMessagesText, r.cwd, r.id].some((v) => v && String(v).toLowerCase().includes(q)),
      )
    : historyCache.rows;
  const matched = rows.sort((a, b) => new Date(b.modified) - new Date(a.modified)).slice(0, Math.max(1, Math.min(400, Number(limit) || 80)));
  return {
    ready: !!historyCache.at,
    scanning: historyCache.scanning,
    progress: historyCache.progress,
    scanned: historyCache.rows.length,
    matched: matched.length,
    error: historyCache.error,
    at: historyCache.at,
    sessions: matched.map((r) => ({
      path: r.path,
      id: r.id,
      cwd: r.cwd,
      name: r.name ?? null,
      title: r.firstMessage || r.name || r.id.slice(0, 10),
      messages: r.messageCount,
      created: r.created,
      modified: r.modified,
      parent: r.parentSessionPath ?? null,
    })),
  };
}

/** Blocking variant, kept for scripts/tests. */
export async function listHistory({ sdk, sessionDir, query = "", limit = 80 }) {
  const t0 = Date.now();
  let rows = [];
  try {
    rows = await (sessionDir
      ? sdk.SessionManager.listAll(sessionDir)
      : sdk.SessionManager.listAll());
  } catch (e) {
    const err = new Error(`cannot scan sessions: ${e.message}`);
    err.status = 500;
    err.code = "E_HISTORY";
    throw err;
  }

  const q = String(query || "").trim().toLowerCase();
  const matched = (q
    ? rows.filter((r) =>
        [r.name, r.firstMessage, r.allMessagesText, r.cwd, r.id].some((v) => v && String(v).toLowerCase().includes(q)),
      )
    : rows
  )
    .sort((a, b) => new Date(b.modified) - new Date(a.modified))
    .slice(0, Math.max(1, Math.min(400, Number(limit) || 80)));

  return {
    scanned: rows.length,
    matched: matched.length,
    ms: Date.now() - t0,
    sessions: matched.map((r) => ({
      path: r.path,
      id: r.id,
      cwd: r.cwd,
      name: r.name ?? null,
      title: r.firstMessage || r.name || r.id.slice(0, 10),
      messages: r.messageCount,
      created: r.created,
      modified: r.modified,
      parent: r.parentSessionPath ?? null,
    })),
  };
}

/** Delete a transcript file. Open sessions must be closed by the registry first. */
export async function deleteHistoryFile(path) {
  try {
    await unlink(path);
    return { ok: true, path };
  } catch (e) {
    const err = new Error(`cannot delete: ${e.message}`);
    err.status = e.code === "ENOENT" ? 404 : 500;
    err.code = "E_HISTORY";
    throw err;
  }
}

/** Rename a transcript that is not open: append a session_info entry via the SDK. */
export async function renameHistoryFile({ sdk, path, name }) {
  if (!name || !String(name).trim()) {
    const e = new Error("name is required");
    e.status = 400;
    e.code = "E_ARGS";
    throw e;
  }
  try {
    const manager = sdk.SessionManager.open(path);
    manager.appendSessionInfo(String(name).trim());
    return { ok: true, path, name: String(name).trim() };
  } catch (e) {
    const err = new Error(`cannot rename: ${e.message}`);
    err.status = 500;
    err.code = "E_HISTORY";
    throw err;
  }
}
