#!/usr/bin/env node
/**
 * The thinking band's motion must stay legible and stay honest.
 *
 *   node test/braille.mjs
 *
 * Two things rot silently here and both are invisible in a screenshot:
 *
 *   1. the dot→position mapping drifts, so every pattern renders mirrored or
 *      transposed (it still *looks* like motion, which is why nobody notices);
 *   2. `phaseOf` starts answering "thinking" for a run that is finished, or
 *      drops the "a command is executing" case — the band then broadcasts the
 *      wrong thing about the machine to an operator watching from across the room.
 *
 * No browser, no pi process: pure functions only.
 */
import { dots, frame, phaseOf, hash, blank, DONE_HOLD, PHASE_LABEL } from "../src/braille.ts";

const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  results.push(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/* ---------------------------------------------------------- dot geometry */

/* the band draws dots: one zero-length segment per lit cell, positioned at the
   CENTRE of its cell. Transposing x/y here turns every pattern 90° — it still
   looks like motion, which is exactly why it needs an assertion. */
const one = (x, y, w = 3, h = 2) => {
  const b = blank(w, h);
  b[y][x] = 1;
  return b;
};
check("a dot lands at the centre of its cell", dots(one(0, 0), 10) === "M5 5h.01", dots(one(0, 0), 10));
check("x is the column, y the row", dots(one(2, 1), 10) === "M25 15h.01", dots(one(2, 1), 10));
check("an empty frame draws nothing", dots(blank(6, 4), 10) === "", JSON.stringify(dots(blank(6, 4), 10)));
check(
  "every lit cell gets exactly one dot",
  (dots(blank(8, 4).map((row, y) => row.map((_, x) => ((x + y) % 3 ? 0 : 1))), 10).match(/M/g) ?? []).length ===
    blank(8, 4).flat().filter((_, i) => (i % 3 === 0)).length,
);
/* the two weights are separate layers, never double-drawn */
const mixed = blank(3, 1);
mixed[0][0] = 1;
mixed[0][1] = 2;
check(
  "weights split into two layers",
  dots(mixed, 10, 10, 1) === "M5 5h.01" && dots(mixed, 10, 10, 2) === "M15 5h.01" && dots(mixed, 10).match(/M/g)?.length === 2,
);
/* the grid is not square: a braille cell is 2 columns per 4 rows, so the
   console draws 6px across and 4.5px down — swapping them tilts the field */
check("the two pitches are independent", dots(one(1, 1, 3, 3), 6, 4.5) === "M9 6.75h.01", dots(one(1, 1, 3, 3), 6, 4.5));

/* ------------------------------------------------------------ the motions */

const PHASES = ["idle", "thinking", "streaming", "running", "done"];

for (const p of PHASES) {
  const bm = frame(p, 4, 20, 4);
  const vals = new Set(bm.flat());
  check(`${p} draws a sane bitmap`, bm.length === 4 && bm[0].length === 20 && [...vals].every((v) => v === 0 || v === 1 || v === 2), JSON.stringify([...vals]));
  check(`${p} actually draws something`, dots(bm, 11).length > 0);
}

/* the same frame must draw the same dots, or the band shivers between renders */
check(
  "frames are deterministic",
  PHASES.every((p) => dots(frame(p, 7, 20, 4), 11) === dots(frame(p, 7, 20, 4), 11)),
);

/* the whole point: five states look like five different things. Compare each
   pair at a frame where every motion has had time to develop. */
const shots = Object.fromEntries(PHASES.map((p) => [p, dots(frame(p, 5, 24, 4), 11)]));
const pairs = [];
for (let i = 0; i < PHASES.length; i++) {
  for (let j = i + 1; j < PHASES.length; j++) {
    if (shots[PHASES[i]] === shots[PHASES[j]]) pairs.push(`${PHASES[i]}/${PHASES[j]}`);
  }
}
check("no two phases share a frame", pairs.length === 0, pairs.join(", ") || "all distinct");

/* idle must not be still (it is ambient) but must move slower than work */
const idleFrames = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((t) => dots(frame("idle", t, 20, 4), 11)));
const workFrames = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((t) => dots(frame("thinking", t, 20, 4), 11)));
check("idle still moves, but less than working", idleFrames.size > 1 && idleFrames.size < workFrames.size);

/* "done" collapses to a baseline and stays there — it must not keep flickering */
const settled = dots(frame("done", 12, 24, 4), 11);
const settledLater = dots(frame("done", 40, 24, 4), 11);
check("the done frame settles and holds", settled === settledLater);

/* hash drives every scatter pattern, so it has to be uniform-ish, not clustered */
const buckets = new Array(10).fill(0);
for (let i = 0; i < 20000; i++) buckets[Math.min(9, Math.floor(hash(i % 200, Math.floor(i / 200)) * 10))]++;
const lo = Math.min(...buckets), hi = Math.max(...buckets);
check("hash is evenly distributed", hi / lo < 1.25, `${lo}–${hi} per decile`);

/* ------------------------------------------------------------- phaseOf */

const tool = (status) => ({ kind: "tool", status, ts: 1 });
const asst = (o) => ({ kind: "assistant", text: "", thinking: "", streaming: false, ts: 1, ...o });

check("nothing happened yet is idle", phaseOf({ items: [], since: 1e9 }) === "idle");
check("a command in flight is running", phaseOf({ items: [tool("run")], since: 0 }) === "running");
check(
  "reasoning without text is thinking",
  phaseOf({ items: [asst({ streaming: true, thinking: "hmm" })], since: 0 }) === "thinking",
);
check(
  "text in flight is streaming",
  phaseOf({ items: [asst({ streaming: true, text: "an answer" })], since: 0 }) === "streaming",
);
check(
  "a prompt with no assistant row yet still reads as thinking",
  phaseOf({ items: [], running: true, since: 0 }) === "thinking",
);

/* text outranks reasoning on the same row, and the machine outranks both */
check(
  "the newest streaming row decides thinking vs streaming",
  phaseOf({
    items: [asst({ streaming: true, text: "x" }), asst({ streaming: true, thinking: "y" })],
    since: 0,
  }) === "thinking",
);
check(
  "a running command outranks text on screen",
  phaseOf({ items: [asst({ streaming: true, text: "x" }), tool("run")], since: 0 }) === "running",
);

/* pending human input is not "running": somebody is waiting on the operator */
check(
  "a pending approval waits rather than runs",
  phaseOf({ items: [{ kind: "approval", status: "pending", ts: 1 }], since: 0 }) === "thinking",
);

/* the settle window: done briefly, then idle on its own */
check("a just-finished run is done", phaseOf({ items: [asst({})], since: 10 }) === "done");
check(
  "done expires into idle",
  phaseOf({ items: [asst({})], since: DONE_HOLD + 1 }) === "idle",
);

check(
  "every phase has a label",
  PHASES.every((p) => typeof PHASE_LABEL[p] === "string" && PHASE_LABEL[p].length > 0),
);

console.log(results.join("\n"));
console.log(failures ? `\n${failures} braille check(s) failed` : `\n${PHASES.length} phases · ${pairs.length} collisions`);
process.exit(failures ? 1 : 0);
