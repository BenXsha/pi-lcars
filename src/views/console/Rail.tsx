import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, type DirEntry, type Item, type ModelInfo } from "../../api";
import { actions, getState } from "../../store";
import { t } from "../../i18n";
import { fmtTok, shortPath } from "../../format";
import { Icon } from "../../components/Icon";
import { QUICK_SLOTS, loadQuick, newQuick, resetQuick, saveQuick, type QuickPrompt } from "../../quick";
import { BarButton, Deck, Meter, PickRow, Readout, Segmented } from "../../components/ui";
import { type Turn } from "./turns";

/* ------------------------------------------------------------------ rail */
export function Rail({
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
export function NewSessionDeck({
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

export function ModelDeck({ current, onClose }: { current?: string; onClose: () => void }) {
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

export function ThinkDeck({ current, onClose }: { current?: string; onClose: () => void }) {
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
export function QuickDeck({ onClose }: { onClose: () => void }) {
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
