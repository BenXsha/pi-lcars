import { useEffect, useState } from "preact/hooks";
import { api, type TreeEntry } from "../api";
import { Icon } from "./Icon";

const fmtSize = (n: number | null) =>
  n == null ? "" : n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${Math.round(n / 1024)}K` : `${(n / 1048576).toFixed(1)}M`;

/** Lazy workspace tree: folders load on first expand, files hand off to the OS. */
export function FileTree({ root }: { root: string }) {
  const [children, setChildren] = useState<Record<string, TreeEntry[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = async (path: string) => {
    setBusy(path);
    try {
      const r = await api.tree(path);
      setChildren((c) => ({ ...c, [path]: r.entries }));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    setChildren({});
    setOpen({});
    load("");
  }, [root]);

  const toggle = (p: string) => {
    const next = !open[p];
    setOpen((o) => ({ ...o, [p]: next }));
    if (next && !children[p]) load(p);
  };

  const copy = async (entry: TreeEntry) => {
    const text = entry.rel || entry.name;
    try {
      await navigator.clipboard.writeText(text);
      setNote(`copied ${text}`);
      setTimeout(() => setNote(null), 1400);
    } catch {
      setNote("clipboard blocked by the browser");
    }
  };

  const openWith = async (entry: TreeEntry, mode: "editor" | "reveal") => {
    try {
      await api.openPath(entry.path, mode);
      setNote(mode === "reveal" ? "revealed in file manager" : "opened in editor");
      setTimeout(() => setNote(null), 1400);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const rows = (path: string, depth: number) =>
    (children[path] ?? []).map((e) => {
      const isDir = e.type === "dir";
      const expanded = !!open[e.path];
      return (
        <div key={e.path}>
          <div
            class={`ft-row ${isDir ? "is-dir" : "is-file"}`}
            style={{ paddingLeft: `${6 + depth * 12}px` }}
            role="button"
            tabIndex={0}
            title={e.rel || e.name}
            onClick={() => (isDir ? toggle(e.path) : openWith(e, "editor"))}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") isDir ? toggle(e.path) : openWith(e, "editor");
            }}
          >
            <span class="ic">
              {isDir ? (
                <Icon name="act-expand" size={11} class={expanded ? "ft-chev open" : "ft-chev"} />
              ) : (
                <Icon name="tool-read" size={11} />
              )}
            </span>
            <span class="nm">{e.name}</span>
            <span class="sz">{isDir ? "" : fmtSize(e.size)}</span>
            <span class="acts">
              <button
                type="button"
                class="ft-act"
                title="Copy path"
                onClick={(ev) => {
                  ev.stopPropagation();
                  copy(e);
                }}
              >
                <Icon name="act-copy" size={10} />
              </button>
              <button
                type="button"
                class="ft-act"
                title="Open"
                onClick={(ev) => {
                  ev.stopPropagation();
                  openWith(e, "editor");
                }}
              >
                <Icon name="act-open" size={10} />
              </button>
              <button
                type="button"
                class="ft-act"
                title="Reveal"
                onClick={(ev) => {
                  ev.stopPropagation();
                  openWith(e, "reveal");
                }}
              >
                <Icon name="fld-path" size={10} />
              </button>
            </span>
          </div>
          {isDir && expanded ? (
            busy === e.path && !children[e.path] ? (
              <div class="ft-load" style={{ paddingLeft: `${18 + depth * 12}px` }}>
                loading…
              </div>
            ) : (
              rows(e.path, depth + 1)
            )
          ) : null}
        </div>
      );
    });

  return (
    <div class="ft">
      <div class="ft-hd">
        <span>{root.replace(/^\/Users\/[^/]+/, "~") || "workspace"}</span>
        <button type="button" class="ft-refresh" title="Reload" onClick={() => load("")}>
          <Icon name="act-reload" size={10} />
        </button>
      </div>
      <div class="ft-scroll">{rows("", 0)}</div>
      {note ? <div class="ft-note">{note}</div> : null}
      {err ? <div class="ft-err">{err}</div> : null}
    </div>
  );
}
