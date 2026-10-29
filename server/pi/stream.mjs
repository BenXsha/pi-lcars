import { now, shortArgs, textOf, truncationOf } from "./format.mjs";

/**
 * pi session events → normalized UI items.
 *
 * The browser never sees pi's event shape. Items are:
 *   user | assistant | tool | notice | approval
 * Everything is keyed by a stable id so the client can patch in place.
 */
export function applyEvent(entry, ev) {
  if (process.env.LCARS_TRACE) console.log("[ev]", ev.type, ev.type === "message_update" ? ev.assistantMessageEvent?.type : "");
  switch (ev.type) {
    case "message_start":
      if (ev.message?.role === "assistant") {
        const id = `a${entry.nextId()}`;
        entry.cur = id;
        entry.emit({ kind: "assistant", id, text: "", thinking: "", streaming: true, ts: now() });
        entry.running = true;
        entry.pushMeta();
      }
      break;

    case "message_update": {
      const a = ev.assistantMessageEvent;
      if (!entry.cur) break;
      if (a?.type === "text_delta") entry.delta(entry.cur, "text", a.delta);
      else if (a?.type === "thinking_delta") entry.delta(entry.cur, "thinking", a.delta);
      break;
    }

    case "message_end": {
      const msg = ev.message;
      if (msg?.role !== "assistant" || !entry.cur) break;
      const id = entry.cur;
      const content = msg.content || [];
      const text = textOf(content) || entry.byId.get(id)?.text || "";
      const thinking =
        content.filter((c) => c?.type === "thinking").map((c) => c.thinking).join("") ||
        entry.byId.get(id)?.thinking ||
        "";
      entry.patch(id, {
        text,
        thinking,
        streaming: false,
        stopReason: msg.stopReason,
        errorMessage: msg.errorMessage,
        usage: msg.usage
          ? {
              input: msg.usage.input,
              output: msg.usage.output,
              cost: msg.usage.cost?.total ?? 0,
              total: msg.usage.totalTokens,
            }
          : undefined,
      });
      if (msg.usage) {
        entry.usage.input += msg.usage.input || 0;
        entry.usage.output += msg.usage.output || 0;
        entry.usage.cost += msg.usage.cost?.total || 0;
        entry.usage.total = msg.usage.totalTokens || entry.usage.total;
      }
      entry.cur = null;
      entry.pushMeta();
      break;
    }

    case "tool_execution_start":
      entry.emit({
        kind: "tool",
        id: `t${ev.toolCallId}`,
        callId: ev.toolCallId,
        name: ev.toolName,
        args: shortArgs(ev.toolName, ev.args),
        status: "run",
        output: "",
        ts: now(),
      });
      break;

    case "tool_execution_update": {
      const id = `t${ev.toolCallId}`;
      if (!entry.byId.has(id)) break;
      const out = textOf(ev.partialResult?.content);
      if (out && out.length > (entry.byId.get(id).output?.length || 0)) entry.patch(id, { output: out });
      break;
    }

    case "tool_execution_end": {
      const id = `t${ev.toolCallId}`;
      const out = textOf(ev.result?.content);
      entry.patch(id, {
        status: ev.isError ? "error" : "ok",
        output: out,
        ms: ev.durationMs,
        truncated: truncationOf(ev.result, out),
      });
      break;
    }

    case "auto_retry_start":
      entry.emit({
        kind: "notice",
        id: `r${entry.nextId()}`,
        tone: "warn",
        label: "RETRY",
        text: `${ev.attempt}/${ev.maxAttempts} · ${ev.errorMessage}`,
        ts: now(),
      });
      break;

    case "auto_retry_end":
      if (!ev.success) {
        entry.emit({
          kind: "notice",
          id: `rf${entry.nextId()}`,
          tone: "error",
          label: "RETRY",
          text: `gave up after ${ev.attempt} · ${ev.finalError || "unknown"}`,
          ts: now(),
        });
      }
      break;

    case "compaction_start":
      entry.emit({
        kind: "notice",
        id: `c${entry.nextId()}`,
        tone: "info",
        label: "COMPACT",
        text: `compacting context (${ev.reason})`,
        ts: now(),
      });
      break;

    case "compaction_end":
      if (ev.errorMessage) {
        entry.emit({
          kind: "notice",
          id: `ce${entry.nextId()}`,
          tone: "error",
          label: "COMPACT",
          text: ev.errorMessage,
          ts: now(),
        });
      }
      break;

    case "queue_update":
      entry.meta.queue = { steering: ev.steering?.length || 0, followUp: ev.followUp?.length || 0 };
      entry.pushMeta();
      break;

    case "agent_end":
      entry.running = false;
      entry.pushMeta();
      break;

    case "agent_settled":
      entry.running = false;
      if (entry.cur) {
        entry.patch(entry.cur, { streaming: false });
        entry.cur = null;
      }
      entry.pushMeta();
      break;

    case "turn_end":
      if (ev.message?.role === "assistant") entry.cur = null;
      break;

    default:
      break;
  }
}
