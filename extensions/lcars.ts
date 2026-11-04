/**
 * `/lcars` — the console, from inside pi.
 *
 *   /lcars            start the console for this workspace (or reattach to the
 *                     one already running for it) and print the URL
 *   /lcars open       same, and open it in the browser
 *   /lcars status     what is running, and for which workspace
 *   /lcars stop       stop the instance that belongs to this workspace
 *
 * Why a command instead of a tool: this is the operator's action, not the
 * model's. Nothing here is offered to the agent.
 *
 * The extension is deliberately dependency-free — it shells out to the same
 * `bin/pi-lcars.mjs` the CLI uses, so `status` / `stop` / `open` see one set of
 * instance records and there is no second copy of the port-walk logic.
 *
 * The host API is typed locally rather than imported: importing
 * `@earendil-works/pi-coding-agent` would make it a peer dependency of a package
 * that otherwise only needs Node, and the surface used here is three fields.
 */

import { execFile, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/* ------------------------------------------------ the host surface we use */
type Ui = {
  notify(message: string, type?: "info" | "warning" | "error"): void;
  setStatus(key: string, text: string | undefined): void;
};
type CommandCtx = { cwd: string; ui: Ui };
type Command = {
  description?: string;
  handler: (args: string, ctx: CommandCtx) => Promise<void>;
  getArgumentCompletions?: (prefix: string) => { value: string; label: string; description?: string }[] | null;
};
type ExtensionApi = { registerCommand(name: string, command: Command): void };

/* --------------------------------------------------------------- internals */
const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // …/pi-lcars
const LAUNCHER = join(PKG_ROOT, "bin", "pi-lcars.mjs");
const run = promisify(execFile);

type Instance = { pid: number; port: number; url: string; cwd: string; ok: boolean; model?: string; sessions?: number };

/** same directory, even through a symlink or a trailing slash */
function sameDir(a: string, b: string): boolean {
  const norm = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return norm(a) === norm(b);
}

async function list(): Promise<Instance[]> {
  try {
    const { stdout } = await run(process.execPath, [LAUNCHER, "status", "--json"], { timeout: 15_000 });
    const rows = JSON.parse(stdout.trim().split("\n").pop() || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return []; // no instance records at all is the normal "nothing running" case
  }
}

const mine = (rows: Instance[], cwd: string) => rows.filter((r) => sameDir(r.cwd, cwd));

/** start it detached, then wait for the instance record to show up */
async function start(cwd: string): Promise<Instance | null> {
  const errFile = join(tmpdir(), `pi-lcars-${process.pid}-${Date.now()}.err`);
  const child = spawn(process.execPath, [LAUNCHER, "--no-open", "--json", "--cwd", cwd], {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  child.unref();

  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const [found] = mine(await list(), cwd);
    if (found?.ok) return found;
    if (child.exitCode != null && child.exitCode !== 0) {
      throw new Error(firstLine(stderr) || `the launcher exited with ${child.exitCode}`);
    }
  }
  throw new Error(firstLine(stderr) || `no instance answered on this workspace after 20s`);
}

const firstLine = (text: string) => text.trim().split("\n").find((l) => l.trim()) ?? "";

function remember(ctx: CommandCtx, inst: Instance | null) {
  ctx.ui.setStatus("lcars", inst ? `:${inst.port}` : undefined);
}

/** the URL, plus the one thing the operator will want next */
function announce(ctx: CommandCtx, inst: Instance) {
  ctx.ui.notify(`LCARS console ${inst.url}  ·  /lcars stop to shut it down`, "info");
  remember(ctx, inst);
}

/* ----------------------------------------------------------------- command */
export default function (pi: ExtensionApi) {
  pi.registerCommand("lcars", {
    description: "Open the LCARS console for this workspace (start, reattach, status, stop)",
    getArgumentCompletions: (prefix) => {
      const items = [
        { value: "", label: "(start)", description: "start the console for this workspace" },
        { value: "open", label: "open", description: "start it and open the browser" },
        { value: "status", label: "status", description: "what is running, and where" },
        { value: "stop", label: "stop", description: "stop this workspace's console" },
      ];
      const p = prefix.trim().toLowerCase();
      return items.filter((i) => i.value.startsWith(p));
    },
    handler: async (args, ctx) => {
      const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

      if (sub === "status") {
        const rows = await list();
        if (!rows.length) {
          ctx.ui.notify("no pi-lcars instance running", "info");
          remember(ctx, null);
          return;
        }
        remember(ctx, mine(rows, ctx.cwd)[0] ?? null);
        const lines = rows.map(
          (r) => `${r.url}  ${r.cwd}  ${r.model ?? "?"}  ${r.sessions ?? 0} session(s)${r.ok ? "" : "  (not answering)"}`,
        );
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (sub === "stop") {
        const [target] = mine(await list(), ctx.cwd);
        if (!target) {
          ctx.ui.notify("no console is running for this workspace", "warning");
          remember(ctx, null);
          return;
        }
        try {
          await run(process.execPath, [LAUNCHER, "stop", "--port", String(target.port)], { timeout: 20_000 });
          ctx.ui.notify(`stopped ${target.url}`, "info");
        } catch (e) {
          ctx.ui.notify(`could not stop ${target.url}: ${(e as Error).message}`, "error");
        }
        remember(ctx, null);
        return;
      }

      // start, or reattach to the instance that already serves this workspace
      const [running] = mine(await list(), ctx.cwd);
      if (running?.ok) {
        announce(ctx, running);
        if (sub === "open") await run(process.execPath, [LAUNCHER, "open", "--port", String(running.port)]).catch(() => {});
        return;
      }

      try {
        const inst = await start(ctx.cwd);
        if (!inst) throw new Error("the instance started but never answered");
        announce(ctx, inst);
        if (sub === "open") {
          await run(process.execPath, [LAUNCHER, "open", "--port", String(inst.port)]).catch(() => {});
        }
      } catch (e) {
        ctx.ui.notify(`could not start the console: ${(e as Error).message}`, "error");
        remember(ctx, null);
      }
    },
  });
}
