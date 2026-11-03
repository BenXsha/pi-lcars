import type {Item} from "../../api";
import {mmss} from "../../format";

/* ------------------------------------------------------------ terminal */
/*
 * The ACTION zone reads as the machine's own screen: a prompt line you could
 * have typed, then whatever came back. One rule keeps it honest — the text in
 * the prompt is exactly what the tool was called with, and the body is exactly
 * what it returned (diff lines for edit/write, raw output otherwise).
 */
const TERM_LINES = 14;

type TermLine = { text: string; tone?: "add" | "del" | "hunk" | "warn" };

/** bash gets its real command line; every other tool gets `name args`. */
function termCommand(it: Extract<Item, { kind: "tool" }>): string {
  const args = (it.args || "").trim();
  if (it.name === "bash") return args || "bash";
  return args ? `${it.name} ${args}` : it.name;
}

function termBody(it: Extract<Item, { kind: "tool" }>): TermLine[] {
  const out: TermLine[] = [];
  if (it.diff) {
    for (const hunk of it.diff.hunks) {
      if (hunk.hdr) out.push({ text: hunk.hdr, tone: "hunk" });
      for (const line of hunk.lines) {
        out.push({ text: `${line.t}${line.text}`, tone: line.t === "+" ? "add" : line.t === "-" ? "del" : undefined });
      }
    }
    if (it.diff.truncated) out.push({ text: "… diff truncated", tone: "warn" });
    return out;
  }
  const raw = ((it.status === "error" ? it.errorText || it.output : it.output) || "").replace(/\s+$/, "");
  if (!raw) return out;
  for (const text of raw.split("\n")) out.push({ text });
  if (it.truncated) out.push({ text: "… output truncated by pi — the full tail is in the log", tone: "warn" });
  return out;
}

export function TerminalEntry({
  it,
  t0,
  open,
  dim,
  turn,
  onToggle,
  onOpenDiff,
}: {
  it: Extract<Item, { kind: "tool" }>;
  t0: number;
  open: boolean;
  /** the exchange this command belongs to (dimmed when another one is focused) */
  turn?: number;
  dim?: "0" | "1";
  onToggle: () => void;
  /** edit/write: the diff is also worth a full-screen look */
  onOpenDiff?: () => void;
}) {
  const body = termBody(it);
  const shown = open ? body : body.slice(0, TERM_LINES);
  const hidden = body.length - shown.length;
  const state = it.status === "run" ? "run" : it.status === "error" ? "error" : it.truncated ? "warn" : "ok";
  const stamp = it.ms != null ? `${(it.ms / 1000).toFixed(it.ms < 10_000 ? 1 : 0)}s` : null;
  const stat = it.diff ? `+${it.diff.stat.add} −${it.diff.stat.del}` : null;
  // the return code is the one readout a terminal cannot leave implicit
  const outcome =
    it.status === "run"
      ? stat
      : it.exitCode != null
        ? `exit ${it.exitCode}`
        : it.status === "error"
          ? "FAILED"
          : (stat ?? "OK");
  const lamp = it.status === "run" ? "run" : it.status === "error" ? "error" : it.truncated ? "warn" : "ok";

  return (
    <div class="term" data-state={state} data-turn={turn ?? 0} data-dim={dim ?? "0"}>
      <div class="term-cmd">
        <span class="ps">{it.name === "bash" ? "$" : "▸"}</span>
        <pre class="cmd">{termCommand(it)}</pre>
        <span class="meta">
          T+{mmss(it.ts - t0)}
          {stamp ? ` · ${stamp}` : ""}
          {it.diff && onOpenDiff ? (
            <button type="button" class="term-view" title="open in the diff viewer" onClick={onOpenDiff}>
              VIEW
            </button>
          ) : null}
        </span>
        {outcome ? (
          <span class="lamp" data-tone={lamp}>
            {outcome}
          </span>
        ) : null}
      </div>
      {shown.length ? (
        <pre class="term-out">
          {shown.map((line, i) => (
            <span class="ln" key={i} data-tone={line.tone ?? ""}>
              {line.text || " "}
            </span>
          ))}
        </pre>
      ) : null}
      {it.status === "run" ? (
        <div class="term-cmd term-live">
          <span class="ps">$</span>
          <span class="cur" />
        </div>
      ) : null}
      {hidden > 0 ? (
        <button type="button" class="term-more" onClick={onToggle}>
          + {hidden} MORE LINES
        </button>
      ) : open && body.length > TERM_LINES ? (
        <button type="button" class="term-more" onClick={onToggle}>
          COLLAPSE
        </button>
      ) : null}
    </div>
  );
}
