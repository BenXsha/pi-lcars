import type { Item } from "../../api";
import { t } from "../../i18n";
import { BrailleBand } from "../../components/Braille";
import { phaseFor } from "../../braille";
import { PHASE_TONE, phaseLive, phaseWord } from "./phase";

/* ------------------------------------------------------------- log strip */
/*
 * The mission log's own instrument: a one-row readout whose value band is the
 * dot matrix. It answers the same question the STREAM's THINKING band answers
 * ("what is the machine doing right now"), but for the whole session, so it
 * sits between the header and the log instead of inside one zone.
 *
 * Same grammar as a zone strip (§7.6r): [14px leg][quiet key block][value
 * band][state block]. The state block is the only part allowed to go solid.
 */
export function LogState({ items, running }: { items: Item[]; running?: boolean }) {
  const phase = phaseFor(items, !!running);
  const tone = PHASE_TONE[phase];
  const live = phaseLive(phase);
  return (
    <div class="logstate" data-tone={tone} data-live={live ? "1" : "0"} data-phase={phase} title={t("log.activity")}>
      <span class="ls-spine" aria-hidden="true" />
      <span class="ls-lb">{t("log.activity")}</span>
      <BrailleBand phase={phase} class="ls-band" />
      <span class="ls-st">{phaseWord(phase)}</span>
    </div>
  );
}
