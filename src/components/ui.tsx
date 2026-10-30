import type { ComponentChildren } from "preact";
import { Icon, type IconName } from "./Icon";
import { Markdown } from "./Markdown";
import { askComposer } from "../composer";
import type { AgentMeta, DiffData, SubCall } from "../api";
import { highlight, langFromPath } from "../highlight";

/* ============================================================
   geometry
   ============================================================ */

type ElbowProps = {
  /** width of the vertical leg */
  vw?: number;
  /** height of the vertical leg */
  vh?: number;
  /** size of the horizontal leg */
  hw: number;
  hh: number;
  /** concave fillet radius at the inner corner */
  r?: number;
  class?: string;
};

/**
 * The LCARS elbow. Two legs of different weight meet; the inner (concave)
 * corner is filleted with `r`, the outer corner stays square. A quadratic
 * through the exact corner gives the fillet without ambiguous arc flags.
 */
export function Elbow({ vw = 64, vh = 104, hw, hh, r = 22, class: cls }: ElbowProps) {
  const w = Math.max(hw, vw + r + 1);
  const h = Math.max(vh, hh + r + 1);
  const d = `M0,0 H${w} V${hh} H${vw + r} Q${vw},${hh} ${vw},${hh + r} V${h} H0 Z`;
  return (
    <svg class={`elbow ${cls ?? ""}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/* ============================================================
   chrome
   ============================================================ */

/**
 * Top cap: a solid block whose bottom-right corner is cut by a concave sweep,
 * so the cap flows into the thin shelf bar next to it. Reproduces the canvas
 * shape (block minus a circle centred on its bottom-right corner).
 */
export function TopCap(props: { w?: number; h?: number; bar?: number; r?: number; flat?: boolean; children?: ComponentChildren; class?: string }) {
  const w = props.w ?? 320;
  const h = props.h ?? 100;
  const bar = props.bar ?? 44;
  const r = props.r ?? Math.max(8, h - bar - 1);
  // convex vs concave: the control point must sit on the INNER corner of the
  // scoop box (w-r, bar). Putting it on the outer corner (w, h) rounds the
  // corner off instead of cutting it out.
  const d = `M0,0 H${w} V${bar} Q${w - r},${bar} ${w - r},${h} H0 Z`;
  return (
    <div class={`cap ${props.class ?? ""}`} style={{ width: `${w}px`, height: `${h}px`, flex: `0 0 ${h}px` }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
        {props.flat ? <rect width={w} height={h} fill="currentColor" /> : <path d={d} fill="currentColor" />}
      </svg>
      {props.children}
    </div>
  );
}

export function Shelf(props: { brand: string; tag: string; left?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <header class="shelf">
      <div class="shelf-l">
        {props.left}
        {props.brand ? <span class="brand">{props.brand}</span> : null}
        <span class="station-tag">{props.tag}</span>
      </div>
      <div class="shelf-r">{props.children}</div>
    </header>
  );
}

export function ControlChip(props: {
  icon: IconName;
  label: string;
  value: string;
  open?: boolean;
  off?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      class={`ctl ${props.off ? "is-off" : ""}`}
      data-open={props.open ? "1" : "0"}
      title={props.title}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={11} />
      <span class="k">{props.label}</span>
      <span class="v">{props.value}</span>
      <Icon name={props.open ? "act-collapse" : "act-expand"} size={11} />
    </button>
  );
}

export function Deck(props: {
  label: string;
  sub?: string;
  children: ComponentChildren;
  actions?: ComponentChildren;
}) {
  return (
    <div class="deck">
      <div class="dk-lb">
        <b>{props.label}</b>
        <span>{props.sub}</span>
      </div>
      <div class="dk-body">{props.children}</div>
      {props.actions ? <div class="dk-act">{props.actions}</div> : null}
    </div>
  );
}

export function PickRow(props: {
  icon: IconName;
  name: string;
  meta?: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" class="opt" aria-selected={props.selected ? "true" : "false"} onClick={props.onClick}>
      <span class="st" />
      <span class="ic">
        <Icon name={props.icon} size={13} />
      </span>
      <span class="nm">{props.name}</span>
      <span class="mt">{props.meta ?? ""}</span>
      <span class="ck">{props.selected ? <Icon name="status-ok" size={13} /> : null}</span>
    </button>
  );
}

export function Segmented<T extends string>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div class="seg" role="group">
      {props.options.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={props.value === o.value ? "true" : "false"}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Station(props: {
  num: string;
  label: string;
  icon: IconName;
  w?: number;
  h?: number;
  tone?: "orange" | "amber" | "lav" | "moon" | "ice" | "cyan";
  active?: boolean;
  full?: boolean;
  badge?: string;
  /** hover hint; shown as an LCARS strip to the right of the rail */
  tip?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      class={`station ${props.full ? "is-full" : ""} ${props.label ? "" : "is-icon"}`}
      data-tone={props.tone}
      data-tip={props.tip ?? props.label}
      aria-label={props.tip ?? props.label}
      aria-current={props.active ? "true" : "false"}
      style={props.full ? { height: `${props.h ?? 44}px` } : { width: `${props.w ?? 196}px`, height: `${props.h ?? 52}px` }}
      onClick={props.onClick}
    >
      <span class="num">{props.num}</span>
      <span class="lbl">{props.label}</span>
      <span class="ic">
        <Icon name={props.icon} size={13} />
      </span>
    </button>
  );
}

/* ============================================================
   readouts
   ============================================================ */

export type ToolState = "run" | "ok" | "error" | "warn";

export function ToolStrip(props: {
  name: string;
  icon: IconName;
  args: string;
  output?: string;
  errorText?: string;
  state: ToolState;
  ms?: number;
  count?: number;
  truncated?: boolean;
  exitCode?: number;
  diff?: DiffData;
  onOpenDiff?: () => void;
  children?: SubCall[];
  agent?: AgentMeta;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const state = props.state;
  const raw = (state === "error" ? props.errorText ?? props.output ?? "" : props.output ?? "").trim();
  const lines = raw ? raw.split("\n") : [];
  const visible = state === "error" ? 3 : 2;
  const shown = props.expanded ? lines : lines.slice(0, visible);
  const hidden = lines.length - shown.length;
  // long commands wrap too; offer the toggle even when the output is short
  const argsLong = (props.args || "").length > 88;
  const diffRows = props.diff ? flattenDiff(props.diff) : [];
  const visibleDiff = props.expanded ? diffRows : diffRows.slice(0, 8);
  const hiddenDiff = diffRows.length - visibleDiff.length;
  const kids = props.children ?? [];
  const visibleKids = props.expanded ? kids : kids.slice(0, 6);
  const hiddenKids = kids.length - visibleKids.length;
  // `hidden` collapses to 0 once expanded, so `expanded` must keep the control
  // alive — otherwise the row can only ever open (it used to be one-way).
  const canToggle = !!props.onToggle && (!!props.expanded || hidden > 0 || hiddenDiff > 0 || hiddenKids > 0 || argsLong);

  return (
    <div class="tool" data-state={state} data-expanded={props.expanded ? "1" : "0"} data-toggle={canToggle ? "1" : "0"}>
      <div class="st" />
      {canToggle ? (
        <button
          type="button"
          class="nm"
          aria-expanded={props.expanded ? "true" : "false"}
          title={props.expanded ? "Collapse output" : "Expand output"}
          onClick={props.onToggle}
        >
          <Icon name={props.icon} size={13} />
          <span class="lb">
            {props.name.toUpperCase()}
            {props.count && props.count > 1 ? <small>x{props.count}</small> : null}
          </span>
        </button>
      ) : (
        <div class="nm">
          <Icon name={props.icon} size={13} />
          <span class="lb">
            {props.name.toUpperCase()}
            {props.count && props.count > 1 ? <small>x{props.count}</small> : null}
          </span>
        </div>
      )}
      <div class={`bd${props.expanded ? " anim-in" : ""}`} key={props.expanded ? "open" : "closed"}>
        <div class="args">{props.args}</div>
        {props.diff ? (
          <>
            {props.onOpenDiff ? (
              <button type="button" class="more" onClick={props.onOpenDiff}>
                OPEN IN VIEWER
              </button>
            ) : null}
            <DiffView rows={visibleDiff} stat={props.diff.stat} truncated={props.diff.truncated} />
          </>
        ) : shown.length ? (
          <OutputBlock
            text={shown.join("\n")}
            tone={state === "error" ? "err" : "out"}
            lang={state === "error" ? "" : langFor(props.name, props.args)}
          />
        ) : null}
        {canToggle ? (
          <button
            type="button"
            class="more"
            aria-expanded={props.expanded ? "true" : "false"}
            onClick={props.onToggle}
          >
            {props.expanded
              ? "− COLLAPSE"
              : hiddenDiff > 0
                ? `+ ${hiddenDiff} MORE LINES`
                : hidden > 0
                  ? `+ ${hidden} MORE LINES`
                  : "EXPAND"}
          </button>
        ) : null}
        {props.truncated ? <div class="warn">warning: output truncated</div> : null}
        {kids.length ? <SubCalls rows={visibleKids} total={kids.length} /> : null}
        {props.agent ? <AgentBay a={props.agent} /> : null}
      </div>
      <div class="mt">
        {props.agent ? (
          <span>{props.agent.tools} CALLS</span>
        ) : kids.length ? (
          <span>{kids.length} CALLS</span>
        ) : state === "run" ? (
          <span class="scan">
            <i />
            <i />
            <i />
          </span>
        ) : state === "error" ? (
          props.exitCode != null ? `EXIT ${props.exitCode}` : "ERROR"
        ) : (
          <span>{props.ms != null ? (props.ms < 1000 ? `${Math.round(props.ms)}ms` : `${(props.ms / 1000).toFixed(2)}s`) : "—"}</span>
        )}
      </div>
    </div>
  );
}

export function Meter(props: { segments: { tone?: "sys" | "tool" | "hist"; pct: number }[] }) {
  const map = { sys: "var(--cyan)", tool: "var(--ice)", hist: "var(--orange)" } as const;
  return (
    <div class="meter">
      {props.segments.map((s, i) => (
        <i key={i} style={{ width: `${s.pct}%`, background: s.tone ? map[s.tone] : undefined }} />
      ))}
    </div>
  );
}

export function Readout(props: { value: string; unit?: string }) {
  return (
    <div class="readout">
      <b>{props.value}</b>
      {props.unit ? <span>{props.unit}</span> : null}
    </div>
  );
}

/* ============================================================
   messages
   ============================================================ */

export function MessageRow(props: {
  role: "user" | "assistant";
  time: string;
  model?: string;
  name?: string;
  text: string;
  thinking?: string;
  thinkingOpen?: boolean;
  onToggleThinking?: () => void;
  streaming?: boolean;
  rate?: number;
  /** shown only for user messages: rewind this exchange back into the composer */
  onRecall?: () => void;
}) {
  const isUser = props.role === "user";
  return (
    <div class={`row ${props.role} turn`}>
      <div class="chip">
        <span class="who">
          <Icon name={isUser ? "role-user" : "role-agent"} size={14} />
          {props.name ?? (isUser ? "" : "PI")}
        </span>
        <span>{isUser ? props.time : props.model ?? ""}</span>
      </div>
      <div class="cell">
        {props.text ? (
          <div class="msg-act">
            <button type="button" onClick={() => navigator.clipboard?.writeText(props.text).catch(() => {})}>
              COPY
            </button>
            <button type="button" onClick={() => askComposer({ kind: "quote", text: props.text })}>
              QUOTE
            </button>
            {props.onRecall ? (
              <button type="button" class="recall" onClick={props.onRecall}>
                RECALL
              </button>
            ) : null}
          </div>
        ) : null}
        {props.thinking ? (
          <button
            type="button"
            class="think"
            data-open={props.thinkingOpen ? "1" : "0"}
            aria-expanded={props.thinkingOpen ? "true" : "false"}
            onClick={props.onToggleThinking}
          >
            <span class="th-hd">
              <Icon name={props.thinkingOpen ? "act-collapse" : "act-expand"} size={10} />
              <span class="th-lb">THINKING</span>
              <span class="th-words">{props.thinking.trim().split(/\s+/).length} W</span>
            </span>
            <span class={`th-body${props.thinkingOpen ? " anim-in" : ""}`} key={props.thinkingOpen ? "open" : "closed"}>
              {props.thinking}
            </span>
          </button>
        ) : null}
        {props.text ? (
          props.role === "assistant" ? <Markdown text={props.text} /> : <div class="txt">{props.text}</div>
        ) : null}
        {props.streaming ? (
          <div class="stream">
            <span class="caret" />
            <span>STREAMING{props.rate ? ` / ${props.rate} TOK/S` : ""}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function NoticeRow(props: { label: string; text: string; tone?: "info" | "warn" | "error" }) {
  return (
    <div class="row notice" data-tone={props.tone ?? "info"}>
      <div class="chip">
        <span>{props.label}</span>
      </div>
      <div class="cell">
        <div class="txt">{props.text}</div>
      </div>
    </div>
  );
}

export function ApprovalDeck(props: {
  tool: string;
  args: string;
  state: "pending" | "approved" | "denied" | "timeout";
  onDecide?: (d: "approve" | "deny" | "always") => void;
}) {
  const pending = props.state === "pending";
  return (
    <div class={`approval ${pending ? "anim-pulse" : ""}`} data-state={props.state}>
      <div class="st" />
      <div class="bd">
        <div class="hd">
          <span class="tag">{pending ? "APPROVAL REQUIRED" : "APPROVAL"}</span>
          <span class="toolname">{props.tool.toUpperCase()}</span>
          <span class="wait">{pending ? "BLOCKING" : props.state.toUpperCase()}</span>
        </div>
        <div class="args">{props.args}</div>
      </div>
      {pending ? (
        <div class="deck-btns">
          <BarButton tone="ok" label="APPROVE" hint="A" icon="ap-approve" onClick={() => props.onDecide?.("approve")} />
          <BarButton tone="stop" label="DENY" hint="D" icon="ap-deny" onClick={() => props.onDecide?.("deny")} />
          <BarButton tone="go" label="ALWAYS" hint="L" icon="ap-always" onClick={() => props.onDecide?.("always")} />
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
   form language
   ============================================================ */

/** Inline styling for the bare input inside `.field > .fc .in`. */
const FIELD_INPUT_STYLE = {
  border: "0",
  background: "none",
  padding: 0,
  outline: 0,
  flex: "1 1 auto",
  color: "inherit",
  font: "inherit",
} as const;

export function FieldRow(props: {
  label: string;
  icon?: IconName;
  required?: boolean;
  value?: string;
  placeholder?: string;
  unit?: string;
  state?: "idle" | "ok" | "error";
  message?: string;
  mask?: boolean;
  onInput?: (v: string) => void;
}) {
  return (
    <label class="field" data-required={props.required ? "1" : "0"} data-state={props.state ?? "idle"}>
      <span class="st" />
      <span class="lb">
        {props.icon ? <Icon name={props.icon} size={11} /> : null}
        {props.label}
      </span>
      <span class="fc">
        <span class="in">
          {props.value !== undefined ? (
            props.mask ? (
              <input
                class="in"
                style={FIELD_INPUT_STYLE}
                type="password"
                value={props.value}
                onInput={(e) => props.onInput?.((e.target as HTMLInputElement).value)}
              />
            ) : (
              <input
                class="in"
                style={FIELD_INPUT_STYLE}
                type="text"
                value={props.value}
                onCompositionStart={(e) => {
                  e.currentTarget.dataset.composing = "1";
                }}
                onCompositionEnd={(e) => {
                  delete e.currentTarget.dataset.composing;
                  props.onInput?.(e.currentTarget.value);
                }}
                onInput={(e) => {
                  if (!e.currentTarget.dataset.composing) props.onInput?.(e.currentTarget.value);
                }}
              />
            )
          ) : (
            <span class="ph">{props.placeholder ?? ""}</span>
          )}
        </span>
        {props.message ? (
          <span class="msg" data-tone={props.state === "error" ? "err" : props.state === "ok" ? "ok" : undefined}>
            {props.message}
          </span>
        ) : null}
      </span>
      <span class="unit">{props.unit ?? ""}</span>
    </label>
  );
}

/** Same grid as FieldRow, but a textarea — for args / env / headers lists. */
export function FieldArea(props: {
  label: string;
  icon?: IconName;
  required?: boolean;
  value: string;
  placeholder?: string;
  rows?: number;
  state?: "idle" | "ok" | "error";
  message?: string;
  onInput?: (v: string) => void;
}) {
  return (
    <label class="field" data-area="1" data-required={props.required ? "1" : "0"} data-state={props.state ?? "idle"}>
      <span class="st" />
      <span class="lb">
        {props.icon ? <Icon name={props.icon} size={11} /> : null}
        {props.label}
      </span>
      <span class="fc">
        <textarea
          value={props.value}
          rows={props.rows ?? 3}
          placeholder={props.placeholder}
          spellcheck={false}
          onCompositionStart={(e) => {
            e.currentTarget.dataset.composing = "1";
          }}
          onCompositionEnd={(e) => {
            delete e.currentTarget.dataset.composing;
            props.onInput?.(e.currentTarget.value);
          }}
          onInput={(e) => {
            if (!e.currentTarget.dataset.composing) props.onInput?.(e.currentTarget.value);
          }}
        />
        {props.message ? (
          <span class="msg" data-tone={props.state === "error" ? "err" : props.state === "ok" ? "ok" : undefined}>
            {props.message}
          </span>
        ) : null}
      </span>
      <span class="unit" />
    </label>
  );
}

export function BarButton(props: {
  label: string;
  hint?: string;
  icon?: IconName;
  tone?: "ok" | "go" | "stop" | "quiet" | undefined;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" class="btn" data-tone={props.tone} disabled={props.disabled} onClick={props.onClick}>
      {props.icon ? <Icon name={props.icon} size={13} /> : null}
      <b>{props.label}</b>
      {props.hint ? <em>{props.hint}</em> : null}
    </button>
  );
}

/* ---------------------------------------------------------------- diff */
export type DiffRow =
  | { kind: "hunk"; text: string }
  | { kind: "add" | "del" | "ctx"; o?: number; n?: number; text: string };

/** Only `read` output is a file body; bash output stays uncoloured. */
function langFor(tool: string, args: string) {
  if (tool !== "read") return "";
  return langFromPath((args || "").split(" / ")[0]);
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
};

const decodeEntities = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (m) => HTML_ENTITIES[m] ?? m);

/**
 * highlight.js returns HTML; we turn it back into nodes instead of injecting it.
 * The parser accepts exactly two shapes — `<span class="hljs-…">` and escaped
 * text — so anything else in the string is dropped rather than rendered.
 */
function Highlighted({ html }: { html: string }) {
  const out: ComponentChildren[] = [];
  const stack: ComponentChildren[][] = [out];
  const token = /<span class="(hljs-[^"]*)">|<\/span>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html))) {
    const [, cls, text] = match;
    if (cls) {
      const kids: ComponentChildren[] = [];
      stack[stack.length - 1]?.push(<span class={cls}>{kids}</span>);
      stack.push(kids);
    } else if (text) {
      stack[stack.length - 1]?.push(decodeEntities(text));
    } else if (stack.length > 1) {
      stack.pop(); // </span>
    }
  }
  return <>{out}</>;
}

function OutputBlock({ text, tone, lang }: { text: string; tone: "out" | "err"; lang: string }) {
  const html = lang ? highlight(text, lang) : null;
  if (!html) return <div class={tone}>{text}</div>;
  return (
    <div class={`${tone} hljs`}>
      <Highlighted html={html} />
    </div>
  );
}

export function flattenDiff(diff: DiffData): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const h of diff.hunks) {
    if (h.hdr) rows.push({ kind: "hunk", text: h.hdr });
    for (const l of h.lines) {
      if (l.t === "+") rows.push({ kind: "add", n: l.n, text: l.text });
      else if (l.t === "-") rows.push({ kind: "del", o: l.o, text: l.text });
      else if (l.t === "\\") continue;
      else rows.push({ kind: "ctx", o: l.o, n: l.n, text: l.text });
    }
  }
  return rows;
}

/** Hunk view: two line-number gutters, a sign column, then the text. */
export function DiffView({ rows, stat, truncated }: { rows: DiffRow[]; stat: { add: number; del: number }; truncated?: boolean }) {
  return (
    <div class="diff">
      <div class="df-stat">
        <span class="add">+{stat.add}</span>
        <span class="del">−{stat.del}</span>
        {truncated ? <span class="tr">truncated</span> : null}
      </div>
      <div class="df-rows">
        {rows.map((r, i) =>
          r.kind === "hunk" ? (
            <div class="dl hunk" key={i}>
              {r.text}
            </div>
          ) : (
            <div class={`dl ${r.kind}`} key={i}>
              <span class="o">{r.kind === "add" ? "" : r.o ?? ""}</span>
              <span class="n">{r.kind === "del" ? "" : r.n ?? ""}</span>
              <span class="s">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}</span>
              <span class="t">{r.text || " "}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- subagents */
/** A subagent's own tool calls, indented under the tool row that spawned it. */
function SubCalls({ rows, total }: { rows: SubCall[]; total: number }) {
  return (
    <div class="subs">
      {rows.map((c) => (
        <div class="sub" key={c.id} data-state={c.status}>
          <span class="st" />
          <span class="nm">{c.name.toUpperCase()}</span>
          <span class="ar">{c.args}</span>
          <span class="ms">
            {c.status === "run" ? (
              <span class="scan">
                <i />
                <i />
                <i />
              </span>
            ) : c.status === "error" ? (
              "FAIL"
            ) : c.ms != null ? (
              c.ms < 1000 ? `${Math.round(c.ms)}ms` : `${(c.ms / 1000).toFixed(2)}s`
            ) : (
              "—"
            )}
          </span>
        </div>
      ))}
      {total > rows.length ? <div class="subs-more">+{total - rows.length} more calls</div> : null}
    </div>
  );
}

/** Subagent summary: pi reports counts and cost, not per-call records. */
function AgentBay({ a }: { a: AgentMeta }) {
  const tok =
    typeof a.tokens === "string" ? a.tokens.replace(/\s*tokens?$/i, "").toUpperCase() : a.tokens >= 1000 ? `${(a.tokens / 1000).toFixed(1)}K` : String(a.tokens);
  const cost = typeof a.cost === "number" ? (a.cost ? `$${a.cost.toFixed(4)}` : "") : a.cost;
  return (
    <div class="agentbay">
      <span class="ab-name">{a.name}</span>
      <span class="ab-sep">/</span>
      <span>{a.type || "agent"}</span>
      {a.model ? <><span class="ab-sep">/</span><span>{a.model}</span></> : null}
      <span class="ab-sep">/</span>
      <span>{a.tools} tools</span>
      <span class="ab-sep">/</span>
      <span>{a.turns} turns</span>
      <span class="ab-sep">/</span>
      <span>{tok} tok</span>
      {cost ? <><span class="ab-sep">/</span><span>{String(cost)}</span></> : null}
      <span class={`ab-st ${a.status === "ok" || a.status === "completed" ? "ok" : ""}`}>{a.status.toUpperCase()}</span>
    </div>
  );
}
