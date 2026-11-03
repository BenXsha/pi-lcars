import { useState } from "preact/hooks";
import type { Item, Meta } from "../../api";
import { actions } from "../../store";
import { t, type TKey } from "../../i18n";
import { fmtTok, shortPath } from "../../format";
import { Icon, type IconName } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { imeBusy } from "../../ime";

/* -------------------------------------------------------------- summary */
/** Context compaction: the model's own recap of what it kept. */
export function SummaryBlock({ item }: { item: Extract<Item, { kind: "summary" }> }) {
  const [open, setOpen] = useState(false);
  const fmt = (n: number | null) => (n == null ? "?" : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
  return (
    <div class="sum" data-open={open ? "1" : "0"}>
      <span class="st" />
      <div class="sb">
        <div class="sb-hd">
          <span class="lb">CONTEXT COMPACTED</span>
          <span class="dl">
            {fmt(item.tokensBefore)} → {fmt(item.tokensAfter)} TOKENS
          </span>
          <span class="rs">{item.reason.toUpperCase()}</span>
          <button type="button" class="pv-btn ghost" onClick={() => setOpen(!open)}>
            {open ? "HIDE" : "READ SUMMARY"}
          </button>
        </div>
        <div class="body" data-open={open ? "1" : "0"}>
          <Markdown text={item.summary} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- skill */
/** A "/skill" invocation: the injected body collapses into one readable line. */
export function SkillBlock({ skill }: { skill: NonNullable<Extract<Item, { kind: "user" }>["skill"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="skl" data-open={open ? "1" : "0"}>
      <span class="st" />
      <div class="sb">
        <div class="sb-hd">
          <span class="lb">SKILL</span>
          <span class="nm">{skill.name}</span>
          <span class="mt">
            {skill.lines} LINES · {Math.round(skill.chars / 1024)}K
          </span>
          <button type="button" class="pv-btn ghost" onClick={() => setOpen(!open)}>
            {open ? "HIDE" : "PREVIEW"}
          </button>
        </div>
        <div class="pth">{skill.location.replace(/^\/Users\/[^/]+/, "~")}</div>
        <pre class="head" data-open={open ? "1" : "0"}>
          {skill.head}
        </pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ ask */
/** A blocked extension dialog (select / confirm / input) rendered inline. */
export function AskBlock({ item }: { item: Extract<Item, { kind: "ask" }> }) {
  const [text, setText] = useState("");
  const pending = item.status === "pending";
  const options = item.options ?? [];

  const split = (opt: string) => {
    const clean = opt.replace(/^\s*\d+\.\s*/, "");
    const i = clean.indexOf(" — ");
    return i === -1 ? [clean, ""] : [clean.slice(0, i), clean.slice(i + 3)];
  };

  return (
    <div class="ask" data-state={item.status}>
      <span class="st" />
      <div class="ab">
        <div class="ab-hd">
          <span class="ab-tag">ASK</span>
          <span class="ab-mode">{item.mode.toUpperCase()}</span>
          <span class="ab-wait">
            {pending
              ? "WAITING FOR YOU"
              : item.status === "cancelled"
                ? "DISMISSED"
                : item.status === "timeout"
                  ? "TIMED OUT"
                  : "ANSWERED"}
          </span>
        </div>

        <div class="ab-title">{item.title}</div>
        {item.message ? <div class="ab-msg">{item.message}</div> : null}

        {pending ? (
          item.mode === "confirm" ? (
            <div class="ab-opts">
              <button type="button" class="ab-opt" onClick={() => actions.answer(item.id, "Yes")}>
                <span class="n">Y</span>
                <span class="t">Yes</span>
                <span class="a">→</span>
              </button>
              <button type="button" class="ab-opt" onClick={() => actions.answer(item.id, "No")}>
                <span class="n">N</span>
                <span class="t">No</span>
                <span class="a">→</span>
              </button>
            </div>
          ) : item.mode === "input" ? (
            <div class="ab-in">
              <input
                value={text}
                placeholder={item.placeholder ?? "type an answer…"}
                onInput={(e) => setText((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (imeBusy(e)) return;
                  if (e.key === "Enter" && text.trim()) actions.answer(item.id, text.trim());
                }}
              />
              <button type="button" class="pv-btn" disabled={!text.trim()} onClick={() => actions.answer(item.id, text.trim())}>
                SEND
              </button>
            </div>
          ) : (
            <div class="ab-opts">
              {options.map((opt, i) => {
                const [label, desc] = split(opt);
                const custom = /type something/i.test(label);
                return (
                  <button
                    type="button"
                    key={opt}
                    class="ab-opt"
                    data-custom={custom ? "1" : "0"}
                    onClick={() => actions.answer(item.id, opt)}
                  >
                    <span class="n">{custom ? "+" : i + 1}</span>
                    <span class="t">
                      {custom ? "Type something." : label}
                      {desc && !custom ? <em>{desc}</em> : null}
                    </span>
                    <span class="a">→</span>
                  </button>
                );
              })}
              <button type="button" class="ab-opt" data-custom="1" onClick={() => actions.answer(item.id, null)}>
                <span class="n">×</span>
                <span class="t">Dismiss — the model is told you declined</span>
                <span class="a">→</span>
              </button>
            </div>
          )
        ) : (
          <div class="ab-res">{item.status === "cancelled" ? "declined" : item.status === "timeout" ? "no answer in time" : item.value}</div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- standby */
/**
 * The empty transcript is an instrument panel, not a paragraph (§7.6g).
 *
 * Grammar: one elbow opens the section (the only elbow here — §3 R6), then a
 * left bar stack whose segments carry each subsystem's tone, then a bar-end
 * capsule per row. Every readout is a real field on the active session meta:
 * no decorative numbers, no "invented telemetry" (§7.6).
 */
type SbRow = {
  tone: "orange" | "amber" | "lilac" | "cyan" | "moon";
  icon: IconName;
  label: string;
  value: string;
  /** bar height — the segment that matters most is the tallest (§7.5) */
  h: 52 | 44 | 36;
  unit?: string;
  note?: string;
  mono?: boolean;
  /** 0-100; renders the two-segment context bar */
  meter?: number;
};

const APPROVAL_NOTE: Record<string, TKey> = {
  off: "sb.polOff",
  risky: "sb.polRisky",
  all: "sb.polAll",
};

export function Standby({ meta, link }: { meta: Meta | null; link: "connecting" | "open" | "down" }) {
  const win = meta?.contextWindow ?? 0;
  const pct = meta?.contextPct ?? 0;
  const used = meta?.usage.total ?? 0;
  const policy = (meta?.policy ?? "").toLowerCase();
  const rows: SbRow[] = [
    {
      tone: "cyan",
      icon: "station-session",
      label: t("sb.workspace"),
      value: meta ? shortPath(meta.cwd) : "—",
      mono: true,
      h: 52,
      note: meta ? t("sb.workspaceNote") : undefined,
    },
    {
      tone: "orange",
      icon: "fld-model",
      label: t("sb.model"),
      value: meta?.model ?? "—",
      mono: true,
      h: 44,
      note: meta ? `${meta.thinking.toUpperCase()} · ${t("sb.thinking")}` : undefined,
    },
    {
      tone: "amber",
      icon: "station-tools",
      label: t("sb.loadout"),
      value: meta ? String(meta.tools.length) : "—",
      unit: t("sb.tools"),
      h: 36,
      note: meta ? `${meta.skills ?? 0} ${t("sb.skills")}` : undefined,
    },
    {
      tone: "lilac",
      icon: "station-context",
      label: t("sb.context"),
      value: `${pct}%`,
      unit: meta ? `${fmtTok(used)} / ${fmtTok(win)}` : "—",
      h: 44,
      meter: meta ? pct : undefined,
    },
    {
      tone: "moon",
      icon: "fld-lock",
      label: t("sb.approval"),
      value: policy ? policy.toUpperCase() : "—",
      h: 36,
      note: policy && APPROVAL_NOTE[policy] ? t(APPROVAL_NOTE[policy]) : undefined,
    },
  ];

  return (
    <div class="standby">
      {/* the elbow: thin stem + 22px arm, filleted on the concave corner */}
      <div class="sb-arm">
        <svg class="sb-corner" width={48} height={100} viewBox="0 0 48 100" aria-hidden="true">
          {/* one continuous spine: soft outer corner (16), concave fillet (22),
              then a root fillet (14) where it grows into the first readout bar
              — the header does not stop in mid-air, it feeds the stack */}
          <path d="M16,0 H48 V22 H36 Q14,22 14,44 V86 Q14,100 28,100 H0 V16 Q0,0 16,0 Z" />
        </svg>
        <div class="sb-ttl">
          <b>{t("sb.standing")}</b>
          <span>{t("sb.idle")}</span>
        </div>
        <div class="sb-link" data-link={link}>
          <Icon name={link === "open" ? "status-ok" : link === "down" ? "status-fail" : "status-idle"} size={12} />
          {link === "open" ? t("sb.linkOpen") : link === "down" ? t("sb.linkDown") : t("sb.linking")}
        </div>
      </div>

      <div class="sb-board">
        {rows.map((r) => (
          <div class="sb-row" data-tone={r.tone} style={{ height: `${r.h}px` }} key={r.label}>
            <span class="stem" />
            <div class="cap" title={r.label}>
              <Icon name={r.icon} size={12} />
              <span>{r.label}</span>
            </div>
            <div class="body">
              <span class={r.mono ? "v is-mono" : "v"} title={r.value}>
                {r.value}
              </span>
              {r.meter != null ? (
                <span class="mm" aria-hidden="true">
                  <i style={{ width: `${Math.max(1.5, r.meter)}%` }} />
                  <i />
                </span>
              ) : null}
              {r.unit ? <span class="un">{r.unit}</span> : null}
              {r.note ? <span class="nt">{r.note}</span> : null}
            </div>
          </div>
        ))}
      </div>

      <div class="sb-bottom">
        <div class="sb-keys">
          {([
            ["ENTER", "sb.kSend"],
            ["SHIFT + ENTER", "sb.kNewline"],
            ["@", "sb.kRef"],
            ["ESC", "sb.kStop"],
          ] as [string, TKey][]).map(([key, label]) => (
            <div class="sb-key" key={key}>
              <kbd>{key}</kbd>
              <span>{t(label)}</span>
            </div>
          ))}
        </div>

        <div class="sb-foot">
          <span class="scan">
            <i />
            <i />
            <i />
          </span>
          <span class="tx">{t("sb.await")}</span>
        </div>
      </div>
    </div>
  );
}
