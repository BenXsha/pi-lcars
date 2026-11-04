import { useEffect, useRef, useState } from "preact/hooks";
import { DONE_HOLD, dots, frame, type Phase } from "../braille";

/* ============================================================
   The thinking band: a dot matrix that says what the model is doing,
   filling the seam between the zone header and its body.

   The dots are DRAWN (one SVG path of round dots), not folded into braille
   glyphs — see src/braille.ts. The cadence is the braille one: an 18px cell
   holds 2 x 4 dots, so the grid is 6 x 4.5px and two cell rows (8 dot rows)
   make a 36px band.

   Motion rules are the console's (§5): linear, fixed step, no easing.
   The clock is shared and stepped at 90ms rather than driven by rAF per
   instance — fifteen bands would otherwise mean fifteen loops redrawing
   at display rate for a 11fps animation.
   ============================================================ */

/** one tick = one drawn frame; matches the console's --t-1 */
const STEP = 90;

/** 18px cell = 2 dots x 6px across, 4 dots x 4.5px down */
const PITCH_X = 6;
const PITCH_Y = 4.5;

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

export function BrailleBand(props: {
  phase: Phase;
  /** dot rows: 8 = two braille cell rows = a 36px band */
  rows?: number;
  /** grid pitch in px (must match .ws-band's --band-dot + gap) */
  pitchX?: number;
  pitchY?: number;
  class?: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [cols, setCols] = useState(0);
  const [t, setT] = useState(1);
  // "done" is a transient: it plays its settle frame, then reads as idle again
  const [local, setLocal] = useState<Phase>(props.phase);

  const pitchX = props.pitchX ?? PITCH_X;
  const pitchY = props.pitchY ?? PITCH_Y;
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

  // the matrix fills its slot exactly: columns come from a measurement, so the
  // band never clips a half dot at the right edge
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (!w) return;
      setCols(Math.max(1, Math.floor(w / pitchX)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pitchX]);

  const bm = cols ? frame(local, t, cols, rows) : null;
  const w = cols * pitchX;
  const h = rows * pitchY;

  return (
    <span
      ref={host}
      class={`ws-band${props.class ? ` ${props.class}` : ""}`}
      data-phase={local}
      data-rows={rows}
      data-pitch-x={pitchX}
      data-pitch-y={pitchY}
      aria-hidden="true"
    >
      {bm ? (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          {/* trailing dots first, the bright head on top of them */}
          <path class="bw1" d={dots(bm, pitchX, pitchY, 1)} />
          <path class="bw2" d={dots(bm, pitchX, pitchY, 2)} />
        </svg>
      ) : null}
    </span>
  );
}
