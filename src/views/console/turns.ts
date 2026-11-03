import type { Item } from "../../api";

/** An exchange: one user message plus everything the agent did for it. */

export type Turn = { id: string; n: number; text: string; ts: number; tools: number; tokens: number; items: number };

export function buildTurns(items: Item[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  for (const it of items) {
    if (it.kind === "user") {
      cur = { id: it.id, n: turns.length + 1, text: it.text, ts: it.ts, tools: 0, tokens: 0, items: 0 };
      turns.push(cur);
      continue;
    }
    if (!cur) continue;
    cur.items++;
    if (it.kind === "tool") cur.tools++;
    if (it.kind === "assistant" && it.usage) cur.tokens += it.usage.output || 0;
  }
  return turns;
}
