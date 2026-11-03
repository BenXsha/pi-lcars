import { useEffect, useRef, useState } from "preact/hooks";
import { actions } from "../../store";
import { t } from "../../i18n";
import { ago } from "../../format";
import { Icon } from "../../components/Icon";
import { Logo } from "../../components/Logo";
import { FileTree } from "../../components/FileTree";
import { Station, TopCap } from "../../components/ui";
import { NAV, type View } from "./nav";

/* ------------------------------------------------------------- sidenav */
export function Sidenav({
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
