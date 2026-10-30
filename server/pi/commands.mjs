/**
 * Slash commands the console can actually run.
 *
 * Built-in CLI commands (/model, /login, /theme …) are TUI-level and never
 * reach prompt(); what does work through the SDK is `/skill:<name>`,
 * file-based prompt templates, and extension commands. We list the first two
 * from the loader and add the console's own UI commands on the client.
 */
export function listCommands({ entry }) {
  const out = [];
  try {
    for (const s of entry?.loader?.getSkills?.().skills ?? []) {
      out.push({
        name: `/skill:${s.name}`,
        description: (s.description ?? "").replace(/\s+/g, " ").slice(0, 120),
        kind: "skill",
        hint: "<task>",
      });
    }
  } catch {
    /* loader may be absent */
  }
  try {
    for (const p of entry?.loader?.getPrompts?.().prompts ?? []) {
      out.push({ name: `/${p.name}`, description: (p.description ?? "").replace(/\s+/g, " ").slice(0, 120), kind: "template" });
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
