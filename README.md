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

```bash
npm install

npm run dev      # client at :5173, proxies /api → :4173
npm run server   # in another shell: real pi session, SSE on :4173
npm test         # 31 endpoint checks against a throwaway session dir

SMOKE_MODEL=1 npm test   # also does one real turn + fork (costs a model call)
```

Production: `npm run build && npm run server` → everything on http://127.0.0.1:4173

| env | default | purpose |
|---|---|---|
| `PORT` | `4173` | server port |
| `PI_CWD` | `process.cwd()` | workspace the agent runs in |
| `LCARS_SESSIONS` | `~/.pi/agent/sessions` | where transcripts are written |
| `LCARS_POLICY` | `off` | approval gate: `off` / `risky` / `all` |
| `LCARS_TRUST_PROJECT` | `1` | load project `.pi/` extensions |
| `LCARS_RESUME` | `0` | `1` = resume the newest session in the workspace on boot |
| `PI_SDK` | auto-resolved | explicit path to the pi SDK |

## Layout

```
server/            Node, no runtime deps beyond the pi SDK
  index.mjs        http + SSE + routes
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
AGENTS.md          the design contract — read before touching UI
PLAN.md            milestone plan (M0..M8)
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

## Screens

- `/` — the console: spine stations, shelf controls (workspace / model / thinking),
  tab bar, live transcript, resources rail.
- `/?craft` — the primitive sheet (elbows, motion, icons, form language, themes),
  i.e. the visual contract on one page.

## Non-obvious behaviour

- **One run at a time.** A second prompt queues and starts when the slot frees. Prompts aimed at the
  running session are steered into it instead of queueing.
- **The approval gate is a pi extension**, not a transport hack: it awaits the operator inside the
  `tool_call` hook, so a denial surfaces to the model as a normal tool error.
- **Fork needs a transcript.** Forking a session with no turns returns `409 E_EMPTY`.
- **Boot does not resume.** A fresh console starts a new session; resuming the newest one
  (which may be your CLI session, with its context and token history) is opt-in via `LCARS_RESUME=1`.
- **Binding is loopback only** and there is no auth — this process can run `bash` in `PI_CWD`.
