/**
 * Composer memory: the draft you were typing and the prompts you already sent.
 *
 * Kept in localStorage, keyed per session, because both are properties of a
 * conversation rather than of the app (`lcars.left` style keys, same store the
 * pane widths use). Nothing here is sent to the server.
 */

const DRAFT = "lcars.draft.";
const HIST = "lcars.hist.";
const HIST_MAX = 40;

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode / quota: drafts are a convenience, never a requirement */
  }
}

export function loadDraft(sessionId: string | null): string {
  return sessionId ? read(DRAFT + sessionId) : "";
}

export function saveDraft(sessionId: string | null, text: string) {
  if (!sessionId) return;
  write(DRAFT + sessionId, text);
}

export function clearDraft(sessionId: string | null) {
  if (sessionId) write(DRAFT + sessionId, "");
}

/** Oldest first, newest last — the order ↑ walks backwards through. */
export function loadHistory(sessionId: string | null): string[] {
  if (!sessionId) return [];
  try {
    const parsed: unknown = JSON.parse(read(HIST + sessionId) || "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
  } catch {
    return [];
  }
}

/** Appends unless it repeats the newest entry, then trims to HIST_MAX. */
export function pushHistory(sessionId: string | null, text: string): string[] {
  const t = text.trim();
  if (!sessionId || !t) return loadHistory(sessionId);
  const list = loadHistory(sessionId);
  const next = list[list.length - 1] === t ? list : [...list, t].slice(-HIST_MAX);
  write(HIST + sessionId, JSON.stringify(next));
  return next;
}
