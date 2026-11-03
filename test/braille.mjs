#!/usr/bin/env node
/**
 * The thinking band's motion must stay legible and stay honest.
 *
 *   node test/braille.mjs
 *
 * Two things rot silently here and both are invisible in a screenshot:
 *
 *   1. the dot→codepoint table drifts, so every pattern renders mirrored or
 *      transposed (it still *looks* like motion, which is why nobody notices);
 *   2. `phaseOf` starts answering "thinking" for a run that is finished, or
 *      drops the "a command is executing" case — the band then broadcasts the
 *      wrong thing about the machine to an operator watching from across the room.
 *
 * No browser, no pi process: pure functions only.
 */
import { braille, frame, phaseOf, hash, blank, DONE_HOLD, PHASE_LABEL } from "../src/braille.ts";

const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  results.push(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/* ---------------------------------------------------------- braille folding */

/* one cell, every dot on: U+28FF is the fully lit 2x4 block */
check("a fully lit cell folds to U+28FF", braille([[1, 1], [1, 1], [1, 1], [1, 1]]) === "\u28ff");

/* dot 1 (top left) is bit 0, dot 4 (top right) is bit 3 — transposing these is
   the classic bug and it looks fine until you read the pattern */
check("top row is dots 1|4", braille([[1, 1], [0, 0], [0, 0], [0, 0]]) === "\u2809");
check("bottom row is dots 7|8", braille([[0, 0], [0, 0], [0, 0], [1, 1]]) === "\u28c0");
check("left column is dots 1|2|3|7", braille([[1, 0], [1, 0], [1, 0], [1, 0]]) === "\u2847");

check(
  "one cell row per 4 bitmap rows",
  // 4 dots wide = 2 cells; 12 rows = 3 cell rows, 8 rows = 2
  braille(blank(4, 12)).replace(/\n/g, "").length === 2 * 3 &&
    braille(blank(4, 8)).replace(/\n/g, "").length === 2 * 2,
  `${braille(blank(4, 12)).replace(/\n/g, "").length}, ${braille(blank(4, 8)).replace(/\n/g, "").length}`,
);

/* cell rows are NEWLINE separated. Concatenating them instead still produces a
   valid-looking braille string, which is why this needs its own assertion:
   the band silently rendered one overlong line and clipped past its slot. */
check(
  "cell rows are separated by newlines",
  braille(blank(4, 8)) === "\u2800\u2800\n\u2800\u2800",
  JSON.stringify(braille(blank(4, 8))),
);
check("frame() emits one line per requested cell row", frame("streaming", 3, 12, 8).split("\n").length === 2);
check("a dot width folds to ceil(w/2) cells", frame("idle", 1, 20, 4).length === 10);
/* ------------------------------------------------------------ the motions */

const PHASES = ["idle", "thinking", "streaming", "running", "done"];

for (const p of PHASES) {
  const s = frame(p, 4, 20, 4);
  const range = [...s].every((c) => c.codePointAt(0) >= 0x2800 && c.codePointAt(0) <= 0x28ff);
  check(`${p} renders only braille codepoints`, range, JSON.stringify(s));
}

/* the same frame must draw the same dots, or the band shivers between renders */
check(
  "frames are deterministic",
  PHASES.every((p) => frame(p, 7, 20, 4) === frame(p, 7, 20, 4)),
);

/* the whole point: five states look like five different things. Compare each
   pair at a frame where every motion has had time to develop. */
const shots = Object.fromEntries(PHASES.map((p) => [p, frame(p, 5, 24, 4)]));
const pairs = [];
for (let i = 0; i < PHASES.length; i++) {
  for (let j = i + 1; j < PHASES.length; j++) {
    if (shots[PHASES[i]] === shots[PHASES[j]]) pairs.push(`${PHASES[i]}/${PHASES[j]}`);
  }
}
check("no two phases share a frame", pairs.length === 0, pairs.join(", ") || "all distinct");

/* idle must not be still (it is ambient) but must move slower than work */
const idleFrames = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((t) => frame("idle", t, 20, 4)));
const workFrames = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((t) => frame("thinking", t, 20, 4)));
check("idle still moves, but less than working", idleFrames.size > 1 && idleFrames.size < workFrames.size);

/* "done" collapses to a baseline and stays there — it must not keep flickering */
const settled = frame("done", 12, 24, 4);
const settledLater = frame("done", 40, 24, 4);
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
