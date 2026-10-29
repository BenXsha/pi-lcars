/**
 * Tool results → renderable diffs.
 *
 * pi's edit tool reports both a display string (`details.diff`) and a standard
 * unified patch (`details.patch`). The patch is what we parse: it carries both
 * line numbers, which the display string does not.
 */

/** Parse a unified patch into hunks with old/new line numbers. */
export function parseUnifiedPatch(patch) {
  if (!patch || typeof patch !== "string") return null;
  const hunks = [];
  let cur = null;
  let add = 0;
  let del = 0;

  for (const raw of patch.split("\n")) {
    const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) {
      cur = { hdr: raw, oldNo: Number(m[1]), newNo: Number(m[2]), lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue; // file headers (---/+++/diff --git)
    if (raw.startsWith("\\")) {
      cur.lines.push({ t: "\\", text: raw.slice(1).trim() });
      continue;
    }
    const sign = raw[0];
    const text = raw.slice(1);
    if (sign === "+") {
      cur.lines.push({ t: "+", n: cur.newNo++, text });
      add++;
    } else if (sign === "-") {
      cur.lines.push({ t: "-", o: cur.oldNo++, text });
      del++;
    } else if (sign === " ") {
      cur.lines.push({ t: " ", o: cur.oldNo++, n: cur.newNo++, text });
    }
  }
  if (!hunks.length) return null;
  if (!add && !del && hunks.every((h) => !h.lines.length)) return null;
  return { hunks, stat: { add, del } };
}

/**
 * `write` has no patch, but the tool args carry the whole file — synthesize an
 * all-additions diff so the row still shows what landed.
 */
export function diffFromWrite(content, path, cap = 400) {
  if (typeof content !== "string" || !content) return null;
  const all = content.split("\n");
  const lines = all.slice(0, cap).map((text, i) => ({ t: "+", n: i + 1, text }));
  return {
    path: path || "",
    hunks: [{ hdr: `@@ -0,0 +1,${all.length} @@`, oldNo: 0, newNo: 1, lines }],
    stat: { add: all.length, del: 0 },
    truncated: all.length > cap,
  };
}

/** Pick the best diff out of a tool result (patch first, display diff as fallback). */
export function diffFromResult(details) {
  if (!details || typeof details !== "object") return null;
  const fromPatch = parseUnifiedPatch(details.patch);
  if (fromPatch) return fromPatch;
  // last resort: the display string already has "+<n> " / "-<n> " prefixes
  if (typeof details.diff === "string" && details.diff.trim()) {
    return parseDisplayDiff(details.diff);
  }
  return null;
}

function parseDisplayDiff(text) {
  const lines = [];
  let add = 0;
  let del = 0;
  for (const raw of text.split("\n")) {
    const m = raw.match(/^([+\- ])(\d+)\s(.*)$/);
    if (!m) continue;
    const [, sign, no, body] = m;
    const n = Number(no);
    if (sign === "+") {
      lines.push({ t: "+", n, text: body });
      add++;
    } else if (sign === "-") {
      lines.push({ t: "-", o: n, text: body });
      del++;
    } else {
      lines.push({ t: " ", o: n, n, text: body });
    }
  }
  if (!lines.length) return null;
  return { hunks: [{ hdr: "", oldNo: 0, newNo: 0, lines }], stat: { add, del } };
}
