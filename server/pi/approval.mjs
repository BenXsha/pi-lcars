import { shortArgs, now } from "./format.mjs";

const RISKY = new Set(["bash", "powershell", "write", "edit", "patch"]);

/**
 * Blocking approval gate.
 *
 * Implemented as an inline pi extension: `tool_call` fires before the tool
 * executes, so awaiting the operator's answer in that handler holds the call.
 * A denied/timed-out call returns `{block: true}` and the agent sees a normal
 * tool error — no special casing in the transport.
 */
export class Approvals {
  constructor({ policy = "off", timeoutMs = 120_000 } = {}) {
    this.policy = policy;
    this.timeoutMs = timeoutMs;
    /** @type {Map<string, {entry: any, tool: string, resolve: (d: string) => void, timer: any}>} */
    this.pending = new Map();
    this.always = new Set();
    this.wired = false;
  }

  get snapshot() {
    return { policy: this.policy, pending: this.pending.size, always: [...this.always], timeoutMs: this.timeoutMs };
  }

  gated(tool) {
    if (this.policy === "off") return false;
    if (this.always.has(tool)) return false;
    return this.policy === "all" || RISKY.has(tool);
  }

  setPolicy(mode) {
    if (!["off", "risky", "all"].includes(mode)) throw new Error("policy must be off | risky | all");
    this.policy = mode;
    // turning the gate off releases whatever it was holding
    if (mode === "off") for (const id of [...this.pending.keys()]) this.settle(id, "approve");
    return this.snapshot;
  }

  ask(entry, { tool, args, callId }) {
    const id = `ap${callId}`;
    const decision = new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(id, "timeout"), this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { entry, tool, resolve, timer });
    });
    entry.emit({
      kind: "approval",
      id,
      callId,
      tool,
      args: shortArgs(tool, args),
      status: "pending",
      timeoutMs: this.timeoutMs,
      ts: now(),
    });
    entry.pushMeta();
    return decision;
  }

  settle(id, decision) {
    const p = this.pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(id);

    const status =
      decision === "approve" ? "approved" : decision === "always" ? "always" : decision === "timeout" ? "timeout" : "denied";
    const item = p.entry.byId.get(id);
    p.entry.patch(id, { status, decidedMs: item ? now() - item.ts : 0 });

    if (decision === "always") {
      this.always.add(p.tool);
      p.entry.emit({
        kind: "notice",
        id: `alw-${now()}`,
        tone: "warn",
        label: "POLICY",
        text: `${p.tool} auto-approved for the rest of this session`,
        ts: now(),
      });
    }
    p.entry.pushMeta();
    p.resolve(decision);
    return true;
  }

  denyAll(entry, reason = "deny") {
    for (const [id, p] of [...this.pending.entries()]) {
      if (p.entry === entry) this.settle(id, reason);
    }
  }

  /** inline extension factory bound to one session entry */
  factoryFor(entry) {
    return (pi) => {
      this.wired = true;
      pi.on("tool_call", async (ev) => {
        // nested calls (a tool invoking another tool) inherit the parent decision
        if (ev.parentToolCallId) return;
        if (!this.gated(ev.toolName)) return;
        const decision = await this.ask(entry, { tool: ev.toolName, args: ev.input, callId: ev.toolCallId });
        if (decision === "approve" || decision === "always") return;
        return {
          block: true,
          reason:
            decision === "timeout"
              ? `approval gate: no operator response in ${Math.round(this.timeoutMs / 1000)}s`
              : "denied by operator on the LCARS console",
        };
      });
    };
  }
}
