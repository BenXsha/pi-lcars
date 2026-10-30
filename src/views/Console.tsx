import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { DiffData, DirEntry, Item, McpConfig, McpServer, ModelInfo, ProviderRow, ProvidersResult, SkillsResult, SystemInfo } from "../api";
import { api } from "../api";
import { actions, connect, getState, subscribe } from "../store";
import { THEMES, appliedTheme, applyTheme, type ThemeId } from "../theme";
import { getSettings, setSettings, subscribeSettings } from "../settings";
import { t } from "../i18n";
import { Icon, type IconName } from "../components/Icon";
import { Logo } from "../components/Logo";
import { FileTree } from "../components/FileTree";
import { FileViewer } from "../components/FileViewer";
import { askComposer, onComposerRequest } from "../composer";
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

const NAV: { view: View; key: TKey2; icon: IconName; tone: "amber" | "lav" | "moon" | "ice" | "cyan" }[] = [
  { view: "mcp", key: "nav.mcp", icon: "station-mcp", tone: "lav" },
  { view: "skills", key: "nav.skills", icon: "station-skills", tone: "ice" },
  { view: "providers", key: "nav.providers", icon: "station-provider", tone: "cyan" },
  { view: "system", key: "nav.settings", icon: "station-system", tone: "moon" },
];
type TKey2 = Parameters<typeof t>[0];

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

/**
 * Column widths by viewport. The cap is always column + 55 (r), so the scoop
 * keeps landing on the column edge instead of drifting.
 */
function useLayoutWidths() {
  const calc = () => {
    const w = typeof window === "undefined" ? 1600 : window.innerWidth;
    if (w >= 1500) return { col: 320, rail: 328 };
    if (w >= 1280) return { col: 288, rail: 300 };
    if (w >= 1100) return { col: 256, rail: 272 };
    return { col: 224, rail: 0 };
  };
  const [dims, setDims] = useState(calc);
  useEffect(() => {
    const on = () => setDims(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return dims;
}

/** One exchange = one user message plus everything the agent did for it. */
type Turn = { id: string; n: number; text: string; ts: number; tools: number; tokens: number; items: number };

function buildTurns(items: Item[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  for (const it of items) {
    if (it.kind === "user") {
      cur = { id: it.id, n: turns.length + 1, text: it.text, ts: it.ts, tools: 0, tokens: 0, items: 0 };
      turns.push(cur);
      continue;
    }
    if (!cur) continue;
    cur.items++;
    if (it.kind === "tool") cur.tools++;
    if (it.kind === "assistant" && it.usage) cur.tokens += it.usage.output || 0;
  }
  return turns;
}

function useStore() {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  return getState();
}

/* ---------------------------------------------------------------- shell */
export function Console() {
  const s = useStore();
  const [view, setView] = useState<View>("session");
  const [deck, setDeck] = useState<null | "new" | "model" | "think">(null);
  const [sideMode, setSideMode] = useState<"sessions" | "files">("sessions");
  const [previewCwd, setPreviewCwd] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ path: string; diff?: DiffData } | null>(null);
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [panes, setPanes] = useState(() => {
    const read = (k: string) => {
      try {
        return localStorage.getItem(k) !== "0";
      } catch {
        return true;
      }
    };
    return { left: read("lcars.left"), right: read("lcars.right") };
  });
  const [theme, setTheme] = useState<ThemeId>(appliedTheme());

  useEffect(() => connect(), []);

  // which exchange is under the reading position — drives the outline marker
  useEffect(() => {
    const sc = document.getElementById("scroll");
    if (!sc) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rows = [...sc.querySelectorAll<HTMLElement>('[data-turn="1"]')];
        if (!rows.length) return setActiveTurn(null);
        const line = sc.getBoundingClientRect().top + 80;
        let current = rows[0].dataset.id ?? null;
        for (const r of rows) if (r.getBoundingClientRect().top <= line) current = r.dataset.id ?? current;
        setActiveTurn(current);
      });
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      sc.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [viewer, view, s.activeId]);

  // locale / scale / motion live in a module store; the shell re-renders on change
  const [, bumpSettings] = useState(0);
  useEffect(() => subscribeSettings(() => bumpSettings((n) => n + 1)), []);

  useEffect(() => {
    try {
      localStorage.setItem("lcars.left", panes.left ? "1" : "0");
      localStorage.setItem("lcars.right", panes.right ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [panes.left, panes.right]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // works while composing too: the composer has no Ctrl/Cmd+B binding
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "b") return;
      e.preventDefault();
      setPanes((p) => (e.shiftKey ? { ...p, right: !p.right } : { ...p, left: !p.left }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const meta = s.meta;
  const active = s.sessions.find((x) => x.id === s.activeId);
  const { col: wideCol, rail } = useLayoutWidths();
  const col = panes.left ? wideCol : 64;

  return (
    <div class="app" data-left={panes.left ? "1" : "0"} data-right={panes.right ? "1" : "0"}>
      <Sidenav
        sessions={s.sessions}
        activeId={s.activeId}
        view={view}
        onView={setView}
        cwd={meta?.cwd ?? ""}
        col={col}
        collapsed={!panes.left}
        onToggle={() => setPanes((p) => ({ ...p, left: !p.left }))}
        mode={sideMode}
        onMode={setSideMode}
        previewCwd={previewCwd}
        flash={flash}
        onOpenFile={(p) => setViewer({ path: p })}
        onNewSession={() => {
          setDeck("new");
          setSideMode("files");
          setPreviewCwd(null);
        }}
        onPickWorkspace={() => previewCwd && setDeck("new")}
      />

      <div class="main">
        <Shelf
          brand=""
          tag=""
        >
          {meta ? (
            <>
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
            </>
          ) : (
            <span style={{ font: "700 11px/1 var(--din)", letterSpacing: "0.14em" }}>CONNECTING…</span>
          )}
          <span class="shelf-tag">{view === "session" ? "MISSION LOG" : view.toUpperCase()}</span>
        </Shelf>

        {deck === "new" ? (
          <NewSessionDeck
            currentCwd={meta?.cwd ?? ""}
            onPreview={setPreviewCwd}
            recents={[...new Set(s.sessions.map((x) => x.cwd))].filter(Boolean).slice(0, 4)}
            onUse={async (path) => {
              await actions.newSession(path);
              setDeck(null);
              setPreviewCwd(null);
              setSideMode("files");
              setFlash(`new session in ${shortPath(path)}`);
              setTimeout(() => setFlash(null), 3200);
            }}
            onClose={() => {
              setDeck(null);
              setPreviewCwd(null);
            }}
          />
        ) : null}
        {deck === "model" ? <ModelDeck current={meta?.modelId} onClose={() => setDeck(null)} /> : null}
        {deck === "think" ? <ThinkDeck current={meta?.thinking} onClose={() => setDeck(null)} /> : null}


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

            {viewer ? (
              <FileViewer path={viewer.path} diff={viewer.diff} onClose={() => setViewer(null)} />
            ) : (
            <div class="scroll" id="scroll">
              {view === "session" ? (
                <Transcript
                  items={s.items}
                  onOpenDiff={(p, d) => setViewer({ path: p, diff: d })}
                  onRecall={async (turn, text, itemId) => {
                    if (!turn) return;
                    const r = await actions.rewind(turn);
                    if (r) {
                      setActiveTurn(null);
                      askComposer({ kind: "replace", text });
                      setFlash(`recalled exchange ${String(turn).padStart(2, "0")} — edit and send again`);
                      setTimeout(() => setFlash(null), 3200);
                    }
                  }}
                />
              ) : view === "mcp" ? (
                <McpPanel />
              ) : view === "providers" ? (
                <ProvidersPanel meta={meta} />
              ) : view === "skills" ? (
                <SkillsPanel meta={meta} policy={s.policy} />
              ) : (
                <SettingsPanel items={s.items} meta={meta} policy={s.policy} theme={theme} onTheme={(id) => { applyTheme(id); setTheme(id); }} />
              )}
            </div>
            )}

            <Composer running={!!meta?.running} disabled={s.link !== "open"} queue={meta?.queue} />
          </main>

          {rail ? (
            panes.right ? (
              <Rail
                items={s.items}
                meta={meta}
                queue={s.queue}
                width={rail}
                turns={buildTurns(s.items)}
                onJump={(id) => {
                  setViewer(null);
                  requestAnimationFrame(() => {
                    document.querySelector(`#scroll [data-id="${id}"]`)?.scrollIntoView({ block: "start" });
                    setActiveTurn(id);
                  });
                }}
                onLatest={() => {
                  setViewer(null);
                  requestAnimationFrame(() => {
                    const sc = document.getElementById("scroll");
                    if (sc) sc.scrollTop = sc.scrollHeight;
                  });
                }}
                activeTurn={activeTurn}
                onToggle={() => setPanes((p) => ({ ...p, right: !p.right }))}
              />
            ) : (
              /* collapsed: keep a 24px handle so the pane can always be reopened */
              <aside class="rail is-collapsed">
                <button
                  type="button"
                  class="pane-foot is-right"
                  data-tip={t("pane.expandRight")}
                  aria-label={t("pane.expandRight")}
                  aria-pressed="false"
                  onClick={() => setPanes((p) => ({ ...p, right: true }))}
                >
                  <Icon name="pane-collapse-left" size={12} />
                </button>
              </aside>
            )
          ) : null}
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
  col,
  collapsed,
  onToggle,
  mode,
  onMode,
  previewCwd,
  flash,
  onOpenFile,
  onNewSession,
  onPickWorkspace,
}: {
  sessions: { id: string; name?: string; title?: string | null; items: number; running: boolean; queued: boolean; lastTs: number | null; pending: boolean; modelId: string; cwd: string }[];
  activeId: string | null;
  view: View;
  onView: (v: View) => void;
  cwd: string;
  col: number;
  collapsed: boolean;
  onToggle: () => void;
  mode: "sessions" | "files";
  onMode: (m: "sessions" | "files") => void;
  previewCwd: string | null;
  flash: string | null;
  onOpenFile: (path: string) => void;
  onNewSession: () => void;
  onPickWorkspace: () => void;
}) {
  const sorted = [...sessions].sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0));
  const listRef = useRef<HTMLDivElement>(null);
  const [cramped, setCramped] = useState(false);

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
    <aside class="sidenav" data-cramped={cramped ? "1" : "0"} style={{ width: `${col}px`, flex: `0 0 ${col}px` }}>
      {/* the cap is always column + r, so the concave corner keeps landing on
          the column edge — collapsed included. Only its contents recentre. */}
      <TopCap w={col + 55} h={100} bar={44}>
        <span class={`cap-logo ${collapsed ? "is-mini" : ""}`}>
          <Logo size={collapsed ? 48 : 64} />
        </span>
        {collapsed ? null : (
          <span class="cap-text">
            <b>Enterprise Agent Console</b>
            <em>base on pi.agent</em>
          </span>
        )}
      </TopCap>

      <div class="lseg" role="tablist" style={collapsed ? { display: "none" } : undefined}>
        <button type="button" aria-selected={mode === "sessions" ? "true" : "false"} onClick={() => onMode("sessions")}>
          {t("side.sessions")}
        </button>
        <button type="button" aria-selected={mode === "files" ? "true" : "false"} onClick={() => onMode("files")}>
          {t("side.files")}
        </button>
      </div>

      {mode === "files" && !collapsed ? (
        <FileTree
          root={previewCwd && previewCwd.startsWith(cwd) ? previewCwd : cwd}
          preview={!!previewCwd && previewCwd.startsWith(cwd) && previewCwd !== cwd}
          notice={previewCwd && !previewCwd.startsWith(cwd) ? "preview limited to the current workspace — the choice still applies to the new session" : flash}
          onPickWorkspace={onPickWorkspace}
          onOpenFile={onOpenFile}
        />
      ) : null}

      <button
        type="button"
        class={`lnew ${collapsed ? "is-mini" : ""}`}
        style={mode === "files" ? { display: "none" } : undefined}
        data-tip={t("side.new")}
        aria-label={t("side.new")}
        onClick={onNewSession}
      >
        <span class="ic">
          <Icon name="act-new" size={15} />
        </span>
        {collapsed ? null : <span class="lb">{t("side.new")}</span>}
      </button>

      <div class={`lsessions ${collapsed ? "is-mini" : ""}`} ref={listRef} style={mode === "files" ? { display: "none" } : undefined}>
        {sorted.length === 0 ? <div class="lempty">no sessions</div> : null}
        {sorted.map((s, i) => (
          <div
            key={s.id}
            class="sess"
            data-active={s.id === activeId ? "1" : "0"}
            data-run={s.running ? "1" : "0"}
            data-mini={collapsed ? "1" : "0"}
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
            {collapsed ? null : (
              <>
                <span class="l1" data-empty={s.title ? "0" : "1"}>
                  {s.title ?? "UNTITLED SESSION"}
                </span>
                <span class="l2">
                  {s.modelId.toUpperCase()} / {s.id.slice(0, 7).toUpperCase()}
                </span>
              </>
            )}
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
          <Station
            key={n.view}
            num=""
            label={collapsed ? "" : t(n.key)}
            icon={n.icon}
            tone={n.tone}
            full
            h={42}
            active={view === n.view}
            tip={t(n.key)}
            onClick={() => onView(n.view)}
          />
        ))}
      </div>

      <button
        type="button"
        class="pane-foot"
        data-tip={collapsed ? t("pane.expand") : t("pane.collapse")}
        aria-label={collapsed ? t("pane.expand") : t("pane.collapse")}
        aria-pressed={collapsed ? "false" : "true"}
        onClick={onToggle}
      >
        <Icon name={collapsed ? "pane-collapse-right" : "pane-collapse-left"} size={12} />
      </button>
    </aside>
  );
}

/* ------------------------------------------------------------------ ask */
/** A blocked extension dialog (select / confirm / input) rendered inline. */
function AskBlock({ item }: { item: Extract<Item, { kind: "ask" }> }) {
  const [text, setText] = useState("");
  const pending = item.status === "pending";

  return (
    <div class="ask" data-state={item.status}>
      <span class="st" />
      <div class="ab">
        <div class="ab-hd">
          <span class="ab-tag">{pending ? "WAITING FOR YOU" : "ANSWERED"}</span>
          <span class="ab-mode">{item.mode.toUpperCase()}</span>
        </div>
        <div class="ab-title">{item.title}</div>
        {item.message ? <div class="ab-msg">{item.message}</div> : null}

        {pending ? (
          item.mode === "select" ? (
            <div class="ab-opts">
              {(item.options ?? []).map((opt) => (
                <button type="button" key={opt} class="ab-opt" onClick={() => actions.answer(item.id, opt)}>
                  {opt}
                </button>
              ))}
              <button type="button" class="ab-opt ghost" onClick={() => actions.answer(item.id, null)}>
                SKIP / CANCEL
              </button>
            </div>
          ) : item.mode === "confirm" ? (
            <div class="ab-opts">
              <button type="button" class="ab-opt" onClick={() => actions.answer(item.id, "Yes")}>
                YES
              </button>
              <button type="button" class="ab-opt" onClick={() => actions.answer(item.id, "No")}>
                NO
              </button>
            </div>
          ) : (
            <div class="ab-in">
              <input
                value={text}
                placeholder={item.placeholder ?? "type an answer…"}
                onInput={(e) => setText((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && text.trim()) actions.answer(item.id, text.trim());
                }}
              />
              <button type="button" class="ab-opt" disabled={!text.trim()} onClick={() => actions.answer(item.id, text.trim())}>
                SEND
              </button>
            </div>
          )
        ) : (
          <div class="ab-res">
            {item.status === "cancelled" ? "dismissed" : item.status === "timeout" ? "timed out" : item.value}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- transcript */
function Transcript({
  items,
  onOpenDiff,
  onRecall,
}: {
  items: Item[];
  onOpenDiff?: (path: string, diff: DiffData) => void;
  onRecall?: (turn: number, text: string, itemId: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const t0 = items[0]?.ts ?? Date.now();

  if (!items.length) {
    return (
      <div class="standby">
        <div class="sb-head">
          <span class="st" />
          <span class="ttl">STANDING BY</span>
          <span class="sub">NO TRANSMISSION IN THIS SESSION</span>
        </div>
        <div class="sb-rows">
          {[
            ["LINK", "live pi session — nothing here is scripted"],
            ["INPUT", "ENTER transmits · SHIFT+ENTER breaks the line"],
            ["STREAM", "text deltas · tool calls · retries · truncation · approvals"],
            ["SCOPE", "this session only; the workspace tree lives in the sidebar"],
          ].map(([k, v]) => (
            <div class="sb-row" key={k}>
              <span class="k">{k}</span>
              <span class="v">{v}</span>
            </div>
          ))}
        </div>
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
            <div class={cls} key={it.id} data-id={it.id} data-turn="1">
              <MessageRow
                role="user"
                time={`T+${mmss(it.ts - t0)}`}
                text={it.text}
                onRecall={onRecall ? () => onRecall(buildTurns(items).find((tn) => tn.id === it.id)?.n ?? 0, it.text, it.id) : undefined}
              />
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
            <div class={cls} key={it.id} data-id={it.id}>
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
                onOpenDiff={
                  it.diff && onOpenDiff
                    ? () => onOpenDiff(it.args.split(" / ")[0].split(" ")[0] || it.name, it.diff!)
                    : undefined
                }
                children={it.children}
                agent={it.agent}
                expanded={open[it.id] ?? false}
                onToggle={() => setOpen((o) => ({ ...o, [it.id]: !o[it.id] }))}
              />
            </div>
          );
        }

        if (it.kind === "ask") {
          return (
            <div class={cls} key={it.id} data-id={it.id}>
              <AskBlock item={it} />
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
function Composer({ running, disabled, queue }: { running: boolean; disabled: boolean; queue?: { steering: string[]; followUp: string[] } }) {
  const [text, setText] = useState("");
  const [flashQuote, setFlashQuote] = useState(false);

  // quote appends, recall replaces — both arrive from the transcript
  useEffect(
    () =>
      onComposerRequest((intent) => {
        if (intent.kind === "replace") setText(intent.text);
        else
          setText((prev) => {
            const quoted = intent.text
              .trim()
              .split("\n")
              .map((l) => `> ${l}`)
              .join("\n");
            return prev.trim() ? `${prev.trim()}\n\n${quoted}\n\n` : `${quoted}\n\n`;
          });
        setFlashQuote(intent.kind === "quote");
        requestAnimationFrame(() => {
          ref.current?.focus();
          ref.current?.setSelectionRange(9999, 9999);
        });
        setTimeout(() => setFlashQuote(false), 1200);
      }),
    [],
  );
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

  const queued = [...(queue?.steering ?? []), ...(queue?.followUp ?? [])];

  return (
    <div class="cmdwrap">
      {queued.length ? (
        <div class="qstrip">
          <span class="q-lb">QUEUED {queued.length}</span>
          {queued.map((q, i) => (
            <span class="q-item" key={i} title={q}>
              {q.replace(/\s+/g, " ")}
            </span>
          ))}
          <span class="q-note">delivered after the current turn</span>
        </div>
      ) : null}
    <div class="cmdbar">
      <div class="entry-block">
        <span class="el">{t("cmd.entry")}</span>
        <span class="eh">{running ? t("cmd.steer") : "CTRL K"}</span>
      </div>

      <div class="cmd-field" data-state={disabled ? "off" : running ? "live" : "idle"}>
        <div class="cmd-help">
          <span class={running ? "live" : ""}>
            {running ? t("cmd.live") : t("cmd.send")}
          </span>
          <span class="cnt">{chars ? `${chars} CHARS` : "INPUT"}</span>
        </div>
        <label class="inputline" data-focused={focused ? "1" : "0"}>
          <span class="caret" />
          <textarea
            ref={ref}
            rows={2}
            placeholder={running ? t("cmd.placeholderLive") : t("cmd.placeholder")}
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
        <BarButton label={running ? t("cmd.steer") : t("cmd.run")} hint="ENTER" tone="ok" disabled={disabled} onClick={submit} icon="act-send" />
        <BarButton label={t("cmd.stop")} hint="ESC" tone="stop" disabled={!running} onClick={() => actions.abort()} icon="act-stop" />
        <BarButton label={t("cmd.fork")} hint="COPY" tone="quiet" onClick={() => actions.fork()} icon="act-copy" />
      </div>
    </div>
    </div>
  );
}

/* ------------------------------------------------------------------ rail */
function Rail({
  items,
  meta,
  queue,
  width,
  turns,
  activeTurn,
  onJump,
  onLatest,
  onToggle,
}: {
  items: Item[];
  meta: ReturnType<typeof getState>["meta"];
  queue: { waiting: string[] };
  width: number;
  turns: Turn[];
  activeTurn: string | null;
  onJump: (id: string) => void;
  onLatest: () => void;
  onToggle: () => void;
}) {

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
  const listRef = useRef<HTMLDivElement>(null);

  // keep the active exchange visible inside the outline's own scroller
  useEffect(() => {
    const list = listRef.current;
    if (!list || !activeTurn) return;
    const row = list.querySelector<HTMLElement>(`[data-tid="${activeTurn}"]`);
    if (!row) return;
    list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2);
  }, [activeTurn]);
  const usage = meta?.usage ?? { input: 0, output: 0, cost: 0, total: 0 };
  const pct = meta?.contextPct ?? 0;
  const win = meta?.contextWindow ?? 200000;

  return (
    <aside class="rail" style={{ width: `${width}px`, flex: `0 0 ${width}px` }}>
      <div class="rail-body">
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

      <div class="phead lav">
        <span>{t("rail.chats")} / {turns.length}</span>
        <button type="button" class="phead-act" onClick={onLatest}>
          LATEST
        </button>
      </div>
      <div class="panel">
        {turns.length === 0 ? <div class="pv-note">no exchanges yet</div> : null}
        <div class="tlist" ref={listRef}>
          {turns.map((tn) => (
            <button
              type="button"
              key={tn.id}
              class="trow"
              data-tid={tn.id}
              data-active={tn.id === activeTurn ? "1" : "0"}
              title={tn.text}
              onClick={() => onJump(tn.id)}
            >
              <span class="tn">{String(tn.n).padStart(2, "0")}</span>
              <span class="tbody">
                <span class="tt">{tn.text.replace(/\s+/g, " ")}</span>
                <span class="tm">
                  {tn.tools ? `${tn.tools} tool${tn.tools > 1 ? "s" : ""}` : "no tools"}
                  {tn.tokens ? ` · ${tn.tokens >= 1000 ? `${(tn.tokens / 1000).toFixed(1)}K` : tn.tokens} tok` : ""}
                  {` · ${new Date(tn.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

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
      </div>

      <button
        type="button"
        class="pane-foot is-right"
        data-tip={t("pane.collapseRight")}
        aria-label={t("pane.collapseRight")}
        aria-pressed="true"
        onClick={onToggle}
      >
        <Icon name="pane-collapse-right" size={12} />
      </button>
    </aside>
  );
}

/* ----------------------------------------------------------------- decks */
/**
 * New session chooser. A session's workspace is fixed once it exists, so this
 * is the only place a directory is chosen — and it browses the *filesystem*
 * (home / root / volumes), not the current session's cwd.
 */
function NewSessionDeck({
  currentCwd,
  onPreview,
  recents,
  onUse,
  onClose,
}: {
  currentCwd: string;
  onPreview: (path: string | null) => void;
  recents: string[];
  onUse: (path: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ path: string; parent: string | null; dirs: DirEntry[]; home: string; roots: { label: string; path: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = (path?: string) =>
    api
      .fs(path)
      .then((d) => {
        setData(d);
        onPreview(d.path);
        setErr(null);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    // start from the filesystem home, not the session's cwd
    load("");
  }, []);

  const chosen = data?.path ?? "";

  const crumbs = chosen.split("/").filter(Boolean);
  const crumbPath = (i: number) => "/" + crumbs.slice(0, i + 1).join("/");

  return (
    <Deck
      label="NEW SESSION"
      sub="CHOOSE A WORKSPACE"
      actions={
        <>
          <BarButton tone="quiet" label="UP" icon="act-expand" disabled={!data?.parent} onClick={() => data?.parent && load(data.parent)} />
          <BarButton tone="quiet" label="CANCEL" icon="act-close" onClick={onClose} />
          <BarButton tone="ok" label="START SESSION" icon="act-new" disabled={!chosen} onClick={() => chosen && onUse(chosen)} />
        </>
      }
    >
      <div class="ws-crumbs">
        <button type="button" class="ws-crumb" onClick={() => load("/")}>
          /
        </button>
        {crumbs.map((c, i) => (
          <button type="button" class="ws-crumb" key={crumbPath(i)} onClick={() => load(crumbPath(i))}>
            {c}
          </button>
        ))}
      </div>

      <div class="ws-recent">
        <span class="lb">GO TO</span>
        {(data?.roots ?? []).map((r) => (
          <button type="button" key={r.path} class="ws-chip" onClick={() => load(r.path)}>
            {r.label}
          </button>
        ))}
        {recents.length ? <span class="lb">RECENT</span> : null}
        {recents.map((c) => (
          <button type="button" key={c} class="ws-chip" data-current={c === currentCwd ? "1" : "0"} onClick={() => load(c)}>
            {shortPath(c).split("/").slice(-2).join("/")}
          </button>
        ))}
      </div>

      {err ? <div style={{ font: "400 11px/1.5 var(--mono)", color: "var(--tomato)" }}>{err}</div> : null}

      {(data?.dirs ?? []).slice(0, 8).map((d) => (
        <PickRow key={d.path} icon="fld-path" name={d.name} meta={d.items != null ? `${d.items} items` : ""} onClick={() => load(d.path)} />
      ))}

      <div class="ws-path">
        {shortPath(chosen)}
        <span>{chosen === currentCwd ? "· same as the current session" : "· this becomes the session workspace"}</span>
      </div>
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

/* ------------------------------------------------------------------ mcp */
function McpPanel() {
  const [data, setData] = useState<McpConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showTools, setShowTools] = useState<Record<string, boolean>>({});
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectNote, setConnectNote] = useState<string | null>(null);

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

  const totals = data?.totals;

  return (
    <div class="pv">
      <div class="pv-title">
        {totals?.connected ?? 0} CONNECTED / {totals?.servers ?? 0} SERVERS · {totals?.tools ?? 0} TOOLS
      </div>
      <div class="pv-sub">
        Status is read from the live session: a server counts as connected when its
        <code> mcp__&lt;name&gt;__&lt;tool&gt;</code> tools actually exist. Config edits take effect on the next session.
      </div>

      {err ? (
        <div class="errbar" style={{ margin: "0 0 8px" }}>
          <Icon name="status-fail" size={13} /> {err}
        </div>
      ) : null}

      {data && !data.bound ? (
        <div class="mcp-connect">
          <div class="cc-txt">
            <b>MCP NOT CONNECTED.</b> {data.servers.length} servers configured, 0 tools loaded.
            Connecting binds them into this session — that is what costs a few seconds at startup,
            so it is your call.
          </div>
          <BarButton
            tone="ok"
            label={connecting ? "CONNECTING…" : "CONNECT"}
            icon="act-reload"
            disabled={connecting}
            onClick={async () => {
              setConnecting(true);
              setConnectNote(null);
              try {
                const r = await api.mcpConnect();
                setData(r);
                setConnectNote(
                  r.pending
                    ? `connected ${r.totals.connected}/${r.totals.servers} in ${r.connectMs}ms — the rest reported no tools`
                    : `${r.totals.connected} servers · ${r.totals.tools} tools in ${r.connectMs}ms`,
                );
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setConnecting(false);
              }
            }}
          />
          {connecting ? <span class="cc-wait">this can take a few seconds (stdio servers spawn a process)</span> : null}
        </div>
      ) : null}

      {connectNote ? <div class="pv-note" style={{ color: "var(--cyan)", marginBottom: "8px" }}>{connectNote}</div> : null}

      {(data?.servers ?? []).map((m) => {
        const expanded = open === m.name;
        const allTools = showTools[m.name];
        const tools = allTools ? m.tools : m.tools.slice(0, 6);
        return (
          <div class="mcp-card" key={m.name} data-off={m.enabled ? "0" : "1"} data-live={m.connected ? "1" : "0"}>
            <div class="mcp-head">
              <span class="st" />
              <button type="button" class="mcp-name" onClick={() => setOpen(expanded ? null : m.name)}>
                <Icon name={expanded ? "act-collapse" : "act-expand"} size={10} />
                <b>{m.name}</b>
              </button>
              <span class="tr">{m.transport === "stdio" ? "STDIO" : "HTTP"}</span>
              <span class="ex">{m.exposure}</span>
              <span class="ct">{m.toolCount} TOOLS</span>
              <span class="state">{m.connected ? "LIVE" : m.enabled ? "NO TOOLS" : "OFF"}</span>
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
                <Icon name="act-delete" size={11} />
              </button>
            </div>

            <div class="mcp-target">{m.transport === "stdio" ? `${m.command} ${m.args.join(" ")}` : m.url}</div>
            {m.description ? <div class={`mcp-desc ${expanded ? "open" : ""}`}>{m.description}</div> : null}

            {expanded ? (
              <div class="mcp-tools">
                {tools.length === 0 ? <div class="pv-note">no tools registered — check the server is reachable</div> : null}
                {tools.map((t) => (
                  <div class="mcp-tool" key={t.name}>
                    <span class="nm">{t.name}</span>
                    <span class="bd">{t.exposure}</span>
                    <span class="ds" title={t.description}>{t.description || "—"}</span>
                  </div>
                ))}
                {m.tools.length > 6 ? (
                  <button type="button" class="pv-more" onClick={() => setShowTools((s) => ({ ...s, [m.name]: !allTools }))}>
                    {allTools ? "− SHOW LESS" : `+ ${m.tools.length - 6} MORE TOOLS`}
                  </button>
                ) : null}
                <div class="pv-note">
                  {m.scope} config{m.override ? ` · overridden in ${shortPath(m.override)}` : ""} · {m.pinned.length ? `${m.pinned.length} pinned to direct` : "all deferred to the caller"}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

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
          <span style={{ font: "400 10px/2.4 var(--mono)", color: "var(--g2)" }}>
            read from {shortPath(data?.paths.global ?? "~/.pi/agent/mcp.json")} · writes keep a .bak
          </span>
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
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ id: "", name: "", baseUrl: "", api: "openai-completions", apiKey: "", models: "" });

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
          {p.custom ? <span class="cur custom">CUSTOM</span> : null}
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

            {p.baseUrl ? <div class="pv-note">baseUrl <code>{p.baseUrl}</code></div> : null}
            {p.custom ? (
              <div style={{ display: "flex", gap: "var(--gap)", marginTop: "4px" }}>
                <button
                  type="button"
                  class="pv-btn ghost"
                  onClick={async () => {
                    try {
                      await api.providerRemove(p.id);
                      await api.providerReload();
                      await load();
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  REMOVE PROVIDER
                </button>
                <span class="pv-note" style={{ alignSelf: "center" }}>defined in models.json</span>
              </div>
            ) : null}
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

      <div class="pv-title" style={{ fontSize: "13px", marginTop: "18px" }}>ADD CUSTOM PROVIDER</div>
      <div class="pv-sub" style={{ marginBottom: "8px", maxWidth: "760px" }}>
        Any OpenAI-, Anthropic- or Google-compatible endpoint can be added by base URL. Models are just ids — pi learns
        capabilities when it first calls them. Setting only <code>baseUrl</code> for an id that already exists routes that
        built-in provider through a proxy.
      </div>
      {!adding ? (
        <BarButton tone="ok" label="NEW PROVIDER" icon="act-new" onClick={() => setAdding(true)} />
      ) : (
        <div class="pv-form">
          <FieldRow label="ID" icon="station-provider" value={draft.id} placeholder="local-proxy" onInput={(v) => setDraft({ ...draft, id: v })} required />
          <FieldRow label="NAME" icon="station-provider" value={draft.name} placeholder="Local Proxy" onInput={(v) => setDraft({ ...draft, name: v })} />
          <FieldRow
            label="BASE URL"
            icon="fld-url"
            value={draft.baseUrl}
            placeholder="http://127.0.0.1:11434/v1"
            onInput={(v) => setDraft({ ...draft, baseUrl: v })}
            required
            unit="V1"
          />
          <div class="pv-form-row">
            <span class="lb">API</span>
            {[
              ["openai-completions", "CHAT"],
              ["openai-responses", "RESPONSES"],
              ["anthropic-messages", "ANTHROPIC"],
              ["google-generative-ai", "GOOGLE"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                class="pv-btn"
                title={value}
                data-on={draft.api === value ? "1" : "0"}
                onClick={() => setDraft({ ...draft, api: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <FieldRow label="API KEY" icon="fld-key" value={draft.apiKey} placeholder="sk-… or $ENV_VAR" onInput={(v) => setDraft({ ...draft, apiKey: v })} mask />
          <FieldRow
            label="MODELS"
            icon="fld-model"
            value={draft.models}
            placeholder="qwen2.5-coder:7b, llama-3.3-70b"
            onInput={(v) => setDraft({ ...draft, models: v })}
          />
          <div style={{ display: "flex", gap: "var(--gap)", alignItems: "center" }}>
            <BarButton
              tone="ok"
              label="ADD"
              icon="act-new"
              disabled={busy === "add" || !draft.id || !draft.baseUrl}
              onClick={async () => {
                setBusy("add");
                try {
                  await api.providerAdd(draft);
                  const r = await api.providerReload();
                  await load();
                  setAdding(false);
                  setDraft({ id: "", name: "", baseUrl: "", api: "openai-completions", apiKey: "", models: "" });
                  setErr(r.reloaded ? null : "saved, but the runtime did not reload — restart the session");
                } catch (e) {
                  setErr((e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            />
            <BarButton tone="quiet" label="CANCEL" icon="act-close" onClick={() => setAdding(false)} />
            <span class="pv-note">writes models.json with a .bak, then reloads the model runtime</span>
          </div>
        </div>
      )}

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
const SHORTCUTS: [string, string][] = [
  ["⌘K / Ctrl K", "focus the composer"],
  ["ENTER", "send (steer while running)"],
  ["SHIFT+ENTER", "newline"],
  ["ESC", "stop the current run"],
  ["⌘B / Ctrl B", "collapse or expand the left rail"],
  ["⌘⇧B / Ctrl ⇧B", "collapse or expand the resources rail"],
];

function SettingsPanel({
  items,
  meta,
  policy,
  theme,
  onTheme,
}: {
  items: Item[];
  meta: ReturnType<typeof getState>["meta"];
  policy: string;
  theme: ThemeId;
  onTheme: (id: ThemeId) => void;
}) {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, force] = useState(0);
  const prefs = getSettings();

  useEffect(() => subscribeSettings(() => force((n) => n + 1)), []);
  useEffect(() => {
    api.system().then(setSys).catch(() => {});
  }, []);

  const flash = (m: string) => {
    setNote(m);
    setTimeout(() => setNote(null), 1400);
  };

  const row = (k: string, v: string, acts?: any) => (
    <div class="set-row" key={k}>
      <span class="k">{k}</span>
      <span class="v" title={v}>
        {v}
      </span>
      <span class="a">{acts}</span>
    </div>
  );

  const copy = (text: string, label: string) =>
    navigator.clipboard?.writeText(text).then(
      () => flash(`copied ${label}`),
      () => flash("clipboard blocked"),
    );

  return (
    <div class="pv">
      <div class="pv-title">{t("set.title")}</div>
      <div class="pv-sub">{t("set.note")}</div>

      <div class="set-section">{t("set.appearance")}</div>

      <div class="set-block">
        <span class="lb">{t("set.theme")}</span>
        <div class="set-themes">
          {THEMES.map((th) => (
            <button
              type="button"
              key={th.id}
              class="theme-opt mini"
              aria-selected={theme === th.id ? "true" : "false"}
              onClick={() => onTheme(th.id)}
            >
              <span class="sw">
                {th.swatch.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <span class="nm">{th.short}</span>
            </button>
          ))}
        </div>
      </div>

      <div class="set-block">
        <span class="lb">{t("set.scale")}</span>
        <div class="seg small">
          {([0.9, 1, 1.1] as const).map((v) => (
            <button type="button" key={v} aria-pressed={prefs.scale === v ? "true" : "false"} onClick={() => setSettings({ scale: v })}>
              {Math.round(v * 100)}%
            </button>
          ))}
        </div>
      </div>

      <div class="set-block">
        <span class="lb">{t("set.motion")}</span>
        <div class="seg small">
          <button type="button" aria-pressed={prefs.motion === "system" ? "true" : "false"} onClick={() => setSettings({ motion: "system" })}>
            SYSTEM
          </button>
          <button type="button" aria-pressed={prefs.motion === "reduced" ? "true" : "false"} onClick={() => setSettings({ motion: "reduced" })}>
            REDUCED
          </button>
        </div>
      </div>

      <div class="set-block">
        <span class="lb">{t("set.locale")}</span>
        <div class="seg small">
          <button type="button" aria-pressed={prefs.locale === "en" ? "true" : "false"} onClick={() => setSettings({ locale: "en" })}>
            EN
          </button>
          <button type="button" aria-pressed={prefs.locale === "zh" ? "true" : "false"} onClick={() => setSettings({ locale: "zh" })}>
            中文
          </button>
        </div>
      </div>

      <div class="set-section">{t("set.runtime")}</div>
      {row(
        "PI SDK",
        sys?.sdk ? shortPath(sys.sdk) : "—",
        <>
          <button type="button" class="pv-btn ghost" onClick={() => sys?.sdk && copy(sys.sdk, "sdk path")}>COPY</button>
          <button type="button" class="pv-btn ghost" onClick={() => sys?.sdk && api.openPath(sys.sdk, "reveal").catch(() => {})}>REVEAL</button>
        </>,
      )}
      {row("VERSION", `${sys?.piVersion ?? "—"} · node ${sys?.node ?? "—"}`)}
      {row("PLATFORM", sys?.platform ?? "—")}
      {row(
        "AGENT DIR",
        sys?.agentDir ? shortPath(sys.agentDir) : "—",
        <>
          <button type="button" class="pv-btn ghost" onClick={() => sys?.agentDir && copy(sys.agentDir, "agent dir")}>COPY</button>
          <button type="button" class="pv-btn ghost" onClick={() => sys?.agentDir && api.openPath(sys.agentDir, "reveal").catch(() => {})}>REVEAL</button>
        </>,
      )}
      {row("WORKSPACE", sys?.cwd ? shortPath(sys.cwd) : "—")}
      {row("SERVER", `127.0.0.1:${sys?.port ?? "—"} · MCP ${sys?.mcpEnabled ? "on" : "off"}`)}

      <div class="set-section">{t("set.keys")}</div>
      <div class="set-keys">
        {SHORTCUTS.map(([k, d]) => (
          <div class="set-key" key={k}>
            <kbd>{k}</kbd>
            <span>{d}</span>
          </div>
        ))}
      </div>

      <div class="set-section">{t("set.policy")}</div>
      <div style={{ display: "flex", gap: "var(--gap)", alignItems: "center", marginBottom: "10px" }}>
        {(["off", "risky", "all"] as const).map((m) => (
          <BarButton key={m} label={m.toUpperCase()} tone={policy === m ? "ok" : "quiet"} onClick={() => actions.policy(m)} />
        ))}
        <span class="pv-note">risky = bash / write / edit · pending calls are released on abort</span>
      </div>

      <div class="set-section">{t("set.tools")} / {meta?.tools.length ?? 0}</div>
      <div class="set-tools">
        {(meta?.tools ?? []).map((n) => (
          <span class="set-tool" key={n}>{n}</span>
        ))}
      </div>

      {note ? <div class="ft-note" style={{ marginTop: "10px" }}>{note}</div> : null}
    </div>
  );
}

