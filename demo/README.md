# LCARS Agent Console (pi-web shell)

浏览器里的 LCARS 控制台，底座是真的 `pi` —— 不是静态稿，也没有 mock 数据。

```
demo/
  server.mjs        # 零依赖 Node http + SSE + pi SDK
  public/
    index.html
    lcars.css       # LCARS token / 网格 / 读数条
    app.js          # 事件流 → DOM
```

## 跑起来

```bash
cd /Users/liuyunkai/Projects/design
node demo/server.mjs           # 真会话
node demo/server.mjs --mock    # 回放脚本，不烧 token
# http://127.0.0.1:4173
```

环境变量：

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | `4173` | 端口 |
| `PI_CWD` | `/Users/liuyunkai/Projects/design` | agent 的工作目录（工具作用域） |
| `PI_SDK` | 自动解析 | 指定 pi SDK 入口路径 |

## 架构

```
browser  ──EventSource(/api/stream)──►  server.mjs  ──session.subscribe──►  pi SDK (in-process)
   │                                        │
   └──POST /api/prompt|abort|reset──────────┘
```

- **进程内 SDK**，不是子进程 RPC。`createAgentSession({ cwd, sessionManager: inMemory })`。
- 服务端把 pi 的原始事件（`message_update` / `tool_execution_*` / `auto_retry_*` / `compaction_*` / `queue_update`）**归一化**成 4 种 UI item：`user` / `assistant` / `tool` / `notice`，再广播。
- 前端只认 item，不认 pi 的事件格式；`delta` 走增量，`patch` 走整条更新。
- 断线重连拿一次 `snap`，不丢现场（服务端保留 items）。

## 与画板（`AGENTS.md`）的对应

| 规则 | 落点 |
|---|---|
| 条高 = 权重，不是栅格 | `.tool` 只有 `min-height:40`，高度由输出行数/错误行数撑开 |
| 同一 turn 工具挤紧、turn 之间拉开 | `.log{gap:4px}` + `.row.turn{margin-top:4px}` |
| 失败显示原文 | `renderTool()` 的 `errorText`，整块转 tomato |
| 重试独立成条 | `auto_retry_start` → `notice` 行，不复用失败条 |
| 截断可见 | `truncated` → 琥珀状态条 + `warning: truncated output` |
| 流式可见 | caret 闪烁 + `STREAMING / n TOK/S`，command bar 同步进入生成态 |
| 数字自洽 | 右栏统计、badge、context 百分比全部由 items/usage 实时算 |

## 已知边界（诚实清单）

- `PLAN` 不做：注意 SDK 里**已有** `plan_mode_question` / `plan_mode_complete` 两个工具（来自 `@narumitw/pi-plan-mode` 包），但那给模型用，不是 UI 模式开关。第三个钮是 `NEW`（新 session），不做假状态。
- `03 AGENTS` 是**真实**的：这个 SDK session 实际加载了 21 个工具，其中包含 `Agent` / `SubagentWorkflow` / `steer_subagent` / `get_subagent_result`。面板列的是真实 loadout，只是本次还没调用过。
- `05 SKILLS` 明确标为「未接线」：skills / context files 由 resource loader 注入 system prompt，session API 不暴露清单，所以不猜、不造假。
- 审批（tool permission）没接：需要 `beforeToolCall` 钩子 + 一次前端确认往返，是下一步。
- 只监听 `127.0.0.1`，没有鉴权 —— 它能在这个目录里跑 `bash`，别往公网放。
