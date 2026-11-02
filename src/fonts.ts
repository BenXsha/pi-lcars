/**
 * Decorative face readout + the bundled pack.
 *
 * Michroma now ships with the console (public/fonts, SIL OFL 1.1), so the deco
 * layer is deterministic: the wordmark and the cycle numerals no longer depend
 * on what the host happens to have installed. `--deco` still carries the sci-fi
 * shelf behind it (Orbitron / Chakra Petch / Rajdhani) for the case where the
 * bundled face somehow fails to load.
 *
 * None of these is Star Trek IP. The real LCARS face is Helvetica Ultra
 * Compressed (commercial), and every "Star Trek" fan face (Okuda, PCap
 * Terminal, Star Trek Future…) is personal-use or derivative — none can be
 * shipped in an MIT package.
 *
 * `document.fonts.check()` only reports @font-face availability, so the test is
 * the classic one: measure the same string in the candidate and in a fallback
 * that cannot match, and compare widths.
 */
const CANDIDATES = ["Michroma", "Orbitron", "Chakra Petch", "Rajdhani"] as const;

export const DECO_CANDIDATES = CANDIDATES;

/** what public/fonts ships — ABOUT reports it as a fact, not a preference */
export const BUNDLED_DECO = "Michroma";

const PROBE = "AGENT CONSOLE 0123456789";
const BASELINE = '"__lcars_missing_face__", monospace';

/** the first decorative family actually rendering, or null for "D-DIN takes over" */
export async function decoFace(): Promise<string | null> {
  if (typeof document === "undefined" || !document.body) return null;

  // the bundled woff2 is local, but a probe run before it lands would report the
  // fallback — wait for it, with a cap so ABOUT can never hang on a font
  try {
    await Promise.race([
      document.fonts.load(`400 32px "${BUNDLED_DECO}"`),
      new Promise((done) => setTimeout(done, 1000)),
    ]);
  } catch {
    /* a failed load just means the probe answers from the fallback stack */
  }

  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font-size:32px";
  probe.textContent = PROBE;
  document.body.appendChild(probe);
  probe.style.fontFamily = BASELINE;
  const base = probe.getBoundingClientRect().width;
  let hit: string | null = null;
  for (const family of CANDIDATES) {
    probe.style.fontFamily = `"${family}", ${BASELINE}`;
    if (Math.abs(probe.getBoundingClientRect().width - base) > 0.5) {
      hit = family;
      break;
    }
  }
  probe.remove();
  return hit;
}
