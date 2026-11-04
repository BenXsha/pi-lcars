import { t } from "../../i18n";
import type { Phase } from "../../braille";

/* ------------------------------------------------------------- phase voice */
/*
 * One place decides what a phase is called and which tone it takes, so the
 * LOG strip and the STREAM zones cannot describe the same moment differently.
 *
 * Tone mapping follows §2 (one colour, one meaning):
 *   thinking  moon    planning / retrieval
 *   streaming orange  the answer being written (the operator-facing output)
 *   running   tang    a command is executing
 *   idle/done g2      nothing to watch — the strip goes quiet, not solid
 */

export const PHASE_TONE: Record<Phase, "moon" | "orange" | "tang" | "quiet"> = {
  idle: "quiet",
  thinking: "moon",
  streaming: "orange",
  running: "tang",
  done: "quiet",
};

/** is the machine doing work right now? (a quiet phase must not look live) */
export const phaseLive = (p: Phase) => p === "thinking" || p === "streaming" || p === "running";

export const phaseWord = (p: Phase): string =>
  p === "thinking"
    ? t("ws.stScan")
    : p === "streaming"
      ? t("ws.streaming")
      : p === "running"
        ? t("ws.running")
        : p === "done"
          ? t("ws.stSettled")
          : t("ws.stIdle");
