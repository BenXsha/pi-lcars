#!/usr/bin/env node
/**
 * Session lineage, as a pure function.
 *
 *   node test/session-tree.mjs
 *
 * The panels only render what this returns, so every rule that is easy to get
 * subtly wrong lives here and is asserted here:
 *
 *   1. a fork sits under its parent, at depth 1 — not wherever "last touched"
 *      would have put it;
 *   2. a fork whose parent is NOT in the result (history is capped, sessions are
 *      deleted) becomes a root instead of disappearing;
 *   3. roots are ordered by the newest thing in their subtree, so an active
 *      fork lifts its parent;
 *   4. collapsing hides descendants but still reports how many;
 *   5. a self-parented or cyclic file cannot hang the walk.
 */
import { sessionTree } from "../src/sessionTree.ts";

const results = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  results.push(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const row = (path, parent, age) => ({ path, parent, age });
const opts = (collapsed) => ({
  path: (r) => r.path,
  parent: (r) => r.parent,
  age: (r) => r.age,
  collapsed,
});
const shape = (nodes) => nodes.map((n) => `${"  ".repeat(n.depth)}${n.row.path}${n.kids ? `(${n.kids})` : ""}`);

/* ------------------------------------------------------------ 1. nesting */
{
  const rows = [row("a", null, 100), row("a1", "a", 90), row("a2", "a", 95), row("b", null, 80)];
  const tree = sessionTree(rows, opts());
  check(
    "a fork sits directly under its parent, newest first",
    shape(tree).join("|") === "a(2)|  a2|  a1|b",
    shape(tree).join(" | "),
  );
  check("depth is the lineage depth", tree.map((n) => n.depth).join(",") === "0,1,1,0", tree.map((n) => n.depth).join(","));
  check("kids counts direct children only", tree[0].kids === 2 && tree[1].kids === 0);
}

/* ------------------------------------------- 2. an orphan is a root, not lost */
{
  const rows = [row("a1", "gone", 90), row("b", null, 80)];
  const tree = sessionTree(rows, opts());
  check("a fork whose parent is missing becomes a root", tree.length === 2 && tree.every((n) => n.depth === 0), shape(tree).join(" | "));
}

/* --------------------------------- 3. roots are ordered by subtree freshness */
{
  const rows = [row("old", null, 100), row("old1", "old", 300), row("new", null, 200)];
  const tree = sessionTree(rows, opts());
  check(
    "an active fork lifts its parent above a newer-but-idle root",
    shape(tree).join("|") === "old(1)|  old1|new",
    shape(tree).join(" | "),
  );
}

/* -------------------------------------------------------- 4. collapse */
{
  const rows = [row("a", null, 100), row("a1", "a", 90), row("a2", "a1", 85), row("b", null, 80)];
  const open = sessionTree(rows, opts());
  const closed = sessionTree(rows, opts(new Set(["a"])));
  check("descendants nest to depth 2", open.map((n) => n.depth).join(",") === "0,1,2,0", open.map((n) => n.depth).join(","));
  check("collapsing hides the whole subtree", shape(closed).join("|") === "a(1)|b", shape(closed).join(" | "));
  check("the parent still says how many it hid", closed[0].hidden === 2, String(closed[0].hidden));
  check("an open parent hides nothing", open[0].hidden === 0);
}

/* ------------------------------------------------- 5. cycles and depth cap */
{
  const rows = [row("x", "y", 10), row("y", "x", 9)];
  const tree = sessionTree(rows, opts());
  check("a two-node cycle still renders every row", tree.length === 2, shape(tree).join(" | "));

  const chain = Array.from({ length: 20 }, (_, i) => row(`n${i}`, i ? `n${i - 1}` : null, 100 - i));
  const deep = sessionTree(chain, opts());
  check("a 20-deep chain is cut at the cap instead of vanishing", deep.length === 20 && Math.max(...deep.map((n) => n.depth)) <= 8, `max depth ${Math.max(...deep.map((n) => n.depth))}`);
}

/* ------------------------------------------------------ 6. degenerate input */
{
  check("no rows, no nodes", sessionTree([], opts()).length === 0);
  const single = sessionTree([row("solo", null, 1)], opts());
  check("a lone session is depth 0 with no kids", single.length === 1 && single[0].depth === 0 && single[0].kids === 0);
}

console.log(`\n  session lineage\n`);
console.log(results.join("\n"));
console.log(failures ? `\n  ${failures} check(s) failed\n` : `\n  ${results.length} checks passed\n`);
process.exit(failures ? 1 : 0);
