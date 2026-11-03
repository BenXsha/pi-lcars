import {useEffect, useRef, useState} from "preact/hooks";
import type {DiffData, Item, Meta} from "../../api";
import {actions} from "../../store";
import {fmtTok, mmss} from "../../format";
import {ApprovalDeck, MessageRow, NoticeRow, ToolStrip} from "../../components/ui";
import {SummaryBlock, SkillBlock, AskBlock, Standby} from "./blocks";
import {toolIcon} from "./tools";
import {buildTurns} from "./turns";

/* ----------------------------------------------------------- transcript */
export function Transcript({
  items,
  meta,
  link,
  onOpenDiff,
  onRecall,
}: {
  items: Item[];
  meta: Meta | null;
  link: "connecting" | "open" | "down";
  onOpenDiff?: (path: string, diff: DiffData) => void;
  onRecall?: (turn: number, text: string, itemId: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const t0 = items[0]?.ts ?? Date.now();
  // Items that existed on the first paint are history: they appear at once.
  // Everything appended later keeps its entrance animation for the life of the
  // node (a class that stays put never replays, and streaming deltas can't cut
  // the wipe short).
  const restored = useRef<Set<string> | null>(null);
  if (restored.current === null) restored.current = new Set(items.map((i) => i.id));
  const [animating, setAnimating] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const fresh = items.filter((i) => !restored.current?.has(i.id)).map((i) => i.id);
    if (!fresh.length) return;
    for (const id of fresh) restored.current?.add(id);
    setAnimating((prev) => {
      const next = new Set(prev);
      for (const id of fresh) next.add(id);
      return next;
    });
  }, [items]);

  const endAnimation = (id: string) =>
    setAnimating((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  if (!items.length) return <Standby meta={meta} link={link} />;

  return (
    <div class="log">
      {items.map((it, i) => {
        const prev = items[i - 1];
        const turn = it.kind === "user" || (it.kind === "assistant" && prev && prev.kind !== "assistant");
        const block = it.kind === "user" || it.kind === "assistant" || it.kind === "summary";
        const animate = animating.has(it.id);
        const cls = `blk${turn ? " turn" : ""}${it.kind === "approval" ? " approval-blk" : ""}${
          animate ? (block ? " anim-wipe" : " anim-in") : ""
        }`;

        if (it.kind === "user") {
          return (
            <div class={cls} key={it.id} data-id={it.id} data-turn="1" onAnimationEnd={(e) => e.animationName === "wipe" && endAnimation(it.id)}>
              {it.skill ? <SkillBlock skill={it.skill} /> : null}
              <MessageRow
                role="user"
                time={`T+${mmss(it.ts - t0)}`}
                text={it.text}
                attachments={it.attachments}
                onRecall={onRecall ? () => onRecall(buildTurns(items).find((tn) => tn.id === it.id)?.n ?? 0, it.text, it.id) : undefined}
              />
              {it.steer || it.queued ? (
                <div class="steer-note" data-tone={it.steer ? "steer" : "queued"}>
                  {it.steer ? "STEERED INTO RUN" : "QUEUED"}
                </div>
              ) : null}
            </div>
          );
        }

        if (it.kind === "assistant") {
          return (
            <div class={cls} key={it.id} data-id={it.id} onAnimationEnd={(e) => e.animationName === "wipe" && endAnimation(it.id)}>
              <MessageRow
                role="assistant"
                time=""
                model={it.usage ? `${fmtTok(it.usage.output)} TOK` : ""}
                text={it.text}
                thinking={it.thinking}
                thinkingOpen={open[it.id] ?? false}
                onToggleThinking={() => setOpen((o) => ({ ...o, [it.id]: !o[it.id] }))}
                streaming={it.streaming}
              />
              {it.errorMessage ? <div class="errbar" style={{ margin: "2px 0 0 88px" }}>{it.errorMessage}</div> : null}
            </div>
          );
        }

        if (it.kind === "tool") {
          const state = it.status === "run" ? "run" : it.status === "error" ? "error" : it.truncated ? "warn" : "ok";
          return (
            <div class={cls} key={it.id}>
              <ToolStrip
                name={it.name}
                icon={toolIcon(it.name)}
                args={it.args}
                output={it.output}
                errorText={it.errorText}
                state={state}
                ms={it.ms}
                exitCode={it.exitCode}
                truncated={it.truncated}
                diff={it.diff}
                onOpenDiff={
                  it.diff && onOpenDiff
                    ? () => onOpenDiff(it.args.split(" / ")[0].split(" ")[0] || it.name, it.diff!)
                    : undefined
                }
                children={it.children}
                agent={it.agent}
                expanded={open[it.id] ?? false}
                onToggle={() => setOpen((o) => ({ ...o, [it.id]: !o[it.id] }))}
              />
            </div>
          );
        }

        if (it.kind === "summary") {
          return (
            <div class={cls} key={it.id} data-id={it.id} onAnimationEnd={(e) => e.animationName === "wipe" && endAnimation(it.id)}>
              <SummaryBlock item={it} />
            </div>
          );
        }

        if (it.kind === "ask") {
          return (
            <div class={cls} key={it.id} data-id={it.id} onAnimationEnd={(e) => e.animationName === "wipe" && endAnimation(it.id)}>
              <AskBlock item={it} />
            </div>
          );
        }

        if (it.kind === "approval") {
          return (
            <div class={cls} key={it.id}>
              <ApprovalDeck
                tool={it.tool}
                args={it.args}
                state={it.status === "always" ? "approved" : it.status}
                onDecide={(d) => actions.approve(it.id, d)}
              />
            </div>
          );
        }

        return (
          <div class={cls} key={it.id}>
            <NoticeRow label={it.label} text={it.text} tone={it.tone} />
          </div>
        );
      })}
    </div>
  );
}
