import type { ComponentChildren } from "preact";
import { Icon, type IconName } from "./Icon";

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

export function Shelf(props: { brand: string; tag: string; children?: ComponentChildren }) {
  return (
    <header class="shelf">
      <div class="shelf-l">
        <span class="brand">{props.brand}</span>
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
      <Icon name={props.icon} size={12} />
      <span class="k">{props.label}</span>
      <span class="v">{props.value}</span>
      <Icon name={props.open ? "act-collapse" : "act-expand"} size={12} />
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
        <Icon name={props.icon} size={14} />
      </span>
      <span class="nm">{props.name}</span>
      <span class="mt">{props.meta ?? ""}</span>
      <span class="ck">{props.selected ? <Icon name="status-ok" size={14} /> : null}</span>
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
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      class="station"
      data-tone={props.tone}
      aria-current={props.active ? "true" : "false"}
      style={{ width: `${props.w ?? 196}px`, height: `${props.h ?? 52}px` }}
      onClick={props.onClick}
    >
      <span class="num">{props.num}</span>
      <span class="lbl">{props.label}</span>
      <span class="ic">
        <Icon name={props.icon} size={14} />
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
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const state = props.state;
  const raw = (state === "error" ? props.errorText ?? props.output ?? "" : props.output ?? "").trim();
  const lines = raw ? raw.split("\n") : [];
  const visible = state === "error" ? 3 : 2;
  const shown = props.expanded ? lines : lines.slice(0, visible);
  const hidden = lines.length - shown.length;

  return (
    <div class="tool" data-state={state}>
      <div class="st" />
      <div class="ic">
        <Icon name={props.icon} size={15} />
      </div>
      <div class="nm">
        <span>{props.name.toUpperCase()}</span>
        {props.count && props.count > 1 ? <small>x{props.count}</small> : null}
      </div>
      <div class="bd">
        <div class="args">{props.args}</div>
        {shown.length ? (
          <div class={state === "error" ? "err" : "out"}>{shown.join("\n")}</div>
        ) : null}
        {hidden > 0 && props.onToggle ? (
          <button type="button" class="more" onClick={props.onToggle}>
            + {hidden} LINES
          </button>
        ) : null}
        {props.truncated ? <div class="warn">warning: output truncated</div> : null}
      </div>
      <div class="mt">
        {state === "run" ? (
          <span class="scan">
            <i />
            <i />
            <i />
          </span>
        ) : state === "error" ? (
          "EXIT 1"
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
}) {
  const isUser = props.role === "user";
  return (
    <div class={`row ${props.role} turn`}>
      <div class="chip">
        <span class="who">
          <Icon name={isUser ? "role-user" : "role-agent"} size={15} />
          {props.name ?? (isUser ? "" : "PI")}
        </span>
        <span>{isUser ? props.time : props.model ?? ""}</span>
      </div>
      <div class="cell">
        {props.thinking ? (
          <div class="think" data-open={props.thinkingOpen ? "1" : "0"} onClick={props.onToggleThinking}>
            <span class="tl">
              <Icon name="role-system" size={11} /> THINKING
            </span>
            <span class="tb">{props.thinking}</span>
          </div>
        ) : null}
        {props.text ? <div class="txt">{props.text}</div> : null}
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
        {props.icon ? <Icon name={props.icon} size={12} /> : null}
        {props.label}
      </span>
      <span class="fc">
        <span class="in">
          {props.value !== undefined ? (
            <input
              class="in"
              style={{ border: "0", background: "none", padding: 0, outline: 0, flex: "1 1 auto", color: "inherit", font: "inherit" }}
              type={(props.mask ? "password" : "text") as any}
              value={props.value}
              onInput={(e) => props.onInput?.((e.target as HTMLInputElement).value)}
            />
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
