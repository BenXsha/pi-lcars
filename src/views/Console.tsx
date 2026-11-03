import {useEffect, useRef, useState} from "preact/hooks";
import type {DiffData, Item} from "../api";
import {actions, connect, getState, subscribe} from "../store";
import {appliedTheme, applyTheme, type ThemeId} from "../theme";
import {subscribeSettings} from "../settings";
import {t} from "../i18n";
import {shortPath} from "../format";
import {Icon} from "../components/Icon";
import {FileViewer} from "../components/FileViewer";
import {AboutPanel} from "./About";
import {askComposer, onDeckRequest} from "../composer";
import {ControlChip, Shelf} from "../components/ui";
import {viewFromHash, NAV, type View} from "./console/nav";
import {buildTurns} from "./console/turns";
import {Sidenav} from "./console/Sidenav";
import {Transcript} from "./console/Transcript";
import {Workspace} from "./console/Workspace";
import {Composer} from "./console/Composer";
import {Rail, NewSessionDeck, ModelDeck, ThinkDeck, QuickDeck} from "./console/Rail";
import {McpPanel} from "./stations/Mcp";
import {ProvidersPanel} from "./stations/Providers";
import {TreePanel} from "./stations/Tree";
import {HistoryPanel} from "./stations/History";
import {SkillsPanel} from "./stations/Skills";
import {SettingsPanel} from "./stations/Settings";
import {imeBusy} from "../ime";

/**
 * The shell: top rail, three columns, and the deck/overlay stack.
 *
 * Everything else lives beside it — stations answer for themselves
 * (./stations/*), conversation pieces in ./console/*, pure formatting in
 * ../format.ts. This file owns layout and nothing else.
 */

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
