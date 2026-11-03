import {useEffect, useState} from "preact/hooks";
import {api, type HistoryResult} from "../../api";
import {shortPath} from "../../format";
import {Icon} from "../../components/Icon";
import {imeBusy} from "../../ime";

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
