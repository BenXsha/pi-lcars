import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { DirEntry, Item, McpServer, ModelInfo, ProviderRow, ProvidersResult, SkillsResult } from "../api";
import { api } from "../api";
import { actions, connect, getState, subscribe } from "../store";
import { THEMES, appliedTheme, applyTheme, type ThemeId } from "../theme";
import { Icon, type IconName } from "../components/Icon";
import { FileTree } from "../components/FileTree";
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
  TopCap,
  ToolStrip,
} from "../components/ui";

/* ---------------------------------------------------------------- setup */
type View = "session" | "mcp" | "skills" | "providers" | "system";

const NAV: { view: View; label: string; icon: IconName; tone: "amber" | "lav" | "moon" | "ice" | "cyan" }[] = [
  { view: "mcp", label: "MCP", icon: "station-mcp", tone: "lav" },
  { view: "skills", label: "SKILLS", icon: "station-skills", tone: "ice" },
  { view: "providers", label: "PROVIDERS", icon: "station-provider", tone: "cyan" },
  { view: "system", label: "SETTINGS", icon: "station-system", tone: "moon" },
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
const ago = (ts: number | null) => {
  if (!ts) return "";
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.max(1, Math.round(d / 1000))}s`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`;
  return `${Math.round(d / 86_400_000)}d`;
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
  const [deck, setDeck] = useState<null | "cwd" | "model" | "think" | "theme">(null);
  const [theme, setTheme] = useState<ThemeId>(appliedTheme());

  useEffect(() => connect(), []);

  const meta = s.meta;
  const active = s.sessions.find((x) => x.id === s.activeId);

  return (
    <div class="app">
      <Sidenav sessions={s.sessions} activeId={s.activeId} view={view} onView={setView} cwd={meta?.cwd ?? ""} />

      <div class="main">
        <Shelf brand="" tag={view === "session" ? "MISSION LOG" : view.toUpperCase()}>
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
              <ControlChip
                icon="act-theme"
                label="THEME"
                value={THEMES.find((t) => t.id === theme)?.short ?? "TNG"}
                open={deck === "theme"}
                title="Switch palette"
                onClick={() => setDeck(deck === "theme" ? null : "theme")}
              />
            </>
          ) : (
            <span style={{ font: "700 11px/1 var(--din)", letterSpacing: "0.14em" }}>CONNECTING…</span>
          )}
        </Shelf>

        {deck === "cwd" ? <CwdDeck meta={meta} onClose={() => setDeck(null)} /> : null}
        {deck === "model" ? <ModelDeck current={meta?.modelId} onClose={() => setDeck(null)} /> : null}
        {deck === "think" ? <ThinkDeck current={meta?.thinking} onClose={() => setDeck(null)} /> : null}
        {deck === "theme" ? (
          <ThemeDeck current={theme} onPick={(id) => { applyTheme(id); setTheme(id); }} onClose={() => setDeck(null)} />
        ) : null}

        <div class="body">
          <main class="center">
            <div class="center-head">
              <div>
                <h1>{view === "session" ? titleOf(active, meta) : view.toUpperCase()}</h1>
                <p>{view === "session" ? subtitleOf(meta, s.items, s.queue.waiting.length) : subtitleFor(view)}</p>
              </div>
              <div class="chips">
                {s.link !== "open" ? <span class="badge tomato">{s.link === "down" ? "LINK DOWN" : "LINKING"}</span> : null}
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

            <div class="scroll" id="scroll">
              {view === "session" ? (
                <Transcript items={s.items} />
              ) : view === "mcp" ? (
                <McpPanel />
              ) : view === "providers" ? (
                <ProvidersPanel meta={meta} />
              ) : view === "skills" ? (
                <SkillsPanel meta={meta} policy={s.policy} />
              ) : (
                <SettingsPanel items={s.items} meta={meta} policy={s.policy} />
              )}
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

function titleOf(
  active: { name?: string; title?: string | null; id: string } | undefined,
  meta: { modelId: string; title?: string | null } | null,
) {
  const t = meta?.title ?? active?.title ?? active?.name;
  if (t) return t;
  if (meta) return `${meta.modelId} / ${active?.id?.slice(0, 8) ?? "SESSION"}`;
  return "STANDING BY";
}
function subtitleOf(meta: { cwd: string; thinking: string; model: string } | null, items: Item[], queued: number) {
  if (!meta) return "no session";
  const errs = items.filter((i) => i.kind === "tool" && i.status === "error").length;
  return `${shortPath(meta.cwd)} / ${meta.thinking} thinking / ${items.length} items / ${errs} errors${queued ? ` / ${queued} queued` : ""}`;
}
function subtitleFor(view: View) {
  return {
    mcp: "model context protocol servers, read from ~/.pi/agent/mcp.json",
    skills: "skills loaded into the system prompt",
    providers: "providers and models available to this session",
    system: "runtime, policy and tool loadout",
    session: "",
  }[view];
}

/* ------------------------------------------------------------- sidenav */
function Sidenav({
  sessions,
  activeId,
  view,
  onView,
  cwd,
}: {
  sessions: { id: string; name?: string; title?: string | null; items: number; running: boolean; queued: boolean; lastTs: number | null; pending: boolean; modelId: string; cwd: string }[];
  activeId: string | null;
  view: View;
  onView: (v: View) => void;
  cwd: string;
}) {
  const sorted = [...sessions].sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0));
  const listRef = useRef<HTMLDivElement>(null);
  const [cramped, setCramped] = useState(false);
  const [mode, setMode] = useState<"sessions" | "files">("sessions");

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const check = () => setCramped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sessions.length]);

  return (
    <aside class="sidenav" data-cramped={cramped ? "1" : "0"}>
      <TopCap w={375} h={100} bar={44}>
        <span class="cap-ttl">PI AGENT CONSOLE</span>
        <span class="cap-sub">LCARS / SESSION CONSOLE</span>
      </TopCap>

      <div class="lseg" role="tablist">
        <button type="button" aria-selected={mode === "sessions" ? "true" : "false"} onClick={() => setMode("sessions")}>
          SESSIONS
        </button>
        <button type="button" aria-selected={mode === "files" ? "true" : "false"} onClick={() => setMode("files")}>
          FILES
        </button>
      </div>

      {mode === "files" ? <FileTree root={cwd} /> : null}

      <button
        type="button"
        class="lnew"
        style={mode === "files" ? { display: "none" } : undefined}
        onClick={() => { actions.newSession(); onView("session"); }}
      >
        <span class="ic">
          <Icon name="act-new" size={15} />
        </span>
        <span class="lb">NEW SESSION</span>
      </button>

      <div class="lsessions" ref={listRef} style={mode === "files" ? { display: "none" } : undefined}>
        {sorted.length === 0 ? <div class="lempty">no sessions</div> : null}
        {sorted.map((s, i) => (
          <div
            key={s.id}
            class="sess"
            data-active={s.id === activeId ? "1" : "0"}
            data-run={s.running ? "1" : "0"}
            role="button"
            tabIndex={0}
            title={`${s.name ?? s.id}\n${s.cwd}`}
            onClick={() => {
              actions.activate(s.id);
              onView("session");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                actions.activate(s.id);
                onView("session");
              }
            }}
          >
            <span class="num">{String(Number(s.id.match(/^s(\d+)/)?.[1] ?? i + 1)).padStart(2, "0")}</span>
            <span class="l1" data-empty={s.title ? "0" : "1"}>
              {s.title ?? "UNTITLED SESSION"}
            </span>
            <span class="l2">
              {s.modelId.toUpperCase()} / {s.id.slice(0, 7).toUpperCase()}
            </span>
            <span class="rt">
              {s.queued ? "QUEUED" : s.running ? "LIVE" : s.pending ? "HELD" : s.lastTs ? ago(s.lastTs) : "NEW"}
              {s.items ? ` · ${s.items}` : ""}
            </span>
            <button
              type="button"
              class="del"
              title="Delete session"
              onClick={(e) => {
                e.stopPropagation();
                actions.remove(s.id);
              }}
            >
              <Icon name="act-delete" size={11} />
            </button>
          </div>
        ))}
      </div>

      {/* LCARS filler: one elastic block extends the column instead of
          leaving a void. It grows with the leftover height and disappears
          once the list itself scrolls. */}
      <div class="lfiller" aria-hidden="true" style={mode === "files" ? { display: "none" } : undefined}>
        <span class="stretch" />
      </div>

      <div class="lnav">
        {NAV.map((n) => (
          <Station key={n.view} num="" label={n.label} icon={n.icon} tone={n.tone} full h={42} active={view === n.view} onClick={() => onView(n.view)} />
        ))}
      </div>
    </aside>
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
        Type below and press <code>ENTER</code>. Every row comes from a real event: text deltas, tool
        executions, retries, truncation, approvals.
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
                diff={it.diff}
                children={it.children}
                agent={it.agent}
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

  const [focused, setFocused] = useState(false);
  const chars = text.length;

  return (
    <div class="cmdbar">
      <div class="entry-block">
        <span class="el">ENTRY</span>
        <span class="eh">{running ? "STEER" : "CTRL K"}</span>
      </div>

      <div class="cmd-field" data-state={disabled ? "off" : running ? "live" : "idle"}>
        <div class="cmd-help">
          <span class={running ? "live" : ""}>
            {running ? "GENERATING / ESC TO INTERRUPT / ENTER QUEUES A STEER" : "ENTER SEND / SHIFT+ENTER NEWLINE"}
          </span>
          <span class="cnt">{chars ? `${chars} CHARS` : "INPUT"}</span>
        </div>
        <label class="inputline" data-focused={focused ? "1" : "0"}>
          <span class="caret" />
          <textarea
            ref={ref}
            rows={2}
            placeholder={running ? "插入一条消息，不打断当前生成…" : "让 pi 构建、重构或调查…"}
            value={text}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>
      </div>

      <div class="btns">
        <BarButton label={running ? "STEER" : "RUN"} hint="ENTER" tone="ok" disabled={disabled} onClick={submit} icon="act-send" />
        <BarButton label="STOP" hint="ESC" tone="stop" disabled={!running} onClick={() => actions.abort()} icon="act-stop" />
        <BarButton label="FORK" hint="COPY" tone="quiet" onClick={() => actions.fork()} icon="act-copy" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ rail */
function Rail({ items, meta, queue }: { items: Item[]; meta: ReturnType<typeof getState>["meta"]; queue: { waiting: string[] } }) {
  const stats = useMemo(() => {
    const out: Record<string, { calls: number; fails: number; trunc: number }> = {};
    for (const it of items) {
      if (it.kind !== "tool") continue;
      out[it.name] ||= { calls: 0, fails: 0, trunc: 0 };
      out[it.name].calls++;
      if (it.status === "error") out[it.name].fails++;
      if (it.truncated) out[it.name].trunc++;
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
            .map(([name, v]) => (
              <div class="mrow" key={name}>
                <span>{name.toUpperCase()}</span>
                <span class={v.fails ? "bad" : v.trunc ? "warnval" : "ok"}>
                  {v.calls}
                  {v.fails ? ` / ${v.fails} FAIL` : ""}
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

/* ----------------------------------------------------------------- theme */
function ThemeDeck({ current, onPick, onClose }: { current: ThemeId; onPick: (id: ThemeId) => void; onClose: () => void }) {
  return (
    <Deck label="PALETTE" sub="INSTANT, PERSISTED" actions={<BarButton tone="quiet" label="CLOSE" icon="act-close" onClick={onClose} />}>
      {THEMES.map((t) => (
        <button
          type="button"
          class="theme-opt"
          key={t.id}
          aria-selected={t.id === current ? "true" : "false"}
          onClick={() => onPick(t.id)}
        >
          <span class="sw">
            {t.swatch.map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          <span class="nm">{t.name}</span>
          <span class="nt">{t.note}</span>
          <span class="ck">{t.id === current ? <Icon name="status-ok" size={13} /> : null}</span>
        </button>
      ))}
    </Deck>
  );
}

/* ------------------------------------------------------------------ mcp */
function McpPanel() {
  const [data, setData] = useState<{ servers: McpServer[]; paths: { global: string; project: string }; exists: { global: boolean; project: boolean } } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .mcp()
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="pv">
      <div class="pv-title">
        MCP / {data?.servers.length ?? 0} SERVERS
      </div>
      <div class="pv-sub">
        Read from <code>{shortPath(data?.paths.global ?? "~/.pi/agent/mcp.json")}</code>
        {data?.exists.project ? ` with project overrides in ${shortPath(data.paths.project)}` : ""}. Changes are written with a{" "}
        <code>.bak</code> backup and take effect on the next session.
      </div>

      {err ? (
        <div class="errbar" style={{ margin: "0 0 8px" }}>
          <Icon name="status-fail" size={13} /> {err}
        </div>
      ) : null}

      {data?.servers.length === 0 ? <div class="pv-sub">No MCP servers configured.</div> : null}

      {(data?.servers ?? []).map((m) => (
        <div class="mcp-row" key={m.name} data-off={m.enabled ? "0" : "1"}>
          <span class="st" />
          <span class="ic">
            <Icon name="station-mcp" size={14} />
          </span>
          <span class="nm">
            {m.name}
            <em>{m.transport === "stdio" ? `${m.command} ${m.args.join(" ")}` : m.url}</em>
          </span>
          <span class="mt">{m.exposure}{m.toolExposure ? ` · ${m.toolExposure} pinned` : ""}</span>
          <button
            type="button"
            class="tgl"
            aria-pressed={m.enabled ? "true" : "false"}
            disabled={busy}
            onClick={() => run(() => api.mcpToggle(m.name, !m.enabled))}
          >
            {m.enabled ? "ON" : "OFF"}
          </button>
          <button type="button" class="tgl ghost" disabled={busy} title="Remove server" onClick={() => run(() => api.mcpRemove(m.name))}>
            <Icon name="act-delete" size={12} />
          </button>
        </div>
      ))}

      <div class="pv-title" style={{ fontSize: "13px", marginTop: "18px" }}>ADD SERVER</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", maxWidth: "820px" }}>
        <FieldRow label="NAME" icon="station-mcp" value={name} placeholder="filesystem" onInput={setName} required />
        <FieldRow label="COMMAND / URL" icon="fld-host" value={command} placeholder="npx -y @modelcontextprotocol/server-filesystem ." onInput={setCommand} />
        <div style={{ display: "flex", gap: "var(--gap)" }}>
          <BarButton
            tone="ok"
            label="ADD"
            icon="act-new"
            disabled={busy || !name || !command}
            onClick={() =>
              run(async () => {
                const isUrl = /^https?:\/\//.test(command);
                await api.mcpAdd(isUrl ? { name, url: command } : { name, command: command.split(/\s+/)[0], args: command.split(/\s+/).slice(1).join(" ") });
                setName("");
                setCommand("");
              })
            }
          />
          <BarButton tone="quiet" label="RELOAD" icon="act-reload" onClick={() => load()} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ providers */
function ProvidersPanel({ meta }: { meta: ReturnType<typeof getState>["meta"] }) {
  const [data, setData] = useState<ProvidersResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, ModelInfo[]>>({});
  const [tests, setTests] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = () =>
    api
      .providers()
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);

  const configured = (data?.providers ?? []).filter((p) => p.auth !== "none");
  const others = (data?.providers ?? []).filter((p) => p.auth === "none");

  const toggle = async (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (next && !models[id]) {
      setBusy(id);
      try {
        setModels((m) => ({ ...m, [id]: [] }));
        const list = await api.providerModels(id);
        setModels((m) => ({ ...m, [id]: list }));
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(null);
      }
    }
  };

  const test = async (id: string) => {
    setBusy(`t:${id}`);
    try {
      const r = await api.providerTest(id);
      setTests((t) => ({ ...t, [id]: `${r.status.toUpperCase()} · ${r.ms}ms${r.reason ? ` · ${r.reason}` : ""}` }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: `ERROR · ${(e as Error).message}` }));
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async (id: string) => {
    const key = (keys[id] ?? "").trim();
    if (!key) return;
    setBusy(`k:${id}`);
    try {
      await api.providerKey(id, key);
      setKeys((k) => ({ ...k, [id]: "" }));
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const row = (p: ProviderRow, dim = false) => {
    const expanded = open === p.id;
    return (
      <div class="pv-card" key={p.id} data-dim={dim ? "1" : "0"}>
        <div class="pv-head" role="button" tabIndex={0} onClick={() => toggle(p.id)} onKeyDown={(e) => e.key === "Enter" && toggle(p.id)}>
          <span class="st" data-auth={p.auth} />
          <Icon name="station-provider" size={12} />
          <span class="nm">{p.name}</span>
          <span class="at">{p.auth === "none" ? "no key" : p.auth === "oauth" ? "oauth" : p.keyMask ?? "api key"}</span>
          <span class="ct">{p.models} models</span>
          {p.current ? <span class="cur">ACTIVE</span> : null}
          {p.auth !== "none" ? (
            <button
              type="button"
              class="pv-btn"
              disabled={busy === `t:${p.id}`}
              onClick={(e) => {
                e.stopPropagation();
                test(p.id);
              }}
            >
              TEST
            </button>
          ) : null}
        </div>
        {tests[p.id] ? <div class={`pv-test ${tests[p.id].startsWith("READY") ? "ok" : ""}`}>{tests[p.id]}</div> : null}

        {expanded ? (
          <div class="pv-body">
            {busy === p.id ? <div class="pv-note">loading models…</div> : null}
            {(models[p.id] ?? []).slice(0, 24).map((m) => (
              <div class="pv-model" key={m.id}>
                <span class="nm">{m.id}</span>
                <span class="cx">{m.contextWindow ? fmtTok(m.contextWindow) : "—"}</span>
                <button
                  type="button"
                  class="pv-btn"
                  onClick={async () => {
                    await actions.setModel(m.provider, m.id);
                    load();
                  }}
                >
                  USE
                </button>
                <button
                  type="button"
                  class="pv-btn ghost"
                  onClick={async () => {
                    try {
                      await api.providerDefault(m.provider, m.id);
                      await load();
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  DEFAULT
                </button>
              </div>
            ))}

            <div class="pv-key">
              <span class="lb">{p.auth === "none" ? "ADD API KEY" : "REPLACE KEY"}</span>
              <input
                type="password"
                value={keys[p.id] ?? ""}
                placeholder={p.keyMask ?? "sk-…"}
                onInput={(e) => setKeys((k) => ({ ...k, [p.id]: (e.target as HTMLInputElement).value }))}
                onKeyDown={(e) => e.key === "Enter" && saveKey(p.id)}
              />
              <button type="button" class="pv-btn" disabled={busy === `k:${p.id}` || !(keys[p.id] ?? "").trim()} onClick={() => saveKey(p.id)}>
                SAVE
              </button>
            </div>
            <div class="pv-note">
              written to <code>{data?.files.auth ? shortPath(data.files.auth) : "~/.pi/agent/auth.json"}</code> with a .bak
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div class="pv">
      <div class="pv-title">
        {configured.length} CONFIGURED / {(data?.providers ?? []).length} KNOWN
      </div>
      <div class="pv-sub">
        Default for new sessions: <code>{data?.defaultProvider ?? "—"} / {data?.defaultModel ?? "—"}</code>. A model switched here applies to
        the next turn; DEFAULT writes it to <code>settings.json</code>.
      </div>
      {err ? (
        <div class="errbar" style={{ margin: "0 0 8px" }}>
          <Icon name="status-fail" size={13} /> {err}
        </div>
      ) : null}

      {configured.map((p) => row(p))}

      {others.length ? (
        <>
          <button type="button" class="pv-more" onClick={() => setMore(!more)}>
            {more ? "− HIDE" : "+ SHOW"} {others.length} PROVIDERS WITHOUT A KEY
          </button>
          {more ? others.map((p) => row(p, true)) : null}
        </>
      ) : null}

      <div class="pv-note" style={{ marginTop: "12px" }}>
        Session model: <code>{meta?.model ?? "—"}</code> · keys are masked on read and never sent back from the server
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- skills */
function SkillsPanel({ meta, policy }: { meta: ReturnType<typeof getState>["meta"]; policy: string }) {
  const [data, setData] = useState<SkillsResult | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .skills()
      .then((d) => {
        setData(d);
        setErr(d.available ? null : d.error ?? "resource loader unavailable");
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);

  const reload = async () => {
    setBusy(true);
    try {
      const d = await api.reloadSkills();
      setData(d);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const skills = data?.skills ?? [];

  return (
    <div class="pv">
      <div class="pv-title">
        {skills.length} SKILLS / {data?.extensions.length ?? 0} EXTENSIONS / {data?.prompts.length ?? 0} PROMPTS
      </div>
      <div class="pv-sub">
        Skills are not tools: pi injects each one into the <b>system prompt</b> only when it decides the skill applies.
        The <code>description</code> below is literally what it matches on — that is the trigger.
      </div>

      {err ? (
        <div class="errbar" style={{ margin: "0 0 8px" }}>
          <Icon name="status-fail" size={13} /> {err}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "var(--gap)", marginBottom: "10px" }}>
        <BarButton tone="ok" label="RELOAD" icon="act-reload" disabled={busy} onClick={reload} />
        <span style={{ font: "400 10px/2.4 var(--mono)", color: "var(--g2)" }}>
          re-reads SKILL.md files, no restart{data?.ms ? ` · last ${data.ms}ms` : ""}
        </span>
      </div>

      {skills.map((sk) => {
        const expanded = openId === sk.name;
        return (
          <div class="sk" key={sk.name}>
            <div class="sk-head" role="button" tabIndex={0} onClick={() => setOpenId(expanded ? null : sk.name)} onKeyDown={(e) => e.key === "Enter" && setOpenId(expanded ? null : sk.name)}>
              <span class="st" data-trigger={sk.trigger} />
              <span class="nm">{sk.name}</span>
              <span class="tg" data-manual={sk.manualOnly ? "1" : "0"}>{sk.manualOnly ? "MANUAL /name" : "AUTO · description"}</span>
              <span class="sz">{sk.bytes ? `${Math.round(sk.bytes / 1024)}K` : ""}</span>
              <span class="acts">
                <button
                  type="button"
                  class="ft-act"
                  title="Copy path"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard?.writeText(sk.path).catch(() => {});
                  }}
                >
                  <Icon name="act-copy" size={10} />
                </button>
                <button
                  type="button"
                  class="ft-act"
                  title="Open SKILL.md"
                  onClick={(e) => {
                    e.stopPropagation();
                    api.openPath(sk.path, "editor").catch(() => {});
                  }}
                >
                  <Icon name="act-open" size={10} />
                </button>
              </span>
            </div>
            {sk.heading ? <div class="sk-heading">{sk.heading}</div> : null}
            <div class={`sk-desc ${expanded ? "open" : ""}`}>{sk.description || "(no description — cannot be auto-invoked)"}</div>
            <div class="sk-path">{shortPath(sk.path)}</div>
          </div>
        );
      })}

      <div class="pv-title" style={{ fontSize: "13px", marginTop: "18px" }}>HOW A SKILL FIRES</div>
      <div class="pv-sub" style={{ maxWidth: "820px" }}>
        <b>AUTO</b> — the model sees every skill's name + description in the system prompt and loads the body only when the
        task matches. You can force one by typing <code>/&lt;name&gt;</code>.<br />
        <b>MANUAL</b> — <code>disableModelInvocation</code> is set; it never auto-fires, only <code>/&lt;name&gt;</code> runs it.<br />
        Extensions ({data?.extensions.length ?? 0}) are different: they register tools and commands, and are listed in SETTINGS.
      </div>

      <div class="pv-title" style={{ fontSize: "13px", marginTop: "14px" }}>RUNTIME</div>
      <div class="pv-row">
        <div class="st" style={{ background: meta?.approvalWired ? "var(--cyan)" : "var(--tomato)" }} />
        <div class="k">APPROVAL</div>
        <div class="v">{meta?.approvalWired ? "inline extension wired" : "not wired — check server log"}</div>
        <div class="n" />
      </div>
      <div class="pv-row">
        <div class="st" style={{ background: "var(--moon)" }} />
        <div class="k">POLICY</div>
        <div class="v">{policy}</div>
        <div class="n" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- settings */
function SettingsPanel({ items, meta, policy }: { items: Item[]; meta: ReturnType<typeof getState>["meta"]; policy: string }) {
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

  return (
    <div class="pv">
      <div class="pv-title">SETTINGS</div>
      <div class="pv-sub">Runtime of the active session, read from the live session rather than from config files.</div>

      <div class="pv-row"><div class="st" style={{ background: "var(--cyan)" }} /><div class="k">MODEL</div><div class="v">{meta?.model ?? "—"}</div><div class="n" /></div>
      <div class="pv-row"><div class="st" style={{ background: "var(--cyan)" }} /><div class="k">THINKING</div><div class="v">{meta?.thinking ?? "—"}</div><div class="n" /></div>
      <div class="pv-row"><div class="st" style={{ background: "var(--cyan)" }} /><div class="k">CWD</div><div class="v">{shortPath(meta?.cwd ?? "")}</div><div class="n" /></div>
      <div class="pv-row"><div class="st" style={{ background: "var(--cyan)" }} /><div class="k">SESSION</div><div class="v">{meta?.path ? shortPath(meta.path) : "unsaved"}</div><div class="n" /></div>

      <div class="pv-title" style={{ fontSize: "13px", marginTop: "18px" }}>APPROVAL POLICY</div>
      <div style={{ display: "flex", gap: "var(--gap)", alignItems: "center", marginBottom: "10px" }}>
        {(["off", "risky", "all"] as const).map((m) => (
          <BarButton key={m} label={m.toUpperCase()} tone={policy === m ? "ok" : "quiet"} onClick={() => actions.policy(m)} />
        ))}
        <span style={{ font: "400 11px/1.6 var(--mono)", color: "var(--g2)" }}>
          risky = bash / write / edit · pending calls are released on abort
        </span>
      </div>

      <div class="pv-title" style={{ fontSize: "13px", marginTop: "10px" }}>TOOL LOADOUT / {meta?.tools.length ?? 0}</div>
      {(meta?.tools ?? []).map((n) => (
        <div class="pv-row" key={n} style={{ minHeight: "36px" }}>
          <div class="st" />
          <div class="k">{n.toUpperCase()}</div>
          <div class="v">
            {stats[n]?.calls ?? 0} calls · {stats[n]?.fails ?? 0} failed
          </div>
          <div class="n">{stats[n]?.ms ? `${Math.round(stats[n].ms)}ms` : "—"}</div>
        </div>
      ))}
    </div>
  );
}
