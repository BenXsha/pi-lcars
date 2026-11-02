import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { BackdropDir, BackdropImage, DiffData, DirEntry, HistoryResult, TreeRow, Item, ImageAttachment, McpConfig, Meta, ModelInfo, ProviderRow, ProvidersResult, SkillsResult, SystemInfo } from "../api";
import { api } from "../api";
import { actions, connect, getState, subscribe } from "../store";
import { THEMES, appliedTheme, applyTheme, type ThemeId } from "../theme";
import { getSettings, setSettings, subscribeSettings, touchBackdrop } from "../settings";
import { t } from "../i18n";
import { Icon, type IconName } from "../components/Icon";
import { Logo } from "../components/Logo";
import { FileTree } from "../components/FileTree";
import { FileViewer } from "../components/FileViewer";
import { AboutPanel } from "./About";
import { Markdown } from "../components/Markdown";
import { askComposer, askDeck, onComposerRequest, onDeckRequest } from "../composer";
import { clearDraft, loadDraft, loadHistory, pushHistory, saveDraft } from "../drafts";
import { QUICK_SLOTS, loadQuick, newQuick, onQuickChange, resetQuick, saveQuick, type QuickPrompt } from "../quick";
import {
  ApprovalDeck,
  BarButton,
  ControlChip,
  Deck,
  FieldArea,
  FieldRow,
  MessageRow,
  Meter,
  fmtSize,
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
type View = "session" | "mcp" | "skills" | "providers" | "history" | "system" | "about";

/** Stations are hash-addressable so a link can open e.g. #about. */
const VIEWS: View[] = ["session", "mcp", "skills", "providers", "history", "system", "about"];
const viewFromHash = (): View => {
  const hash = typeof location === "undefined" ? "" : location.hash.replace(/^#/, "");
  return (VIEWS as string[]).includes(hash) ? (hash as View) : "session";
};

const NAV: { view: View; key: TKey2; icon: IconName; tone: "amber" | "lav" | "moon" | "ice" | "cyan" }[] = [
  { view: "mcp", key: "nav.mcp", icon: "station-mcp", tone: "lav" },
  { view: "skills", key: "nav.skills", icon: "station-skills", tone: "ice" },
  { view: "providers", key: "nav.providers", icon: "station-provider", tone: "cyan" },
  { view: "history", key: "nav.history", icon: "station-history", tone: "amber" },
  { view: "system", key: "nav.settings", icon: "station-system", tone: "moon" },
  { view: "about", key: "nav.about", icon: "station-about", tone: "ice" },
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
const shortPath = (p: string) =>
  p.replace(/^\/(?:Users|home)\/[^/]+/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/i, "~");
const fmtBytes = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
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
  const [view, setView] = useState<View>(viewFromHash);
  const [deck, setDeck] = useState<null | "new" | "model" | "think" | "quick">(null);
  const [sideMode, setSideMode] = useState<"sessions" | "files">("sessions");
  const [previewCwd, setPreviewCwd] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ path: string; diff?: DiffData } | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  // the three-zone workspace is a second view of the same stream (#stream deep-links it)
  const [wsOpen, setWsOpen] = useState(() => (typeof location === "undefined" ? false : location.hash === "#stream"));
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // stream following: pinned to the bottom unless the reader scrolled up
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [unseen, setUnseen] = useState(0);
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
  useEffect(() => onDeckRequest((d) => setDeck(d)), []);

  // keep the hash in step with the station (replace, so Back stays useful)
  useEffect(() => {
    const want = view === "session" ? (wsOpen ? "#stream" : "") : `#${view}`;
    if (location.hash === want) return;
    history.replaceState(null, "", want ? `${location.pathname}${want}` : location.pathname);
  }, [view, wsOpen]);
  useEffect(() => {
    const onHash = () => {
      setWsOpen(location.hash === "#stream");
      setView(viewFromHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ---- follow the stream ------------------------------------------------
  const pinToBottom = (el: HTMLElement) => {
    el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      const near = gap < 48;
      if (near === followRef.current) return;
      followRef.current = near;
      setFollowing(near);
      if (near) setUnseen(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [view]);

  // content grows without a scroll event: streaming text, tweened expansion
  useEffect(() => {
    const el = scrollRef.current;
    const inner = el?.firstElementChild;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (followRef.current) pinToBottom(el);
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [view, s.activeId]);

  // a new item either keeps the tail in view or counts for the jump bar
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (followRef.current) requestAnimationFrame(() => pinToBottom(el));
    else if (view === "session") setUnseen((n) => n + 1);
  }, [s.items.length, view]);

  // switching sessions always starts at the newest message
  useEffect(() => {
    followRef.current = true;
    setFollowing(true);
    setUnseen(0);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) pinToBottom(el);
    });
  }, [s.activeId]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (el) pinToBottom(el);
    followRef.current = true;
    setFollowing(true);
    setUnseen(0);
  };

  // Escape dismisses whatever is layered over the transcript: view deck, then tree, then workspace.
  useEffect(() => {
    if (!deck && !treeOpen && !wsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || imeBusy(e)) return;
      e.preventDefault();
      if (deck) setDeck(null);
      else if (treeOpen) setTreeOpen(false);
      else setWsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck, treeOpen, wsOpen]);

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

  // ⌥1–⌥6 (Alt+digit) jump to a station, ⌥0 returns to the mission log.
  // Plain digits stay free for typing, and the combos are not browser- or
  // OS-reserved (⌘1–⌘9 are tabs, ⌘⇧3 is a screenshot). e.code is used because
  // Option+digit yields "¡"-style keys on macOS.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code ?? "");
      if (!m) return;
      const n = Number(m[1]);
      if (n === 0) {
        e.preventDefault();
        setView("session");
        return;
      }
      if (n >= 1 && n <= NAV.length) {
        e.preventDefault();
        setView(NAV[n - 1].view);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  const onViewSession = () => setView("session");
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
        {deck === "quick" ? <QuickDeck onClose={() => setDeck(null)} /> : null}


        <div class="body">
          <main class="center">
            <div class="center-head">
              {/* keyed on the view so the head drops in (90ms wipe-down) each time
                  the station changes; the body below keeps its 2-frame swap */}
              <div class="ttl" key={view}>
                <h1>{view === "session" ? titleOf(active, meta) : view.toUpperCase()}</h1>
                <p>{view === "session" ? subtitleOf(meta, s.items, s.queue.waiting.length) : subtitleFor(view)}</p>
              </div>
              <div class="chips">
                {s.link !== "open" ? (
                  <span class="badge tomato" data-scan={s.link === "down" ? undefined : "1"}>
                    {s.link === "down" ? "LINK DOWN" : "LINKING"}
                  </span>
                ) : null}
                {meta?.pending ? <span class="badge tomato">{meta.pending} HELD</span> : null}
                {s.queue.waiting.length ? (
                  <span class="badge moon">{s.queue.waiting.length} QUEUED</span>
                ) : (
                  <span class={`badge ${meta?.running ? "moon" : "dim"}`}>{meta?.running ? "RUNNING" : "IDLE"}</span>
                )}
                <span class="badge ice">{countTools(s.items)} CALLS</span>
                {view === "session" ? (
                  /* A mode, not an action: both positions stay on screen and the
                     current one is filled. A single badge whose label flips reads
                     as "go to log" — the wrong promise for a two-state view. */
                  <div class="vsw" role="group" aria-label={t("ws.mode")}>
                    <span class="k">{t("ws.mode")}</span>
                    <button
                      type="button"
                      class="vsw-b"
                      aria-pressed={wsOpen ? "false" : "true"}
                      onClick={() => {
                        setWsOpen(false);
                        setTreeOpen(false);
                      }}
                      title={t("ws.close")}
                    >
                      LOG
                    </button>
                    <button
                      type="button"
                      class="vsw-b"
                      aria-pressed={wsOpen ? "true" : "false"}
                      onClick={() => {
                        setWsOpen(true);
                        setTreeOpen(false);
                      }}
                      title={t("ws.open")}
                    >
                      STREAM
                    </button>
                  </div>
                ) : null}
                {view === "session" ? (
                  /* A toggle, not an opener: the button carries the state and the
                     second click closes. The panel's own CLOSE stays as a
                     secondary way out, never the only one. */
                  <button
                    type="button"
                    class="badge dim"
                    data-on={treeOpen ? "1" : "0"}
                    aria-pressed={treeOpen ? "true" : "false"}
                    onClick={() => {
                      setTreeOpen((open) => !open);
                      setWsOpen(false);
                    }}
                    title={treeOpen ? t("tree.close") : t("tree.open")}
                  >
                    TREE
                  </button>
                ) : null}
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
            ) : treeOpen ? (
              <TreePanel
                onClose={() => setTreeOpen(false)}
                onSwitch={() => {
                  setTreeOpen(false);
                  setActiveTurn(null);
                }}
              />
            ) : wsOpen && view === "session" ? (
              <Workspace items={s.items} onOpenDiff={(p, d) => setViewer({ path: p, diff: d })} />
            ) : (
            <div class="scroll" id="scroll" ref={scrollRef}>
              <div key={view} class={view === "session" ? "sess-body" : "anim-swap"}>
              {view === "session" ? (
                <Transcript
                  items={s.items}
                  meta={meta}
                  link={s.link}
                  onOpenDiff={(p, d) => setViewer({ path: p, diff: d })}
                  onRecall={async (turn, text, _itemId) => {
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
              ) : view === "history" ? (
                <HistoryPanel
                  onOpen={async (path) => {
                    await actions.openPath(path);
                    onViewSession();
                  }}
                  onFork={async (path) => {
                    await actions.forkPath(path);
                    onViewSession();
                  }}
                />
              ) : view === "skills" ? (
                <SkillsPanel meta={meta} policy={s.policy} />
              ) : view === "about" ? (
                <AboutPanel />
              ) : (
                <SettingsPanel items={s.items} meta={meta} policy={s.policy} theme={theme} onTheme={(id) => { applyTheme(id); setTheme(id); }} />
              )}
              </div>
            </div>
            )}

            {view === "session" && !viewer && !treeOpen && !wsOpen && !following ? (
              <button type="button" class="jumpbar" onClick={jumpToLatest} title="Jump to the newest message">
                <span class="ar" aria-hidden="true">
                  ↓
                </span>
                LATEST{unseen ? ` · ${unseen} NEW` : ""}
              </button>
            ) : null}

            <Composer session={s.activeId} running={!!meta?.running} disabled={s.link !== "open"} queue={meta?.queue} />
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
    history: "every transcript on this machine, searchable",
    system: "runtime, policy and tool loadout",
    about: "version, credits, and what this console owes to LCARS",
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
            <b>Agent Console</b>
            <em>based on pi.agent</em>
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
        {NAV.map((n, i) => (
          <Station
            key={n.view}
            num={collapsed ? "" : String(i + 1).padStart(2, "0")}
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

/* -------------------------------------------------------------- summary */
/** Context compaction: the model's own recap of what it kept. */
function SummaryBlock({ item }: { item: Extract<Item, { kind: "summary" }> }) {
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
function SkillBlock({ skill }: { skill: NonNullable<Extract<Item, { kind: "user" }>["skill"]> }) {
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
function AskBlock({ item }: { item: Extract<Item, { kind: "ask" }> }) {
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

const APPROVAL_NOTE: Record<string, Parameters<typeof t>[0]> = {
  off: "sb.polOff",
  risky: "sb.polRisky",
  all: "sb.polAll",
};

function Standby({ meta, link }: { meta: Meta | null; link: "connecting" | "open" | "down" }) {
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
          ] as [string, Parameters<typeof t>[0]][]).map(([key, label]) => (
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

/* ----------------------------------------------------------- transcript */
function Transcript({
  items,
  meta,
  link,
  onOpenDiff,
  onRecall,
}: {
  items: Item[];
  meta: Meta | null;
  link: "connecting" | "open" | "down";
  onOpenDiff?: (path: string, diff: DiffData) => void;
  onRecall?: (turn: number, text: string, itemId: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const t0 = items[0]?.ts ?? Date.now();
  // Items that existed on the first paint are history: they appear at once.
  // Everything appended later keeps its entrance animation for the life of the
  // node (a class that stays put never replays, and streaming deltas can't cut
  // the wipe short).
  const restored = useRef<Set<string> | null>(null);
  if (restored.current === null) restored.current = new Set(items.map((i) => i.id));
  const [animating, setAnimating] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const fresh = items.filter((i) => !restored.current?.has(i.id)).map((i) => i.id);
    if (!fresh.length) return;
    for (const id of fresh) restored.current?.add(id);
    setAnimating((prev) => {
      const next = new Set(prev);
      for (const id of fresh) next.add(id);
      return next;
    });
  }, [items]);

  const endAnimation = (id: string) =>
    setAnimating((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  if (!items.length) return <Standby meta={meta} link={link} />;

  return (
    <div class="log">
      {items.map((it, i) => {
        const prev = items[i - 1];
        const turn = it.kind === "user" || (it.kind === "assistant" && prev && prev.kind !== "assistant");
        const block = it.kind === "user" || it.kind === "assistant" || it.kind === "summary";
        const animate = animating.has(it.id);
        const cls = `blk${turn ? " turn" : ""}${it.kind === "approval" ? " approval-blk" : ""}${
          animate ? (block ? " anim-wipe" : " anim-in") : ""
        }`;

        if (it.kind === "user") {
          return (
            <div class={cls} key={it.id} data-id={it.id} data-turn="1" onAnimationEnd={(e) => e.animationName === "wipe" && endAnimation(it.id)}>
              {it.skill ? <SkillBlock skill={it.skill} /> : null}
              <MessageRow
                role="user"
                time={`T+${mmss(it.ts - t0)}`}
                text={it.text}
                attachments={it.attachments}
                onRecall={onRecall ? () => onRecall(buildTurns(items).find((tn) => tn.id === it.id)?.n ?? 0, it.text, it.id) : undefined}
              />
              {it.steer || it.queued ? (
                <div class="steer-note" data-tone={it.steer ? "steer" : "queued"}>
                  {it.steer ? "STEERED INTO RUN" : "QUEUED"}
                </div>
              ) : null}
            </div>
          );
        }

        if (it.kind === "assistant") {
          return (
            <div class={cls} key={it.id} data-id={it.id} onAnimationEnd={(e) => e.animationName === "wipe" && endAnimation(it.id)}>
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
                exitCode={it.exitCode}
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

        if (it.kind === "summary") {
          return (
            <div class={cls} key={it.id} data-id={it.id} onAnimationEnd={(e) => e.animationName === "wipe" && endAnimation(it.id)}>
              <SummaryBlock item={it} />
            </div>
          );
        }

        if (it.kind === "ask") {
          return (
            <div class={cls} key={it.id} data-id={it.id} onAnimationEnd={(e) => e.animationName === "wipe" && endAnimation(it.id)}>
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

const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const pad2 = (n: number) => String(n).padStart(2, "0");
const firstLine = (text: string) => (text.split("\n").find((l) => l.trim()) ?? "").trim();

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
        {/* The bent arm: the header is the horizontal leg, the body's left edge
            is the vertical one, and this piece carries the concave fillet
            across the 4px seam so the two read as one piece. It lives on the
            header (not in the body) because the body scrolls and would clip it. */}
        <span class="ws-arm" aria-hidden="true">
          <svg width="28" height="18" viewBox="0 0 28 18">
            <path d="M0,0 H28 Q14,0 14,18 H0 Z" />
          </svg>
        </span>
      </header>
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

export function Workspace({ items, onOpenDiff }: { items: Item[]; onOpenDiff?: (path: string, diff: DiffData) => void }) {
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
  const scanning = items.some((it) => it.kind === "assistant" && it.streaming && (it.thinking ?? "").trim());
  const reading = zones.action.find(
    (it): it is Extract<Item, { kind: "tool" }> => it.kind === "tool" && it.status === "run" && RETRIEVAL.has(it.name),
  );
  const tail = zones.thread[zones.thread.length - 1];
  const awaiting = !streaming && running === 0 && tail?.kind === "assistant";

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
        status={scanning ? t("ws.stScan") : zones.thinking.length ? t("ws.stSettled") : t("ws.stIdle")}
        live={scanning}
        empty={t("ws.emptyThinking")}
        focus={focus}
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

function TerminalEntry({
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

/* -------------------------------------------------------------- composer */
const UI_COMMANDS = [
  { name: "/compact", description: "compact the context now", kind: "ui" },
  { name: "/fork", description: "fork this session", kind: "ui" },
  { name: "/new", description: "start a session in a workspace", kind: "ui" },
  { name: "/model", description: "switch the model for the next turn", kind: "ui" },
  { name: "/stop", description: "stop the current run", kind: "ui" },
];

/** Queue payloads have been both counts and texts — never trust the shape. */
function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

const PLAIN_COMPOSER = new URLSearchParams(location.search).has("plain");

const MAX_IMAGES = 6;

/** A pasted or dropped image, still in memory — nothing is uploaded until RUN. */
type Attachment = ImageAttachment & { id: string; name: string; bytes: number };

/** File input → the base64 shape /api/prompt accepts. */
function readImage(file: File): Promise<Attachment | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve(null);
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const url = String(reader.result || "");
      const data = url.slice(url.indexOf(",") + 1);
      if (!data) return resolve(null);
      resolve({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name || "pasted image",
        mimeType: file.type,
        bytes: file.size,
        data,
      });
    };
    reader.readAsDataURL(file);
  });
}

/* An IME owns the keyboard for as long as a candidate window is open: Enter
 * commits the candidate, ArrowUp/Down pick one, Escape dismisses it, and Space
 * is a commit key in most Chinese/Japanese methods. None of those may reach a
 * console shortcut — `composing` covers the browsers that report
 * `isComposing: false` on the committing Enter, and `keyCode 229` covers the
 * engines that never set `isComposing` at all. */
function imeBusy(e: KeyboardEvent, composing?: { current: boolean }): boolean {
  if (composing?.current || e.isComposing) return true;
  return (e as KeyboardEvent & { keyCode?: number }).keyCode === 229;
}

function Composer({
  session,
  running,
  disabled,
  queue,
}: {
  session: string | null;
  running: boolean;
  disabled: boolean;
  queue?: { steering: string[]; followUp: string[] };
}) {
  const plainRef = useRef<HTMLTextAreaElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  /** last height written to the field — writes are skipped when it is unchanged */
  const grownRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const histDraft = useRef("");
  /** true between compositionstart and compositionend — the IME owns `value` */
  const composing = useRef(false);
  const [text, setText] = useState("");
  const [flashQuote, setFlashQuote] = useState(false);
  const [images, setImages] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [cmds, setCmds] = useState<{ name: string; description: string; kind: string; hint?: string }[]>(UI_COMMANDS);
  const [pick, setPick] = useState(0);
  const [caret, setCaret] = useState(0);
  const [files, setFiles] = useState<{ rel: string; base: string; dir: string }[]>([]);
  const [filesBusy, setFilesBusy] = useState(false);
  const [histPick, setHistPick] = useState<number | null>(null);
  // operator macro pad: rebuilt whenever the editor saves
  const [quick, setQuick] = useState<QuickPrompt[]>(loadQuick);
  useEffect(() => onQuickChange(() => setQuick(loadQuick())), []);

  useEffect(() => {
    api
      .commands()
      .then((r) => setCmds([...UI_COMMANDS, ...r.commands]))
      .catch(() => {});
  }, []);

  const slash = text.startsWith("/") && !text.includes(" ") ? text.toLowerCase() : null;
  const matches = slash
    ? cmds.filter((c) => c.name.toLowerCase().startsWith(slash) || c.name.toLowerCase().includes(slash.slice(1))).slice(0, 8)
    : [];

  /** `@token` right before the caret opens the file palette instead. */
  const atMatch = slash ? null : /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  const atQuery = atMatch ? atMatch[1] : null;

  /** Run a console-side command; returns true when it consumed the text. */
  const runUi = (cmd: string) => {
    const name = cmd.trim().toLowerCase();
    if (name === "/compact") return actions.compact(), true;
    if (name === "/fork") return actions.fork(), true;
    if (name === "/stop") return actions.abort(), true;
    if (name === "/new") return askDeck("new"), true;
    if (name === "/model") return askDeck("model"), true;
    return false;
  };

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
  /* The draft and the sent-history belong to the conversation, not the tab:
     switching sessions must not carry text across — and the outgoing draft is
     flushed first, so a switch less than one debounce after a keystroke is safe. */
  const sessionRef = useRef(session);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  useEffect(() => {
    const outgoing = sessionRef.current;
    if (outgoing && outgoing !== session) saveDraft(outgoing, textRef.current);
    sessionRef.current = session;
    setText(loadDraft(session));
    setImages([]);
    setFiles([]);
    setHistPick(null);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const id = setTimeout(() => saveDraft(session, text), 400);
    return () => clearTimeout(id);
  }, [session, text]);

  /* Auto-grow: the field rises with the draft, then scrolls inside its cap.
     Measured on an off-screen mirror, never by collapsing the real box —
     `height:auto` on the textarea made the composer jump 44 → 64 → 44 on every
     keystroke and re-laid out the whole transcript (see .grow-mirror).
     Also called from `input`/`compositionupdate`, because an IME grows the field
     before it commits anything to `text`. */
  const grow = () => {
    const el = ref.current;
    const m = mirrorRef.current;
    if (!el || !m) return;
    const w = el.clientWidth;
    if (!w) return;
    const width = `${w}px`;
    if (m.style.width !== width) m.style.width = width;
    // the trailing newline keeps a final empty line in the count
    m.textContent = `${el.value}\n`;
    const cap = Math.min(240, Math.max(96, Math.round(window.innerHeight * 0.26)));
    const want = Math.min(Math.max(m.scrollHeight, 44), cap);
    if (want === grownRef.current) return;
    grownRef.current = want;
    el.style.height = `${want}px`;
  };

  useEffect(grow, [text]);

  /** A pad appends to the draft (never sends): the operator keeps the last word. */
  const useQuick = (q: QuickPrompt) => {
    setText((prev) => {
      const base = prev.replace(/\s+$/, "");
      return base ? `${base}\n${q.text}` : q.text;
    });
    setHistPick(null);
    requestAnimationFrame(() => {
      const el = ref.current;
      el?.focus();
      if (el) {
        el.setSelectionRange(el.value.length, el.value.length);
        setCaret(el.value.length);
      }
      grow();
    });
  };

  /* File palette: debounced, because a walk per keystroke is wasteful. */
  useEffect(() => {
    setPick(0);
    if (atQuery === null) {
      setFiles([]);
      setFilesBusy(false);
      return;
    }
    let live = true;
    setFilesBusy(true);
    const id = setTimeout(() => {
      api
        .files(atQuery, 12)
        .then((r) => {
          if (live) setFiles(r.files);
        })
        .catch(() => {
          if (live) setFiles([]);
        })
        .finally(() => {
          if (live) setFilesBusy(false);
        });
    }, 120);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [atQuery]);

  /** Swap the `@token` for the picked path; the model reads it with `read`. */
  const pickFile = (rel: string) => {
    const before = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    if (!before) return;
    const start = caret - before[1].length - 1;
    const insert = `\`${rel}\` `;
    const next = text.slice(0, start) + insert + text.slice(caret);
    setText(next);
    setFiles([]);
    setFilesBusy(false);
    requestAnimationFrame(() => {
      const pos = start + insert.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const addFiles = async (list: FileList | File[] | null) => {
    if (!list) return;
    const picked = Array.from(list).filter((f) => f.type.startsWith("image/"));
    const room = MAX_IMAGES - images.length;
    if (!picked.length || room <= 0) return;
    const read = await Promise.all(picked.slice(0, room).map(readImage));
    const ok = read.filter((a): a is Attachment => !!a);
    if (ok.length) setImages((prev) => [...prev, ...ok].slice(0, MAX_IMAGES));
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed && !images.length) return;
    stopVoice();
    if (trimmed && runUi(trimmed)) {
      setText("");
      clearDraft(session);
      return;
    }
    const payload = images.map((im) => ({ data: im.data, mimeType: im.mimeType }));
    setText("");
    setImages([]);
    setFiles([]);
    setHistPick(null);
    clearDraft(session);
    if (trimmed) pushHistory(session, trimmed);
    actions.send(trimmed, payload);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc in front of an IME candidate window dismisses the candidate — it is
      // not an interrupt, and stopping the run on it loses the operator's input
      if (imeBusy(e, composing)) return;
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

  /* ---------------------------------------------------------- dictation
     The browser's own recogniser, feature-detected. Nothing goes through this
     app: the recognition (and its network hop, if the browser has one) belongs
     to the browser, and the transcript lands in the same draft the keys write
     to. Unsupported browsers get a disabled button, never a silent no-op. */
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const speechSupported =
    typeof window !== "undefined" &&
    !!((window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

  const stopVoice = () => {
    recRef.current?.stop?.();
    recRef.current = null;
    setListening(false);
  };

  const toggleVoice = () => {
    if (!speechSupported) return;
    if (listening) return stopVoice();
    const w = window as unknown as Record<string, any>;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    const rec = new SR();
    const base = textRef.current.trim() ? `${textRef.current.trim()} ` : "";
    let final = "";
    rec.lang = getSettings().locale === "zh" ? "zh-CN" : "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setText(base + final + interim);
      requestAnimationFrame(() => {
        grow();
        const el = ref.current;
        if (el) {
          el.setSelectionRange(el.value.length, el.value.length);
          setCaret(el.value.length);
        }
      });
    };
    rec.onerror = () => stopVoice();
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      stopVoice();
    }
  };

  useEffect(() => () => recRef.current?.stop?.(), []);

  const queued = [...textList(queue?.steering), ...textList(queue?.followUp)];

  if (PLAIN_COMPOSER) {
    return (
      <div class="cmdwrap">
        <div class="cmdbar">
          <div class="cmd-field" data-state={disabled ? "off" : "idle"}>
            <div class="cmd-help">
              <span>PLAIN MODE · NO HANDLERS</span>
            </div>
            <label class="inputline">
              <span class="caret" />
              <textarea
                ref={plainRef}
                rows={2}
                defaultValue=""
                disabled={disabled}
                placeholder="uncontrolled textarea — for bisecting the composer"
                onKeyDown={(e) => {
                  if (imeBusy(e)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const value = plainRef.current?.value.trim();
                    if (!value) return;
                    if (plainRef.current) plainRef.current.value = "";
                    actions.send(value);
                  }
                }}
              />
            </label>
          </div>
          <div class="btns">
            <BarButton
              label={running ? t("cmd.steer") : t("cmd.run")}
              hint="ENTER"
              tone="ok"
              disabled={disabled}
              icon="act-send"
              onClick={() => {
                const value = plainRef.current?.value.trim();
                if (!value) return;
                if (plainRef.current) plainRef.current.value = "";
                actions.send(value);
              }}
            />
            <BarButton label={t("cmd.stop")} hint="ESC" tone="stop" disabled={!running} onClick={() => actions.abort()} icon="act-stop" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      class="cmdwrap"
      data-drop={dragging ? "1" : "0"}
      data-flash={flashQuote ? "1" : "0"}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer?.files ?? null);
      }}
    >
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
    {matches.length ? (
      <div class="cpal">
        {matches.map((c, i) => (
          <button
            type="button"
            key={c.name}
            class="cp"
            data-on={i === pick ? "1" : "0"}
            onMouseEnter={() => setPick(i)}
            onClick={() => {
              if (c.hint || c.kind !== "ui") setText(`${c.name} `);
              else {
                setText("");
                runUi(c.name);
              }
            }}
          >
            <span class="cn">{c.name}</span>
            <span class="cd">{c.description || c.kind}</span>
            {c.hint ? <span class="ch">{c.hint}</span> : null}
          </button>
        ))}
      </div>
    ) : null}

    {/* `@` palette: same row language as the command palette, but the pick is a
        path — it lands in the draft as a code span, which pi's read tool owns. */}
    {atQuery !== null ? (
      <div class="cpal" data-kind="file">
        {filesBusy && !files.length ? <span class="cp-empty">{t("cmd.scanning")}</span> : null}
        {!filesBusy && !files.length ? <span class="cp-empty">{t("cmd.noFile")}</span> : null}
        {files.map((f, i) => (
          <button
            type="button"
            key={f.rel}
            class="cp"
            data-on={i === pick ? "1" : "0"}
            title={f.rel}
            onMouseEnter={() => setPick(i)}
            onClick={() => pickFile(f.rel)}
          >
            <span class="cn">{f.base}</span>
            <span class="cd">{f.dir || "."}</span>
            <span class="ch">REF</span>
          </button>
        ))}
      </div>
    ) : null}

    <div class="cmdbar" data-run={running ? "1" : "0"}>
      {/* ENTRY is the input console's control block: label, the two input modes
          (image attach, dictation) and the live mode line. Keeping the buttons
          here means the field needs only one auxiliary row — the chips. */}
      <div class="entry-block">
        <span class="el">{t("cmd.entry")}</span>
        <div class="entry-acts">
          <button
            type="button"
            class="iact"
            title={t("cmd.attach")}
            aria-label={t("cmd.attach")}
            disabled={disabled || images.length >= MAX_IMAGES}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="fld-image" size={12} />
          </button>
          <button
            type="button"
            class="iact"
            data-on={listening ? "1" : "0"}
            title={!speechSupported ? t("cmd.voiceNA") : listening ? t("cmd.voiceStop") : t("cmd.voice")}
            aria-label={listening ? t("cmd.voiceStop") : t("cmd.voice")}
            aria-pressed={listening ? "true" : "false"}
            disabled={disabled || !speechSupported}
            onClick={toggleVoice}
          >
            <Icon name={listening ? "act-mic-off" : "act-mic"} size={12} />
          </button>
        </div>
        <span class="eh" data-live={listening ? "1" : "0"}>
          {images.length
            ? `${images.length}/${MAX_IMAGES} IMG`
            : listening
              ? t("cmd.listening")
              : running
                ? t("cmd.steer")
                : "CTRL K"}
        </span>
      </div>

      <div class="cmd-field" data-state={disabled ? "off" : running ? "live" : "idle"}>
        <div class="cmd-help">
          {/* one row, two tenants: the chips take it over while something is
              attached, so an attachment never costs a second line */}
          {images.length ? (
            <div class="attach-strip">
              {images.map((a) => (
                <span class="achip" key={a.id} title={`${a.name} · ${a.mimeType} · ${fmtSize(a.bytes)}`}>
                  <img src={`data:${a.mimeType};base64,${a.data}`} alt="" />
                  <span class="an">{a.name}</span>
                  <span class="asz">{fmtSize(a.bytes)}</span>
                  <button
                    type="button"
                    class="ax"
                    title={t("cmd.drop")}
                    aria-label={t("cmd.drop")}
                    onClick={() => setImages((prev) => prev.filter((x) => x.id !== a.id))}
                  >
                    <Icon name="act-close" size={10} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span class={`hint${running ? " live" : ""}`}>{running ? t("cmd.live") : t("cmd.send")}</span>
          )}
          <span class="cnt">{chars ? `${chars} CHARS` : "INPUT"}</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const input = e.currentTarget;
            addFiles(input.files);
            input.value = "";
          }}
        />
        <label class="inputline" data-focused={focused ? "1" : "0"}>
          <span class="caret" />
          {/* autosize probe — see .grow-mirror in the stylesheet */}
          <div class="grow-mirror" ref={mirrorRef} aria-hidden="true" />
          <textarea
            ref={ref}
            rows={2}
            placeholder={running ? t("cmd.placeholderLive") : t("cmd.placeholder")}
            value={text}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              // an IME that never sent compositionend (blur cancels it) must not
              // leave the composer thinking a candidate window is still open
              composing.current = false;
              setFocused(false);
            }}
            /* An IME (fcitx5/ibus) owns the text between compositionstart and
               compositionend. The field stays *controlled*, so `value` has to
               track the DOM exactly: Preact re-applies the prop whenever it
               differs from `dom.value` (diff/index.js), which is precisely what
               eats a half-composed candidate. Mirroring every input keeps the
               two equal, so nothing is ever written back over the IME. */
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionUpdate={grow}
            onCompositionEnd={(e) => {
              composing.current = false;
              const el = e.target as HTMLTextAreaElement;
              grow();
              setText(el.value);
              setCaret(el.selectionStart ?? 0);
            }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              // grow before the commit too: composing text already occupies rows
              grow();
              setText(el.value);
              setCaret(el.selectionStart ?? 0);
              setHistPick(null);
            }}
            onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onPaste={(e) => {
              const picks = Array.from(e.clipboardData?.items ?? [])
                .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
                .map((i) => i.getAsFile())
                .filter((f): f is File => !!f);
              // plain text keeps the browser's own paste path
              if (!picks.length) return;
              e.preventDefault();
              addFiles(picks);
            }}
            onKeyDown={(e) => {
              // while a candidate window is open every key belongs to the IME:
              // Enter commits, arrows/space pick, Esc dismisses. Swallow nothing,
              // act on nothing — sending a half-composed prompt is the bug.
              if (imeBusy(e, composing)) return;
              if (files.length && atQuery !== null) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setPick((p) => (p + 1) % files.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setPick((p) => (p - 1 + files.length) % files.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  const f = files[Math.min(pick, files.length - 1)];
                  if (f) pickFile(f.rel);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setFiles([]);
                  return;
                }
              }
              if (matches.length) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setPick((p) => (p + 1) % matches.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setPick((p) => (p - 1 + matches.length) % matches.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  const cmd = matches[Math.min(pick, matches.length - 1)];
                  e.preventDefault();
                  if (cmd && (cmd.hint || cmd.kind !== "ui")) {
                    setText(`${cmd.name} `);
                    setPick(0);
                    return;
                  }
                  if (cmd) setText(cmd.name);
                  if (cmd) runUi(cmd.name);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setText("");
                  return;
                }
              }
              /* Sent-history walk: only from the very start of the draft, so
                 ArrowUp still moves between lines of a paragraph. */
              const atStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
              if (e.key === "ArrowUp" && (histPick !== null || atStart)) {
                const hist = loadHistory(session);
                if (!hist.length) return;
                e.preventDefault();
                if (histPick === null) {
                  histDraft.current = text;
                  setHistPick(hist.length - 1);
                  setText(hist[hist.length - 1]);
                } else if (histPick > 0) {
                  setHistPick(histPick - 1);
                  setText(hist[histPick - 1]);
                }
                return;
              }
              if (e.key === "ArrowDown" && histPick !== null) {
                e.preventDefault();
                const hist = loadHistory(session);
                if (histPick < hist.length - 1) {
                  setHistPick(histPick + 1);
                  setText(hist[histPick + 1]);
                } else {
                  setHistPick(null);
                  setText(histDraft.current);
                }
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>
      </div>

      <div class="cmd-aux">
        <div class="aux-primary">
          <BarButton label={running ? t("cmd.steer") : t("cmd.run")} hint="ENTER" tone="ok" disabled={disabled} onClick={submit} icon="act-send" />
          <BarButton label={t("cmd.stop")} hint="ESC" tone="stop" disabled={!running} onClick={() => actions.abort()} icon="act-stop" />
        </div>
        {/* quick prompts: a 3x2 pad matrix, corner key last. A pad appends its
            text to the draft instead of sending — the operator still owns RUN. */}
        <div class="aux-matrix" role="group" aria-label={t("qp.title")}>
          {quick.map((q) => (
            <button type="button" class="qp" key={q.id} title={q.text} onClick={() => useQuick(q)}>
              <span class="lb">{q.label}</span>
            </button>
          ))}
          <button
            type="button"
            class="qp is-edit"
            title={t("qp.edit")}
            aria-label={t("qp.edit")}
            onClick={() => askDeck("quick")}
          >
            <Icon name="act-new" size={11} />
            <span class="lb">{t("qp.editKey")}</span>
          </button>
        </div>
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
        {/* The SDK reports one total per request, not a system/tools/history
            split — so the meter shows exactly the two numbers we have. */}
        <Meter segments={[{ tone: "hist", pct: Math.max(1, pct) }, { pct: Math.max(1, 100 - pct) }]} />
        <div class="legend">
          <span><i style={{ background: "var(--orange)" }} />USED</span>
          <span><i style={{ background: "var(--g1)" }} />FREE</span>
        </div>
        <span class="rnote">system / tools breakdown is not reported by the SDK</span>
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

  const groups = useMemo(() => {
    const byProvider = new Map<string, ModelInfo[]>();
    for (const m of models) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return [...byProvider.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [models]);

  const meta = (m: ModelInfo) => {
    const bits = [m.contextWindow ? fmtTok(m.contextWindow) : null];
    if (m.cost && (m.cost.input || m.cost.output)) bits.push(`$${m.cost.input}/$${m.cost.output} Mtok`);
    if (m.reasoning) bits.push("reasoning");
    return bits.filter(Boolean).join(" · ") || m.provider;
  };

  return (
    <Deck label="MODEL" sub={`${models.length} AVAILABLE · TAKES EFFECT NEXT TURN`}>
      {err ? <div style={{ font: "400 11px/1.5 var(--mono)", color: "var(--tomato)" }}>{err}</div> : null}
      <div class="deck-list">
        {groups.map(([provider, list]) => (
          <div key={provider}>
            <div class="deck-grp">{provider}</div>
            {list.map((m) => (
              <PickRow
                key={`${m.provider}/${m.id}`}
                icon="fld-model"
                name={m.id}
                meta={meta(m)}
                selected={m.id === current}
                onClick={async () => {
                  await actions.setModel(m.provider, m.id);
                  onClose();
                }}
              />
            ))}
          </div>
        ))}
        {groups.length === 0 && !err ? <div class="deck-empty">no model with valid credentials</div> : null}
      </div>
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

/**
 * The quick-prompt editor. Same language as every other console form: a numbered
 * strip per row, label on the left, the sentence in mono, delete at the end.
 * Rows are edited in place and only written when SAVE runs — a half-typed row
 * never lands on the pad.
 */
function QuickDeck({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<QuickPrompt[]>(loadQuick);
  const patch = (id: string, next: Partial<QuickPrompt>) =>
    setRows((r) => r.map((q) => (q.id === id ? { ...q, ...next } : q)));

  return (
    <Deck
      label={t("qp.title")}
      sub={`${rows.length}/${QUICK_SLOTS} · ${t("qp.sub")}`}
      actions={
        <>
          <BarButton tone="quiet" label={t("qp.reset")} icon="act-reload" onClick={() => setRows(resetQuick())} />
          <BarButton
            tone="ok"
            label={t("qp.save")}
            icon="status-ok"
            onClick={() => {
              saveQuick(rows);
              onClose();
            }}
          />
        </>
      }
    >
      <div class="qp-rows">
        {rows.map((q, i) => (
          <div class="qp-row" key={q.id} data-bad={q.text.trim() ? "0" : "1"}>
            <span class="n">{String(i + 1).padStart(2, "0")}</span>
            <input
              class="kl"
              value={q.label}
              maxLength={12}
              placeholder={t("qp.label")}
              aria-label={t("qp.label")}
              onInput={(e) => patch(q.id, { label: (e.target as HTMLInputElement).value })}
            />
            <input
              class="tx"
              value={q.text}
              placeholder={t("qp.text")}
              aria-label={t("qp.text")}
              onInput={(e) => patch(q.id, { text: (e.target as HTMLInputElement).value })}
            />
            <button
              type="button"
              class="del"
              title={t("qp.del")}
              aria-label={t("qp.del")}
              onClick={() => setRows((r) => r.filter((x) => x.id !== q.id))}
            >
              <Icon name="act-delete" size={11} />
            </button>
          </div>
        ))}
        {rows.length < QUICK_SLOTS ? (
          <button type="button" class="qp-add" onClick={() => setRows((r) => [...r, newQuick()])}>
            <Icon name="act-new" size={11} /> {t("qp.add")}
          </button>
        ) : null}
      </div>
      <div class="qp-note">{t("qp.note")}</div>
    </Deck>
  );
}

/* ------------------------------------------------------------------ mcp */
const MCP_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,40}$/i;

const EMPTY_MCP_DRAFT = {
  name: "",
  transport: "auto" as "auto" | "stdio" | "http",
  command: "",
  args: "",
  url: "",
  headers: "",
  env: "",
  dir: "",
  timeout: "",
  description: "",
  exposure: "codemode",
  scope: "global",
};

const EXPOSURE_HINT: Record<string, string> = {
  codemode: "callable from codemode scripts; not declared to the model (default)",
  "codemode-deferred": "alias of codemode",
  deferred: "declared after tool_search loads a match",
  direct: "declared like a built-in tool",
  hidden: "registered but unreachable",
};

/** `[label][choice buttons]` — the same row language as the provider API picker. */
function ChoiceRow(props: { label: string; value: string; options: [string, string][]; onPick: (v: string) => void }) {
  return (
    <div class="pv-form-row">
      <span class="lb">{props.label}</span>
      {props.options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          class="pv-btn"
          data-on={props.value === value ? "1" : "0"}
          onClick={() => props.onPick(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function McpPanel() {
  const [data, setData] = useState<McpConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showTools, setShowTools] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState(EMPTY_MCP_DRAFT);
  const [addError, setAddError] = useState<string | null>(null);
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

  // "auto" follows whatever was filled first: a URL means http, otherwise stdio
  const transport = draft.transport === "auto" ? (draft.url.trim() ? "http" : "stdio") : draft.transport;
  const isHttp = transport === "http";
  const problem = !MCP_NAME_RE.test(draft.name)
    ? "name: letters, digits, dot, dash, underscore"
    : draft.command.trim() && draft.url.trim()
      ? "fill command (stdio) or url (http), not both"
      : isHttp && !/^https?:\/\//.test(draft.url.trim())
        ? "url: must start with http:// or https://"
        : !isHttp && !draft.command.trim()
          ? "command: required for stdio servers"
          : null;

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

      <div class="pv-h">ADD SERVER</div>
      <div class="pv-form" style={{ maxWidth: "820px" }}>
        <FieldRow
          label="NAME"
          icon="station-mcp"
          value={draft.name}
          placeholder="filesystem"
          onInput={(v) => setDraft({ ...draft, name: v })}
          required
          state={draft.name && !MCP_NAME_RE.test(draft.name) ? "error" : "idle"}
          message={draft.name && !MCP_NAME_RE.test(draft.name) ? "letters, digits, dot, dash, underscore" : undefined}
        />
        <ChoiceRow
          label="TRANSPORT"
          value={draft.transport}
          options={[
            ["auto", "AUTO"],
            ["stdio", "STDIO"],
            ["http", "HTTP"],
          ]}
          onPick={(v) => setDraft({ ...draft, transport: v as typeof draft.transport })}
        />

        {!isHttp ? (
          <>
            <FieldRow
              label="COMMAND"
              icon="tool-bash"
              value={draft.command}
              placeholder="npx"
              onInput={(v) => setDraft({ ...draft, command: v })}
              required
            />
            <FieldArea
              label="ARGS"
              icon="fld-args"
              value={draft.args}
              rows={2}
              placeholder="-y @modelcontextprotocol/server-filesystem ~/projects   (or a JSON array)"
              onInput={(v) => setDraft({ ...draft, args: v })}
            />
            <FieldRow
              label="WORKING DIR"
              icon="fld-path"
              value={draft.dir}
              placeholder="optional · absolute, ~/…, or relative to the session"
              onInput={(v) => setDraft({ ...draft, dir: v })}
            />
            <FieldArea
              label="ENV"
              icon="fld-key"
              value={draft.env}
              rows={2}
              placeholder={"GITHUB_TOKEN=${GITHUB_TOKEN}\nAPI_BASE=https://api.example.com"}
              onInput={(v) => setDraft({ ...draft, env: v })}
            />
          </>
        ) : (
          <>
            <FieldRow
              label="URL"
              icon="fld-host"
              value={draft.url}
              placeholder="https://example.com/mcp"
              onInput={(v) => setDraft({ ...draft, url: v })}
              required
            />
            <FieldArea
              label="HEADERS"
              icon="fld-key"
              value={draft.headers}
              rows={2}
              placeholder={"Authorization: Bearer ${DOCS_TOKEN}"}
              onInput={(v) => setDraft({ ...draft, headers: v })}
            />
          </>
        )}

        <FieldRow
          label="TIMEOUT"
          icon="act-time"
          value={draft.timeout}
          placeholder="60"
          unit="SEC"
          onInput={(v) => setDraft({ ...draft, timeout: v })}
        />
        <FieldRow
          label="DESCRIPTION"
          icon="act-info"
          value={draft.description}
          placeholder="one sentence — listed in the system prompt"
          onInput={(v) => setDraft({ ...draft, description: v })}
        />
        <ChoiceRow
          label="EXPOSURE"
          value={draft.exposure}
          options={[
            ["codemode", "CODEMODE"],
            ["deferred", "DEFERRED"],
            ["direct", "DIRECT"],
            ["hidden", "HIDDEN"],
          ]}
          onPick={(v) => setDraft({ ...draft, exposure: v })}
        />
        <span class="form-note">{EXPOSURE_HINT[draft.exposure] ?? ""}</span>
        <ChoiceRow
          label="SCOPE"
          value={draft.scope}
          options={[
            ["global", "GLOBAL"],
            ["project", "PROJECT"],
          ]}
          onPick={(v) => setDraft({ ...draft, scope: v })}
        />
        <span class="form-note">
          {draft.scope === "project"
            ? `written to ${shortPath(data?.paths.project ?? ".pi/mcp.json")} — project servers load after project trust`
            : `written to ${shortPath(data?.paths.global ?? "~/.pi/agent/mcp.json")} with a .bak`}
        </span>

        {addError ? (
          <span class="form-note" data-err="1">
            {addError}
          </span>
        ) : null}

        <div class="form-actions">
          <BarButton
            tone="ok"
            label="ADD"
            icon="act-new"
            disabled={busy || Boolean(problem)}
            onClick={() =>
              run(async () => {
                setAddError(null);
                try {
                  await api.mcpAdd({
                    name: draft.name.trim(),
                    command: isHttp ? undefined : draft.command.trim(),
                    args: isHttp ? undefined : draft.args,
                    url: isHttp ? draft.url.trim() : undefined,
                    headers: isHttp ? draft.headers : undefined,
                    env: isHttp ? undefined : draft.env,
                    dir: isHttp ? undefined : draft.dir,
                    timeout: draft.timeout,
                    description: draft.description,
                    exposure: draft.exposure,
                    scope: draft.scope,
                  });
                  setDraft(EMPTY_MCP_DRAFT);
                } catch (e) {
                  setAddError((e as Error).message);
                }
              })
            }
          />
          <BarButton tone="quiet" label="RELOAD" icon="act-reload" onClick={() => load()} />
          <span class="form-note">{problem ?? "args, env and headers accept one entry per line"}</span>
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
                onKeyDown={(e) => !imeBusy(e) && e.key === "Enter" && saveKey(p.id)}
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

      <div class="pv-h">ADD CUSTOM PROVIDER</div>
      <div class="pv-sub" style={{ marginBottom: "8px", maxWidth: "760px" }}>
        Any OpenAI-, Anthropic- or Google-compatible endpoint can be added by base URL. Models are just ids — pi learns
        capabilities when it first calls them. Setting only <code>baseUrl</code> for an id that already exists routes that
        built-in provider through a proxy.
      </div>
      {!adding ? (
        <button type="button" class="add-row" onClick={() => setAdding(true)}>
          <span class="ic">
            <Icon name="act-new" size={13} />
          </span>
          <span class="lb">NEW PROVIDER</span>
          <span class="hint">models.json</span>
        </button>
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
          <div class="form-actions">
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
          </div>
          <span class="form-note">writes models.json with a .bak, then reloads the model runtime</span>
        </div>
      )}

      <div class="pv-note" style={{ marginTop: "12px" }}>
        Session model: <code>{meta?.model ?? "—"}</code> · keys are masked on read and never sent back from the server
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tree */
function TreePanel({ onClose, onSwitch }: { onClose: () => void; onSwitch: () => void }) {
  const [data, setData] = useState<{ count: number; leaf: string | null; nodes: TreeRow[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const load = () =>
    api
      .branchTree()
      .then(setData)
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);

  // keyboard: move the cursor over the flat tree, Enter stages the switch
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      const list = data?.nodes ?? [];
      if (!list.length) return;
      e.preventDefault();
      if (e.key === "Enter") {
        const row = cursor === null ? null : list[cursor];
        if (row && !row.current) {
          setConfirm(row.id);
          setSelected(row.id);
        }
        return;
      }
      const down = e.key === "ArrowDown";
      setCursor((c) => (c === null ? (down ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, c + (down ? 1 : -1)))));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, data]);

  const nodes = data?.nodes ?? [];
  // siblings tell the reader where a branch actually forks
  const siblings = new Map<string, number>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    siblings.set(n.parentId, (siblings.get(n.parentId) ?? 0) + 1);
  }
  const order = new Map<string, number>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    order.set(n.parentId, (order.get(n.parentId) ?? 0) + 1);
  }
  const forks = [...siblings.values()].filter((n) => n > 1).length;
  // Indent only where the graph actually forks. A conversation is a long chain
  // of single children — indenting per message turns the list into a staircase
  // that runs off the panel.
  const siblingList = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = siblingList.get(n.parentId) ?? [];
    list.push(n.id);
    siblingList.set(n.parentId, list);
  }
  const shownDepth = new Map<string, number>();
  for (const n of nodes) {
    if (!n.parentId) {
      shownDepth.set(n.id, 0);
      continue;
    }
    const parentDepth = shownDepth.get(n.parentId) ?? 0;
    const parentForks = (siblings.get(n.parentId) ?? 0) > 1;
    shownDepth.set(n.id, parentDepth + (parentForks ? 1 : 0));
  }
  // chronology: a turn starts at every user message; the row keeps a running
  // sequence number, so time reads from the numbers instead of an indent that
  // used to march right with every message
  let turn = 0;
  const seqOf = new Map<string, number>();
  const turnOf = new Map<string, number>();
  const turnCount = new Map<number, number>();
  nodes.forEach((n, i) => {
    if (n.kind === "user" || turn === 0) turn += 1;
    seqOf.set(n.id, i + 1);
    turnOf.set(n.id, turn);
    turnCount.set(turn, (turnCount.get(turn) ?? 0) + 1);
  });

  const clock = (iso: string, withMs = true) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    const base = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return withMs ? `${base}.${pad(d.getMilliseconds(), 3)}` : base;
  };

  return (
    <div class="tv">
      <div class="fv-hd">
        <span class="st" />
        <span class="nm">branch tree</span>
        <span class="mt">
          {data ? `${nodes.length} ENTRIES · ${forks} FORKS · HEAD ${data.leaf ? `#${data.leaf.slice(-4)}` : "—"}` : "…"}
        </span>
        <button type="button" class="pv-btn ghost" onClick={load}>
          RELOAD
        </button>
        <button type="button" class="pv-btn" onClick={onClose}>
          CLOSE
        </button>
      </div>

      <div class="tv-legend">
        <span class="lg" data-k="user">USER</span>
        <span class="lg" data-k="assistant">ASSISTANT</span>
        <span class="lg" data-k="toolResult">TOOL</span>
        <span class="lg" data-k="compaction">COMPACT</span>
        <span class="lg" data-k="branch_summary">BRANCH</span>
        <span class="hint">switching moves the conversation to that point — the tail is kept on its own branch</span>
      </div>

      {err ? (
        <div class="errbar">
          <Icon name="status-fail" size={13} /> {err}
        </div>
      ) : null}

      <div class="tv-body" role="tree" aria-label="branch tree">
        {data?.count === 0 ? <div class="pv-note">nothing in this session yet</div> : null}
        {nodes.map((n, i) => {
          const total = n.parentId ? siblings.get(n.parentId) ?? 1 : 1;
          const index = n.parentId ? order.get(n.parentId) ?? 1 : 1;
          const t = turnOf.get(n.id) ?? 1;
          const startsTurn = i === 0 || turnOf.get(nodes[i - 1].id) !== t;
          return (
            <>
            {startsTurn ? (
              <div class="tsep" key={`t${n.id}`}>
                <span class="n">T{String(t).padStart(2, "0")}</span>
                <span class="ts" title={clock(n.ts)}>
                  {clock(n.ts, false)}
                </span>
                <span class="ct">{turnCount.get(t) ?? 0} ENTRIES</span>
              </div>
            ) : null}
            <div
              class="tnode"
              key={n.id}
              data-kind={n.kind}
              data-current={n.current ? "1" : "0"}
              data-path={n.isLeafPath ? "1" : "0"}
              data-confirm={confirm === n.id ? "1" : "0"}
              data-selected={selected === n.id ? "1" : "0"}
              data-cursor={cursor !== null && nodes[cursor]?.id === n.id ? "1" : "0"}
              role="treeitem"
              aria-level={(shownDepth.get(n.id) ?? 0) + 1}
              aria-selected={selected === n.id}
              style={{ "--d": `${shownDepth.get(n.id) ?? 0}` } as Record<string, string>}
              onClick={() => setSelected(n.id)}
            >
              <span class="cap">
                <span class="seq">{String(seqOf.get(n.id) ?? 0).padStart(3, "0")}</span>
                <span class="kd">{n.kind === "toolResult" ? "TOOL" : n.kind.toUpperCase()}</span>
              </span>
              <span class="body">
                <span class="lb" title={n.label}>
                  {n.label || "—"}
                </span>
              </span>
              <span class="tl">
                <span class="ts" title={clock(n.ts)}>
                  {clock(n.ts)}
                </span>
                {total > 1 ? (
                  <span class="fork">
                    <button
                      type="button"
                      class="go pg"
                      title="previous version"
                      disabled={index <= 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        const prev = (n.parentId && siblingList.get(n.parentId)?.[index - 2]) || null;
                        if (prev) void actions.goto(prev).then(onSwitch);
                      }}
                    >
                      ‹
                    </button>
                    <span class="ix">
                      {index}/{total}
                    </span>
                    <button
                      type="button"
                      class="go pg"
                      title="next version"
                      disabled={index >= total}
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = (n.parentId && siblingList.get(n.parentId)?.[index]) || null;
                        if (next) void actions.goto(next).then(onSwitch);
                      }}
                    >
                      ›
                    </button>
                  </span>
                ) : null}
                {confirm === n.id ? (
                  <span class="cf">
                    <button
                      type="button"
                      class="go wide"
                      onClick={async () => {
                        setConfirm(null);
                        await actions.goto(n.id);
                        onSwitch();
                      }}
                    >
                      SWITCH
                    </button>
                    <button type="button" class="go" title="cancel" onClick={() => setConfirm(null)}>
                      ×
                    </button>
                  </span>
                ) : n.current ? (
                  <span class="cur">HEAD</span>
                ) : (
                  <button
                    type="button"
                    class="go"
                    title="switch the conversation here"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirm(n.id);
                    }}
                  >
                    GO
                  </button>
                )}
              </span>
            </div>
            </>
          );
        })}
      </div>
    </div>
  );
}


/* --------------------------------------------------------------- history */
function HistoryPanel({ onOpen, onFork }: { onOpen: (path: string) => void; onFork: (path: string) => void }) {
  const [data, setData] = useState<HistoryResult | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [editPath, setEditPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmPath, setConfirmPath] = useState<string | null>(null);

  const load = (query = q, refresh = false) =>
    api
      .history(query, refresh)
      .then((d) => {
        setData(d);
        setErr(d.error);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load("", false);
  }, []);

  // the scan runs in the background; poll until it lands
  useEffect(() => {
    if (!data || data.ready || !data.scanning) return;
    const t = setInterval(() => load(q, false), 1800);
    return () => clearInterval(t);
  }, [data?.ready, data?.scanning, q]);

  const ago = (iso: string) => {
    const d = Date.now() - new Date(iso).getTime();
    if (d < 60_000) return "just now";
    if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
    return `${Math.round(d / 86_400_000)}d ago`;
  };

  const sessions = data?.sessions ?? [];

  return (
    <div class="pv">
      <div class="pv-title">
        HISTORY {data?.matched ? `/ ${data.matched}` : ""}
        {data && !data.ready && data.scanning ? " · SCANNING" : ""}
      </div>
      <div class="pv-sub">
        Every transcript on this machine, newest first. A scan reads all of them, so it runs in the background and this
        list fills in when it lands — {data ? `${data.scanned} indexed` : "…"}.
      </div>

      <div class="hist-search">
        <Icon name="tool-grep" size={12} />
        <input
          value={q}
          placeholder="search titles, contents, paths…"
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setQ(v);
            load(v, false);
          }}
        />
        <button type="button" class="pv-btn" onClick={() => load(q, true)}>
          RESCAN
        </button>
      </div>

      {err ? (
        <div class="errbar" style={{ margin: "0 0 8px" }}>
          <Icon name="status-fail" size={13} /> {err}
        </div>
      ) : null}

      {!data?.ready && data?.scanning ? (
        <div class="hist-scan">
          reading transcripts… {data.progress.total ? `${data.progress.loaded}/${data.progress.total}` : ""}
        </div>
      ) : null}

      {sessions.length === 0 && data?.ready ? <div class="pv-note">nothing matches</div> : null}

      <div class="hist-list">
        {sessions.map((h) => (
          <div class="hrow" key={h.path} data-confirm={confirmPath === h.path ? "1" : "0"}>
            <span class="st" data-fork={h.parent ? "1" : "0"} />
            <div class="hb">
              {editPath === h.path ? (
                <div class="hren">
                  <input
                    value={draft}
                    autoFocus
                    onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (imeBusy(e)) return;
                      if (e.key === "Enter" && draft.trim()) {
                        api.historyOp("rename", { path: h.path, name: draft.trim() }).then(() => {
                          setEditPath(null);
                          load(q, true);
                        });
                      }
                      if (e.key === "Escape") setEditPath(null);
                    }}
                  />
                </div>
              ) : (
                <div class="ht" title={h.title}>
                  {h.title.replace(/\s+/g, " ")}
                </div>
              )}
              <div class="hm">
                {shortPath(h.cwd)} · {h.messages} msgs · {ago(h.modified)}
                {h.parent ? " · forked" : ""}
                {h.name ? ` · ${h.name}` : ""}
              </div>
            </div>
            <div class="ha">
              {confirmPath === h.path ? (
                <>
                  <button
                    type="button"
                    class="pv-btn"
                    style={{ background: "var(--tomato)", color: "#000" }}
                    onClick={() => api.historyOp("delete", { path: h.path }).then(() => {
                      setConfirmPath(null);
                      load(q, true);
                    })}
                  >
                    DELETE
                  </button>
                  <button type="button" class="pv-btn ghost" onClick={() => setConfirmPath(null)}>
                    KEEP
                  </button>
                </>
              ) : (
                <>
                  <button type="button" class="pv-btn" onClick={() => onOpen(h.path)}>
                    OPEN
                  </button>
                  <button type="button" class="pv-btn ghost" onClick={() => onFork(h.path)}>
                    FORK
                  </button>
                  <button
                    type="button"
                    class="pv-btn ghost"
                    onClick={() => {
                      setDraft(h.name ?? "");
                      setEditPath(h.path);
                    }}
                  >
                    RENAME
                  </button>
                  <button type="button" class="pv-btn ghost" onClick={() => setConfirmPath(h.path)}>
                    <Icon name="act-delete" size={10} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
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
  ["⌥1 – ⌥6  /  Alt 1 – Alt 6", "switch station (the numbers on the rail)"],
  ["⌥0  /  Alt 0", "back to the mission log"],
  ["⌘K / Ctrl K", "focus the composer"],
  ["ENTER", "send (steer while running)"],
  ["SHIFT+ENTER", "newline"],
  ["ESC", "stop the current run"],
  ["⌘B / Ctrl B", "collapse or expand the left rail"],
  ["⌘⇧B / Ctrl ⇧B", "collapse or expand the resources rail"],
];

/**
 * Backdrop picker. Deliberately not workspace-scoped: an operator's stills live
 * wherever they live (Pictures, Desktop, an external volume), so this browses
 * the real filesystem. The server streams the chosen file from its original
 * path — nothing is copied into the project, and deleting the file simply turns
 * the backdrop off.
 */
function BackdropPicker({
  current,
  onUse,
  onClose,
}: {
  current: string;
  onUse: (path: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<BackdropDir | null>(null);
  const [sel, setSel] = useState<BackdropImage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = (dir?: string) => {
    api
      .backdrop(dir)
      .then((d) => {
        setData(d);
        setSel(null);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  // Escape closes the picker only — the applied backdrop is not touched.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || imeBusy(e)) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const path = data?.path ?? "";
  // keep the separators so POSIX and Windows paths both split into prefixes
  const parts = path.split(/(?<=[\\/])/).filter(Boolean);
  const crumbPath = (i: number) => parts.slice(0, i + 1).join("");

  return (
    <div class="bd-browse">
      <div class="hd">
        <span class="lb">{t("bd.pickTitle")}</span>
        <span class="sub">{t("bd.pickSub")}</span>
      </div>

      <div class="ws-crumbs">
        {parts.map((seg, i) => (
          <button type="button" class="ws-crumb" key={crumbPath(i)} onClick={() => load(crumbPath(i))}>
            {seg.replace(/[\\/]$/, "") || seg}
          </button>
        ))}
      </div>

      <div class="ws-recent">
        <span class="lb">{t("bd.goTo")}</span>
        {(data?.roots ?? []).map((r) => (
          <button type="button" key={r.path} class="ws-chip" onClick={() => load(r.path)}>
            {r.label}
          </button>
        ))}
      </div>

      {err ? <div class="bd-empty" style={{ color: "var(--tomato)" }}>{err}</div> : null}

      <div class="bd-scroll">
        {(data?.dirs ?? []).map((d) => (
          <PickRow key={d.path} icon="fld-path" name={d.name} onClick={() => load(d.path)} />
        ))}
        {(data?.images ?? []).length ? (
          <div class="bd-imgs">
            {(data?.images ?? []).map((img) => (
              <button
                type="button"
                key={img.path}
                class="bd-img"
                aria-selected={sel?.path === img.path ? "true" : "false"}
                title={img.path}
                onClick={() => setSel(img)}
              >
                <span class="st" />
                <span class="th" style={{ backgroundImage: `url("${api.backdropUrl(img.path, img.mtime)}")` }} />
                <span class="nm">{img.name}</span>
                <span class="mt">{fmtBytes(img.size)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div class="bd-empty">{t("bd.noImages")}</div>
        )}
        {data?.truncated ? <div class="bd-empty">{t("bd.truncated")}</div> : null}
      </div>

      <div class="bd-foot">
        <span class="picked" title={sel?.path ?? current}>
          {sel ? shortPath(sel.path) : current ? shortPath(current) : t("bd.none")}
        </span>
        <button type="button" class="pv-btn ghost" disabled={!data?.parent} onClick={() => data?.parent && load(data.parent)}>
          {t("bd.up")}
        </button>
        <button type="button" class="pv-btn ghost" onClick={onClose}>
          {t("bd.cancel")}
        </button>
        <button type="button" class="pv-btn" disabled={!sel} onClick={() => sel && onUse(sel.path)}>
          {t("bd.use")}
        </button>
      </div>
    </div>
  );
}

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
  const [picking, setPicking] = useState(false);
  const [, force] = useState(0);
  const prefs = getSettings();

  useEffect(() => subscribeSettings(() => force((n) => n + 1)), []);
  useEffect(() => {
    api.system().then(setSys).catch(() => {});
  }, []);

  // per-tool call stats for the loadout chips (S9: usage without a new station)
  const toolStats = useMemo(() => {
    const acc = new Map<string, { n: number; ms: number; err: number }>();
    for (const it of items) {
      if (it.kind !== "tool") continue;
      const cur = acc.get(it.name) ?? { n: 0, ms: 0, err: 0 };
      cur.n += 1;
      if (typeof it.ms === "number") cur.ms += it.ms;
      if (it.status === "error") cur.err += 1;
      acc.set(it.name, cur);
    }
    return acc;
  }, [items]);

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

      <div class="set-block" data-open={picking ? "1" : "0"}>
        <span class="lb">{t("set.backdrop")}</span>
        <div>
          <div class="bd-row">
            <span
              class="bd-thumb"
              data-empty={prefs.backdrop ? "0" : "1"}
              style={prefs.backdrop ? { backgroundImage: `url("${api.backdropUrl(prefs.backdrop)}")` } : undefined}
            >
              {prefs.backdrop ? null : <Icon name="fld-image" size={13} />}
            </span>
            <span class="bd-path" data-empty={prefs.backdrop ? "0" : "1"} title={prefs.backdrop || t("bd.none")}>
              {prefs.backdrop ? shortPath(prefs.backdrop) : t("bd.none")}
            </span>
            <span class="bd-acts">
              <button type="button" class="pv-btn" data-bd-choose="1" onClick={() => setPicking((v) => !v)}>
                {prefs.backdrop ? t("bd.change") : t("bd.choose")}
              </button>
              {prefs.backdrop ? (
                <button
                  type="button"
                  class="pv-btn ghost"
                  onClick={() => {
                    setSettings({ backdrop: "" });
                    setPicking(false);
                    flash(t("bd.cleared"));
                  }}
                >
                  {t("bd.clear")}
                </button>
              ) : null}
            </span>
          </div>

          {picking ? (
            <BackdropPicker
              current={prefs.backdrop}
              onClose={() => setPicking(false)}
              onUse={(path) => {
                setSettings({ backdrop: path });
                touchBackdrop();
                setPicking(false);
                flash(`${t("bd.applied")} · ${shortPath(path)}`);
              }}
            />
          ) : null}
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
        {(meta?.tools ?? []).map((n) => {
          const st = toolStats.get(n);
          return (
            <span class="set-tool" key={n} data-used={st ? "1" : "0"}>
              {n}
              {st ? (
                <em data-err={st.err ? "1" : "0"}>
                  {st.n}× · {st.ms ? `${Math.round(st.ms / st.n)}ms` : "—"}
                  {st.err ? ` · ${st.err} err` : ""}
                </em>
              ) : null}
            </span>
          );
        })}
      </div>
      <span class="pv-note">
        {toolStats.size} of {(meta?.tools ?? []).length} tools used this session ·{" "}
        {[...toolStats.values()].reduce((n, v) => n + v.n, 0)} calls ·{" "}
        {[...toolStats.values()].reduce((n, v) => n + v.err, 0)} errors
      </span>

      {note ? <div class="ft-note" style={{ marginTop: "10px" }}>{note}</div> : null}
    </div>
  );
}

