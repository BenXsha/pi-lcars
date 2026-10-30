import { now } from "./format.mjs";

/**
 * Dialog surface for extensions.
 *
 * pi's extensions ask the host for `select / confirm / input` and render their
 * own TUI overlay through `custom()`. A browser cannot host the overlay, but the
 * primitives are enough: `ask_user_question` (and anything else built on them)
 * falls back to a sequential dialog walk when the host answers
 * `hasUI` and implements select/input. Those calls become transcript items here
 * and resolve when the operator answers.
 */
export class Dialogs {
  constructor({ timeoutMs = 300_000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.n = 0;
  }

  #open(entry, req) {
    const id = `dlg${++this.n}-${now()}`;
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => this.#settle(id, undefined, "timeout"), this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { entry, resolve, timer });
    });
    entry.emit({ kind: "ask", id, status: "pending", ts: now(), ...req });
    entry.pushMeta();
    return promise;
  }

  #settle(id, value, status = "answered") {
    const p = this.pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.entry.patch(id, { status, value: typeof value === "string" ? value : value === true ? "Yes" : value === false ? "No" : undefined });
    p.entry.pushMeta();
    p.resolve(value);
    return true;
  }

  /** The browser answered (or dismissed, with null). */
  answer(id, value) {
    if (value === null || value === undefined) return this.#settle(id, undefined, "cancelled");
    return this.#settle(id, value);
  }

  cancelFor(entry) {
    for (const [id, p] of [...this.pending.entries()]) if (p.entry === entry) this.#settle(id, undefined, "cancelled");
  }

  get count() {
    return this.pending.size;
  }

  /** ExtensionUIContext, minus everything that only makes sense in a terminal. */
  context(entry) {
    const noop = () => {};
    return {
      select: (title, options) => this.#open(entry, { mode: "select", title, options }),
      confirm: (title, message) => this.#open(entry, { mode: "confirm", title, message }),
      input: (title, placeholder) => this.#open(entry, { mode: "input", title, placeholder }),
      editor: (title, prefill) => this.#open(entry, { mode: "input", title, placeholder: prefill }),
      notify: (message, type) =>
        entry.emit({
          kind: "notice",
          id: `nt${now()}`,
          tone: type === "error" ? "error" : type === "warning" ? "warn" : "info",
          label: "EXT",
          text: message,
          ts: now(),
        }),
      onTerminalInput: () => noop,
      setStatus: noop,
      setWorkingMessage: noop,
      setWorkingVisible: noop,
      setWorkingIndicator: noop,
      setHiddenThinkingLabel: noop,
      setWidget: noop,
      setFooter: noop,
      setHeader: noop,
      setTitle: noop,
      pasteToEditor: noop,
      setEditorText: noop,
      getEditorText: () => "",
      addAutocompleteProvider: noop,
      setEditorComponent: noop,
      getEditorComponent: () => undefined,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: true }),
      getToolsExpanded: () => false,
      setToolsExpanded: noop,
      // no overlay renderer in a browser: the RPC walker takes over instead
      custom: async () => undefined,
    };
  }
}
