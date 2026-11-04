import { useCallback, useState } from "preact/hooks";

/* ============================================================
   Fold state for the two session lists.

   Both panels are trees of the same rows (a session and its forks), and both
   need the same two things: a set of collapsed paths that survives a reload,
   and a toggle. Keeping it in one place means "collapsed" means the same thing
   in the rail and in HISTORY, and a bad localStorage value cannot break either
   panel.
   ============================================================ */

const read = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
};

export function useFolds(key: string): [ReadonlySet<string>, (path: string) => void] {
  const [set, setSet] = useState<ReadonlySet<string>>(() => new Set(read(key)));

  const toggle = useCallback(
    (path: string) => {
      setSet((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        try {
          localStorage.setItem(key, JSON.stringify([...next]));
        } catch {
          /* private mode: the fold just does not survive a reload */
        }
        return next;
      });
    },
    [key],
  );

  return [set, toggle];
}
