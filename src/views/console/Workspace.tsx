import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { DiffData, Item } from "../../api";
import { actions } from "../../store";
import { t } from "../../i18n";
import { firstLine, fmtTok, mmss, pad2, wordsOf } from "../../format";
import { Icon } from "../../components/Icon";
import { BrailleBand } from "../../components/Braille";
import { phaseFor } from "../../braille";
import { phaseLive, phaseWord as wordOf } from "./phase";
import { ApprovalDeck, MessageRow } from "../../components/ui";
import { AskBlock, SkillBlock, SummaryBlock } from "./blocks";
import { TerminalEntry } from "./Terminal";

/* ------------------------------------------------------------ workspace */
/*
 * A second look at the *same* live stream, cut into three zones instead of one
 * scroll: what the model is reasoning about, what it was asked, what it
 * produced, and what the machine is doing or waiting on. The mission log stays
 * the source of truth — this view is for scanning a long run, not for reading
 * a thread in order.
 */
type Zones = {
  thinking: Extract<Item, { kind: "assistant" }>[];
  /** the conversation itself — what was asked and what came back, in order */
  thread: Item[];
  action: Item[];
};


/** Split, don't invent: every item lands in exactly one zone. */
function zonesOf(items: Item[]): Zones {
  const zones: Zones = { thinking: [], thread: [], action: [] };
  for (const it of items) {
    if (it.kind === "assistant") {
      if ((it.thinking ?? "").trim()) zones.thinking.push(it);
      // a message that only carries tool calls never produced output — showing it
      // while it streams leaves an empty caret row that then has to disappear
      if ((it.text ?? "").trim()) zones.thread.push(it);
      continue;
    }
    // a user turn and a compaction summary are the other half of the exchange
    if (it.kind === "user" || it.kind === "summary") zones.thread.push(it);
    // tools, approvals, dialogs and notices are machine activity
    else zones.action.push(it);
  }
  return zones;
}

/*
 * The cycle, and the only reason the zones are numbered:
 *
 *   I  CONVERSATION  the operator states what to do        (instruction)
 *   II THINKING      pi works out how, reading as it goes  (retrieval)
 *   III TERMINAL     the machine does it                   (execution)
 *   →  CONVERSATION  the result comes back to be confirmed (result)
 *
 * A user prompt opens an exchange; every later item belongs to it until the
 * next prompt. Both the numbering and the cross-zone "show me turn n" are
 * derived from that, so nothing here is invented.
 */
function cyclesOf(items: Item[]): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  for (const it of items) {
    if (it.kind === "user") n += 1;
    map.set(it.id, n);
  }
  return map;
}

type Tally = { think: number; tools: number; running: number };

function tallyOf(items: Item[], cycles: Map<string, number>): Map<number, Tally> {
  const out = new Map<number, Tally>();
  for (const it of items) {
    const n = cycles.get(it.id) ?? 0;
    const t = out.get(n) ?? { think: 0, tools: 0, running: 0 };
    if (it.kind === "assistant" && (it.thinking ?? "").trim()) t.think += 1;
    if (it.kind === "tool") {
      t.tools += 1;
      if (it.status === "run") t.running += 1;
    }
    out.set(n, t);
  }
  return out;
}

type Exchange = { n: number; items: Item[] };

/** The conversation, grouped by exchange — one instruction, its answers. */
function exchangesOf(thread: Item[], cycles: Map<string, number>): Exchange[] {
  const out: Exchange[] = [];
  let cur: Exchange | null = null;
  for (const it of thread) {
    const n = cycles.get(it.id) ?? 0;
    if (!cur || cur.n !== n) {
      cur = { n, items: [] };
      out.push(cur);
    }
    cur.items.push(it);
  }
  return out;
}

/** Tools that read the world: while one runs, THINKING says which. */
const RETRIEVAL = new Set([
  "read",
  "grep",
  "glob",
  "ls",
  "find",
  "web_search",
  "fetch_content",
  "symbol_search",
  "ffgrep",
  "fffind",
  "code_search",
  "lens_diagnostics",
]);

const ACK_KEY = "lcars.ack";

/** "I have looked at this answer" — a local review mark, never sent anywhere. */
function loadAcks(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(ACK_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === "number") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

const TONE_OF = { thinking: "moon", thread: "orange", action: "tang" } as const;

/** One instrument: a numbered strip, a live state readout, its own scroll. */
function Zone(props: {
  zone: "thinking" | "thread" | "action";
  /** the cycle numeral — order, not decoration */
  num: string;
  label: string;
  count: number;
  note?: string;
  /** what this instrument is doing right now */
  status: string;
  live?: boolean;
  empty: string;
  focus: number | null;
  /** ambient motion filling the seam between the header strip and the body */
  band?: ComponentChildren;
  footer?: ComponentChildren;
  children: ComponentChildren;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Each zone follows the tail independently: scrolled up means "don't yank me".
  // Growth is the trigger, not the item count — a streamed answer, a thinking
  // block and a running command's output all grow without adding an item.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });

  // "show me exchange n": bring this zone to its first row of that exchange
  useEffect(() => {
    if (props.focus == null) return;
    const el = bodyRef.current?.querySelector(`[data-turn="${props.focus}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [props.focus]);

  const tone = TONE_OF[props.zone];
  return (
    <section
      class="ws-zone"
      data-zone={props.zone}
      data-tone={tone}
      data-focus={props.focus == null ? "0" : "1"}
    >
      <header class="ws-hd" data-tone={tone}>
        <span class="idx">{props.num}</span>
        <span class="lb">
          <span class="tx">{props.label}</span>
          {props.note ? <em class="nt">{props.note}</em> : null}
          <span class="n">{props.count}</span>
        </span>
        <span class="st" data-live={props.live ? "1" : "0"}>
          {props.status}
        </span>
        {/* The bent arm: the header is the horizontal leg, the wrapper below is
            the vertical one, and this piece carries the concave fillet across
            the 4px seam so the two read as one piece. It lives on the header
            (not inside the body) because the body scrolls and would clip it. */}
        <span class="ws-arm" aria-hidden="true">
          <svg width="34" height="20" viewBox="0 0 34 20">
            <path d="M0,0 H34 Q14,0 14,20 H0 Z" />
          </svg>
        </span>
      </header>
      {/* band + body share one rail: the leg runs from the arm to the foot with
          no seam-wide hole where the band used to sit (AGENTS §7.6r) */}
      <div class="ws-mid">
        {props.band}
        <div
          class="ws-body"
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
          }}
        >
          {props.count ? (
            props.children
          ) : (
            <div class="ws-empty">
              <span>{props.empty}</span>
            </div>
          )}
        </div>
      </div>
      {props.footer ? <div class="ws-foot">{props.footer}</div> : null}
      {props.zone === "thread" ? null : <i class="ws-joint" aria-hidden="true" />}
    </section>
  );
}

/**
 * One exchange = one instruction plus everything it caused. The footer is the
 * only place where the three instruments visibly join: two taps that ask the
 * other zones to show their half of the same exchange, and the acknowledge
 * mark that closes the cycle. It is also where the answer "returns".
 */
function Exchange(props: {
  n: number;
  items: Item[];
  tally: Tally;
  focus: number | null;
  onFocus: (n: number | null) => void;
  t0: number;
  ack: number | null;
  /** the newest exchange, while the session is still producing text */
  active: boolean;
  /** only the newest exchange lights its numeral: the rest stay quiet */
  latest: boolean;
  onAck: (id: string) => void;
}) {
  const user = props.items.find((it): it is Extract<Item, { kind: "user" }> => it.kind === "user");
  const tail = props.items[props.items.length - 1];
  const live = props.focus === props.n;
  const settled = !!user && !!tail && tail.kind === "assistant" && !tail.streaming && props.tally.running === 0;
  const awaiting = settled && props.ack == null;

  return (
    <article
      class="exc"
      data-turn={props.n}
      data-live={props.active || (awaiting && props.latest) ? "1" : "0"}
      data-focus={live ? "1" : "0"}
      data-dim={props.focus != null && !live ? "1" : "0"}
    >
      <div class="exc-body">
        {props.items.map((it) => {
          if (it.kind === "user") {
            return (
              <div class="ws-item" key={it.id}>
                {it.skill ? <SkillBlock skill={it.skill} /> : null}
                <MessageRow
                  role="user"
                  time={`T+${mmss(it.ts - props.t0)}`}
                  text={it.text}
                  attachments={it.attachments}
                />
              </div>
            );
          }
          if (it.kind === "summary") {
            return (
              <div class="ws-item" key={it.id}>
                <SummaryBlock item={it} />
              </div>
            );
          }
          if (it.kind !== "assistant") return null;
          // the answer sits right under the prompt it belongs to: one exchange,
          // read as a conversation instead of two lists in two places
          return (
            <div class="ws-item" key={it.id}>
              <MessageRow
                role="assistant"
                time=""
                model={it.usage ? `${fmtTok(it.usage.output)} TOK` : ""}
                text={it.text}
                streaming={it.streaming}
              />
              {it.errorMessage ? <div class="errbar">{it.errorMessage}</div> : null}
            </div>
          );
        })}
      </div>
      <footer class="exc-ft">
        <span class="en">{pad2(props.n)}</span>
        <button
          type="button"
          class="tap"
          data-tone="moon"
          disabled={!props.tally.think}
          aria-pressed={live ? "true" : "false"}
          title={t("ws.noteThinking")}
          onClick={() => props.onFocus(live ? null : props.n)}
        >
          <i aria-hidden="true" />
          {props.tally.think} {t("ws.reasoning")}
        </button>
        <button
          type="button"
          class="tap"
          data-tone="tang"
          disabled={!props.tally.tools}
          aria-pressed={live ? "true" : "false"}
          title={t("ws.noteAction")}
          onClick={() => props.onFocus(live ? null : props.n)}
        >
          <i aria-hidden="true" />
          {props.tally.tools} {t("ws.commands")}
        </button>
        <span class="sp" />
        <span class="tm">T+{mmss((tail?.ts ?? props.t0) - props.t0)}</span>
        {awaiting ? (
          <button type="button" class="ack" onClick={() => user && props.onAck(user.id)}>
            {t("ws.ack")}
          </button>
        ) : props.ack != null ? (
          <span class="akd">
            {t("ws.acked")} {new Date(props.ack).toTimeString().slice(0, 5)}
          </span>
        ) : props.active ? (
          <span class="wrk">{t("ws.streaming")}</span>
        ) : null}
      </footer>
    </article>
  );
}

export function Workspace({
  items,
  running: agentRunning,
  onOpenDiff,
}: {
  items: Item[];
  /** the transport's run flag — keeps the zone from reading IDLE mid-latency */
  running?: boolean;
  onOpenDiff?: (path: string, diff: DiffData) => void;
}) {
  const zones = useMemo(() => zonesOf(items), [items]);
  const cycles = useMemo(() => cyclesOf(items), [items]);
  const tallies = useMemo(() => tallyOf(items, cycles), [items, cycles]);
  const exchanges = useMemo(() => exchangesOf(zones.thread, cycles), [zones.thread, cycles]);
  const [openThink, setOpenThink] = useState<Record<string, boolean>>({});
  const [openTool, setOpenTool] = useState<Record<string, boolean>>({});
  const [focus, setFocus] = useState<number | null>(null);
  const [acks, setAcks] = useState<Record<string, number>>(loadAcks);
  const t0 = items[0]?.ts ?? Date.now();

  const words = zones.thinking.reduce((n, it) => n + wordsOf(it.thinking), 0);
  const running = zones.action.filter((it) => it.kind === "tool" && it.status === "run").length;
  const turns = zones.thread.filter((it) => it.kind === "user").length;
  // the session is producing something, whether or not this zone has text yet
  const streaming = items.some((it) => it.kind === "assistant" && it.streaming);
  const reading = zones.action.find(
    (it): it is Extract<Item, { kind: "tool" }> => it.kind === "tool" && it.status === "run" && RETRIEVAL.has(it.name),
  );
  const tail = zones.thread[zones.thread.length - 1];
  const awaiting = !streaming && running === 0 && tail?.kind === "assistant";
  // The band answers "what is the model doing" for the whole session, so it
  // reads every item — not just this zone's. One helper decides it, so the log
  // strip and this zone can never describe the same moment differently.
  const phase = phaseFor(items, agentRunning);
  // the reading and the motion come from one source, so they cannot disagree
  const phaseWord = wordOf(phase);
  const phaseBusy = phaseLive(phase);

  const ack = (id: string) =>
    setAcks((prev) => {
      const next = { ...prev, [id]: Date.now() };
      const keys = Object.keys(next);
      // bounded: the oldest marks fall off past 200 exchanges
      if (keys.length > 200) {
        for (const k of keys.sort((a, b) => next[a] - next[b]).slice(0, keys.length - 200)) delete next[k];
      }
      try {
        localStorage.setItem(ACK_KEY, JSON.stringify(next));
      } catch {
        /* private mode: the mark just does not survive a reload */
      }
      return next;
    });

  return (
    <div class="ws">
      <Zone
        zone="thinking"
        num="II"
        label={t("ws.zoneThinking")}
        count={zones.thinking.length}
        note={focus != null ? `▸ EXCH ${pad2(focus)}` : t("ws.noteThinking")}
        status={phaseWord}
        live={phaseBusy}
        empty={t("ws.emptyThinking")}
        focus={focus}
        band={<BrailleBand phase={phase} />}
        footer={
          reading ? (
            <span class="ws-read">
              <b>{t("ws.reading")}</b>
              <em>
                {reading.name} · {firstLine(reading.args)}
              </em>
            </span>
          ) : zones.thinking.length ? (
            <span class="ws-read">
              <b>{words} W</b>
              <em>
                {zones.thinking.length} BLOCKS · {t("ws.noteThinking")}
              </em>
            </span>
          ) : null
        }
      >
        {zones.thinking.map((it, i) => {
          const body = it.thinking.trim();
          const n = cycles.get(it.id) ?? 0;
          // the newest block opens itself: it is the thing being written
          const open = openThink[it.id] ?? i === zones.thinking.length - 1;
          return (
            <button
              type="button"
              class="ws-t"
              key={it.id}
              data-open={open ? "1" : "0"}
              data-turn={n}
              data-dim={focus != null && focus !== n ? "1" : "0"}
              aria-expanded={open ? "true" : "false"}
              onClick={() => setOpenThink((prev) => ({ ...prev, [it.id]: !open }))}
            >
              <span class="hd">
                <span class="ix">{pad2(i + 1)}</span>
                <span class="lb">{t("ws.reasoning")}</span>
                <span class="w">{wordsOf(body)} W</span>
                <span class="tm">T+{mmss(it.ts - t0)}</span>
                <span class="stt" data-live={it.streaming ? "1" : "0"}>
                  {it.streaming ? t("ws.stScan") : t("ws.stSettled")}
                </span>
                <Icon name={open ? "act-collapse" : "act-expand"} size={10} />
              </span>
              <span class="bd">{body}</span>
            </button>
          );
        })}
      </Zone>

      <Zone
        zone="thread"
        num="I"
        label={t("ws.zoneThread")}
        count={zones.thread.length}
        note={
          focus != null
            ? `▸ EXCH ${pad2(focus)}`
            : `${t("ws.noteThread")}${turns ? ` · ${turns} TURN` : ""}`
        }
        status={streaming ? t("ws.streaming") : awaiting ? t("ws.stAwait") : t("ws.stIdle")}
        live={streaming || awaiting}
        empty={t("ws.emptyThread")}
        focus={focus}
      >
        {exchanges.map((ex) => {
          // the acknowledgment mark hangs off the prompt: it is the exchange's identity
          const prompt = ex.items.find((it) => it.kind === "user");
          const last = ex.n === exchanges[exchanges.length - 1].n;
          return (
            <Exchange
              key={ex.n}
              n={ex.n}
              items={ex.items}
              tally={tallies.get(ex.n) ?? { think: 0, tools: 0, running: 0 }}
              focus={focus}
              onFocus={setFocus}
              t0={t0}
              ack={prompt ? (acks[prompt.id] ?? null) : null}
              active={streaming && last}
              latest={last}
              onAck={ack}
            />
          );
        })}
      </Zone>

      <Zone
        zone="action"
        num="III"
        label={t("ws.zoneAction")}
        count={zones.action.length}
        note={focus != null ? `▸ EXCH ${pad2(focus)}` : t("ws.noteAction")}
        status={running ? `${running} ${t("ws.running")}` : zones.action.length ? t("ws.stReady") : t("ws.stIdle")}
        live={running > 0}
        empty={t("ws.emptyAction")}
        focus={focus}
      >
        {zones.action.map((it, i) => {
          const n = cycles.get(it.id) ?? 0;
          const prev = i > 0 ? (cycles.get(zones.action[i - 1].id) ?? 0) : n;
          const head =
            n !== 0 && n !== prev ? (
              <div class="term-turn" key={`t${it.id}`} data-dim={focus != null && focus !== n ? "1" : "0"}>
                <b>
                  EXCH {pad2(n)}
                  {tallies.get(n)?.think ? ` · ${tallies.get(n)!.think} ${t("ws.reasoning")}` : ""}
                </b>
              </div>
            ) : null;
          const dim = focus != null && focus !== n ? "1" : "0";
          let row: ComponentChildren = null;
          if (it.kind === "tool") {
            row = (
              <TerminalEntry
                key={it.id}
                it={it}
                t0={t0}
                dim={dim}
                turn={n}
                open={openTool[it.id] ?? false}
                onToggle={() => setOpenTool((prevOpen) => ({ ...prevOpen, [it.id]: !prevOpen[it.id] }))}
                onOpenDiff={
                  it.diff && onOpenDiff
                    ? () => onOpenDiff(it.args.split(" / ")[0].split(" ")[0] || it.name, it.diff!)
                    : undefined
                }
              />
            );
          } else if (it.kind === "approval") {
            row = (
              <ApprovalDeck
                key={it.id}
                tool={it.tool}
                args={it.args}
                state={it.status === "always" ? "approved" : it.status}
                onDecide={(d) => actions.approve(it.id, d)}
              />
            );
          } else if (it.kind === "ask") {
            row = <AskBlock key={it.id} item={it} />;
          } else if (it.kind === "notice") {
            // a notice is the machine talking back: keep it in the same voice
            row = (
              <div class="term-note" key={it.id} data-tone={it.tone ?? "info"} data-turn={n} data-dim={dim}>
                <span class="lb">{it.label}</span>
                <span class="tx">{it.text}</span>
              </div>
            );
          }
          return head ? (
            <>
              {head}
              {row}
            </>
          ) : (
            row
          );
        })}
      </Zone>
    </div>
  );
}
