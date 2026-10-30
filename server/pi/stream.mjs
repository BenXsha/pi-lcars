import { now, shortArgs, textOf, truncationOf } from "./format.mjs";
import { diffFromResult, diffFromWrite } from "./diff.mjs";

/**
 * pi session events → normalized UI items.
 *
 * The browser never sees pi's event shape. Items are:
 *   user | assistant | tool | notice | approval
 * Everything is keyed by a stable id so the client can patch in place.
 */
const MAX_CHILDREN = 80;

/** The subagent tool reports a compact summary instead of nested calls. */
function agentMeta(details) {
  if (!details || typeof details !== "object") return null;
  if (details.subagentType === undefined && details.toolUses === undefined) return null;
  return {
    name: details.displayName ?? details.subagentType ?? "agent",
    type: details.subagentType ?? "",
    model: details.modelName ?? "",
    tools: details.toolUses ?? 0,
    tokens: details.tokens ?? 0,
    cost: details.cost ?? 0,
    turns: details.turnCount ?? 0,
    status: details.status ?? "ok",
    agentId: details.agentId ?? "",
  };
}

/** ToolResultMessage.nestedCalls → children[] (used when the subagent runs its
 *  own loop and does not emit parentToolCallId events into this session). */
function nestedChildren(nested) {
  const calls = nested?.calls;
  if (!Array.isArray(calls) || !calls.length) return null;
  return calls.slice(0, MAX_CHILDREN).map((c) => ({
    id: c.id,
    name: c.name,
    args: shortArgs(c.name, c.arguments),
    status: c.status === "error" ? "error" : c.status === "ok" ? "ok" : "run",
    ms: c.durationMs,
    ts: now(),
  }));
}

/** Attach a subagent's tool call to the item that spawned it. */
function childPatch(entry, parentId, childId, fields) {
  const parent = entry.byId.get(parentId);
  if (!parent) return false;
  const kids = parent.children ?? [];
  const i = kids.findIndex((c) => c.id === childId);
  if (i === -1) return false;
  kids[i] = { ...kids[i], ...fields };
  entry.patch(parentId, { children: kids.slice() });
  return true;
}

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
      if (msg?.role === "toolResult") {
        const kids = nestedChildren(msg.nestedCalls);
        if (kids) entry.patch(`t${msg.toolCallId}`, { children: kids });
        break;
      }
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

    case "tool_execution_start": {
      entry.rawCalls?.set(ev.toolCallId, ev.args);
      if (ev.parentToolCallId) {
        const parentId = `t${ev.parentToolCallId}`;
        const parent = entry.byId.get(parentId);
        if (parent) {
          const kids = (parent.children ?? []).slice(0, MAX_CHILDREN);
          kids.push({
            id: ev.toolCallId,
            name: ev.toolName,
            args: shortArgs(ev.toolName, ev.args),
            status: "run",
            ts: now(),
          });
          entry.childOwner?.set(ev.toolCallId, parentId);
          entry.patch(parentId, { children: kids });
          break;
        }
      }
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
    }

    case "tool_execution_update": {
      const id = `t${ev.toolCallId}`;
      if (entry.childOwner?.has(ev.toolCallId)) break; // children show status only
      if (!entry.byId.has(id)) break;
      const out = textOf(ev.partialResult?.content);
      if (out && out.length > (entry.byId.get(id).output?.length || 0)) entry.patch(id, { output: out });
      break;
    }

    case "tool_execution_end": {
      const id = `t${ev.toolCallId}`;
      const owner = entry.childOwner?.get(ev.toolCallId);
      if (owner) {
        childPatch(entry, owner, ev.toolCallId, {
          status: ev.isError ? "error" : "ok",
          ms: ev.durationMs,
        });
        entry.childOwner.delete(ev.toolCallId);
        break;
      }
      const out = textOf(ev.result?.content);
      const nestedKids = nestedChildren(ev.result?.details?.nestedCalls);
      const agent = agentMeta(ev.result?.details);
      let diff = diffFromResult(ev.result?.details);
      if (!diff && ev.toolName === "write" && !ev.isError) {
        const args = entry.rawCalls?.get(ev.toolCallId);
        diff = diffFromWrite(args?.content, args?.path);
      }
      entry.rawCalls?.delete(ev.toolCallId);
      entry.patch(id, {
        status: ev.isError ? "error" : "ok",
        output: out,
        ms: ev.durationMs,
        truncated: truncationOf(ev.result, out),
        ...(diff ? { diff } : {}),
        ...(nestedKids ? { children: nestedKids } : {}),
        ...(agent ? { agent } : {}),
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
      // keep the texts so the composer can show what is waiting
      entry.meta.queue = {
        steering: (ev.steering ?? []).slice(0, 5),
        followUp: (ev.followUp ?? []).slice(0, 5),
      };
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
