# PLAN — pi-lcars 真实项目化

> 目标：从「单会话 demo」升级为**标准 agent GUI 客户端**（Codex / Trae 的形态），
> 但把两件事做成产品差异：**LCARS 输出流** 与 **LCARS 配置表单**。
> 本文只写方案与验收，不写实现。实现按里程碑推进，每个里程碑可独立评审。

---

## 0. 现状差距

| 能力 | 现在 | 目标 |
|---|---|---|
| 会话 | 1 个，进程内存，刷新即换新 | 多会话、落盘、可恢复、可 fork |
| 历史 | 无 | 列表 / 搜索 / 打开 / 改名 / 删除 |
| Provider | 吃 `~/.pi/agent` 默认值 | 可视化增删改 + 连通性测试 + 默认模型 |
| Skills | 只读清单 | 开关 / 重载 / 定位文件 / 触发方式 |
| MCP | 继承 pi 自身配置，界面不可见 | 服务器 CRUD + 连接状态 + 工具清单 + exposure |
| 输出流 | 纯文本 pre-wrap | Markdown + 代码高亮 + 复制 |
| Diff | 显示 `+18 -2` 一行字 | 逐 hunk 的差异对比 |
| 子 agent | 一行 `AGENT … LIVE` | 嵌套转录 + 实时阶段 + 计数 |
| 配置层 | 无 | 统一的 LCARS 表单语言（§4） |
| 测试 | 手动 playwright | 冒烟脚本 + 提交前门禁 |

## 1. 目标形态（IA）

```
┌─ SPINE ─┬────────────── WORKSPACE ───────────────┬─ RAIL ──┐
│ 会话列表 │ SHELF  工作区~/x · 模型 · 思考 · T+ · ctx │ 上下文 │
│          ├──────────────────────────────────────┤ 工具    │
│          │ CONTROL DECK（点 shelf 控件时就地展开） │ 子 agent│
│          │ TAB BAR  会话A · 会话B · +            │ 审批    │
│ (可滚动) │                                        │ 工具    │
│          │ TRANSCRIPT（滚动区，唯一滚动）        │ 子 agent│
│  ──────  │  · 用户块 / 助手块 / 工具读数条         │ 审批    │
│ 01 SESS  │  · 代码块 / 差异块 / 子 agent 舱        │ 失败    │
│ 02 TOOLS │                                        │         │
│ 03 AGENT │                                        │         │
│ 04 CTX   │ COMPOSER  ENTRY ▸ [ ... ]  RUN STOP    │         │
│ 05 SKILL │                                        │         │
│ 06 SYS   │ STATUS  model · tok/s · ctx · cost      │         │
└──────────┴────────────────────────────────────────┴─────────┘
设置以「全屏 sheet」覆盖 workspace（06 SYSTEM / 02 TOOLS / 05 SKILLS 里的配置入口），
不弹小窗 —— LCARS 里没有浮层小卡片。
```

**屏幕清单**（每块单独验收）

| # | 屏幕 | 内容 |
|---|---|---|
| S1 | Transcript | 消息流、工具条、代码、diff、子 agent 舱、审批、通知 |
| S2 | Sessions | 标签页 + 左侧会话列表（当前/最近/按项目分组） |
| S3 | History | 全量会话表：名称、cwd、首句、消息数、修改时间、fork 谱系 |
| S4 | Provider | provider 列表 + 详情表单 + 模型清单 + 测试 |
| S5 | MCP | 服务器表 + 传输配置 + 探测 + 工具 exposure |
| S6 | Skills | 清单 + model-invocation 开关 + 重载 + 文件定位 |
| S7 | Context | 分段条 + token/费用 + compaction 记录 |
| S8 | Policy | off / risky / all + 超时 + always 清单 |
| S9 | Tools | loadout 表 + 每工具调用统计 |
| S10 | 工作区选择 | 新建 / 切会话时选 cwd：路径面包屑 + 目录列表 + 最近使用 |
| S11 | 模型选择 | 按 provider 分组的模型表：id、context window、cost、当前标记 |
| S12 | 思考开关 | OFF / LOW / MED / HIGH 四段控件（shelf 上直接循环，deck 里展开选择） |

**三条会话级控件的落位（都属于 M0，不是配置页）**
- 工作区：只影响**新会话**。已开会话的 cwd 不可改（pi 的 context/工具作用域绑定 cwd），
  UI 上必须显示为只读 + 「NEW SESSION IN …」入口。
- 模型：**下一轮请求即生效**（`session.model` 可热切换）；当前轮进行中时只排队，不改在跑的请求。
- 思考：同理热切换，写进 session 的 `thinking_level_changed` 事件；OFF 时 relayout（不显示 THINKING 行）。

## 2. 架构

### 2.1 进程模型

```
browser ──(REST + 每会话 SSE)──► node server ──(in-process)──► pi SDK
                                    │
                                    ├─ SessionRegistry: id → { session|runtime, items, meta, subs }
                                    ├─ ConfigStore: providers / mcp / skills / policy
                                    └─ Workspace: 单 cwd，多会话共享（写入串行化）
```

- **技术栈定案：Vite + Preact + TS**。理由：8 个屏幕 + 大量表单，组件化与类型检查是刚需；
  `pi-coding-agent` 自带 `.d.ts`，SDK 调用能直接在编辑器里校验。
  构建产物由同一个 Node 服务托管；开发期 `vite` 起 5173，`/api` 代理到 4173。
- **运行时依旧零新增依赖**：highlight.js / diff 一律走 pi 的转出（§3.3），不自己引入。
- **一个 SSE 通道**，消息带 `sessionId`，前端按会话分桶；不用每会话一条连接。
- **写入串行化**：同 cwd 允许多会话并发读，但 `write/edit/bash` 的执行进入每 cwd 的队列，
  避免两个会话同时改同一文件（pi 自己有 `withFileMutationQueue`，可复用）。

### 2.2 会话层

用 SDK 原生能力，不自己发明：

| 需求 | 用法 |
|---|---|
| 新建/打开 | `SessionManager.create(cwd)` / `SessionManager.open(path)` |
| 恢复 | 同上，文件自带 context |
| 列表 | `SessionManager.listAll()` → `SessionInfo{name, cwd, created, modified, messageCount, firstMessage, parentSessionPath}` |
| 切换 / fork | `AgentSessionRuntime.switchSession(path)` / `.fork(entryId)` / `.newSession()` |
| 改名 | `session_info` entry（SessionManager 原生支持） |

**并发策略（已定）**：多标签，但**全局同时只跑 1 个**。第二个会话提交时进入 `QUEUED`，
当前运行结束后按队列自动启动；每 cwd 的写入因此天然串行，不需要额外写锁。
运行中切换标签不打断任务，标签上显示 `RUNNING / QUEUED / IDLE`。

### 2.3 API 面

```
GET    /api/bootstrap?session=            → meta + 会话列表 + 配置摘要
GET    /api/stream                        → 单一 SSE，事件带 sessionId
POST   /api/session                       → {op:"new"|"open"|"fork"|"rename"|"delete"}
POST   /api/prompt                        → {session,text}
POST   /api/model                         → {session,model}      下一轮生效
POST   /api/thinking                      → {session,level}      off|low|medium|high
GET    /api/fs?path=                      → 目录列表（仅目录，跳过隐藏/权限错误）
GET    /api/models                        → 已配置 provider 的模型清单
POST   /api/abort | /api/approve | /api/policy
GET    /api/providers                     → 列表 + 当前默认
POST   /api/providers                     → {op:"upsert"|"delete"|"test"|"default"}
GET    /api/mcp | POST /api/mcp           → {op:"upsert"|"delete"|"test"|"toggle"}
GET    /api/skills | POST /api/skills     → {op:"reload"|"toggle"|"reveal"}
```

统一响应体：`{ok, data?, error?, warnings?}`；错误必须带 `code`（`E_AUTH` / `E_MCP_CONNECT` / …），
前端用颜色语义呈现，不弹通用 toast。

### 2.4 目录结构

```
pi-lcars/
  server/
    index.mjs              http + 静态托管 + SSE
    routes/                bootstrap · session · prompt · providers · mcp · skills
    pi/
      registry.mjs         sessionId → { session|runtime, items, meta, subs }
      queue.mjs            全局单跑队列（RUNNING / QUEUED）
      stream.mjs           pi 事件 → item（含 blocks / diff / subagent）
      highlight.mjs        highlightCode() ANSI → HTML
      diffs.mjs            generateDiffString → hunks
      config.mjs           分层读取 + 写前备份 / 失败回滚
  src/
    main.tsx  app.tsx  api.ts  store.ts
    views/       Transcript · Sessions · History · Provider · Mcp · Skills · Context · System
    components/  Spine · Shelf · TabBar · ToolStrip · MessageBlock · CodeBlock
                 DiffBlock · SubagentBay · ApprovalDeck · FieldRow · BarButton
    styles/      tokens.css · lcars.css
  test/  smoke.mjs  ui.mjs
  demo/                  v0 参考实现，保留不删
  PLAN.md  AGENTS.md
```

### 2.5 主题支持（已提前落地）

`themes.css` 四套预设（tng / voy / ds9 / mono），九语义角色不随主题改变，
`scripts/check-themes.mjs` 做 16 组对比度门禁。UI 入口在 Craft 页 THEME 段，
M0 之后收到 SYSTEM 站里。浅色主题明确不做。

## 3. 输出流 v2

### 3.1 item 类型（服务端归一化后）

```ts
user | assistant | tool | approval | notice | subagent | diff
```

新增/升级：

- **assistant.blocks[]**：`{kind:"text"|"code"|"list"|"table"|"heading", …}`，
  由服务端把 markdown 切块（`code` 块带 `lang` + 高亮后的 HTML 行）。
- **tool.output.kind**：`text` | `code`（read：按路径高亮）| `diff`（edit/write）| `empty`。
- **subagent**：`{tool, name, phase, parentCallId, calls[], tokens, elapsed, status}`。

### 3.2 三类新增渲染

**代码块**：行号 gutter（4px 竖条 + 右对齐 11px 数字）→ 代码区 → 右上 `COPY` / `WRAP` / `LANG`。
超过 40 行折叠为 `+N LINES`（沿用工具条同一套展开语义）。

**差异块**：头部 `EDIT · src/foo.ts · +18 −2`，正文按 hunk 分组：
`@@ -12,6 +12,9 @@` 作为 moon 色标记行；`+` 行左边 4px cyan、`−` 行 tomato；
行号双列（old|new）；整块可折叠为只显示 hunk 头。

**子 agent 舱**：`AGENT · explore-1 · RUNNING · 12 CALLS · 00:31` 顶栏 + 缩进的嵌套工具条（同一套读数条，字号降一档）。
阶段由 `tool_execution_*` 的 `parentToolCallId` 归集；结束时整舱折叠为一行摘要，保留展开。

### 3.3 实现路径（不新增依赖）

| 能力 | 来源 |
|---|---|
| 语法高亮 | pi `highlightCode(code, lang)`（ANSI）→ 40 行 ANSI→HTML 转换 |
| 语言识别 | pi `getLanguageFromPath(path)` |
| 差异 | pi `generateDiffString` / `generateUnifiedPatch` |
| 输出截断 | pi `truncateHead` / `DEFAULT_MAX_LINES` |
| 文件写入串行 | pi `withFileMutationQueue` |

## 4. 配置表单语言（LCARS form spec）

新的一类构件，写入 `AGENTS.md` §13。

```
[4px 状态][ 160px 标签块 ][ 字段区 flex ][ 96px 值/单位 ]
```

- **字段区不是输入框**：黑色底 + 底部 2px 读数条（`--g1`），聚焦时变 `--orange` 且左侧出现 2px caret。
  错误时条变 `--tomato`，并追加一行 11px mono 的错误说明 —— 不弹 toast、不抖动。
- **标签块**沿用站点条：实色块 + 全大写 11px。必填项标签块左侧 4px `--orange`。
- **敏感字段**（apiKey）默认显示 `••••••••` + `REVEAL` 按钮，值永远不进 DOM 明文（除非点击）。
- **动作条**：`TEST` / `APPLY` / `DELETE` 三种实色块；`TEST` 返回结果写在动作条右侧
  （`OK 142ms · 6 models` / `E_AUTH 401`），不弹窗。
- **列表行**（provider/mcp/session）用 §3 的读数条语法：`4px 状态 | 名称 | 摘要 | 计数/耗时`。
- **危险操作**（删除 provider / 删除会话）走红区：整行变 `--tomato` + 二次确认块（`CONFIRM` / `CANCEL`）。

## 5. 里程碑

| # | 内容 | 交付 | 验收 |
|---|---|---|---|
| **M0** | 会话注册表 + 落盘 + 每会话 SSE + 标签栏 + **shelf 控件（cwd/模型/思考）** | registry、queue、`/api/session`、`/api/model`、`/api/thinking`、`/api/fs`、TabBar、Shelf | 刷新不丢会话；切标签各自上下文；fork 各自续写；新建时能选目录；切模型下一轮生效；思考关掉后 THINKING 行消失 |
| **M1** | Provider 配置 + 模型选择 + 测试 | S4 屏幕、`/api/providers` | 新建 provider → 测试拿到模型清单 → 切默认模型 → 下一次对话生效 |
| **M2** | MCP 配置与管理 | S5 屏幕、`/api/mcp` | 加一个 stdio server → 测试连通 → 工具出现在 02 TOOLS → 关闭后消失 |
| **M3** | Skills 管理 | S6 屏幕、`/api/skills` | 开关 model-invocation 后下一轮 system prompt 生效；reload 不重启进程 |
| **M4** | 历史 | S3 屏幕 | 列表按项目分组；搜索命中首句/全文；打开与 fork 正确 |
| **M5** | Markdown + 代码高亮 + 复制 | stream v2 第一半 | 三种语言高亮正确；长代码折叠；复制到剪贴板 |
| **M6** | Diff 视图 | stream v2 第二半 | edit 工具产生 hunk 视图；write 显示全新增；行号双列正确 |
| **M7** | 子 agent 舱 | stream v2 第三半 | 触发 Agent 后舱内出现嵌套工具条；结束后折叠为摘要 |
| **M8** | 按需出稿（不是固定里程碑） | MasterGo 帧、AGENTS.md §13 | 只在「需要视觉沟通 / 要人工拍板」时出稿：预期是配置表单语言、Diff 块、子 agent 舱这三处 |

依赖：M0 → (M1,M2,M3,M4 并行) → M5 → M6 → M7 → M8。

## 6. 风险与不做的

**风险**
1. **并发写入**：两个会话改同一文件会互相覆盖 → 每 cwd 写队列 + UI 提示「另一个会话正在运行」。
2. **配置写坏**：M1/M2 会改 `~/.pi/agent` 下的真实配置（与 CLI 共用）→ 每次写前备份 `*.bak`，校验失败回滚。
3. **API 漂移**：pi 仍在 1.4.x 快速迭代 → 所有 SDK 调用集中到 `server/pi/*.mjs` 一层，便于替换。
4. **无测试**：先补 `test/smoke.mjs`（打每个端点）+ `test/ui.mjs`（playwright 断言），作为 M0 的门禁。
5. **画板与实现再次脱节**：定死「画板只是快照」，每个里程碑结束才更新，且以运行截图为准。

**这轮不做**
- 多用户 / 鉴权 / 远程访问（仍是 127.0.0.1 单机）
- 移动端 H5 适配
- 插件市场、主题编辑器
- 自定义工具（`customTools`）的 GUI —— 留到 M9 之后再评估

## 7. 已定决策

| # | 决策 | 备注 |
|---|---|---|
| 1 | **Vite + Preact + TS** | 运行时零新增依赖，构建产物由 Node 托管 |
| 2 | **多标签 · 全局单跑队列** | 同 cwd 写入天然串行；标签显示 RUNNING / QUEUED / IDLE |
| 3 | **按 SDK 原生分层落盘** | Provider/凭证 → `~/.pi/agent`；MCP/Skills 支持项目 `.pi/` 覆盖；写前备份、失败回滚 |
| 4 | **画板按需出稿** | 仅用于视觉沟通与人工确认；预期三处：配置表单语言、Diff 块、子 agent 舱 |
