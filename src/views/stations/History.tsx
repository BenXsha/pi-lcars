import {useEffect, useMemo, useState} from "preact/hooks";
import {api, type HistoryResult} from "../../api";
import {shortPath} from "../../format";
import {Icon} from "../../components/Icon";
import {imeBusy} from "../../ime";
import {sessionTree} from "../../sessionTree";
import {useFolds} from "../../folds";

/* --------------------------------------------------------------- history */
export function HistoryPanel({ onOpen, onFork }: { onOpen: (path: string) => void; onFork: (path: string) => void }) {
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
  const [folds, toggleFold] = useFolds("lcars.fold.history");

  // Same lineage rule as the rail (src/sessionTree.ts): a fork sits under the
  // session it came from. A search result is a different question — matches are
  // scattered by definition — so a query shows a flat list instead, and the row
  // says which session it was forked from.
  const tree = useMemo(() => {
    if (q.trim()) {
      return sessions.map((row) => ({ row, depth: 0, kids: 0, hidden: 0 }));
    }
    return sessionTree(sessions, {
      path: (r) => r.path,
      parent: (r) => r.parent,
      age: (r) => new Date(r.modified).getTime(),
      collapsed: folds,
    });
  }, [sessions, folds, q]);

  const byPath = useMemo(() => new Map(sessions.map((r) => [r.path, r])), [sessions]);
  const parentTitle = (row: { parent: string | null }) => {
    if (!row.parent) return null;
    const p = byPath.get(row.parent);
    return p ? p.title : null; // not in the page: the parent is further back
  };

  return (
    <div class="pv">
      <div class="pv-title">
        HISTORY {data?.matched ? `/ ${data.matched}` : ""}
        {data && !data.ready && data.scanning ? " · SCANNING" : ""}
      </div>
      <div class="pv-sub">
        Every transcript on this machine, grouped by lineage: a fork sits under the session it came from. A scan reads
        all of them, so it runs in the background and this list fills in when it lands — {data ? `${data.scanned} indexed` : "…"}.
        Searching flattens the list.
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
        {tree.map(({ row: h, depth, kids, hidden }) => (
          <div
            class="hrow"
            key={h.path}
            data-confirm={confirmPath === h.path ? "1" : "0"}
            data-depth={depth}
            data-fork={h.parent ? "1" : "0"}
            style={depth ? { paddingLeft: `${depth * 18}px` } : undefined}
          >
            <span class="gut">
              {kids && !q.trim() ? (
                <button
                  type="button"
                  class="fold"
                  aria-expanded={folds.has(h.path) ? "false" : "true"}
                  title={hidden ? `${hidden} hidden` : `${kids} fork${kids === 1 ? "" : "s"}`}
                  onClick={() => toggleFold(h.path)}
                >
                  <Icon name={folds.has(h.path) ? "act-expand" : "act-collapse"} size={12} />
                </button>
              ) : h.parent ? (
                <span class="forkmark" title={h.parent}>
                  ↳
                </span>
              ) : null}
            </span>
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
                {h.parent ? ` · ↳ ${parentTitle(h) ?? "forked"}` : ""}
                {hidden ? ` · ${hidden} hidden` : ""}
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
