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

**屏幕清单**（每块单独验收；状态列以代码为准，2026-10-30 对账）

| # | 屏幕 | 内容 | 状态 |
|---|---|---|---|
| S1 | Transcript | 消息流、工具条、代码、diff、子 agent 舱、审批、通知 | ✅ `views/Console.tsx` · 行语言 + 查看器 |
| S2 | Sessions | 会话列表（当前/最近/按项目分组） | ✅ 改为**左轨列表**，未做标签页（见 §9） |
| S3 | History | 全量会话表：名称、cwd、首句、消息数、修改时间、fork 谱系 | ✅ `views/Console.tsx` HISTORY 站 + `server/pi/history.mjs` |
| S4 | Provider | provider 列表 + 详情表单 + 模型清单 + 测试 | ✅ PROVIDERS 站 |
| S5 | MCP | 服务器表 + 传输配置 + 探测 + 工具 exposure | ✅ MCP 站（connect 轮询到工具出现） |
| S6 | Skills | 清单 + 重载 + 文件定位 | ⚠️ model-invocation **开关未做**（只读展示 `disableModelInvocation`） |
| S7 | Context | 分段条 + token/费用 + compaction 记录 | ✅ 站点**已砍**，内容并入右栏 RESOURCES + compaction summary |
| S8 | Policy | off / risky / all + 超时 + always 清单 | ✅ 并入 SETTINGS 站（`set.policy` 三段按钮） |
| S9 | Tools | loadout 表 + 每工具调用统计 | ✅ 并入 SYSTEM 站：loadout 徽标带「本次会话 N× · 平均耗时 · 错误数」，右栏另有调用/失败列表 |
| S10 | 工作区选择 | 新建 / 切会话时选 cwd：面包屑 + 目录列表 + 最近使用 | ✅ workspace deck（预览 → 提交） |
| S11 | 模型选择 | 按 provider 分组的模型表：id、context window、cost、当前标记 | ✅ shelf `MODEL` chip → ModelDeck |
| S12 | 思考开关 | OFF / LOW / MED / HIGH 四段控件 | ✅ shelf `THINK` chip → ThinkDeck |
| S13 | About | 版本、运行时、依赖与许可证、LCARS 归属、字体、网络姿态 | ✅ ABOUT 站（`#about`），依赖清单由 vite 构建期注入 |

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

| # | 内容 | 交付 | 验收 | 状态 |
|---|---|---|---|---|
| **M0** | 会话注册表 + 落盘 + 每会话 SSE + 标签栏 + **shelf 控件（cwd/模型/思考）** | registry、queue、`/api/session`、`/api/model`、`/api/thinking`、`/api/fs`、Shelf | 刷新不丢会话；切会话各自上下文；fork 各自续写；新建时能选目录；切模型下一轮生效；思考关掉后 THINKING 行消失 | ✅ 标签栏改为左轨列表 |
| **M1** | Provider 配置 + 模型选择 + 测试 | S4 屏幕、`/api/providers` | 新建 provider → 测试拿到模型清单 → 切默认模型 → 下一次对话生效 | ✅ |
| **M2** | MCP 配置与管理 | S5 屏幕、`/api/mcp` | 加一个 stdio server → 测试连通 → 工具出现在工具清单 → 关闭后消失 | ✅ 工具清单看 SYSTEM 站（无独立 TOOLS 站） |
| **M3** | Skills 管理 | S6 屏幕、`/api/skills` | 开关 model-invocation 后下一轮 system prompt 生效；reload 不重启进程 | ⚠️ RELOAD 已做，**开关未做**（pi 侧无写入接口） |
| **M4** | 历史 | S3 屏幕 | 列表按项目分组；搜索命中首句/全文；打开与 fork 正确 | ✅ 后台扫描 + 缓存 |
| **M5** | Markdown + 代码高亮 + 复制 | stream v2 第一半 | 三种语言高亮正确；长代码折叠；复制到剪贴板 | ✅ 12 种语言 · hljs |
| **M6** | Diff 视图 | stream v2 第二半 | edit 工具产生 hunk 视图；write 显示全新增；行号双列正确 | ✅ 双行号 + 整屏 viewer |
| **M7** | 子 agent 舱 | stream v2 第三半 | 触发 Agent 后舱内出现嵌套工具条；结束后折叠为摘要 | ✅ `nestedCalls → children` |
| **M8** | 按需出稿（不是固定里程碑） | MasterGo 帧、AGENTS.md §13 | 只在「需要视觉沟通 / 要人工拍板」时出稿 | ⛔ 未做：`boards/` 仍是 web 壳之前的 v1/v2，见 §9 |
| **M9** | **启动器**：`pi-lcars` 一条命令起全套 ＋ **pi 环境检查** | `bin/pi-lcars.mjs`、`server/pi/sdk.mjs`、`package.json` 的 `bin`/`files`/`prepack`、`test/launch.mjs`、`test/pi-env.mjs` | 全新 clone 一句 `npx pi-lcars` 即可用；未装 pi 给安装引导；多 release 自动选可用版本；端口冲突自动偏移；`status`/`stop`/`doctor` | ✅ 已发 npm `pi-lcars@0.3.0` |

依赖：M0 → (M1,M2,M3,M4 并行) → M5 → M6 → M7 → M9 → M8。

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
| 5 | **交付形态是「一条命令」** | `pi-lcars`（bin）= 起 pi 后台 + 起 UI + 开浏览器，形态对齐 `opencode web`；不再把「先 build 再 server」暴露给用户 |
| 6 | **`dist` 随包发布，构建只在源码检出时发生** | 全局安装不带 vite，不能要求用户自己 build；源码检出用 `import("vite").build()` 进程内构建 |
| 7 | **默认只绑 `127.0.0.1`，端口可自动偏移** | 无鉴权的单机工具；偏移后写 `last-url`，脚本用 `--strict-port` 关掉偏移 |
| 8 | **一 cwd 一进程**（不做跨工作区单进程） | `registry` 的 `CWD` 是进程级常量；跨 cwd 共进程需要改注册表，收益不匹配成本 |

---

## 8. 启动器（M9）：一条命令起全套

> 目标：`pi-lcars` 一条命令 = 起 pi 后台 + 起 UI + 开浏览器，形态对齐 `opencode web`。
> 不引入第二个进程管理工具，不做系统服务、不做远程访问。

### 8.1 现状与差距

| 现在 | 差距 |
|---|---|
| `npm run build && npm run server` 两个动作 | 需要仓库内安装 + 手工构建，用户得知道顺序 |
| 端口写死 `4173`（仅 `PORT` 环境变量可改） | 端口占用即启动失败，无自动偏移、无提示 |
| 服务只从 `dist/` 读静态资源 | 首次运行没有 `dist` → 浏览器收到 `503 client not built yet` |
| SDK 解析写死 `releases/1.4.0/…`（`server/pi/sdk.mjs:6`） | pi 一升级就断；全局安装时更隐蔽 |
| 无 `bin`、无状态文件 | 没有 `status` / `stop`，多实例互不知情 |
| `server/index.mjs` 顶层就 `listen` + `boot` | 无法被 launcher 复用（需要导出 `start(opts)`） |

### 8.2 命令面

| 命令 | 行为 |
|---|---|
| `pi-lcars` | 前台启动：按需构建 → 起服务 → 打印启动块 → 开浏览器 |
| `pi-lcars web` | 同上（别名，迁就 `opencode web` 的肌肉记忆） |
| `pi-lcars --dev` | 同时起 vite(5173, HMR) + 服务(4173)，Ctrl-C 一起收 |
| `pi-lcars status` | 列本机实例：pid / cwd / url / 会话数 / 运行时长 |
| `pi-lcars stop [--port N]` | SIGTERM 指定实例（默认最近启动的那个） |
| `pi-lcars --json` | 首行输出 `{url,port,pid,cwd,model}`，供脚本与 `test/launch.mjs` 消费 |

参数：

| flag | 默认 | 说明 |
|---|---|---|
| `-C, --cwd <dir>` | `process.cwd()` | 工作区根（会话 cwd，建会话后不可变） |
| `-p, --port <n>` | `4173`，占用则 `+1` 试探到 `4189` | `--strict-port` 关掉偏移，占用即报 `E_PORT` |
| `--host <ip>` | `127.0.0.1` | 非回环地址必须显式给出，并打印 `NO AUTH` 警告 |
| `--open` / `--no-open` | TTY 下开 | `open` / `xdg-open` / `start` 三级降级，失败只打印 URL |
| `--no-build` | off | `dist` 缺失或过期就报错，不隐式构建 |
| `--resume` | off | 等价 `LCARS_RESUME=1` |
| `--policy <off\|risky\|all>` | `off` | 等价 `LCARS_POLICY` |
| `--version` | — | 打印版本 + `dist` 构建时间（判断是否用上了新前端） |

### 8.3 启动序列

1. 解析参数，用 `import.meta.url` 定位包根（不依赖 `cwd`）
2. **先解析 pi SDK** —— 失败立刻退出并给三行修复建议，别等到第一次 prompt 才炸
3. **`dist` 新鲜度**：`dist/index.html` 缺失，或比 `src/**` / `index.html` / `vite.config.ts` / `package.json` 旧 → 构建；源码检出走 `await import("vite").build()`（进程内，无 shell、无 `npm run`），发布包直接跳过
4. **选端口**：`net.createServer().listen()` 探测，占用即 `+1`（≤ 4189），仍失败给 `E_PORT` + 占用进程提示
5. 写实例状态 `~/.pi/agent/lcars/instances/<pid>.json`（`pid/port/cwd/url/startedAt/model`），并更新 `last-url`
6. 起服务：`server/index.mjs` 改成导出 `start(opts)`，`bin` 调用它（顶层副作用 → 可复用）
7. `--open` 开浏览器；前台阻塞；`SIGINT/SIGTERM` 走既有 `shutdown` 钩子（已 `closeAll` + 1.5s 兜底）
8. 退出时删状态文件，`last-url` 保留

### 8.4 打包与依赖决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 交付形态 | 本仓库 `bin` + `npm i -g pi-lcars` | 与 pi 解耦，不需要 pi 提供 CLI 扩展点；也不做成 pi package |
| `dist` | **随包发布**（`files: ["dist","server","bin"]`，`prepack` 构建） | 全局安装不带 vite，不能要求用户自己 build |
| `vite` | 保持 devDependency，仅源码检出路径 `import()` | 发布包零构建依赖；源码检出必然装了 devDeps |
| 运行期依赖 | 0（只用 `node:http` / `node:net` / `node:child_process` / `node:fs`） | 保持“零运行期依赖”这条既有承诺 |
| SDK 解析 | `PI_SDK` → 本地 `node_modules` → `~/.pi/agent/install/releases/*/node_modules/@earendil-works/pi-coding-agent`（按 semver 取最高）→ 全局包名 | 修掉写死的 `1.4.0`；`sdkSpec()` 继续把实际来源显示在 06 SYSTEM |
| 一进程一工作区 | 每个 cwd 一个进程、一个端口 | `registry` 的 `CWD` 是进程级常量；跨 cwd 共进程要改注册表，本轮不做 |

### 8.5 验收

- **全新 clone**：`npm i && npx pi-lcars` → 一次自动构建（打印耗时）→ `http://127.0.0.1:4173` 可用 → 浏览器已打开 → 日志有 `session ready`
- **全局安装**：`npm i -g .` 后进入任意项目目录 `pi-lcars` → 无构建步骤、无仓库依赖 → UI 工作区 = 该目录 → `sdkSpec()` 显示真实解析路径
- **第二个实例**：端口自动 4174，两个 URL 都可用；`pi-lcars status` 两行；`pi-lcars stop` 只收目标进程
- **`--dev`**：改 `src/*.tsx` 保存即热更，SSE 连接不断、不重连风暴；Ctrl-C 后无残留子进程
- **缺 SDK**：输出 `E_PI_SDK` + 平台对应的安装命令 + 三行修复建议（装 pi / 设 `PI_SDK` / 指向具体 release），退出码非 0，不打栈
- **环境自检**：`pi-lcars doctor` 报告 node / platform / agent dir / settings·auth / pi CLI / 每个候选 SDK 的版本与缺失 API；`doctor --json` 单行可解析；缺 pi 时退出码 1
- **自动匹配**：同时存在 `1.4.0`（完整）与 `9.9.9`（缺 API）时选 `1.4.0`，且 doctor 列出 `9.9.9 missing …`；只有旧版本时能启动但带版本告警
- **`--json`**：首行可被 `JSON.parse`，字段齐全；`--strict-port` 在占用时退出码非 0

### 8.6 风险

| 风险 | 处理 |
|---|---|
| 端口自动偏移让书签失效 | 固定写 `~/.pi/agent/lcars/last-url` + `status` 打印；脚本用 `--strict-port` |
| 状态文件残留（SIGKILL / 断电） | 读状态时 `kill(pid, 0)` 探活，死条目自动清理 |
| 全局包 `dist` 与源码不同步 | `prepack` 强制构建；`--version` 打印版本 + `dist` 构建时间 |
| 绑定非回环地址被误用 | 默认 `127.0.0.1`；`--host` 需显式且打印 `NO AUTH` 警告 |
| Windows 无 `open` | 三级降级，全失败只打印 URL，不算失败 |
| `dist` 过期但用户 `--no-build` | 打印两条时间戳（源码最新 / dist 构建）并退出，不静默跑旧前端 |

### 8.7 子步骤

| # | 内容 | 验收 |
|---|---|---|
| M9a | `bin/pi-lcars.mjs`：参数解析、状态文件、`status` / `stop` | `status` 能列出真实实例，`stop` 只收目标 |
| M9b | `server/index.mjs` 拆出 `start(opts)` + 构建新鲜度 + 端口选择 + SDK 动态解析 | 全新 clone 与全局安装两条路径都能起来 |
| M9c | `--dev` 双进程编排 + 浏览器打开 + 启动块输出 | HMR 可用，Ctrl-C 无残留 |
| M9d | `test/launch.mjs` 门禁（起进程 → `--json` → 打 3 个端点 → `stop`） | 并入 `npm test`；README 的“端点数”改为脚本自报，不再写死 |
| M9e | **pi 环境检查**：`pi-lcars doctor`、候选 API 探测与自动匹配、安装引导、跨平台路径 | `test/pi-env.mjs` 全绿；空 home 模拟 → 退出码 1 + 安装命令 |

### 8.8 pi 后台环境检查（M9e）

> 需求：启动前就把“pi 在不在、版本合不合、接口全不全”问清楚；没装就引导安装，
> 装了就在多个 release 里自动挑一个**真能跑**的，且不假设用户的操作系统。

**检测项**（`pi-lcars doctor`，全部机器可读）

| 检测 | 来源 | 不满足时 |
|---|---|---|
| Node 版本 | `process.version` vs pi 的 `22.19.0` | 告警（不阻断启动） |
| SDK 可加载 | `PI_SDK` → 项目 `node_modules` → `<agent>/install/releases/*`（新→旧）→ npm 全局根 | 引导安装，退出码 1 |
| SDK 调用面 | 逐候选探测 `createAgentSession` / `DefaultResourceLoader` / `SessionManager` / `parseSkillBlock` | 跳到下一个候选（自动匹配） |
| SDK 版本 | 候选同目录的 `package.json` | 低于 `1.4.0` → 能启动但告警 |
| pi CLI | `<agent>/bin/pi` 与 PATH（按 `PATHEXT`） | 仅提示 |
| 配置 | `PI_CODING_AGENT_DIR` 或 `~/.pi/agent`；`settings.json` / `auth.json` | 提示先跑一次 `pi` |

**自动匹配规则**

- 候选按上表顺序逐个 `import()` 并**验证导出**，第一个通过的即用；新版本缺 API 时自动退到旧版本，而不是整体失败。
- 实际选中的来源、版本、缺失的可选 API 全部写进 doctor 输出与 `/api/system`（`sdkVersion` / `nodeMin`），不静默。

**引导安装**（缺失时）

- 按平台给官方命令：`install.sh` / `install.ps1` / `npm i -g --ignore-scripts @earendil-works/pi-coding-agent`。
- 说明“跑一次 `pi` 生成 `settings.json`”，并给出 `PI_SDK` 逃生口（自定义安装位置）。
- 输出到 stderr、退出码 1、不打栈；`--json` 模式下不污染 stdout。

**跨平台**

- 路径只用 `node:path` / `node:os.homedir()`——旧代码读 `process.env.HOME`，Windows 上是空的。
- `pi` 二进制按 `PATH` + `PATHEXT` 查，另有 Windows 的 `pi.cmd` / `pi.exe`；npm 全局根用 `npm.cmd`。
- 状态目录、端口探测、代理目标、打开浏览器均不假设 POSIX。

**验收**

- 空 home（无 pi）→ `E_PI_SDK` + 安装命令，退出码 1；`doctor` 同样退出码 1。
- 装两个 release、新版缺 API → 选旧版，doctor 明写 `missing …`。
- 只有旧版本 → 能启动 + 版本告警。
- `doctor --json` 单行可解析（`node` / `platform` / `nodeOk` / `selected` / `candidates`）。

---

## 9. 交付对账（2026-10-30）

### 9.1 与计划不同、但已定案

| 项 | 计划 | 实际 | 定案理由 |
|---|---|---|---|
| 标签页 | 多标签 TabBar | 左轨会话列表 + `LIVE / QUEUED / HELD` | 一屏看清全部会话状态，标签在 1600 宽下会挤掉主区 |
| S7 CONTEXT 站 | 独立站 | 砍掉，内容并入右栏 RESOURCES | 上下文是常驻读数，不该"切过去看" |
| S8 Policy 屏 | 独立屏 | 并入 SETTINGS 的 `set.policy` | 低频设置不值得单独一站 |
| S9 TOOLS 屏 | 独立屏 | SYSTEM 的 loadout + 本次调用统计 | 新增一站只为一屏统计，收益低于成本 |
| 子 agent | 独立舱 | 工具行内嵌 children | 少一层容器，层级更平 |

### 9.2 欠账清单（本轮结清）

| # | 欠账 | 状态 |
|---|---|---|
| D1 | Skills 的 model-invocation 开关 | **不做**：由 `SKILL.md` frontmatter 决定，写回等于改用户资产。站内保留只读 `AUTO / MANUAL` 徽标 + `OPEN` |
| D2 | 左轨编号 `01–06` + 数字快捷键（AGENTS §3 R9） | ✅ 补：编号显示 + `1`–`6` 切站、`0` 回日志；输入框内不触发；折叠轨隐藏编号且无溢出 |
| D3 | `test/ui.mjs`（UI 回归门禁，PLAN §6 风险 4） | ✅ 补：CDP 驱动 61 检查（站切换 + hash、深链、双栏折叠、deck/Esc、主题、composer、序号快捷键、无未捕获异常），并入 `npm test` |
| D4 | M8 画板与实现脱节 | 待定：只在需要视觉沟通时出「配置表单语言 + Diff 块」局部稿，不再整屏重画 |

### 9.3 本轮修掉的真 bug（不是文档）

- **Composer 渲染崩溃**：`meta.queue` 一处给数字、一处给文本数组，`...(... ?? [])` 抛异常导致整页不再重渲染（表现就是"点哪都没反应"）。服务端统一成数组，客户端 `textList()` 兜底。
- **Escape 关不掉 deck / 分支树**：只有文件查看器处理 Esc。现在 deck → tree → viewer 依次关闭。
- **NEW SESSION 布局被旧 CSS 拖成竖排**：`.lnew` 两条同名规则，新规则没重置 `flex-direction: column`，图标在上、标签被挤到底边。
- **低于 11px 底线的字号**：`10px`（`.tgl`、`.set-tool`、MCP 内联说明）与 `10.5px`（`.set-section`）整体上调到 11px。
- **`unknown/unknown` 模型**：见 commit `d93b41c`。
