/* ============================================================
   Braille dot-matrix renderers — the thinking band's ambient motion.

   A braille cell is 2x4 dots, so a strip one cell tall carries twice the
   horizontal resolution of text at the same width. We render a bitmap and
   fold it into U+2800–U+28FF; the result is a real glyph string, not a
   canvas — it inherits colour, can be selected, and costs no compositing.

   The band answers one question: *what is the model doing right now*.
   Five phases, five distinct motions, no decoration:

     idle       standby  — a still waveform that breathes in amplitude
     thinking   spark    — dots firing on their own periods (neurons)
     streaming  trace    — a waveform travelling right (signal, not bursts)
     running    fall     — columns draining (a machine emitting output)
     done       settle   — the waveform collapses to a baseline, then idles

   Everything here is pure: same (phase, frame, width) gives the same
   string, which is what makes it testable without a DOM.
   ============================================================ */

export type Phase = "idle" | "thinking" | "streaming" | "running" | "done";

/** braille dot weights, indexed [row][column] inside one 2x4 cell */
const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

export type Bitmap = number[][];

export const blank = (w: number, h: number): Bitmap =>
  Array.from({ length: h }, () => new Array(w).fill(0));

const put = (b: Bitmap, x: number, y: number, v = 1) => {
  if (b[y] && b[y][x] !== undefined) b[y][x] = v;
};

/**
 * Deterministic noise: the same frame draws the same dots, so nothing
 * shivers between two renders of an unchanged frame.
 */
export function hash(x: number, y: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Fold a bitmap into braille. One cell row per 4 bitmap rows, 8 per row. */
export function braille(bm: Bitmap): string {
  const h = bm.length;
  const w = bm[0]?.length ?? 0;
  const rows = Math.ceil(h / 4);
  const cols = Math.ceil(w / 2);
  let out = "";
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let v = 0x2800;
      for (let dr = 0; dr < 4; dr++) {
        for (let dc = 0; dc < 2; dc++) {
          const y = cy * 4 + dr;
          const x = cx * 2 + dc;
          if (bm[y] && bm[y][x]) v |= DOTS[dr][dc];
        }
      }
      out += String.fromCodePoint(v);
    }
    if (cy < rows - 1) out += "\n";
  }
  return out;
}

/* ------------------------------------------------------------ motions */

/** travelling waveform — "a signal is flowing" */
function trace(t: number, w: number, h: number): Bitmap {
  const b = blank(w, h);
  for (let x = 0; x < w; x++) {
    const v = Math.sin(x * 0.41 + t * 0.62) * 0.55 + Math.sin(x * 0.17 - t * 0.34) * 0.45;
    const hgt = Math.max(1, Math.round((v * 0.5 + 0.5) * (h - 1) + 1));
    for (let y = h - hgt; y < h; y++) put(b, x, y);
    if (hash(x, t % 97) > 0.9) put(b, x, Math.max(0, h - hgt - 1));
  }
  return b;
}

/** sparse dots that reshuffle slowly — "awake, but not working" */
function standby(t: number, w: number, h: number): Bitmap {
  const b = blank(w, h);
  // one reshuffle every 6 ticks (~540ms): calm, but never frozen
  const slow = Math.floor(t / 6);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (hash(x, y, slow) > 0.91) put(b, x, y, 1);
    }
  }
  return b;
}

/** dots firing on their own periods — reasoning */
function spark(t: number, w: number, h: number): Bitmap {
  const b = blank(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = hash(x, y);
      const period = 5 + Math.floor(p * 11);
      const phase = hash(y, x + 91) * period;
      const local = (t + phase) % period;
      if (local < 1) put(b, x, y, 2);
      else if (local < 2) put(b, x, y, 1);
    }
  }
  return b;
}

/** columns draining — a command emitting output */
function fall(t: number, w: number, h: number): Bitmap {
  const b = blank(w, h);
  const span = h + 5;
  for (let x = 0; x < w; x++) {
    const speed = 0.35 + hash(x, 7) * 0.5;
    const head = Math.round(((t * speed + hash(x, 3) * span) % span) - 2);
    for (let k = 0; k < 2; k++) {
      const y = head - k;
      if (y >= 0 && y < h) put(b, x, y, k === 0 ? 2 : 1);
    }
  }
  return b;
}

/** the waveform collapsing to a baseline — the run finished */
function settle(t: number, w: number, h: number): Bitmap {
  const b = blank(w, h);
  const k = Math.min(1, t / 9);
  for (let x = 0; x < w; x++) {
    const v = Math.sin(x * 0.41) * 0.55 + Math.sin(x * 0.17) * 0.45;
    const hgt = Math.max(1, Math.round((v * 0.5 + 0.5) * (h - 1) * (1 - k) + 1));
    for (let y = h - hgt; y < h; y++) put(b, x, y);
  }
  return b;
}

const MOTION: Record<Phase, (t: number, w: number, h: number) => Bitmap> = {
  idle: standby,
  thinking: spark,
  streaming: trace,
  running: fall,
  done: settle,
};

/**
 * One frame of the band, as a string.
 * `t` is a frame counter (one tick = one drawn frame), `w` a dot width.
 */
export function frame(phase: Phase, t: number, w: number, h = 4): string {
  return braille(MOTION[phase](t, w, h));
}

/* ------------------------------------------------------- phase from data */

type PhaseItem = {
  kind: string;
  status?: string;
  text?: string;
  thinking?: string;
  streaming?: boolean;
  ts?: number;
};

export type PhaseInput = {
  items: PhaseItem[];
  /** a prompt is in flight but the assistant row has not appeared yet */
  running?: boolean;
  /** ms since the last item; the caller owns the clock */
  since?: number;
};

/** how long "done" holds before falling back to idle */
export const DONE_HOLD = 1200;

/**
 * Derive the phase from what is actually happening. Priority is deliberate:
 * a command in flight outranks text, because the machine — not the model —
 * is the one doing work at that moment.
 */
export function phaseOf({ items, running, since = Infinity }: PhaseInput): Phase {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "tool" && it.status === "run") return "running";
    if (it.kind === "approval" && it.status === "pending") return "thinking";
    if (it.kind === "ask" && it.status === "pending") return "thinking";
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "assistant" && it.streaming) {
      // text in flight outranks reasoning: it is the answer being written
      return (it.text ?? "").trim() ? "streaming" : "thinking";
    }
  }
  if (running) return "thinking";
  const last = items[items.length - 1];
  if (last && since < DONE_HOLD) return "done";
  return "idle";
}

export const PHASE_LABEL: Record<Phase, string> = {
  idle: "IDLE",
  thinking: "SCANNING",
  streaming: "STREAMING",
  running: "RUNNING",
  done: "SETTLED",
};
