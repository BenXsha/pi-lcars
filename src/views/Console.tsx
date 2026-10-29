import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { DirEntry, Item, ModelInfo } from "../api";
import { api } from "../api";
import { actions, connect, getState, subscribe } from "../store";
import { Icon, type IconName } from "../components/Icon";
import {
  ApprovalDeck,
  BarButton,
  ControlChip,
  Deck,
  FieldRow,
  MessageRow,
  Meter,
  NoticeRow,
  PickRow,
  Readout,
  Segmented,
  Shelf,
  Station,
  ToolStrip,
} from "../components/ui";

/* ---------------------------------------------------------------- setup */
type View = "session" | "tools" | "agents" | "context" | "skills" | "system";

const STATIONS: { view: View; num: string; label: string; icon: IconName; tone: "orange" | "amber" | "lav" | "moon" | "ice" | "cyan"; w: number; h?: number }[] = [
  { view: "session", num: "01", label: "SESSION", icon: "station-session", tone: "orange", w: 224, h: 56 },
  { view: "tools", num: "02", label: "TOOLS", icon: "station-tools", tone: "amber", w: 196 },
  { view: "agents", num: "03", label: "AGENTS", icon: "station-agents", tone: "lav", w: 168 },
  { view: "context", num: "04", label: "CONTEXT", icon: "station-context", tone: "moon", w: 204 },
  { view: "skills", num: "05", label: "SKILLS", icon: "station-skills", tone: "ice", w: 156 },
  { view: "system", num: "06", label: "SYSTEM", icon: "station-system", tone: "cyan", w: 184 },
];

const TOOL_ICON: Record<string, IconName> = {
  bash: "tool-bash",
  read: "tool-read",
  write: "tool-write",
  edit: "tool-edit",
  grep: "tool-grep",
  find: "tool-find",
  ls: "tool-ls",
  web_search: "tool-web",
  fetch_content: "tool-web",
  Agent: "tool-agent",
  SubagentWorkflow: "tool-workflow",
  steer_subagent: "tool-agent",
  get_subagent_result: "tool-agent",
  todo: "tool-todo",
  batch_run: "tool-batch",
  batch_status: "tool-batch",
  codemode: "tool-codemode",
};

const toolIcon = (name: string): IconName => TOOL_ICON[name] ?? "station-tools";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const shortPath = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

function useStore() {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  return getState();
}

/* ---------------------------------------------------------------- shell */
export function Console() {
  const s = useStore();
  const [view, setView] = useState<View>("session");
  const [deck, setDeck] = useState<null | "cwd" | "model" | "think">(null);

  useEffect(() => connect(), []);

  const meta = s.meta;
  const active = s.sessions.find((x) => x.id === s.activeId);

  return (
    <div class="app">
      <aside class="spine">
        {STATIONS.map((st) => (
          <Station
            key={st.view}
            num={st.num}
            label={st.label}
            icon={st.icon}
            tone={st.tone}
            w={st.w}
            h={st.h}
            active={view === st.view}
            onClick={() => setView(st.view)}
          />
        ))}
        <div class="filler" style={{ width: "120px", height: "56px" }} />
        <div class="tail" />
      </aside>

      <div class="main">
        <Shelf brand="PI AGENT CONSOLE" tag={`MISSION LOG / ${STATIONS.find((x) => x.view === view)?.num ?? "01"}`}>
          {meta ? (
            <>
              <ControlChip
                icon="fld-path"
                label="WORKSPACE"
                value={shortPath(meta.cwd)}
                open={deck === "cwd"}
                onClick={() => setDeck(deck === "cwd" ? null : "cwd")}
              />
              <ControlChip
                icon="fld-model"
                label="MODEL"
                value={meta.modelId}
                open={deck === "model"}
                onClick={() => setDeck(deck === "model" ? null : "model")}
              />
              <ControlChip
                icon="role-system"
                label="THINK"
                value={meta.thinking.toUpperCase()}
                off={meta.thinking === "off"}
                open={deck === "think"}
                onClick={() => setDeck(deck === "think" ? null : "think")}
              />
              <ControlChip icon="station-context" label="CTX" value={`${meta.contextPct}%`} />
            </>
          ) : (
            <span style={{ font: "700 11px/1 var(--din)", letterSpacing: "0.14em" }}>CONNECTING…</span>
          )}
        </Shelf>

        {deck === "cwd" ? <CwdDeck meta={meta} onClose={() => setDeck(null)} /> : null}
        {deck === "model" ? <ModelDeck current={meta?.modelId} onClose={() => setDeck(null)} /> : null}
        {deck === "think" ? <ThinkDeck current={meta?.thinking} onClose={() => setDeck(null)} /> : null}

        <Tabs sessions={s.sessions} activeId={s.activeId} />

        <div class="body">
          <main class="center">
            <div class="center-head">
              <div>
                <h1>{view === "session" ? titleOf(active, meta) : `STATION ${STATIONS.find((x) => x.view === view)?.num} / ${view.toUpperCase()}`}</h1>
                <p>{view === "session" ? subtitleOf(meta, s.items, s.queue.waiting.length) : "runtime inspection"}</p>
              </div>
              <div class="chips">
                {s.link !== "open" ? (
                  <span class="badge tomato">{s.link === "down" ? "LINK DOWN" : "LINKING"}</span>
                ) : null}
                {meta?.pending ? <span class="badge tomato">{meta.pending} HELD</span> : null}
                {s.queue.waiting.length ? (
                  <span class="badge moon">{s.queue.waiting.length} QUEUED</span>
                ) : (
                  <span class={`badge ${meta?.running ? "moon" : "dim"}`}>{meta?.running ? "RUNNING" : "IDLE"}</span>
                )}
                <span class="badge ice">{countTools(s.items)} CALLS</span>
              </div>
            </div>

            {s.error ? (
              <div class="errbar">
                <Icon name="status-fail" size={13} />
                {s.error}
              </div>
            ) : null}

            <div class="scroll">
              {view === "session" ? <Transcript items={s.items} /> : <StationPanel view={view} items={s.items} meta={meta} policy={s.policy} />}
            </div>

            <Composer running={!!meta?.running} disabled={s.link !== "open"} />
          </main>

          <Rail items={s.items} meta={meta} queue={s.queue} />
        </div>
      </div>
    </div>
  );
}

const countTools = (items: Item[]) => items.filter((i) => i.kind === "tool").length;

function titleOf(active: { name?: string; id: string } | undefined, meta: { modelId: string } | null) {
  if (active?.name) return active.name;
  if (meta) return `${meta.modelId} / ${active?.id?.slice(0, 8) ?? "SESSION"}`;
  return "STANDING BY";
}
function subtitleOf(meta: { cwd: string; thinking: string; model: string } | null, items: Item[], queued: number) {
  if (!meta) return "no session";
  const errs = items.filter((i) => i.kind === "tool" && i.status === "error").length;
  return `${shortPath(meta.cwd)} / ${meta.thinking} thinking / ${items.length} items / ${errs} errors${queued ? ` / ${queued} queued` : ""}`;
}

/* ----------------------------------------------------------------- tabs */
function Tabs({ sessions, activeId }: { sessions: { id: string; name?: string; items: number; running: boolean; queued: boolean }[]; activeId: string | null }) {
  return (
    <div class="tabs">
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          class="tab"
          aria-selected={s.id === activeId ? "true" : "false"}
          data-run={s.running ? "1" : "0"}
          data-queued={s.queued ? "1" : "0"}
          title={`${s.name ?? s.id}\n${s.id}`}
          onClick={() => actions.activate(s.id)}
        >
          <i />
          {s.name ?? s.id.slice(0, 10)}
          <span class="ct">{s.items}</span>
        </button>
      ))}
      <button type="button" class="tab-new" title="New session" onClick={() => actions.newSession()}>
        <Icon name="act-new" size={13} />
      </button>
    </div>
  );
}

/* ----------------------------------------------------------- transcript */
function Transcript({ items }: { items: Item[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const t0 = items[0]?.ts ?? Date.now();

  if (!items.length) {
    return (
      <div class="empty-log">
        <b>STANDING BY.</b> This console is wired to a live <code>pi</code> session.
        <br />
        Type below and press <code>ENTER</code>. Every row comes from a real event: text deltas,
        tool executions, retries, truncation, approvals.
      </div>
    );
  }

  return (
    <div class="log">
      {items.map((it, i) => {
        const prev = items[i - 1];
        const turn = it.kind === "user" || (it.kind === "assistant" && prev && prev.kind !== "assistant");
        const cls = `blk${turn ? " turn" : ""}${it.kind === "approval" ? " approval-blk" : ""}`;

        if (it.kind === "user") {
          return (
            <div class={cls} key={it.id}>
              <MessageRow role="user" time={`T+${mmss(it.ts - t0)}`} text={it.text} />
              {it.steer || it.queued ? (
                <div style={{ marginLeft: "88px", marginTop: "2px", font: "700 10px/1.4 var(--din)", letterSpacing: "0.14em", color: it.steer ? "var(--orange)" : "var(--moon)" }}>
                  {it.steer ? "STEERED INTO RUN" : "QUEUED"}
                </div>
              ) : null}
            </div>
          );
        }

        if (it.kind === "assistant") {
          return (
            <div class={cls} key={it.id}>
              <MessageRow
                role="assistant"
                time=""
                model={it.usage ? `${fmtTok(it.usage.output)} TOK` : ""}
                text={it.text}
                thinking={it.thinking}
                thinkingOpen={open[it.id] ?? false}
                onToggleThinking={() => setOpen((o) => ({ ...o, [it.id]: !o[it.id] }))}
                streaming={it.streaming}
              />
              {it.errorMessage ? <div class="errbar" style={{ margin: "2px 0 0 88px" }}>{it.errorMessage}</div> : null}
            </div>
          );
        }

        if (it.kind === "tool") {
          const state = it.status === "run" ? "run" : it.status === "error" ? "error" : it.truncated ? "warn" : "ok";
          return (
            <div class={cls} key={it.id}>
              <ToolStrip
                name={it.name}
                icon={toolIcon(it.name)}
                args={it.args}
                output={it.output}
                errorText={it.errorText}
                state={state}
                ms={it.ms}
                truncated={it.truncated}
                expanded={open[it.id] ?? false}
                onToggle={() => setOpen((o) => ({ ...o, [it.id]: !o[it.id] }))}
              />
            </div>
          );
        }

        if (it.kind === "approval") {
          return (
            <div class={cls} key={it.id}>
              <ApprovalDeck
                tool={it.tool}
                args={it.args}
                state={it.status === "always" ? "approved" : it.status}
                onDecide={(d) => actions.approve(it.id, d)}
              />
            </div>
          );
        }

        return (
          <div class={cls} key={it.id}>
            <NoticeRow label={it.label} text={it.text} tone={it.tone} />
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- composer */
function Composer({ running, disabled }: { running: boolean; disabled: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    actions.send(t);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && running) {
        e.preventDefault();
        actions.abort();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]);

  return (
    <div class="composer">
      <div class="chip" style={{ width: "84px", height: "100%", background: "var(--orange)", borderRadius: "0 var(--r-1) var(--r-1) 0" }}>
        <span style={{ font: "700 12px/1.2 var(--din)", letterSpacing: "0.1em" }}>ENTRY</span>
        <span style={{ font: "700 9px/1.2 var(--din)", letterSpacing: "0.1em" }}>CTRL K</span>
      </div>
      <div class="field" style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div class={`help ${running ? "live" : ""}`}>
          {running ? "GENERATING / ESC TO INTERRUPT / ENTER QUEUES A STEER" : "ENTER SEND / SHIFT+ENTER NEWLINE"}
        </div>
        <textarea
          ref={ref}
          rows={2}
          placeholder={running ? "插入一条消息，不打断当前生成…" : "让 pi 构建、重构或调查…"}
          value={text}
          disabled={disabled}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <div class="btns">
        <BarButton label={running ? "STEER" : "RUN"} hint="ENTER" tone="ok" disabled={disabled} onClick={submit} icon="act-send" />
        <BarButton label="STOP" hint="ESC" tone="stop" disabled={!running} onClick={() => actions.abort()} icon="act-stop" />
        <BarButton label="NEW" hint="RESET" tone="quiet" onClick={() => actions.newSession()} icon="act-new" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ rail */
function Rail({ items, meta, queue }: { items: Item[]; meta: ReturnType<typeof getState>["meta"]; queue: { waiting: string[] } }) {
  const stats = useMemo(() => {
    const out: Record<string, { calls: number; fails: number; trunc: number; ms: number }> = {};
    for (const it of items) {
      if (it.kind !== "tool") continue;
      out[it.name] ||= { calls: 0, fails: 0, trunc: 0, ms: 0 };
      out[it.name].calls++;
      if (it.status === "error") out[it.name].fails++;
      if (it.truncated) out[it.name].trunc++;
      out[it.name].ms += it.ms ?? 0;
    }
    return out;
  }, [items]);

  const fails = items.filter((i) => i.kind === "tool" && i.status === "error") as Extract<Item, { kind: "tool" }>[];
  const usage = meta?.usage ?? { input: 0, output: 0, cost: 0, total: 0 };
  const pct = meta?.contextPct ?? 0;
  const win = meta?.contextWindow ?? 200000;

  return (
    <aside class="rail">
      <div class="phead">RESOURCES</div>
      <div class="panel">
        <div class="ctx-top">
          <span>CONTEXT WINDOW</span>
          <b>{pct}%</b>
        </div>
        <Readout value={fmtTok(usage.total)} unit={`/ ${fmtTok(win)}`} />
        <Meter segments={[{ tone: "sys", pct: 8 }, { tone: "tool", pct: 4 }, { tone: "hist", pct: Math.max(1, pct - 12) }, { pct: Math.max(1, 100 - pct) }]} />
        <div class="legend">
          <span><i style={{ background: "var(--cyan)" }} />SYSTEM</span>
          <span><i style={{ background: "var(--ice)" }} />TOOLS</span>
          <span><i style={{ background: "var(--orange)" }} />HISTORY</span>
          <span><i style={{ background: "var(--g1)" }} />FREE</span>
        </div>
      </div>

      <div class="phead ice">TOOL CALLS / THIS SESSION</div>
      <div class="panel">
        <div class="rows">
          {Object.keys(stats).length === 0 ? <div class="mrow"><span>NO CALLS YET</span><span>—</span></div> : null}
          {Object.entries(stats)
            .sort((a, b) => b[1].calls - a[1].calls)
            .map(([name, s]) => (
              <div class="mrow" key={name}>
                <span>{name.toUpperCase()}</span>
                <span class={s.fails ? "bad" : s.trunc ? "warnval" : "ok"}>
                  {s.calls}
                  {s.fails ? ` / ${s.fails} FAIL` : ""}
                  {s.trunc ? ` / ${s.trunc} TRUNC` : ""}
                </span>
              </div>
            ))}
        </div>
      </div>

      {fails.length ? (
        <>
          <div class="phead tomato">FAILURES</div>
          <div class="panel">
            {fails.slice(-4).reverse().map((f) => (
              <div class="fail" key={f.id}>
                <i />
                <code>{`${f.name}: ${(f.errorText || f.output || "failed").split("\n")[0]}`}</code>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div class="phead cyan">SYSTEM</div>
      <div class="panel">
        <div class="rows">
          <div class="mrow"><span>MODEL</span><span>{meta?.modelId ?? "—"}</span></div>
          <div class="mrow"><span>THINKING</span><span>{meta?.thinking ?? "—"}</span></div>
          <div class="mrow"><span>POLICY</span><span class={meta?.policy === "off" ? "ok" : "warnval"}>{meta?.policy ?? "—"}</span></div>
          <div class="mrow"><span>TOOLS</span><span>{meta?.tools.length ?? 0}</span></div>
          <div class="mrow"><span>SKILLS</span><span>{meta?.skills ?? 0}</span></div>
          <div class="mrow"><span>QUEUE</span><span>{queue.waiting.length}</span></div>
        </div>
      </div>
    </aside>
  );
}

/* ----------------------------------------------------------------- decks */
function CwdDeck({ meta, onClose }: { meta: ReturnType<typeof getState>["meta"]; onClose: () => void }) {
  const [data, setData] = useState<{ path: string; parent: string | null; dirs: DirEntry[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = (path?: string) =>
    api
      .fs(path)
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load(meta?.cwd);
  }, []);

  return (
    <Deck
      label="WORKSPACE"
      sub="APPLIES TO NEW SESSIONS"
      actions={
        <>
          <BarButton tone="quiet" label="UP" icon="act-expand" disabled={!data?.parent} onClick={() => data?.parent && load(data.parent)} />
          <BarButton
            tone="ok"
            label="NEW SESSION"
            icon="act-new"
            onClick={async () => {
              await actions.newSession(data?.path ?? meta?.cwd);
              onClose();
            }}
          />
        </>
      }
    >
      <div style={{ font: "400 12px/1.6 var(--mono)", color: "var(--g3)", padding: "0 0 2px 2px" }}>
        {shortPath(data?.path ?? meta?.cwd ?? "")} <span style={{ color: "var(--g2)" }}>· current session keeps its cwd (read-only)</span>
      </div>
      {err ? <div style={{ font: "400 11px/1.5 var(--mono)", color: "var(--tomato)" }}>{err}</div> : null}
      {(data?.dirs ?? []).slice(0, 7).map((d) => (
        <PickRow key={d.path} icon="fld-path" name={d.name} meta={d.items != null ? `${d.items} items` : ""} onClick={() => load(d.path)} />
      ))}
    </Deck>
  );
}

function ModelDeck({ current, onClose }: { current?: string; onClose: () => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .models()
      .then((r) => setModels(r.models))
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <Deck label="MODEL" sub="TAKES EFFECT NEXT TURN">
      {err ? <div style={{ font: "400 11px/1.5 var(--mono)", color: "var(--tomato)" }}>{err}</div> : null}
      {models.slice(0, 8).map((m) => (
        <PickRow
          key={`${m.provider}/${m.id}`}
          icon="fld-model"
          name={m.id}
          meta={`${m.provider}${m.contextWindow ? ` · ${fmtTok(m.contextWindow)}` : ""}`}
          selected={m.id === current}
          onClick={async () => {
            await actions.setModel(m.provider, m.id);
            onClose();
          }}
        />
      ))}
    </Deck>
  );
}

function ThinkDeck({ current, onClose }: { current?: string; onClose: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <Deck label="THINKING" sub="BUDGET PER TURN" actions={<BarButton tone="quiet" label="CLOSE" icon="act-close" onClick={onClose} />}>
      <Segmented
        value={(current ?? "off") as "off" | "low" | "medium" | "high"}
        onChange={async (v) => {
          const r = await actions.thinking(v);
          setNote(r?.clamped ? `model does not support reasoning — stayed at ${r.thinking}` : null);
        }}
        options={[
          { value: "off", label: "OFF" },
          { value: "low", label: "LOW" },
          { value: "medium", label: "MED" },
          { value: "high", label: "HIGH" },
        ]}
      />
      <div style={{ font: "400 11px/1.6 var(--mono)", color: note ? "var(--amber)" : "var(--g2)", padding: "4px 2px 0" }}>
        {note ?? "off → THINKING rows disappear from the stream. switching mid-run applies to the next turn."}
      </div>
    </Deck>
  );
}

/* ---------------------------------------------------------------- panels */
function StationPanel({
  view,
  items,
  meta,
  policy,
}: {
  view: View;
  items: Item[];
  meta: ReturnType<typeof getState>["meta"];
  policy: string;
}) {
  const stats = useMemo(() => {
    const out: Record<string, { calls: number; fails: number; ms: number }> = {};
    for (const it of items) {
      if (it.kind !== "tool") continue;
      out[it.name] ||= { calls: 0, fails: 0, ms: 0 };
      out[it.name].calls++;
      if (it.status === "error") out[it.name].fails++;
      out[it.name].ms += it.ms ?? 0;
    }
    return out;
  }, [items]);

  const rows = (list: [string, string, string][]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
      {list.map(([k, v, n]) => (
        <div class="pv-row" key={k}>
          <div class="st" />
          <div class="k">{k}</div>
          <div class="v">{v}</div>
          <div class="n">{n}</div>
        </div>
      ))}
    </div>
  );

  if (view === "tools") {
    const names = [...(meta?.tools ?? [])].sort((a, b) => (stats[b]?.calls ?? 0) - (stats[a]?.calls ?? 0));
    return (
      <div class="pv">
        <div class="pv-title">TOOL LOADOUT / {names.length}</div>
        <div class="pv-sub">Everything the model can call in this session, from <code>getActiveToolNames()</code>.</div>
        {rows(names.map((n) => [n.toUpperCase(), `${stats[n]?.calls ?? 0} calls · ${stats[n]?.fails ?? 0} failed`, stats[n]?.ms ? `${Math.round(stats[n].ms)}ms` : "—"]))}
      </div>
    );
  }

  if (view === "agents") {
    const known = ["Agent", "SubagentWorkflow", "steer_subagent", "get_subagent_result"].filter((n) => (meta?.tools ?? []).includes(n));
    return (
      <div class="pv">
        <div class="pv-title">AGENTS / {known.length} TOOLS</div>
        <div class="pv-sub">Subagent tools loaded from your pi packages. A spawned agent appears here as soon as it runs.</div>
        {rows(known.map((n) => [n.toUpperCase(), stats[n]?.calls ? `${stats[n].calls} runs · ${stats[n].fails} failed` : "idle · never called", "—"]))}
        <div class="pv-sub" style={{ marginTop: "10px" }}>
          Nested transcripts arrive with M7 — for now a subagent reports back as one tool result row.
        </div>
      </div>
    );
  }

  if (view === "context") {
    const u = meta?.usage ?? { input: 0, output: 0, cost: 0, total: 0 };
    return (
      <div class="pv">
        <div class="pv-title">{meta?.contextPct ?? 0}% OF CONTEXT</div>
        <div class="pv-sub">{fmtTok(u.total)} tokens in the last request · window {fmtTok(meta?.contextWindow ?? 200000)}</div>
        <Meter segments={[{ tone: "sys", pct: 8 }, { tone: "tool", pct: 4 }, { tone: "hist", pct: Math.max(1, (meta?.contextPct ?? 0) - 12) }, { pct: Math.max(1, 100 - (meta?.contextPct ?? 0)) }]} />
        {rows([
          ["INPUT", fmtTok(u.input), ""],
          ["OUTPUT", fmtTok(u.output), ""],
          ["COST", `$${u.cost.toFixed(4)}`, ""],
          ["COMPACTION", "auto at threshold", ""],
        ])}
      </div>
    );
  }

  if (view === "skills") {
    return (
      <div class="pv">
        <div class="pv-title">SKILLS / {meta?.skills ?? 0}</div>
        <div class="pv-sub">
          Loaded from your pi resource loader and injected into the system prompt. Editing and per-skill toggles land in M3.
          {meta?.approvalWired ? "" : " Approval extension is not wired — check the server log."}
        </div>
        {rows([
          ["SKILLS", `${meta?.skills ?? 0} loaded`, ""],
          ["APPROVAL", meta?.approvalWired ? "inline extension wired" : "not wired", ""],
          ["POLICY", policy, ""],
        ])}
      </div>
    );
  }

  return (
    <div class="pv">
      <div class="pv-title">SYSTEM</div>
      <div class="pv-sub">Runtime of the active session. Values are read from the live session, not from config files.</div>
      {rows([
        ["MODEL", meta?.model ?? "—", ""],
        ["THINKING", meta?.thinking ?? "—", ""],
        ["TOOLS", `${meta?.tools.length ?? 0} active`, ""],
        ["CWD", shortPath(meta?.cwd ?? ""), ""],
        ["SESSION", meta?.path ? shortPath(meta.path) : "unsaved", ""],
      ])}
      <div class="pv-title" style={{ fontSize: "14px", marginTop: "16px" }}>APPROVAL POLICY</div>
      <div style={{ display: "flex", gap: "var(--gap)" }}>
        {(["off", "risky", "all"] as const).map((m) => (
          <BarButton
            key={m}
            label={m.toUpperCase()}
            tone={policy === m ? "ok" : "quiet"}
            onClick={() => actions.policy(m)}
          />
        ))}
        <span style={{ font: "400 11px/2.2 var(--mono)", color: "var(--g2)" }}>
          risky = bash / write / edit · always releases on abort
        </span>
      </div>
    </div>
  );
}
