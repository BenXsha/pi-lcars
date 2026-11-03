import { useEffect, useRef, useState } from "preact/hooks";
import { DONE_HOLD, frame, type Phase } from "../braille";

/* ============================================================
   The thinking band: one braille cell row that says what the model is
   doing, filling the seam between the zone header and its body.

   Motion rules are the console's (§5): linear, fixed step, no easing.
   The clock is shared and stepped at 90ms rather than driven by rAF per
   instance — fifteen bands would otherwise mean fifteen loops redrawing
   at display rate for a 11fps animation.
   ============================================================ */

/** one tick = one drawn frame; matches the console's --t-1 */
const STEP = 90;

let n = 0;
let raf = 0;
let prev = 0;
let acc = 0;
const subs = new Set<(n: number) => void>();

function isReduced(): boolean {
  if (document.documentElement.dataset.motion === "reduced") return true;
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function loop(now: number) {
  raf = requestAnimationFrame(loop);
  const dt = now - prev;
  prev = now;
  if (!subs.size) return;
  // reduced motion gets one still frame and then no clock at all
  if (isReduced()) return;
  acc += dt;
  if (acc < STEP) return;
  acc %= STEP;
  n++;
  for (const fn of subs) fn(n);
}

function onFrame(fn: (n: number) => void): () => void {
  subs.add(fn);
  if (!raf) {
    prev = performance.now();
    acc = 0;
    raf = requestAnimationFrame(loop);
  }
  return () => {
    subs.delete(fn);
    if (!subs.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

/** advance width of one braille cell at a given font size, cached */
const widths = new Map<number, number>();
function cellWidth(px: number): number {
  const hit = widths.get(px);
  if (hit) return hit;
  const cv = document.createElement("canvas").getContext("2d");
  let w = px; // a braille cell is square in every face that carries the block
  if (cv) {
    cv.font = `400 ${px}px "Apple Braille", "Noto Sans Symbols 2", "Segoe UI Symbol", monospace`;
    const m = cv.measureText("\u2800\u28ff\u2847").width / 3;
    if (m > 0) w = m;
  }
  widths.set(px, w);
  return w;
}

export function BrailleBand(props: {
  phase: Phase;
  /** dot rows: 8 = two braille lines (the default band) */
  rows?: number;
  size?: number;
  class?: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [cells, setCells] = useState(0);
  const [t, setT] = useState(1);
  // "done" is a transient: it plays its settle frame, then reads as idle again
  const [local, setLocal] = useState<Phase>(props.phase);

  const size = props.size ?? 13;
  // two cell rows: one line reads as a stray artefact, two read as a field
  const rows = props.rows ?? 8;

  useEffect(() => {
    if (props.phase !== "done") {
      setLocal(props.phase);
      return;
    }
    setLocal("done");
    const id = setTimeout(() => setLocal("idle"), DONE_HOLD);
    return () => clearTimeout(id);
  }, [props.phase]);

  // each phase starts its own frame sequence, so "settle" always collapses
  // from the beginning instead of picking up wherever the counter got to
  useEffect(() => {
    const base = n;
    setT(1);
    if (isReduced()) return;
    return onFrame((cur) => setT(cur - base));
  }, [local]);

  // the band fills its slot exactly: cells are fixed-width, so the count has
  // to come from a measurement rather than from overflow clipping
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (!w) return;
      setCells(Math.max(1, Math.floor(w / cellWidth(size))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // braille advances change once the bundled faces land, so re-measure after
    document.fonts?.ready?.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [size]);

  return (
    <span
      ref={host}
      class={`ws-band${props.class ? ` ${props.class}` : ""}`}
      data-phase={local}
      aria-hidden="true"
    >
      {cells ? frame(local, t, cells * 2, rows) : ""}
    </span>
  );
}
