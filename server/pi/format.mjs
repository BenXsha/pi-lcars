/** Shared formatting helpers for pi payloads → UI items. */

export const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c && c.type === "text")
    .map((c) => c.text)
    .join("");
};

/** Image parts of a stored user message — counts only, the bytes are pi's. */
export const imagesOf = (content) => {
  if (!Array.isArray(content)) return [];
  return content
    .filter((c) => c && c.type === "image")
    .map((c) => ({ mimeType: String(c.mimeType || "image/png"), bytes: Math.round(((c.data?.length ?? 0) * 3) / 4) }));
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

export const now = () => Date.now();

/** First-sentence summary of an operator prompt, used as the session title. */
export function summaryOf(text, max = 56) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const clause = t.split(/(?<=[。．.!?！？])\s*/)[0] || t;
  const base = clause.length >= 8 && clause.length <= max ? clause : t;
  return base.length > max ? `${base.slice(0, max - 1).trimEnd()}…` : base;
}
