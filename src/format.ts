/**
 * Pure readout formatters — no DOM, no components, no store.
 *
 * Every number the console prints (sizes, elapsed time, tokens, paths) is
 * produced here so the same quantity never reads two different ways in two
 * stations. Components import these; nothing here imports anything.
 */

/** 1.2 MB / 48 KB / 512 B — the roomy form, for panels and readouts. */
export function fmtSize(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** 1.2M / 48K / 512B — the dense form, for one-line lists. */
export function fmtSizeShort(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}K`;
  return `${(n / 1048576).toFixed(1)}M`;
}

/** 1.4M / 24.6K / 812 — token counts; context windows reach 1M. */
export const fmtTok = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

/** mm:ss — elapsed and uptime readouts. */
export const mmss = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
};

/** 12s / 4m / 3h / 2d — relative age of a session row. */
export const ago = (ts: number | null): string => {
  if (!ts) return "";
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.max(1, Math.round(d / 1000))}s`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`;
  return `${Math.round(d / 86_400_000)}d`;
};

/** Collapse the home directory to `~` so paths fit a readout. */
export const shortPath = (p: string): string =>
  p.replace(/^\/(?:Users|home)\/[^/]+/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/i, "~");

export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** The first non-empty line of a block, trimmed. */
export const firstLine = (text: string): string => (text.split("\n").find((l) => l.trim()) ?? "").trim();

/** Word count for reasoning blocks (pi reports no reasoning tokens). */
export const wordsOf = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
