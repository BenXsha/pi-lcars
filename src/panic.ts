/**
 * Panic surface: an uncaught error must never leave a blank LCARS screen.
 *
 * It renders the message and stack in the console's own language, keeps the
 * detail copyable, and posts a one-line report to the server so the terminal
 * that started `pi-lcars` shows what the browser hit — no DevTools required.
 */

type Detail = { message: string; stack?: string; source: string };

/**
 * Messages that arrive as `error` events but describe the browser's own
 * scheduling, not a fault of ours. Chrome fires the ResizeObserver notice on
 * `window.onerror` with no stack, and it reproduced on every HISTORY visit —
 * replacing the console with a SCRIPT ERROR screen for a warning. Nothing is
 * actionable about them, so they are logged and skipped.
 */
const BENIGN: RegExp[] = [
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i,
  /^Script error\.?$/i, // cross-origin script: no message, no source, no stack
];

export const isBenignError = (message: string): boolean => BENIGN.some((re) => re.test(String(message).trim()));

let installed = false;
let reporting = false;

function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: value.message || String(value), stack: value.stack };
  if (typeof value === "string") return { message: value };
  try {
    return { message: JSON.stringify(value) };
  } catch {
    return { message: String(value) };
  }
}

function report(detail: Detail) {
  // best effort: a crashing page may also have a broken connection
  try {
    const body = JSON.stringify({
      message: detail.message.slice(0, 2000),
      stack: (detail.stack ?? "").slice(0, 6000),
      source: detail.source,
      href: location.href,
      ua: navigator.userAgent,
    });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/client-error", new Blob([body], { type: "application/json" }));
    else void fetch("/api/client-error", { method: "POST", body, keepalive: true });
  } catch {
    /* ignore */
  }
}

function paint(detail: Detail) {
  if (reporting) return; // the panic UI itself must not recurse
  reporting = true;
  report(detail);

  const root = document.getElementById("root") ?? document.body;
  const wrap = document.createElement("div");
  wrap.className = "panic";

  const head = document.createElement("div");
  head.className = "panic-head";
  const bar = document.createElement("span");
  bar.className = "st";
  const title = document.createElement("span");
  title.className = "ttl";
  title.textContent = "SYSTEM FAULT";
  head.append(bar, title);

  const msg = document.createElement("div");
  msg.className = "panic-msg";
  msg.textContent = detail.message;

  const where = document.createElement("div");
  where.className = "panic-sub";
  where.textContent = `${detail.source} · ${location.pathname}`;

  const pre = document.createElement("pre");
  pre.className = "panic-stack";
  pre.textContent = detail.stack ?? "(no stack)";

  const actions = document.createElement("div");
  actions.className = "panic-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "COPY REPORT";
  copy.onclick = () => {
    const text = `${detail.source}: ${detail.message}\n\n${detail.stack ?? ""}\n\n${location.href}\n${navigator.userAgent}`;
    navigator.clipboard?.writeText(text).then(
      () => {
        copy.textContent = "COPIED";
      },
      () => {
        copy.textContent = "CLIPBOARD BLOCKED";
      },
    );
  };
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "RELOAD CONSOLE";
  reload.onclick = () => location.reload();
  actions.append(copy, reload);

  wrap.append(head, msg, where, pre, actions);
  root.replaceChildren(wrap);
}

export function installPanicSurface() {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (e) => {
    const { message, stack } = describe(e.error ?? e.message);
    if (isBenignError(message)) return;
    paint({ message, stack, source: e.filename ? "script error" : "runtime error" });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const { message, stack } = describe(e.reason);
    if (isBenignError(message)) return;
    paint({ message, stack, source: "unhandled rejection" });
  });

  // Preact rethrows render errors through the scheduler; a thrown value that
  // never reaches window still lands here on the next paint in most browsers.
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    originalError(...args);
    const first = args.find((a) => a instanceof Error) as Error | undefined;
    if (first && /render|diff|component/i.test(first.stack ?? "")) {
      paint({ message: first.message, stack: first.stack, source: "render error" });
    }
  };
}

/**
 * `?trace=1` mirrors every key event and focus change to the server, so a
 * freeze that kills the tab still leaves a trail in the launcher terminal.
 * Diagnostic only — it is not installed without the query flag.
 */
export function installInputTrace() {
  if (!new URLSearchParams(location.search).has("trace")) return;
  const send = (line: string) => report({ message: `trace: ${line}`, stack: "", source: "trace" });

  window.addEventListener(
    "keydown",
    (e) => {
      const el = e.target as HTMLElement | null;
      (window as unknown as { __lcarsLast?: string }).__lcarsLast = `keydown ${JSON.stringify(e.key)} on ${el?.tagName ?? "?"}`;
      send(`keydown key=${JSON.stringify(e.key)} code=${e.code} target=${el?.tagName ?? "?"} prevented=${e.defaultPrevented}`);
    },
    true,
  );
  window.addEventListener("focusin", (e) => {
    const el = e.target as HTMLElement | null;
    send(`focusin target=${el?.tagName ?? "?"} cls=${el?.className ?? ""}`);
  });
  send("trace installed");
}

/**
 * Watchdog: a Web Worker keeps ticking while the main thread is blocked, so a
 * freeze that ends in a renderer kill still leaves evidence. It reports how long
 * the main thread was unresponsive and the last interaction we saw.
 */
export function installWatchdog() {
  if (!new URLSearchParams(location.search).has("trace")) return;
  try {
    const source = `
      let lastAt = Date.now();
      let lastLabel = "start";
      onmessage = (e) => { lastAt = Date.now(); lastLabel = e.data || lastLabel; };
      setInterval(() => {
        const gap = Date.now() - lastAt;
        if (gap > 900) {
          fetch("/api/client-error", {
            method: "POST",
            keepalive: true,
            body: JSON.stringify({ message: "STALL " + gap + "ms last=" + lastLabel, source: "watchdog" }),
          }).catch(() => {});
        }
      }, 250);
    `;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url);
    const beat = () => {
      const label = (window as unknown as { __lcarsLast?: string }).__lcarsLast ?? "idle";
      try {
        worker.postMessage(label);
      } catch {
        /* terminated */
      }
    };
    beat();
    setInterval(beat, 250);
    window.addEventListener("beforeunload", () => worker.terminate());
  } catch {
    /* workers unavailable — the keydown trace still applies */
  }
}
