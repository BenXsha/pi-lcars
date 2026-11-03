import {useEffect, useState} from "preact/hooks";
import {api, type TreeRow} from "../../api";
import {actions} from "../../store";
import {Icon} from "../../components/Icon";

/* ------------------------------------------------------------------ tree */
export function TreePanel({ onClose, onSwitch }: { onClose: () => void; onSwitch: () => void }) {
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
