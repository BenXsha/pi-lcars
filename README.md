# pi-lcars

A web console for [pi](https://pi.dev) where the agent transcript reads like an LCARS station display —
**but every pixel is driven by real session events.** No mock data, no scripted demo.

```
┌─ SPINE ─┬──────────── WORKSPACE ────────────┬─ RAIL ──┐
│ sessions│ SHELF   workspace · model · think │ context │
│ 01..06  │ TAB BAR  A · B · +                │ tools   │
│         │ TRANSCRIPT (streams, diffs…)      │ agents  │
│         │ COMPOSER  ENTRY ▸ [ ] RUN STOP    │ approval│
└─────────┴───────────────────────────────────┴─────────┘
```

## Run

One command boots the pi backend, the UI and the browser — the client is served
by the same Node process that hosts the SDK, so there is nothing else to start.

```bash
npx pi-lcars            # from anywhere; builds the client on first run
npm i -g pi-lcars       # or install it, then just `pi-lcars`
```

```
  pi-lcars              start, open the browser
  pi-lcars --dev        vite dev server with HMR on :5173
  pi-lcars doctor       check the pi backend, print the fix when it is missing
  pi-lcars status       running instances (pid, port, cwd, model)
  pi-lcars stop         stop the newest instance
```

`--cwd <dir>` sets the workspace, `--port` the first port to try (it walks up
when busy), `--host` the bind address, `--policy off|risky|all` the approval
gate, `--json` prints `{url,port,pid,cwd}` on the first stdout line.

### Requirements

- Node **>= 22.19** (pi's own minimum)
- pi itself — the installer (`curl -fsSL https://pi.dev/install.sh | sh`, or
  `irm https://pi.dev/install.ps1` on Windows) or
  `npm i -g --ignore-scripts @earendil-works/pi-coding-agent`

`pi-lcars doctor` finds the backend automatically: `PI_SDK` → project
`node_modules` → `<agent>/install/releases/*` (newest release that answers the
SDK API the console calls) → npm global root. Nothing installed? It prints the
platform-correct install command instead of failing with a stack trace.

### Development

```bash
npm install
npm run dev      # client at :5173, proxies /api → :4173
npm run server   # in another shell: real pi session, SSE on :4173
npm test         # pi-env (18) + endpoints (50) + launcher (28) + ui (61) checks

SMOKE_MODEL=1 npm test   # also does one real turn + fork (costs a model call)
```

| env | default | purpose |
|---|---|---|
| `PORT` | `4173` | first port to try |
| `HOST` | `127.0.0.1` | bind address (no auth — keep it loopback) |
| `PI_CWD` | `process.cwd()` | workspace the agent runs in |
| `LCARS_SESSIONS` | pi default | where transcripts are written |
| `LCARS_POLICY` | `off` | approval gate: `off` / `risky` / `all` |
| `LCARS_TRUST_PROJECT` | `1` | load project `.pi/` extensions |
| `LCARS_RESUME` | `0` | `1` = resume the newest session in the workspace on boot |
| `LCARS_STATE_DIR` | `~/.pi/agent/lcars` | instance records for `status` / `stop` |
| `PI_SDK` | auto-resolved | explicit path to (or specifier of) the pi SDK |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | pi config dir, honoured everywhere |

## Layout

```
bin/pi-lcars.mjs   launcher: args, build-if-stale, port walk, status/stop/doctor
server/            Node, no runtime deps beyond the pi SDK
  index.mjs        start(opts): http + SSE + routes
  pi/sdk.mjs       pi backend discovery: PI_SDK → node_modules → releases → npm -g
  pi/registry.mjs  session lifecycle, transcript items, meta
  pi/queue.mjs     one global run at a time
  pi/approval.mjs  blocking tool approval gate (inline pi extension)
  pi/stream.mjs    pi events → UI items
src/               Vite + Preact + TS client
  styles/          tokens (structure) + themes (colour) + lcars (components)
  components/      Elbow · ToolStrip · ApprovalDeck · FieldRow · Icon …
  views/Craft.tsx  craft layer, the visual contract in one page
  icons.ts         generated: remixicon -fill paths (56 icons, no font)
demo/              v0 vanilla implementation, kept for reference
boards/            MasterGo frames (v1 skeleton, v2 real stream)
AGENTS.md          the design contract — read before touching UI (repo only, not published)
PLAN.md            milestone plan (M0..M9) (repo only, not published)
```

## API

| method | path | notes |
|---|---|---|
| GET | `/api/bootstrap` | sessions, active meta, policy, items |
| GET | `/api/stream` | single SSE channel; events carry `sessionId` |
| GET | `/api/state` | same + queue snapshot (debugging) |
| POST | `/api/session` | `{op: new\|open\|fork\|activate\|rename\|delete}` |
| POST | `/api/prompt` | steers the running session, otherwise queues |
| POST | `/api/abort` | cancels queued work, denies pending approvals |
| POST | `/api/approve` | `{id, decision: approve\|deny\|always}` |
| POST | `/api/policy` | `off` / `risky` / `all` |
| POST | `/api/model` | `{provider, model}` — takes effect next turn |
| POST | `/api/thinking` | `off` / `low` / `medium` / `high` (reports `clamped`) |
| GET | `/api/models` | available models for the active session |
| GET | `/api/fs?path=` | directories only, for the workspace picker |
| GET | `/api/mcp` | servers from `mcp.json` (global + project overrides) |
| POST | `/api/mcp` | `{op: toggle\|add\|remove}` — writes with a `.bak` backup |

## Screens

- `/` — the console: left rail (session list + MCP / SKILLS / PROVIDERS / HISTORY / SYSTEM / ABOUT),
  shelf controls (model / thinking), live transcript, pinned composer, resources rail.
  Stations are hash-addressable: `/#about`, `/#providers`, …
- `/?craft` — the primitive sheet (elbows, motion, icons, form language, themes),
  i.e. the visual contract on one page.

## Keyboard

| keys | action |
|---|---|
| `⌥1` – `⌥6` (`Alt 1` – `Alt 6`) | jump to a station — the numbers on the rail are the combos |
| `⌥0` (`Alt 0`) | back to the mission log |
| `⌘K` / `Ctrl K` | focus the composer |
| `Enter` | send (steers while a run is active) |
| `Shift+Enter` | newline |
| `Esc` | close a deck / tree / viewer, else stop the current run |
| `⌘B` | collapse / expand the left rail (64px icon rail when collapsed) |
| `⌘⇧B` | collapse / expand the resources rail |

## Non-obvious behaviour

- **One run at a time.** A second prompt queues and starts when the slot frees. Prompts aimed at the
  running session are steered into it instead of queueing.
- **The approval gate is a pi extension**, not a transport hack: it awaits the operator inside the
  `tool_call` hook, so a denial surfaces to the model as a normal tool error.
- **Fork needs a transcript.** Forking a session with no turns returns `409 E_EMPTY`.
- **Boot does not resume.** A fresh console starts a new session; resuming the newest one
  (which may be your CLI session, with its context and token history) is opt-in via `LCARS_RESUME=1`.
- **MCP edits are written to disk**, not applied live: the next session picks them up. Every write keeps
  a `.bak` next to the file.
- **Binding is loopback only** and there is no auth — this process can run `bash` in `PI_CWD`.
