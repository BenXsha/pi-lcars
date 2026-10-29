/** Shared formatting helpers for pi payloads → UI items. */

export const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c && c.type === "text")
    .map((c) => c.text)
    .join("");
};

/** One-line argument summary per tool, mirroring how pi's TUI labels calls. */
export function shortArgs(name, args) {
  if (!args || typeof args !== "object") return "";
  if (name === "bash" && typeof args.command === "string") return args.command;
  if (typeof args.path === "string") {
    const range =
      name === "read" && args.offset ? ` / lines ${args.offset}-${args.offset + (args.limit || 0)}` : "";
    return args.path + range;
  }
  if (typeof args.query === "string") return `"${args.query}"`;
  const s = JSON.stringify(args);
  return s.length > 160 ? `${s.slice(0, 159)}…` : s;
}

export function truncationOf(result, text) {
  const d = result?.details;
  if (d && typeof d === "object" && (d.truncated || d.truncatedLines)) return true;
  return /warning: truncated|truncated output|\[truncated/i.test(text || "");
}

/** "0.42s" / "12ms" / "—" */
export function fmtMs(ms) {
  if (ms == null) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export const now = () => Date.now();
