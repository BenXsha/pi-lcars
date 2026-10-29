import { readFile, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

/**
 * Skills / prompts / extensions as the live resource loader sees them.
 *
 * Skills are injected into the system prompt, not exposed as tools, so the
 * loader is the only honest source. Each row carries the description (which is
 * also the model's trigger), the invocation mode, and where it lives on disk.
 */
export async function listSkills({ entry }) {
  const loader = entry?.loader;
  if (!loader) {
    return { available: false, skills: [], prompts: [], extensions: [], error: "no resource loader on this session" };
  }

  let skills = [];
  let prompts = [];
  let extensions = [];
  let diagnostics = [];
  try {
    const r = loader.getSkills?.() ?? { skills: [], diagnostics: [] };
    skills = r.skills ?? [];
    diagnostics = (r.diagnostics ?? []).map((d) => ({ level: d.level ?? d.severity ?? "warn", message: d.message ?? String(d) }));
  } catch (e) {
    return { available: false, skills: [], prompts: [], extensions: [], error: e.message };
  }
  try {
    prompts = (loader.getPrompts?.().prompts ?? []).map((p) => ({ name: p.name, path: p.filePath ?? p.path ?? "" }));
  } catch {
    prompts = [];
  }
  try {
    extensions = (loader.getExtensions?.().extensions ?? []).map((e) => ({
      name: e.name ?? basename(e.path ?? "extension"),
      path: e.path ?? "",
    }));
  } catch {
    extensions = [];
  }

  const rows = [];
  for (const s of skills) {
    let bytes = null;
    let modified = null;
    try {
      const st = await stat(s.filePath);
      bytes = st.size;
      modified = st.mtime;
    } catch {
      /* skill file may be virtual */
    }
    // the first heading often names the skill in the operator's words
    let heading = null;
    if (s.filePath) {
      try {
        const raw = await readFile(s.filePath, "utf8");
        // skip YAML frontmatter, then take the first markdown heading
        const body = raw.startsWith("---") ? raw.replace(/^---[\s\S]*?\n---\s*\n?/, "") : raw;
        heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
      } catch {
        heading = null;
      }
    }
    rows.push({
      name: s.name,
      description: (s.description || "").replace(/\s+/g, " ").trim(),
      heading,
      path: s.filePath,
      dir: s.baseDir ? basename(s.baseDir) : dirname(s.filePath ?? ""),
      manualOnly: !!s.disableModelInvocation,
      trigger: s.disableModelInvocation ? "manual" : "description",
      bytes,
      modified,
    });
  }

  return { available: true, skills: rows, prompts, extensions, diagnostics };
}

/** Re-run discovery. Cheap enough to expose: it only re-reads SKILL.md files. */
export async function reloadSkills({ entry }) {
  const loader = entry?.loader;
  if (!loader?.reload) {
    const e = new Error("this session has no reloadable resource loader");
    e.status = 409;
    e.code = "E_NO_LOADER";
    throw e;
  }
  const t0 = Date.now();
  await loader.reload({ resolveProjectTrust: async () => true });
  return { ms: Date.now() - t0, ...(await listSkills({ entry })) };
}
