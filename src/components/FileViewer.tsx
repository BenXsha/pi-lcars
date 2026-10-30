import { useEffect, useState } from "preact/hooks";
import { api, type DiffData, type FileResult } from "../api";
import { Icon } from "./Icon";
import { DiffView, flattenDiff } from "./ui";
import { highlight, langFromPath } from "../highlight";
import { Markdown } from "./Markdown";

const fmtSize = (n: number) =>
  n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${Math.round(n / 1024)}K` : `${(n / 1048576).toFixed(1)}M`;

const raw = (path: string) => `/api/raw?path=${encodeURIComponent(path)}`;

/**
 * In-app viewer. Only what the browser can render is previewed: text, images,
 * audio, video. Anything else says so and hands the file to the OS.
 */
export function FileViewer({ path, diff, onClose }: { path: string; diff?: DiffData; onClose: () => void }) {
  const [data, setData] = useState<FileResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);
  const isMd = /\.(md|mdx|markdown)$/i.test(path);
  const [md, setMd] = useState<"preview" | "source">("preview");

  useEffect(() => {
    setData(null);
    setErr(null);
    setMd("preview");
    api.file(path).then(setData).catch((e) => setErr(e.message));
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = diff ? flattenDiff(diff) : [];

  return (
    <div class="fv">
      <div class="fv-hd">
        <span class="st" />
        <span class="nm">{data?.rel || path}</span>
        <span class="mt">
          {data ? `${data.kind.toUpperCase()} · ${fmtSize(data.size)}${data.lines ? ` · ${data.lines} LINES` : ""}` : "…"}
        </span>
        {isMd && data?.kind === "text" ? (
          <button type="button" class="pv-btn" data-on={md === "preview" ? "1" : "0"} onClick={() => setMd(md === "preview" ? "source" : "preview")}>
            {md === "preview" ? "SOURCE" : "PREVIEW"}
          </button>
        ) : null}
        {!isMd && data?.kind === "text" ? (
          <button type="button" class="pv-btn ghost" onClick={() => setWrap(!wrap)}>
            {wrap ? "NO WRAP" : "WRAP"}
          </button>
        ) : null}
        <button type="button" class="pv-btn ghost" onClick={() => navigator.clipboard?.writeText(data?.rel ?? path).catch(() => {})}>
          COPY
        </button>
        <button type="button" class="pv-btn ghost" onClick={() => api.openPath(path, "editor").catch(() => {})}>
          OPEN
        </button>
        <button type="button" class="pv-btn" onClick={onClose}>
          CLOSE
        </button>
      </div>

      {err ? (
        <div class="errbar">
          <Icon name="status-fail" size={13} /> {err}
        </div>
      ) : null}

      <div class="fv-body">
        {diff ? (
          <DiffView rows={rows} stat={diff.stat} truncated={diff.truncated} />
        ) : !data ? (
          <div class="pv-note">loading…</div>
        ) : data.kind === "text" && isMd && md === "preview" ? (
          <div class="fv-md">
            <Markdown text={data.text} />
          </div>
        ) : data.kind === "text" ? (
          <div class={`fv-code ${wrap ? "is-wrap" : ""}`}>
            <div class="fv-gutter" aria-hidden="true">
              {Array.from({ length: data.text.split("\n").length }, (_, i) => (
                <span key={i}>{i + 1}</span>
              ))}
            </div>
            <pre
              class="fv-pre hljs"
              dangerouslySetInnerHTML={{
                __html:
                  highlight(data.text, langFromPath(data.path)) ??
                  data.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
              }}
            />
          </div>
        ) : data.kind === "image" ? (
          <div class="fv-media">
            <img src={raw(data.path)} alt={data.rel} />
          </div>
        ) : data.kind === "audio" ? (
          <div class="fv-media">
            <audio controls src={raw(data.path)} />
          </div>
        ) : data.kind === "video" ? (
          <div class="fv-media">
            <video controls src={raw(data.path)} />
          </div>
        ) : (
          <div class="fv-none">
            <p class="ttl">NO INLINE PREVIEW</p>
            <p class="sub">
              {data.mime} · {fmtSize(data.size)} — this format is not something the browser renders. Use OPEN to hand it to
              the OS.
            </p>
          </div>
        )}

        {data?.truncated ? (
          <div class="ft-note">
            {data.reason === "size" ? "file is larger than the viewer limit" : data.reason === "binary" ? "binary content" : "only the first 6000 lines are shown"}
          </div>
        ) : null}
      </div>
    </div>
  );
}
