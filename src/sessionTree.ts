/* ============================================================
   Session lineage — one helper, two panels.

   pi records a fork by writing `parentSession` into the child's header, so both
   the live list and the on-disk history already carry the relationship. What
   neither has is an ORDER: a flat list sorted by "last touched" scatters a fork
   away from the session it came from, which is exactly the thing you want to
   see when a fork goes wrong.

   This turns rows into a depth-first list:

     · siblings newest-first, roots ordered by the newest thing in their subtree
       (an active fork lifts its parent to the top, where it belongs)
     · a row whose parent is missing from the set is a ROOT, not a lost child —
       history is capped at 200 rows and the parent may simply not be in it
     · collapsed parents keep their children out of the list but still report how
       many they hid, so the toggle can say so
     · a parent chain longer than MAX_DEPTH is treated as a root: a corrupt or
       hand-edited file must not hang the panel in a cycle
   ============================================================ */

export type TreeNode<T> = {
  row: T;
  depth: number;
  /** direct children, whether or not they are currently on screen */
  kids: number;
  /** how many descendants this row is hiding (0 unless collapsed) */
  hidden: number;
};

export type TreeOptions<T> = {
  /** identity of a row (the transcript path) */
  path: (row: T) => string;
  /** its parent's path, if it is a fork */
  parent: (row: T) => string | null | undefined;
  /** ordering key, newest first */
  age: (row: T) => number;
  /** paths whose children are folded away */
  collapsed?: ReadonlySet<string>;
};

const MAX_DEPTH = 8;

export function sessionTree<T>(rows: readonly T[], opts: TreeOptions<T>): TreeNode<T>[] {
  const byPath = new Map<string, T>();
  for (const row of rows) byPath.set(opts.path(row), row);

  // parent → children, but only when the parent is really here. History is
  // capped and sessions get deleted, so an orphan must surface as a root rather
  // than disappear; a self-parent is a corrupt file, not a lineage.
  const kids = new Map<string, T[]>();
  const roots: T[] = [];
  for (const row of rows) {
    const self = opts.path(row);
    const parent = opts.parent(row);
    if (!parent || parent === self || !byPath.has(parent)) {
      roots.push(row);
      continue;
    }
    const list = kids.get(parent);
    if (list) list.push(row);
    else kids.set(parent, [row]);
  }

  const newest = (row: T): number => opts.age(row);
  const countAll = (row: T, depth: number, seen: Set<string>): number => {
    const p = opts.path(row);
    if (depth > MAX_DEPTH || seen.has(p)) return 0;
    seen.add(p);
    return (kids.get(p) ?? []).reduce((n, child) => n + 1 + countAll(child, depth + 1, seen), 0);
  };
  const subtreeAge = (row: T, depth = 0, seen = new Set<string>()): number => {
    const p = opts.path(row);
    if (depth > MAX_DEPTH || seen.has(p)) return newest(row);
    seen.add(p);
    let age = newest(row);
    for (const child of kids.get(p) ?? []) age = Math.max(age, subtreeAge(child, depth + 1, seen));
    return age;
  };

  const sortRows = (a: T, b: T) => newest(b) - newest(a);
  roots.sort((a, b) => subtreeAge(b) - subtreeAge(a));
  for (const list of kids.values()) list.sort(sortRows);

  const out: TreeNode<T>[] = [];
  const emitted = new Set<string>();
  /** a collapsed subtree is accounted for, not lost: mark it so the fallback
   *  pass below does not resurrect it as a root */
  const markHidden = (row: T, depth: number, seen = new Set<string>()) => {
    for (const child of kids.get(opts.path(row)) ?? []) {
      const p = opts.path(child);
      if (depth > MAX_DEPTH || seen.has(p)) continue;
      seen.add(p);
      emitted.add(p);
      markHidden(child, depth + 1, seen);
    }
  };
  const walk = (row: T, depth: number) => {
    const p = opts.path(row);
    if (emitted.has(p)) return; // a cycle: the row is already on screen
    emitted.add(p);
    const children = depth >= MAX_DEPTH ? [] : (kids.get(p) ?? []);
    const closed = children.length > 0 && !!opts.collapsed?.has(p);
    out.push({
      row,
      depth,
      kids: children.length,
      hidden: closed ? countAll(row, 0, new Set()) : 0,
    });
    if (closed) {
      markHidden(row, 0);
      return;
    }
    for (const child of children) walk(child, depth + 1);
  };

  for (const root of roots) walk(root, 0);
  // anything unreachable from a root is a cycle or a chain past the cap: show it
  // at the top level rather than silently dropping transcripts
  for (const row of rows) if (!emitted.has(opts.path(row))) walk(row, 0);

  return out;
}

/** the parent row, when it is in the same result set */
export function parentOf<T>(row: T, rows: readonly T[], opts: Pick<TreeOptions<T>, "path" | "parent">): T | null {
  const parent = opts.parent(row);
  if (!parent) return null;
  return rows.find((r) => opts.path(r) === parent) ?? null;
}
