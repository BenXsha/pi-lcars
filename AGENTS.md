# AGENTS.md — LCARS Agent Console

> 本项目：以 **LCARS**（Star Trek TNG 的 Library Computer Access and Retrieval System）为视觉语言的
> **pi-agent 桌面控制台**，设计产物落在 **MasterGo 画板**。
>
> **本文件的效力**：
> - 视觉/体验/文案准则 → **优先级高于**任何通用设计 skill 的美学建议。
> - **技术管线约束（§8）不可被本文件覆盖** —— 那些是 MasterGo 渲染器的事实限制，违反只会渲崩。
> - 每次改设计前先读本文件；本次改完若产生了新结论，追加到 §10「决策记录」，不要只留在对话里。

---

## 0. 一句话定位

> 一艘可以干活的星舰：**不是把 Star Trek 皮肤套在 ChatGPT 上，而是把「操作一台复杂机器」的信息结构翻译成 LCARS 的视觉语法。**

成功标准（任何一版画板都拿这三条验收）：

1. **去掉颜色，仍然读得懂**：层级、分区、状态全靠块的大小/位置/黑缝，不靠色相。
2. **颜色都有含义**：每个色相唯一对应一个系统域或一种状态，没有纯装饰色。
3. **像一台仪器，不像一张海报**：所有编号/读数/进度都是真实数据位，不放装饰性占位符。

---

## 1. LCARS 事实层（先理解，再设计）

| 事实 | 设计后果 |
|---|---|
| 1987 年为 NTSC 4:3 电视设计，Michael Okuda / Rick Sternbach | 粗块、高饱和、无细线、无小字、无渐变 —— **都是广播带宽与显像管的妥协，不是风格癖好** |
| 纯黑底 + 实色块浮在上面 | 黑色**就是**分隔线；LCARS 没有"卡片边框"这回事 |
| 标志性构件是 **elbow（肘）**：两条粗细不等的横竖粗条 L 形相接 | 一屏最多 1–2 个肘；滥用立刻变成"假 LCARS" |
| 左栏是**粗细不等的横条堆**，条与条之间是黑缝 | 天然适配「导航/站点切换」——本项目直接征用它 |
| 字体是 Helvetica / Univers 系压缩粗体，全大写，字距紧 | 全大写 = 仪表盘语气；必须靠字号差 + 色块建立层级，不能靠字重 |
| 原版动效是「整块出现 + 擦除」，没有缓动 | 现代复刻保留**块状擦除 / 宽度展开**，禁止 fade-in、禁止 spring 回弹 |
| 原版配色是**装饰性**的（同一种橙既当导航也当警告） | ⚠️ 这是原版最大的可用性缺陷 —— **本项目必须纠正**（见 §2） |
| 原版大量无意义编号（`07-4421-3`） | ⚠️ 同样纠正：每个数字必须来自真实数据（会话 ID、工具调用数、tokens、耗时） |

---

## 2. 色彩（唯一权威表）

背景永远 `#000000`。下表色值为 fan-standard Okuda palette，可按对比度微调，但**语义分配不可改**。

| Token | 色值 | 语义（唯一） | 使用面积 |
|---|---|---|---|
| `ops-orange` | `#FF9C00` | **主操作 / 当前焦点 / 主人在说话** | 大面积块 + 按钮；文字仅 ≥14px 粗体 |
| `amber` | `#FFCE9C` | **次级信息 / 元数据 / 时间戳** | 中等块、标签底 |
| `tangerine` | `#FF9966` | **工具执行中 / 运行态** | 进度条、状态灯 |
| `tomato` | `#CC6666` | **错误 / 需人类决策（红区）** | 仅作为大块或 ≥14px 文字；禁止 11px 小字 |
| `lilac` | `#CC99CC` | **记忆 / 上下文 / 长期状态** | 上下文条、memory 面板 |
| `lavender` | `#9999FF` | **子代理 / 并行任务** | 停靠舱面板、Agent 徽标 |
| `ice` | `#99CCFF` | **只读信息 / 引用 / 外部输入** | web 结果、MCP、文件路径 |
| `moon` | `#CCCC99` | **计划 / 待办 / 未执行** | plan mode、todo 未完成 |
| `cyan` | `#99CCCC` | **系统 / 环境 / 运行时** | 状态栏、模型信息 |
| `white` | `#FFFFFF` | **正文文字**（唯一用途） | 不做大面积底 |
| `gray-3` | `#999999` | 次级文字 | — |
| `gray-2` | `#666666` | 禁用 / 空态 | — |
| `gray-1` | `#333333` | 未激活的块 | — |

**硬规则**
- **R1 一色一义**：颜色不得复用。红色只表示错误/待决策，不得用来"点缀"。
- **R2 对比度**：黑底上正文 ≥ 4.5:1；`#CC6666`、`#CC99CC` 小字不合格 → 只做块或用 `#FFFFFF` 字。
- **R3 不用色阶表深浅**：同一色相只允许一个色值；层级用尺寸和位置表达。
- **R4 禁止**渐变、发光、玻璃、阴影表达层级。深度只有两种手段：黑缝、块尺寸。

---

### 2.5 主题机制

配色分两层，**结构 token 与主题无关**：

- `src/styles/tokens.css` —— 网格、圆角、动效时长、字体栈。任何主题都不改。
- `src/styles/themes.css` —— 九个语义角色 + 五档中性色 + `--bg`。主题只换这里的值。

| 主题 | 定位 | 关键色 |
|---|---|---|
| `tng`（默认，不带 `data-theme`） | 暖橙，原版 Okuda | `#ff9c00` |
| `voy` | 210° 冷色，紫蓝焦点 + 薄荷系统色 | `#8fa9ff` |
| `ds9` | 30° 青铜，低明度 | `#e8a33d` |
| `mono` | LCARS 47 风格去饱和，焦点=近白 | `#e8e8e8` |
| `kelvin` | 开尔文时间线电影（Into Darkness 2013 / Beyond 2016）：冰白文字 + 琥珀高光 + 钢蓝底 | `#ffb25a` |
| `picard` | 25 世纪 / Picard S3（2023，Twisted Media + Okuda 参与）：石板底 + 亮青焦点 + 珊瑚告警 | `#41c4f7` |
| `hull` | 从一张舰体静帧里取色：钢蓝灰主色 + 冰白高光 + 引擎铜光（铜只作告警）；只取色值，不随包分发图片 | `#9fb2c8` |
| `grid` | 赛博朋克（舒适版）：靛黑底 + 哑光洋红焦点 + 灰青运行态 + 洗淡酸性黄；色相不变、彩度约减半 | `#cf86ae` |
| `borg` | 老式绿色终端 / Borg alcove：P1 磷光绿焦点 `#33ff33` + 薄荷系统色，唯一的暖块是琥珀告警（单色 CRT 没有红） | `#33ff33` |

**硬规则**
- 角色语义不随主题改变：`--orange` 永远是「焦点/操作者」，`--cyan` 永远是「系统/正常」。
  换主题只换色相，不换谁代表什么。
- **每个块色都必须能承载黑色文字**（≥ 4.5:1），因为 LCARS 的块内文字始终是黑的。
- `node scripts/check-themes.mjs` 是门禁：16 组对比度全部达标才算通过，不接受肉眼判断。
- 新增主题要动三处：`themes.css` 加一段 → `src/theme.ts` 的 `THEMES` 加一行（含 4 色 swatch）→ 跑门禁。
- **不做浅色主题**：LCARS 是暗屏系统，浅色会毁掉「黑缝即网格」的构图逻辑。

## 3. 形状与网格

**网格**
- 基准 4px；黑缝取值只允许 `4 / 8 / 12`（主分区缝 12，块间缝 4–8）。
- 主画板 `1600 × 1000`；左轨 `224px`，右栏 `320px`，中间主区自适应。
- 块高梯度：`44 / 56 / 72 / 104`，只在这四档里选。

**形状规则**
- **R5 圆角单向**：只在「朝外/朝内的一侧或单角」做半高圆角，禁止四角同半径（胶囊除外）。四角 12px 圆角 = 通用 SaaS，禁用。
- **R6 elbow 配额**：一屏 ≤ 2 个肘（左上主结构 + 右下状态区）。肘 = 粗细不等两段 + 外角半高圆角 + 内角直角。
- **R7 无描边**：不用 border 表达边界。需要分隔就用黑缝或 2px 内缩块。
- **R8 无卡片**：不允许"圆角卡片 + 内边距 + 标题"的三段式。信息靠**条带（bar）** 承载，条带左端接在一条"脊（spine）"上。
- **R9 左轨即导航**：左轨条堆 = 站点列表，条高随重要性变化（当前站点最高）。条内编号是**真实快捷键**（`01`–`06`）。

### 3.5 曲线（浏览器里的真形状）

LCARS 的形状语言本质是**曲线**：肘的凹角、胶囊端、读数条端头。v1/v2 画板全是直角，
那是 MasterGo 渲染的妥协，不是设计。浏览器里必须做对：

- **肘（elbow）**：两条粗细不等的腿相接，**内（凹）角**倒圆，外角保持直角。路径公式：

  ```
  M0,0 H{w} V{hh} H{vw+r} Q{vw},{hh} {vw},{hh+r} V{h} H0 Z
  ```

  用**二次贝塞尔穿过直角点**，不要用 `A` 弧 —— 弧的 sweep flag 在 y 向下的坐标系里极易搞反。
- **圆角只给外沿一侧**：`border-radius: 0 r r 0`。三档：`--r-1:6px`（块内）/ `--r-2:14px`（大块）/ `--r-pill:999px`（胶囊）。
- **禁止**四角同半径（= 通用 SaaS 卡片），**禁止**用描边表达边界。
- 曲线只出现在**结构关节**：spine↔shelf、条带端头、meter 分段。不做装饰弧、不做波浪。
- **顶部 cap（画布 `容器 412` 的形状）**：实心块右下角被一个圆"减掉"，形成下凹的扫掠，
  再与 44px 细条相接。路径用二次贝塞尔过直角点：

  ```
  M0,0 H320 V44 Q265,44 265,100 H0 Z      // r = h - bar - 1 = 55
  ```

  ⚠️ **控制点决定凹凸**：控制点落在**内角** `(w-r, bar)` → 角被**挖掉**（凹，正确，等于"矩形减圆"）；
  落在**外角** `(w, h)` → 角被**补圆**（凸，错的）。两者只差一个坐标，肉眼极难分辨，必须验：
  取路径中点，量它到外角 `(w,h)` 的距离 —— **> r 才是凹**（实测 59 > 55 ✓），< r 说明画反了。

  **cap 宽度 = 侧栏列宽 + r**（画布 398 = 336 + 63；本地 375 = 320 + 55）——
  这样凹口的收口点正好落在下层按钮/会话块的右边界上，视觉上"对齐下边边界"。
  若 cap 与列同宽，凹口会缩进 r 像素，下面一排块就会突兀地探出约 55px。
  凹口区（x ∈ [列宽, 列宽+r]，y ≤ bar）被 cap 盖住，所以细条要留 `padding-left: 列宽+r` 再把内容放出来。

### 3.5b Markdown（助手输出）

助手消息按 Markdown 渲染（`marked`，构建期依赖，运行时无新增）。规则：

- **原始 HTML 一律丢弃**（`renderer.html = () => ""`）：模型输出不得注入标记。
- **代码块复用工具条的语言**：`[LANG]` 头 26px + 可滚动正文（`52vh` 上限、等宽、`--g0`），右上 `COPY`。
  **有语言标识就上高亮**（highlight.js，只注册 12 种语言）；`read` 工具的输出按文件扩展名高亮。
  配色按语义映射，不搬现成主题：keyword=lav、string=cyan、number=amber、function=orange、comment=g2。
  行内代码用 `--g0` 底 + `--ice` 字，不加边框。
- **表格不用线**：表头是一块 `--amber` 实色（黑字、10px 全大写），表体每行一块 `--g0`，
  行距 4px 黑缝，首尾单元格各收一侧圆角。
- 标题靠 `inset 4px --orange` 竖条（h1/h2）建立层级，不用字号爆炸；h4 走全大写 + `--amber`。
- 列表 marker 用 `--orange`（有序用 `--amber` + 等宽数字）。
- 链接一律 `target=_blank rel=noreferrer noopener`，下划线只用 1px `--ice` 透明化，不做整块高亮。
- **用户消息不解析 Markdown**：操作者输入按字面呈现，避免误判。

### 3.5c Diff（差异块）

`edit` / `write` 的工具行**不显示文本输出**，直接渲染差异：

- 数据来源：优先 pi 的 `details.patch`（标准 unified patch，**双行号**都在 `@@ -a,b +c,d @@` 里），
  退回 `details.diff`（展示串，只有单侧行号）；`write` 没有 patch，用 args 里的 content
  合成为「全新增」差异（上限 400 行，超出标 `truncated`）。
- 布局：`[30px 旧行号][30px 新行号][12px 符号][正文]`，行号等宽右对齐、`--g2`、不可选中。
- 颜色：新增行 `color-mix(--cyan 13%)` 底 + 青符号；删除行 `tomato 16%` 底 + 红符号；上下文行文字压到 `--g3`。
- 段头 `@@ … @@` 是一块 `--g1` 实色条（`--moon` 字），不是分隔线。
- 统计 `+N −M` 放在差异块顶部，与工具条右端的耗时并置。
- 折叠沿用工具条那套：默认 8 行，展开后整体 `52vh` 内滚。

### 3.6 图标（remixicon，扫视锚点）

原版 LCARS 纯文字，低识别度是真实缺陷。图标只解决「扫视」，不承担语义：

- **永远和文字同时出现**，图标不单独承载含义（唯一例外：28px 见方的动作按钮，必须有 `title`）。
- **风格：remixicon `-fill`（实心填充）系列**，不用线稿。实心更贴合 LCARS 的色块语言，
  在深底 + 高饱和块上辨识度也更高；线稿只在大面积留白场景（如 24px 以上空态图）才考虑。
- 尺寸因视觉重量下调一档：`11 / 13 / 14`（实心 13px ≈ 线稿 14px 的视觉重量）。颜色一律 `currentColor`。
- 位置只有四处：站点条（标签前）、工具读数条（独立 26px 图标列）、动作按钮内、字段标签内。
- 生成方式：`node scripts/build-icons.mjs` → `src/icons.ts`，只内联用到的 path（56 个 / 27KB），
  **不加载图标字体、不联网**。命名空间：`station-*` `tool-*` `status-*` `act-*` `fld-*` `ap-*` `role-*` `diff-*`。

**布局骨架（固定）**

```
┌──────────────────────────────────────────────────────────────┐
│ TOP RAIL  项目/分支 · 模型 · sessionId · 运行时长 · 连接数    │ 56
├──────────┬───────────────────────────────────┬───────────────┤
│ LEFT     │ MISSION LOG（主区，唯一滚动区）    │ RESOURCE      │
│ SPINE    │  · 用户指令块（ops-orange）        │  · context 分段│
│ 224      │  · 助手输出（黑底白字，左脊 6px）  │  · tokens/费用 │
│ 01–06    │  · 工具调用读数行（tangerine）     │  · 延迟       │
│          │  · 审批块（tomato，阻断式）        │  · 子代理舱   │
├──────────┴───────────────────────────────────┴───────────────┤
│ COMMAND INPUT   ENTRY ▸ [______________]   RUN / PLAN / STOP  │ 96
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 排版

### 4.1 字体策略：可读性优先，不追求复刻

LCARS 原版用 `Swiss 911 Ultra Compressed`（压缩粗体）。**本项目不复刻该字族** —— 它对非拉丁字符几乎不可用，
且压缩+全大写在中英文混排下可读性极差。**LCARS 的身份由几何/色彩/网格承担，不由字体承担。**

字体令牌（全部为可自由使用 / 开源许可，保证跨平台不侵权）：

| 令牌 | 首选 | 回退栈 | 用途 |
|---|---|---|---|
| `font-ui` | **MiSans**（小米，免费商用） | `Source Han Sans SC` → `Noto Sans SC` → `PingFang SC` → `HarmonyOS Sans SC` | 中文正文、中英混排 |
| `font-instrument` | **D-DIN**（SIL OFL） | `Inter` → `Helvetica Neue` | 英文标签、编号、读数、大数字 |
| `font-code` | **IBM Plex Mono**（SIL OFL） | `SF Mono` → `Menlo` | 命令、路径、工具参数 |

> 为什么 MiSans 而不是思源黑体：**宿主里没有安装 Source Han / Noto Sans SC**（实测 `setFont` 静默回退到 Inter）。
> MiSans / PingFang SC / HarmonyOS Sans SC 实测可用。思源系仍是回退栈第一位 —— 只要目标机器装了就会命中。

### 4.2 大小写与混排（硬规则）

- **英文结构性标签用全大写**：导航、面板标题、工具名、状态、按钮、表头。这是 LCARS 的语气来源。
- **中文一律不做大写化 / 不加宽字距**（`tracking` 对中文只在 ≥20px 时给 `+0.5px`，其余为 0）。
- **中文正文不压缩、不缩小**：正文 16/24 起，最小可读 13/20；11px 只允许英文大写标签。
- **中英混排规则**：中文与拉丁/数字之间保留 1 个半角空格（`60 秒`、`10 req`）；数字与单位之间不断行。
- 中文段落行高比英文松：16px 字号配 24–26px 行高（1.5–1.6）。

### 4.2b 对比度与缩放（WCAG）

- 正文 `--w` on `--bg` = 21:1；次级 `--g3` = 7.4:1。
- **`--g2` 只用于非文本**（分隔、装饰）。因为它曾以 3.66:1 被当作 9–11px 标签色，
  现在主题里的 `--g2` 已提到 ≈5:1，并且 `check-themes.mjs` 对它的要求从 3:1 改成 **4.5:1**。
- 界面缩放用 `zoom`（`--ui-scale` = 0.9 / 1 / 1.1），不改任何 px 值 —— 保证 4px 网格与半高圆角不被破坏。
- 响应式只看**空间够不够**，不做"缩字号"：1600 列为 320/328，1280 起 288/300，1100 起 256/272，< 1100 不再给右栏。

### 4.3 输入面（不许"看不出来是输入框"）

命令输入区是**唯一允许长文本的地方**，它必须一眼可辨：

- 可见输入面：`--g0` 底面 + **2px 底部读数条**（空闲 `--g2`，聚焦 `--orange`）+ 左侧 4px 状态条（同上变色）。
- 前置 2×18px 闪烁 caret，占位文字用 `--g3`（不是 `--g2`，要比装饰文字亮一档）。
- 聚焦时**不出现 ring、不出现投影**：只变色，和配置字段同一套语言。
- 输入区顶部一行 9.5px 元信息：左「快捷键提示」右「字符数 / INPUT」（最右是 attach 小按钮），运行态时左侧变 `--orange`。
- **96px 是下限不是定高**：字段随草稿长高，见 §4.3b；**永远贴在窗口底部**（footer），不随消息流滚动。

### 4.3b 输入区能力（草稿 / 历史 / 附件 / @ 引用 / 自增高）

输入区是唯一需要「记住东西」的地方，四项能力的约定：

| 能力 | 行为 | 落地规则 |
|---|---|---|
| **草稿** | 按**会话**存 `localStorage[lcars.draft.<id>]`，输入停止 400ms 落盘；发送 / 执行 `/命令` 后清空；切换会话先 flush 旧会话再读新会话 | 刷新、切站、切会话都不丢字；**不跨会话串字** |
| **历史召回** | `↑` 从**光标在文首**时开始走 `lcars.hist.<id>`（最近 40 条，去连续重复），`↓` 走回去，到底恢复原草稿；随手输入即退出历史模式 | 不在任意位置劫持 `↑`，否则多行草稿没法用方向键 |
| **附件** | 粘贴 / 拖入 / 点 attach 得到图片 chip（缩略图 + 名字 + 体积 + ×，上限 6 张） | 服务端只收 `png/jpeg/webp/gif`，`/api/prompt` 独立 32MB 缓冲；转录区**只显示数量与体积**，不回传字节 |
| **@ 引用** | `@` + 若干字符 → 文件面板（同一套 `.cp` 条），`↑↓` 选、`Tab/Enter` 插入成 `` `rel/path` `` | 扁平索引 + 服务端排序（文件名前缀 > 文件名包含 > 路径包含），跳过 `node_modules/.git/dist` 与隐藏项，20s 缓存 |
| **自增高** | `height:auto` 量 `scrollHeight`，夹在 `44px` 与 `min(240px, 26vh)` 之间，超限内部滚动 | 测量在 effect 里做，不用字符数估算；`ENTRY` 块与右侧按钮**固定 96px 贴底**，只有字段长高 |
| **输入法（IME）** | 组字期间 `value` 与 DOM **逐键同步**（`onInput` 直接 `setText(el.value)`），`Enter` / `↑↓` / `Tab` / `Esc` 全部让给候选窗；字段随组字即时长高 | Preact 在 `value` 与 `dom.value` 不一致时会**回写**（`diff/index.js`），滞后一帧就把半个词吞掉；故不能用“组字期间不改 state”的做法，只能让两者恒等。`composing` ref 兜住“提交候选的 Enter 报 `isComposing:false`”的浏览器 |

- 状态只用**脊色**表达（聚焦 `--orange`、拖入 `--tang`、引用闪回 `--ice`），不加 ring、不加投影（§2 R4 / §4.3）。
- 附件 chip 的左脊是 `--lavender`（并行/外部输入位），转录里的静态 chip 降为 `--g2`。
- `@` 面板的文件名用 `--ice`：路径是**只读引用**，不是可执行命令。


### 4.4 字号 / 字距 / 数字

- 字号档位（只允许这些）：`40 / 28 / 21 / 18 / 16 / 13.5 / 12.5 / 11.5 / 11`
  **11px 是硬底线**：审计脚本按 `< 11px` 计数，任何新控件不得低于它（原 9–10px 的微标签已整体上调一档）。
- 行高：`56→56 / 40→44 / 28→34 / 20→28 / 16→24 / 13→20 / 11→16 / 10→14`
- 字距：英文大写标签 `+1~2px`；大标题 `-0.5px`；中文 `0`。
- 数字：等宽（tabular），**右对齐在色块内**，数字块右侧留 12px。
- **R10 三层上限**：一个区块内最多三级字号差（如 28 / 13 / 11）。LCARS 的信息密度来自大量小块，不来自多级标题。
- **R10b 一个文本节点只用一种字体**：禁止在同一个 text 节点里混排两种字体（渲染管线不支持字符级字体切换）。需要混排时拆成两个节点。

---

## 5. 动效与声音

动效只做一件事：**告诉用户「这块是新的 / 正在算」**，不做表演。

| 场景 | 手法 | 时长 / 缓动 |
|---|---|---|
| 区块出现 | `clip-path` 从左脊向右擦除（`wipe`） | 140ms linear |
| 次级块 | 同上，延迟 60ms（形成节奏） | 140ms linear |
| 面板/标签切换 | 跳两帧再亮（`swap`，steps(1)），不做淡入 | 90ms linear |
| 行插入 | 同 wipe，缩短 | 90ms linear |
| 就绪 / 计算中 | 三段扫描条错相位 | 900ms steps(3) loop |
| 流式文字 | 2×17px caret，`steps(1)` 闪 | 1s loop |
| 审批告警 | 亮度脉冲 **2 次**后常亮 | 300ms ×2 |
| 宽度变化（meter） | `width` 过渡 | 240ms linear |
| hover | **无过渡**，直接 +8~40% 亮度 | 0ms |
| 声音 | 默认静音，设置里可开 | — |

- **R11 只用 linear**：唯一例外是 `ease-out`，仅用于 240ms 以上的宽度补间。禁止 spring / bounce / 模糊过渡。
- **R12 尊重减弱动效**：`prefers-reduced-motion: reduce` 时全部 `0.001ms` 且不循环。
- 时长令牌只有四档：`--t-1:90ms` / `--t-2:140ms` / `--t-3:240ms` / `--t-4:900ms`。
- 禁止整页淡入、禁止骨架屏 shimmer、禁止列表 stagger（LCARS 是整块出现，不是逐项滑入）。

## 6. 反模式清单（出现即打回）

1. 四角圆角卡片 + 橙色描边 = 「复古太空风」，不是 LCARS。
2. 装饰性编号（`07-4421-3`、`SYS.OK` 之类无来源字符串）。
3. 橙色文字叠在橙色块上（对比度陷阱）。
4. 一屏 5 个 elbow / 到处 L 形装饰。
5. 细字重、细线、hairline 分割线。
6. 渐变、glow、scanline 贴图满屏铺。
7. 把每个面板都做成"仪表盘圆环"。
8. 用颜色区分"重要/次要"（那是尺寸的活）。
9. 中文正文被强行大写化 / 加宽字距。
10. 为了像 LCARS 而隐藏功能（信息可读性 > 致敬）。

---

## 7. Agent UI 信息架构（pi-agent 底座）

**只允许呈现 pi-agent 真实存在的能力。** 不得虚构"舰船武器/护盾"之类叙事功能。

| LCARS 位 | 承载内容 | 真实数据来源 |
|---|---|---|
| 左轨 `01 SESSION` | 会话列表、新建、恢复 | sessions |
| 左轨 `02 TOOLS` | 工具开关、MCP 连接（mg / playwright）、权限 | tools / mcp |
| 左轨 `03 AGENTS` | 子代理、workflow 运行、后台任务 | Agent / SubagentWorkflow / batch |
| 左轨 `04 CONTEXT` | 上下文占用、压缩、memory | compaction / token usage |
| 左轨 `05 SKILLS` | skills / extensions / prompt templates | skills |
| 左轨 `06 SYSTEM` | 模型、provider、thinking 档位、主题、键位 | models / settings |
| 顶栏 | `project@branch` · 模型名 · `sessionId` 短码 · 已运行时长 · 连接数 | — |
| 主区 mission log | user / assistant / thinking / tool call / tool result | message types |
| 工具读数行 | 工具名 · 参数摘要 1 行 · 耗时 · exit code · 输出折叠 | tool calls |
| 右栏 resource | context `USED / FREE` 两段（SDK 不报细分时**不编** system/tools 段）· tokens · 费用 | usage |
| 底部 command | 输入框 + `RUN`（回车）· `PLAN`（plan mode）· `STOP`（中断） | keybindings |
| 阻断层 | 工具审批：`tomato` 块 + `APPROVE / DENY / ALWAYS` | approvals |
| 左轨 `07 ABOUT` | 版本 · 依赖与许可证 · LCARS 归属 · 字体 · 网络姿态 | package.json + vite `define` + `api/system` |

> ⚠️ 上表的 `02 TOOLS / 03 AGENTS / 04 CONTEXT` 是**最初计划**。实际落地是
> `01 SESSION` 为默认视图（会话行即入口），导航为 `MCP / SKILLS / PROVIDERS / HISTORY / SYSTEM / ABOUT`，
> 依次对应 `⌥1`–`⌥6`，`⌥0` 回 mission log；CONTEXT 并入右栏，TOOLS 的 loadout + 调用统计并入 SYSTEM。
> 以 `src/views/Console.tsx` 的 `NAV` 为准（见 §9 交付对账）。

### 7.6b 空态补偿（LCARS filler）

LCARS 的左轨**从不留纯黑空洞**：内容排不满时，纵向剩余由**一根弹性矩形块**吃掉，
它读作列的延续（如同 LCARS 左侧那根通到底的竖条），而不是装饰。

本地规则：

- **一块**，不是一组：**满列宽**（与会话块、导航条同宽 320）、`flex: 1 1 auto` 吃掉剩余高度、
  `--g0` 底色、右下角 6px 圆角收口、与上方会话块和下方导航各留 4px 黑缝。
- 只做延伸，不承载信息：`pointer-events:none`、`aria-hidden`，不加文字、不加色条。
- 列表 `flex: 0 1 auto`（不抢空间），补块 `flex: 1 1 auto`（独占剩余）；
  一旦列表要滚动（`scrollHeight > clientHeight`，由 `ResizeObserver` 判定 → `data-cramped`）
  就**整块隐藏**，避免露出被裁一半的条。

### 7.6c-0 工作区切换（会话级，参考 Codex 的模型）

Codex 的做法是：**工作区在你开 session 时就定了，之后不可变**；文件树、diff、工具路径全部以它为根；
换工作区 = 开新 session，并且会显式告诉你"这是新会话"。本地照此实现：

- **cwd 是会话属性**，运行中不可改（pi 的 context 与工具作用域都绑在 cwd 上）。UI 上明确标注 `this session's workspace (fixed)`。
- **入口只有 NEW SESSION**：页头不放工作区切换器。点 NEW SESSION 弹出选择器，**必选目录才能建会话**。
- **选择器从文件系统根出发，不是从当前 cwd**：默认落在 `~`，顶部是面包屑（`/ Users name Projects …` 可点），
  `GO TO` 提供 HOME / ROOT / PROJECTS（macOS 另加 `/Volumes` 挂载卷），`RECENT` 列出已有会话的 cwd。
  `GET /api/fs` 不带 `path` 时返回 home —— 这是选择器，不是"当前目录浏览器"。
- **两段式：预览 → 提交**。浏览目录时文件树跟着走（`PREVIEW` 徽标 + amber 路径），但**不动当前会话**；
  **预览只在工作区内生效**（`/api/tree` 有越界保护），超出时文件树停在原处并显示一行说明，
  以免让人以为"树跟丢了"。确认后 `START SESSION` 才建会话。
- **联动是双向的**：deck 里的目录点击驱动文件树根；文件树头部的 `USE` 按钮 / 路径也能回到 deck。
- **提交后的反馈**：文件树保留在新工作区、显示 `workspace → ~/x · new session`，工具栏 WORKSPACE chip 同步更新，
  deck 自动关闭、PREVIEW 徽标消失。会话列表里多出一条（新会话）。
- **RECENT** 列出已有会话的 cwd 去重（最多 4 个），当前会话的用橙色描边标出。

### 7.6c 工作区文件树（侧栏 FILES 模式）

侧栏在会话列表上方有一个 `SESSIONS / FILES` 二段开关，切到 FILES 就是工作区目录树 ——
**同一个位置复用**，不开新面板、不加第三个滚动区。

- 行高 23px，`[11px 图标][名字 mono 11px][大小 9px][hover 出三个动作]`，缩进 `6 + depth×12`。
- **懒加载**：文件夹首次展开才请求 `/api/tree?path=`；折叠不清缓存，再次展开不重复请求。
- 动作条只在 hover 时出现（不占静态宽度）：`COPY`（相对路径）/ `OPEN`（编辑器）/ `REVEAL`（文件管理器）。
- **越界保护在服务端**：`guardPath()` 把路径 `realpath` 后必须落在工作区内，否则 `403 E_OUTSIDE`；
  客户端不自己判断。`openPath()` 按 `code -g` → `open -a "Visual Studio Code"` → `open` 顺序降级，
  并且**在 `spawn` 事件上 resolve**，不是 spawn 完就返回（否则 ENOENT 会被当成成功）。
- 默认隐藏 `.git` / `node_modules` / `dist`；文件名本身以 `.` 开头的也隐藏（可加 `?hidden=1`）。
- 切到 FILES 时，会话列表、NEW SESSION、弹性延伸块一起隐藏，树独占该区域。

### 7.6d Provider 面板（PROVIDERS 站）

- **只列已配置的**（有 key / 有 oauth），其余 43 个折叠成 `+ SHOW N PROVIDERS WITHOUT A KEY` ——
  一屏 45 行没人会读。已配置的排前面，不排序、不搜索。
- 每行：`4px 状态条`（无 key=g1 / api_key=cyan / oauth=lav）+ 名字 + 掩码 key + 模型数 + `ACTIVE`。
- 展开才拉模型列表（`op:"models"`）；模型行给 `USE`（下一轮生效）与 `DEFAULT`（写 `settings.json`，影响新会话）。
- **key 永远不回传**：服务端只返回 `sk-e…sZhU` 掩码；写入走 `auth.json` 原子替换 + `.bak`，
  输入框是 `type=password`，placeholder 显示现有掩码。
- `TEST` 调 `modelRuntime.checkAuth()`，结果写成一行 `READY · 142ms` / `INVALID · invalid_state`，
  不弹窗、不 toast。
- **自定义 provider**：`ADD` 写 `models.json`（`baseUrl` + `api` + `apiKey` + `models[].id`），
  写完立刻 `modelRuntime.refresh()`，不需要重启会话（实测新 provider 立即出现在列表里）。
  `api` 只允许四个值：`openai-completions` / `openai-responses` / `anthropic-messages` / `google-generative-ai`；
  其它协议要写 provider 扩展，面板不装作支持。
- **只写 baseUrl 等于走代理**：id 与内置 provider 同名时只覆盖 `baseUrl`，模型清单与鉴权保持不变
  （pi 文档定义的行为），面板文案要说清楚。
- **内置 provider 不可删**：`remove` 只删 `models.json` 里用户定义的条目，内置 id 返回 `404 E_NOT_CUSTOM`。
- 读取一律走**活着的 ModelRuntime**（`getProviders/getAllModels/hasConfiguredAuth`），
  不解析 models.json —— 保证界面和下一轮实际选择永远一致。

### 7.6d-2 MCP 站（ADD 表单必须覆盖 pi 的完整 server schema）

pi 的 `mcp.json` 一个 server 能写的字段远不止 `command` / `url`；表单少一项，用户就写不出那种配置。
ADD 表单因此覆盖：

| 字段 | 适用 | 说明 |
|---|---|---|
| `NAME` | 两者 | `[a-z0-9][a-z0-9._-]*`，工具名会变成 `mcp__<name>__<tool>` |
| `TRANSPORT` | — | `AUTO / STDIO / HTTP`；AUTO 看填了 url 还是 command，两边都填直接判错 |
| `COMMAND` | stdio | 只写可执行文件，不是 shell 字符串 |
| `ARGS` | stdio | 空白分词（支持引号）或直接贴 JSON 数组 |
| `WORKING DIR` | stdio | 绝对路径 / `~/…` / 相对会话目录 |
| `ENV` | stdio | 一行一个 `KEY=VALUE`（或 JSON 对象），值可写 `${VAR}` 或 `!命令` |
| `URL` / `HEADERS` | http | 一行一个 `Name: value`；同理支持 `${VAR}` |
| `TIMEOUT` | 两者 | 秒，1–3600，默认 60 |
| `DESCRIPTION` | 两者 | 一句话，进 system prompt 的 `mcp_servers` 段，也用于 tool search 排序 |
| `EXPOSURE` | 两者 | `codemode`（默认）/ `deferred` / `direct` / `hidden`，选中有解释行 |
| `SCOPE` | 两者 | `GLOBAL` 写 `~/.pi/agent/mcp.json`，`PROJECT` 写 `.pi/mcp.json`（需项目信任） |

硬规则：

- **解析在服务端**（`parseArgs` / `parsePairs`），客户端只传原始文本；错误必须带行号（`env line 3: expected KEY=VALUE`），
  不静默丢弃行。JSON 数组/对象作为逃生口保留。
- **秘密只进不出**：`env` / `headers` 的值可以含 token，`readMcp()` 只回报 `envKeys` / `headerKeys` 计数，
  任何响应里都不出现值（测试里用真 token 断言这一点）。
- 写入仍然 **备份 + 原子替换**，且 `command` 与 `url` 互斥（两种 transport 混写 pi 会判无效）。
- `exposure` 非法值、`timeout` 越界、重名、坏名字一律 `400/409 E_MCP`，不做"尽力而为"。

### 7.6e Skills 面板（SKILLS 站）

技能不是工具，pi 只在**判断适用时**把技能正文注入 system prompt —— 所以面板必须回答三个问题：

| 问题 | 呈现 |
|---|---|
| 加载了什么 | 名字 + 首个小标题（`# Heading`，跳过 frontmatter）+ 文件体积 |
| 有什么用 | **完整 description**，默认 3 行截断、点击展开（因为 description 往往就是一句使用说明） |
| 怎么触发 | 行内徽标 `AUTO · description` 或 `MANUAL /name`；页面底部固定一段「HOW A SKILL FIRES」解释两种机制 |

- 数据只从活的 `resourceLoader.getSkills()` 读（`Skill{name, description, filePath, baseDir, disableModelInvocation}`），不扫目录。
- `RELOAD` 直接调 `loader.reload()`：重读 SKILL.md，不重启进程；耗时写进按钮旁（实测 1.5s）。
- 每行 hover 出 `COPY`（路径）与 `OPEN`（编辑器），复用文件树那套动作。
- 扩展（extensions）与 prompt 模板分开计数，不混在技能列表里 —— 它们的注册方式不同。

### 7.6f 可折叠面板与设置

- **两侧都可折叠**，且不是"隐藏"：左栏折叠成 **64px 窄轨**，保留交互 —— 会话变成只剩大号编号的方块、
  NEW SESSION 只剩 `+`、导航只剩图标。**窄轨里所有东西都必须居中于 64px**（不是靠右）：
  图标项 `justify-content: center` 且去掉左右 padding，会话编号 `justify-self: center`。
- **折叠手柄放在各自栏的底部**（`pane-foot`，26px 高、整宽、hover 出底色），不再挂在工具栏上：
  工具栏左侧被 cap 悬挑占着，放哪儿都会"飘"；底部贴着它所控制的栏，位置自解释。
- **栏折叠后手柄必须还在**：左栏折成 64px 窄轨、手柄仍在底部；右栏折成 **24px 拉手条**，
  只放这一个按钮（`justify-content: flex-end` 让它在底部），否则右栏一收就没有入口了。
- 折叠图标用 `arrow-left-double-fill` / `arrow-right-double-fill`（双箭头在 12px 下比 sidebar-fold 更清楚），
  右侧栏成对镜像使用。
  cap **任何状态都是 `col + 55`**：折叠时 cap 是 119 宽、凹口正好收在 64px 的列边界上，
  内圆角语言不能丢；只是里面的标记改以 32px（窄轨中心）对齐。shelf 左内距恒为 70px。
- 快捷键：`⌘B / Ctrl B` 左栏、`⌘⇧B / Ctrl ⇧B` 右栏；**在输入框里也生效**（composer 没有占用这组绑定）。
- 状态写 localStorage（`lcars.left` / `lcars.right`），刷新保留。
- SETTINGS 站只放**界面相关**的东西：配色 / 界面缩放 / 动效 / 语言 / 背景 / PI 运行时路径 / 快捷键表 / 审批策略。
  运行时数值（模型、token）不放这里 —— 它们在 rail 与 CONTEXT 站。
- 语言只翻**界面外壳**（导航、按钮、输入提示、设置面板），消息与工具输出保持原文，
  面板底部明确写出这一点；新增文案先加 `i18n.ts` 的 key，不要在组件里写死中英文。

### 7.6k 扩展对话框（ask_user_question 等）

`@juicesharp/rpiv-ask-user-question` 的 `execute()` 第一行就是 `if (!ctx.hasUI) return rejectWithoutUi()`，
而且它的 reconciler 在 `before_agent_start` 里**看到 `hasUI === false` 会把工具从 active 集合里摘掉**。
所以绑定扩展时不能图省事：

- `bindExtensions` 必须传 `mode: "rpc"` **并且** 带 `uiContext`（`server/pi/dialogs.mjs`）。
  传 `{mode:"print"}` / 不传 uiContext → `hasUI=false` → 工具直接消失，模型会说"没有这个工具"。
- `uiContext` 只需要 `select / confirm / input`（包内的 RPC walker 就用这三个），其余方法给 no-op。
  `custom()` 返回 `undefined` 是有意的：浏览器没有 overlay，让包自己走 dialog walker。
- 每次 dialog 变成一条 `kind:"ask"` 的 item（`mode/title/options/placeholder`），
  用户选择 → `POST /api/answer {id, value}` → 解析 Promise → 工具继续执行并写回 toolResult。
- **样式与工具条/审批条同宗**：4px 竖脊 + 填充体 + **条状选项**（`20px 序号 | 文本 | →`，hover 出橙脊），
  不用胶囊按钮 —— 胶囊是本项目的"动作"形状，不是"选项"形状。描述折到第二行（`em`，`--g3`）。
  `Type something.` 与 `Dismiss` 用 `data-custom="1"` 降到灰阶，和真正的选项区分。
- `select` 的返回值可以是**选项原文**，也可以是**自由文本**（包把非选项文本当作"自己的答案"），
  所以块里既有选项按钮，也可以以后加输入框；取消 = 传 `null`，包会当作 Esc 并把"用户拒绝"告诉模型。
- 绑定时机：**第一次 prompt 之前**自动 `entry.bind()`（顺带把 MCP 工具注册进来），
  不在 boot 时绑 —— 那会拖慢会话创建。
- 注意 `tool_search` 会重写 active tool set，实测在一次搜索后 `ask_user_question` 会被挤出列表；
  这是 pi 扩展行为，不是本项目的 bug，写在这里免得下次误判。

### 7.6o 分支树（TREE）

TUI 的 `/tree` 对应物。服务端 `POST /api/session {op:"tree"}` 把 `manager.getTree()` 压平：**只留可读节点**
（user / assistant / toolResult / compaction / branch_summary / custom），
`model_change` / `thinking_level_change` / `system` / `context_edit` 这类记账条目隐藏，
子节点上提到最近的可见祖先 —— 否则树里全是噪音。`depth` 按可见层级重新计算。

- 每个节点标记 `current`（leaf）与 `isLeafPath`（root→leaf 路径），UI 靠这个做明暗：路径 0.85、其它 0.55、HEAD 全亮 + 橙脊。
- `POST /api/session {op:"goto", entryId}` = `manager.branch(entryId)` + 重建 session。
  **和 rewind 共用 `#rebuild()`**：dispose → 用同一 manager 重新 `createAgentSession` → 重绑扩展 →
  从 `session.messages` 重建 items → 推 `{e:"items"}`。运行中拒绝（`409 E_BUSY`）。
- 切换前必须二次确认（行内 `SWITCH HERE / CANCEL`）——它会把后续对话从当前视图移走。
- 入口是 center header 的 `TREE` 徽标，视图与文件查看器同级（替换 transcript 列，composer 不动）。

### 7.6r 四分区域工作区（STREAM，实验视图）

**同一份 `items` 的第二种看法**，不是替代品：mission log 仍是唯一按时间顺序读的地方。
用途是扫一场长跑——「它在想什么 / 我要它做什么 / 它给出了什么 / 机器现在在干什么」四件事分别可扫。

- **入口**：center header 的 `STREAM` 徽标（开着时变 `LOG`，`data-on="1"` 用 ice 实心），`Esc` 退回日志，
  `#stream` 可深链（与 `TREE` 同级：替换 transcript 区，composer 不动）。
- **切分是纯函数**（`zonesOf()`），每条 item 只落一个区，不复制、不编造：

  | 区 | 收什么 | 脊色 | 头部读数 |
  |---|---|---|---|
  | `THINKING` | assistant 的 `thinking`（非空） | `--moon` | 总词数；每块一条可展开（默认展开最新一条，折叠 6 行） |
  | `BASE` | `user`（含 skill / 附件）+ `summary`（压缩摘要） | `--orange` | `TURN n` |
  | `OUTPUT` | assistant 的 `text`（非空；只有 toolCall 的 assistant 消息不进） | `--w` | 会话正在生成时写 `生成中` |
  | `ACTION`（标签 `TERMINAL`） | `tool` / `approval` / `ask` / `notice` | `--tang` | 正在跑的工具数 |

**ACTION 是终端，不是又一个卡片列表**（右列两行高都是它的）：

- 每条工具 = **一行你本来会亲手敲的命令** + 它的原样输出。bash 用 `$` 前缀并显示**真实命令行**
  （多行命令按终端的样子换行，不折叠成一行提要）；其它工具用 `▸ name args`。
- 输出是 `pre` + 等宽 + `pre-wrap`：不缩进、不换字体、不加边框。行首符号照原样带（diff 的 `+`/`-` 保留），
  并按语义上色（add=cyan / del=tomato / hunk=moon / 截断=amber），失败时整段 tomato。
- 行尾读数只有真实字段：`T+01:12 · 0.8s · exit 1`；非 bash 没有 exit，diff 类显示 `+14 −2`（有 `onOpenDiff` 时再给 `VIEW`）。
- 默认 14 行，超出给 `+ N MORE LINES`；`status: run` 的条目在末尾多一行 `$ ▊` 闪烁块——终端说“还在跑”的方式。
- 审批/对话框仍用它们自己的阻断块（要能点），notice 降成同一套终端嗓音：`[TRUNCATED] 正文`。


- **布局**：`thinking` 压 `base` 在左列（360px），`action`（终端）占右列两行，`output` **满宽拿底栏最大一份高度**：行高比 `0.78fr / 0.58fr / 1.55fr`（1600×1000 实测 189 / 141 / 376：终端 189+141+黑缝 ≈ 334，输出 376）。早期版本把终端压在 168px，命令一多就只看得到最后两条；现在终端拿满右列，正文靠到底栏，两者都不再是脚注。
  ≤1180px 退成单列（每区最小 132px，`output` 220、`action` 260），整块滚动。区块之间只有黑缝，无描边。
- **每个区独立滚动且独立跟随**：只有贴底时才自动滚（滚上去就不再被拽回去）。**跟随的触发是内容增长，不是 `count`**：
  流式正文、流式 thinking、正在跑的命令输出都是“item 数不变、高度在长”，只按条数跟随等于看着答案长到屏幕外。
  实现是 `Zone` 里每次渲染后的 effect（`pinned` 为真才写 `scrollTop`），不需要 `ResizeObserver`。
- **空区必须自证**：四区各自的空态文案（`ws.empty*`）走 i18n，不留纯黑板。
- 头部读数全部来自本次数据（词数、turn 数、运行中工具数），不写装饰数字（§7.6）。


### 7.6n 斜杠命令与压缩摘要

**斜杠命令只列真正能跑的**：

- 服务端 `GET /api/commands` 从 loader 取 `getSkills()` → `/skill:<name>`（带 `<task>` 提示）
  与 `getPrompts()` → 模板名；**内置 CLI 命令（`/model` `/login` `/theme`）不进列表** ——
  它们是 TUI 层的，走 `session.prompt()` 根本不会执行，列出来等于骗人。
- 客户端再叠加五个"控制台自己的命令"：`/compact` `/fork` `/new` `/model` `/stop`，
  这些由 UI 直接执行（`/new`、`/model` 通过 `askDeck()` 事件打开对应 deck，不自己造第二套弹窗）。
- 输入以 `/` 开头且还没打空格时出现面板；`↑ ↓` 选择、`Tab/Enter` 补全（带参数的补全后留在输入框），
  `Esc` 清空。面板行是 `命令 | 说明 | 参数提示` 三段，和提示词索引同一套条状语法。

**压缩摘要**：

- `compaction_end` 带 `result` 时推一条 `kind:"summary"` 的 item：
  `CONTEXT COMPACTED · 148K → 24K TOKENS · MANUAL`，正文是模型自己写的摘要（可展开，走 Markdown 渲染）。
- 手动触发：`POST /api/session {op:"compact"}` → `session.compact()`；**错误只走 `compaction_end`**，
  路由的 catch 只记日志，否则同一次失败会出现两条 notice（踩过）。
- 会话太小时 pi 会回 `Nothing to compact (session too small)`，这条要原样显示，不要吞。

### 7.6m 历史浏览器（HISTORY 站）

全机 400+ 份 transcript，`SessionManager.listAll()` 全量解析要 **30 秒以上**，所以：

- **扫描放后台 + 缓存**（`historyCache`）：服务端启动即扫一次，`GET /api/history` **立刻返回**，
  带 `{ready, scanning, progress, scanned, matched}`；前端在 `scanning` 时每 1.8s 轮询，扫完自动落地。
- 端点只做内存过滤（标题 / 全文 / cwd / id），排序按修改时间倒序，最多 200 条；不阻塞、不分页。
- 每行：`4px 脊（forked = lavender）| 首句（单行）| cwd · N msgs · 相对时间 · forked/name | OPEN FORK RENAME ×`。
- **删除是两段式**：点垃圾桶 → 整行转 tomato 底色 + `DELETE / KEEP`，不做系统 confirm。
- 改名用行内输入（Enter 提交 / Esc 取消），不弹窗。
- 打开 / fork 直接复用 `/api/session {op:"open"|"fork", path}`，fork 后自动切到新会话。

### 7.6l Skill 调用块

用户输入 `/skill …` 时，pi 会把技能正文以
`<skill name="…" location="…">\n…\n</skill>\n\n用户自己的话` 的形式塞进消息。服务端用 SDK 的
`parseSkillBlock()` 拆开，`user` item 变成两段：

- `text` 只留操作者真正打的字（`</skill>` 之后的内容），不再把整篇技能正文倒进消息流。
- `skill` 字段带 `{name, location, lines, chars, head}`，渲染成独立块：
  **ice 竖脊 + `SKILL` 标签 + 技能名 + `N LINES · NK` + 路径（等宽、家目录简写）**，
  `PREVIEW` 展开前 3 行注入内容。默认收起 —— 一次技能调用动辄几百行，不能让它淹没对话。

### 7.6j 消息动作：复制 / 引用 / 撤回 / 排队

**每条消息（用户与助手）悬停出三个动作**，绝对定位在行右上，不占静态空间：

- `COPY` — 原文进剪贴板，不做 Markdown→纯文本的猜测。
- `QUOTE` — 通过 `composer.ts` 的 `askComposer({kind:"quote"})` 追加成 `> 行…` 引用块，聚焦并置尾；
  不替换用户现有草稿（引用是叠加，不是覆盖）。
- `RECALL`（仅用户消息）— 真正的"撤回"：`POST /api/session {op:"rewind", turn}`。
  pi 是 append-only，所以实现是 **branch + 重建 session**：`manager.branch(该消息前一条)` →
  dispose 旧 session → 用同一个 manager `createAgentSession` → 从 `session.messages` 重建 items →
  推 `{e:"items"}` 事件让前端整段替换。turn 从 1 起算，对应用户消息序号。
  跑的过程中拒绝（`409 E_BUSY`），前端提示先 STOP。
- 撤回后原文通过 `askComposer({kind:"replace"})` 放回输入框，光标置尾 —— 编辑完再发即是"改完重发"。

**排队可见**：`queue_update` 事件里的 `steering` / `followUp` **保留原文**（不是只留计数），
composer 上方出现 `QUEUED n` 条带，逐条显示待投递文本 + `delivered after the current turn`。
运行中按回车仍是 steer，不另开入口。

### 7.6i Thinking 块与提示词索引

**Thinking**（推理旁白，不是正文）：

- 结构改为「标签行 + 正文」两段：第一行是 `chevron + THINKING + N W`（词数），正文 13px/1.68、`max-width: 86ch`、可断词。
- 折叠**2 行**（不是 1 行 —— 一行截断读不出内容），展开后 `--w` 86% 不透明度、去掉 clamp；
  空间松紧靠 `6/12/7` 内边距 + `5px` 行距，不靠加粗或变色。
- 左侧 2px `--g1` 竖脊 + `--g0` 悬停底，整块是 `<button aria-expanded>`，键盘可用。
- 不显示 token 数（SDK 不给 reasoning token），只给词数，避免编数字。

**往来索引**（右栏倒数第二块，`CHATS / N`，在 RESOURCES / TOOL CALLS / FAILURES 之后）：

- 单位是**一次往来**（user 消息 + 它引发的全部 assistant/tool 条），不是"我发过的 prompt 列表"。
  每行两段：`01 用户首句（单行省略）` + `3 tools · 12.4K tok · 10:31`，让"这一轮干了多少事"可扫。
- **位置随阅读走**：`#scroll` 上监听滚动，取视口上方 80px 处之上最后一个 `[data-turn]`，
  该行 `inset 2px --orange` 高亮，并在列表自己的滚动区里居中（不带动整页）。
- 单击 → 关查看器（如果在开）→ `scrollIntoView({block:"start"})`；标题栏 `LATEST` 直接回到底部。
- 列表自身 `max-height: 208px` 内部滚动 —— 长会话靠滚动而不是"+N EARLIER"分页，索引才有"地图"感。
- 空态写明 `no exchanges yet`；不做筛选、不重排，索引只负责定位。

### 7.6h 内置查看器（文件 / 差异）

不弹窗、不跳转：查看器**替换 transcript 所在的整列**（头部 + 主体），composer 仍然固定在底部。

- **头部**：4px 橙脊 + 相对路径（等宽）+ `TYPE · SIZE · LINES` + 动作（md 的 `SOURCE/PREVIEW`、文本的 `WRAP`、`COPY`、`OPEN`、`CLOSE`）。
  `Esc` 关闭。头部用 **flex 而不是 grid** —— 动作数量随类型变化，grid 列数写死会把按钮挤到第二行（踩过）。
- **只预览浏览器能渲染的格式**：`text` / `image` / `audio` / `video`；
  其它一律 `NO INLINE PREVIEW` + 用 `OPEN` 交给系统。判定在服务端（`classify()` 按扩展名）。
- **文本**：左侧 52px 行号槽（`pointer-events: none`，不可选中）+ hljs 高亮正文，正文内部滚动。
  超过 512KB 或 6000 行会截断并明确说明原因（size / lines / binary）。
- **图片/音视频**走 `/api/raw`（支持 Range，视频可拖拽进度），`<img>/<audio>/<video>` 原生控件。
- **Markdown 默认 PREVIEW**（复用 §3.5b 的 Markdown 渲染），头部可切 `SOURCE` 回到带行号的源码。
- **差异视图**复用同一外壳：transcript 里的 diff 块有 `OPEN IN VIEWER`，打开后是整屏 hunk 视图。

### 7.6g 空态（standby）

空会话不能只剩一段说明文字：

`solid 4px --orange 竖条 + 21px 标题 STANDING BY + 10.5px 全大写副标`，下面用 `[96px 键 | 值]` 的
双列读数说清楚 LINK / INPUT / STREAM / SCOPE，键用 `--amber` 等宽，值用 `--g3` 等宽。
文案保持"仪表陈述句"，不用营销口吻，也不描述不存在的能力。

### 7.6q ABOUT 站（归属与致谢）

站点存在的原因：说清楚"这东西是谁的、用了谁的代码、致敬了谁"，同时不打断会话。

- **入口**：左轨最后一站 `ABOUT`（第七个），也是 `#about` 深链目标；`Esc`/点会话行返回 mission log。
- **运行时事实**来自 `GET /api/system`（node、pi SDK 版本、platform、workspace、port、policy），
  **构建期事实**来自 `vite.config.ts` 的 `define: __APP_INFO__`（版本、许可证、仓库地址、依赖清单）。
  依赖清单不是手写常量：构建时读每个包的 `package.json` 取 `version` + `license`，所以不会漂移。
- **UI 身份是独立一段**：头部副标 `pi-lcars <version>+<git sha>`（构建时 `git rev-parse --short`，tarball 安装显示 `no-git`），运行时区再给 `UI VERSION`（package.json 版本）与 `UI BUILD`（构建日期 · git sha）——"我跑的是哪次构建"必须能直接读出来，不能靠翻 npm。
- **作者段**（`AUTHOR & MAINTENANCE`）来自 `package.json` 的 `author`（字符串或对象都解析）：一块橙脊实心行，姓名 + `MAINTAINER` + mailto/主页。没有 author 字段就明写"没有"，不编一个名字。
- **归属文案**必须写死三件事：LCARS 出自 TNG(1987)、Michael Okuda 与 Rick Sternbach；三处刻意偏离
  （一色一义 / 放弃压缩字体 / 编号只放真实数据）；Star Trek 与 LCARS 是 Paramount/CBS 商标、
  本项目为非官方爱好者作品、不复用原版素材。
- **字体段**说明字体栈偏好的 MiSans（小米，免费商用）/ D-DIN / IBM Plex Mono（后两者 SIL OFL），
  并明确"不随包分发字体文件"。
- **网络段**必须与实现一致：无遥测、默认只绑 `127.0.0.1`、对外流量仅来自 pi 本身。
- 正文走 `i18n`（中英），包名/许可证/商标声明保持原文，不翻译专有名词。

### 7.7 会话块（列表项）

会话不是"小卡片"，是**实心块 + 双行读数**：

- 高度固定 52px，四角只在右侧收圆（`0 r r 0`）；无描边、无阴影。
- **左列是大号序号**：`21px` 等宽数字（`01 / 02 / 03`），右对齐、占两行高。序号取自会话 id 的自增段，
  **删掉会话后允许出现空号**（`01` → `03`），这比"按列表位置重排"更诚实 —— 位置会随活跃时间变，序号不会。
- **第一行是标题**：取会话的**首句提示词摘要**（服务端 `summaryOf()`：压缩空白 → 截第一句 → 超 56 字加省略号），
  11.5px 正文体、单行省略；没有消息时显示 `UNTITLED SESSION`（灰、常规字重）。改名优先于摘要。
- 第二行是 9.5px 元信息 `模型 / 短 ID`；右列 9px `LIVE / QUEUED / HELD / 相对时间 · 条数`。
- **选中 = 实心色块 + 黑字**；未选中 = 该色 10% 混黑底 + 2px 内描边 + 彩色字。
- **动作条（NEW SESSION）与列表项必须不同档**，否则三个橙色块互相打架。动作条用中性 `--g1` 底 +
  24px 图标格 + 11px 标签 + 右侧胶囊圆角，高度 40（比会话块 52 矮一档）；hover/聚焦直接**反色成实心橙 + 黑字**，无过渡。
  层级因此是：cap（实心橙，最大）→ 选中会话（实心橙，块）→ 动作条（中性，条）→ 未选中会话（淡橙，块）。
- 编号取自会话 id 里的自增序号（`s7-xxxx` → 07），**不能用列表下标** —— 列表按活跃时间排序，下标会跳。

**交互调整（相对原版 LCARS）**
- 原版没有滚动条概念 → 本项目允许主区纵向滚动，但滚动条必须是 4px 实色块，不出现系统滚动条。
- 原版没有 hover → 本项目用「整条块高亮（+8% 亮度）+ 左侧 6px 竖条」表示 hover/选中，不用描边、不用投影。
- 原版没有空态 → 每个面板必须有空态：`gray-2` 块 + 一行 11px 说明。

### 7.5 真实会话流：8 条硬规则（v1 的教训）

> v1 的错误：**每条工具调用的高度相同、距离相等，每类工具各出现一次，assistant 一次性输出给好的段落。**
> 那是“工具菜单”，不是“会话”。真实 agent 流的不均匀性本身就是信息。

1. **条高 = 权重，不是栅格**。允许的高度档位：`28 / 36 / 44 / 52 / 60 / 68 / 76 / 88`。
   单行工具 36、带一行结果 52、带错误原文 64–68、被截断的输出 60–64、多行参数 76–88。
   **禁止**把一个 turn 里的 N 条工具行做成等高。
2. **同一 turn 内的工具挤紧（4px），turn 之间拉开（8px）**。实现方式：`gap-4` 统一，
   在 turn 边界把相邻块的容器高度 +4px（黑底膨胀等价于间距），静默地打破均伤感。
3. **失败必须显示错误原文**，不得写“出错了”：`Access denied: filePath must be within the project directory`、
   `All-provider search failed: - Exa: fetch failed`。原文长度本身就是视觉重量。
4. **重试要占独立一条**，不能合并到失败条里。真实 agent 会 retry，并且往往仍然失败。
5. **截断是 pi 的常态**，必须显示：`warning: truncated output (original token count: 11764)`
   + `full output at /var/folders/...`。不显示截断的 UI 都是假的。
6. **并行调用合并成一条，用 `×N` 标识**（`READ ×2`），不拆成两条。
7. **流式必须可见**：2×20px 橙色 caret + 右侧三段扫描 + `41 TOK/S`；
   同时 command bar 必须同步为生成态（`RUN` 变灰、`STOP` 变亮、提示改成 `ESC TO INTERRUPT`），
   **不允许出现“消息在流、输入框还在等 RUN”的矛盾态**。
8. **图标必须在色块内部**：工具行的图标放在名字块（实色）里，与标签同行，颜色为 **黑**（跟块内文字同色）。
   早期版本给图标单独开了一列 26px，靠黑底衬托，结果在状态条和名字块之间切出一段黑，行被割裂。
   现在的列宽只有 `4px(状态) | 104px(名字+图标) | body | 88px(耗时)`，色块连续。
9. **折叠必须真的解开**：展开靠 `data-expanded="1"` 解除 `max-height`，不能只改渲染行数 ——
   只切数据而 CSS 仍钳着 `max-height: 2.8em` 时，按钮会"点了没反应"。展开后给 `52vh` 上限 + 内部滚动，
   否则 45 行输出会把整条 transcript 顶下去 700px。
   **展开手柄 = 工具名字块本身**（它已经是一个实色块，天然是最好的点击目标）：`<button class="nm">`
   带 `aria-expanded`，键盘 Enter/Space 可用；行尾的 `+ N MORE LINES` 只是同一动作的副入口。
10. **滚动窗从中间开始**：顶部放 `↑ 18 EARLIER MESSAGES` 灰条。
   会话永远不会刚好从第一句开始，也不会刚好排满。

### 7.6 数字必须自洽（v1 的第二个教训）

- 头部写 `18 MESSAGES` 就必须真有 18 条（或标明是历史总数）；**禁止**写一个与内容对不上的漂亮数字。
- 能用**本次会话真实计数**的优先用真实值（节点数、渲染次数、错误次数、耗时）。
- 占位数据（token / 费用 / 上下文）必须与消息量量级匹配：13 条短消息不可能烧掉 148K。
- 右栏面板要放**真实存在的东西**：本次会话没有 subagent / batch_run，就不画子代理停靠舱。


---

## 8. MasterGo 渲染管线约束（不可违反，来自 mastergo-design skill）

**HTML → 画板**
- 每个 `<section>` **必须**含 `flex` / `flex-col` / `flex-row` 之一（否则 padding 全失效）。
- 每个 `<p>` **必须**显式 `leading-[Npx]`（否则默认 36px 行高直接炸版）。
- `flex-row` 的每个子元素**必须**有 `w-[Npx]` 或 `flex-1`；只写 `px-` 的胶囊按钮会 CJK 折行。
- 每个标签**必须**有 `data-name`（图层名 = 后续覆写/组件的唯一锚点）。
- `rgba(...)` **不能有空格**；优先用 `#RRGGBBAA`。
- 嵌套 VERTICAL 容器**必须各自写死宽度**（auto-FILL 不递归）。
- 禁止：`hover:`/`sm:` 等变体前缀、`grid`、`%`/`vw`/`vh`、`calc`、非 gray/slate 调色板、`<button>`/`<input>`。
- `<div>` 只能是叶子节点；有子元素一律用 `<section>`。
- `<p>` 上禁止 `bg-*` / `p*-*` / `rounded-*`（会被写成文字色 → 文字隐形）。底色写在 `<section>`。
- 字体必须是宿主已安装的字体；不确定就先渲染一次，用 `node_get` 回读实际 `fontName`。

**字体（⚠️ 管线级坑，已实测）**

- `code_to_design` **忽略 HTML 里的 `font-family`（含 inline style）**，一律输出 `Inter` + 对应字重。
  实测：root 上写 `font-family:'Source Han Sans SC'`、元素上 inline 写 `'D-DIN'` / `'IBM Plex Mono'`，回读全是 Inter。
- 所以字体必须**渲染后二次归一化**：遍历根节点下所有 TEXT 节点，按内容与 `nodeName` 重新 `node_update` `fontName`。
  - 含 CJK → `MiSans`；字重 ≥600 → `Demibold`，否则 `Regular`
  - 纯英文/数字 → `D-DIN`；字重 ≥600 → `Bold`，否则 `Regular`
  - `nodeName` 含 `args` / `code` / `path` → `IBM Plex Mono`
- 归一化会改变文字实际宽度（Inter → MiSans/D-DIN 宽高不同），**必须留足余量**：
  单行文本块左右各留 ≥ 16px，容器高度按更大字号算，归一化后再用 `node_get` 抽查是否溢出。
- 未验证的字体名会**静默回退**到上一个可用字体，不报错 —— 只有回读 `fontName` 才能确认。

**画板操作**
- 新版与旧版**共存**，确认满意后再删旧版；不主动删用户画布内容。
- 一次 `code_to_design` 尽量一个整屏，避免多次渲染叠加错位。
- 大画板整体导出可能失败 → 分区块导出再拼。
- 渲染后必须 `selection_get` 回读校验，不靠"应该没问题"。

**MCP 服务的路径白名单（踩过）**
- `code_to_design` 的 `filePath` 与 `node_export_image` 的 `saveToPath` **必须落在 MCP 服务进程的 cwd 内**，
  否则报 `Access denied: ... must be within the project directory`。
- 实测服务 cwd = `/Users/liuyunkai/Projects/master-local-mcp/mgpilot-mcp`（不是本项目目录）。
  所以：**HTML 用 `html` 字符串传（不用 filePath）**；需要落图先存到那个目录再 `cp` 回来。

**渲染产物结构（每次都要知道）**
- `code_to_design` 返回的 `rootNodeIds[0]` 是**自动生成的白色画板容器**，你自己的根 `section` 是它唯一的子节点。
- 必做两件事：① 把容器 fill 改成 `#000000`（否则任何 1px 缝隙都露白）；② 给容器改语义名。
- 本次实测：1600×1000 主屏 = **249 个节点**、112 个文本节点，渲染 6–7s。

**布局自检脚本（必跑）**
渲染后遍历全树，用**绝对坐标**校验两件事 —— 注意 `node_get` 的 `x/y` 是相对父节点的，
直接跟父节点绝对 box 比会误报 78 处：
1. 子节点 bbox 不超出父节点 bbox；
2. 文本节点高度 > `leading × 1.5` 即视为意外折行（CJK 字体替换后最常见）。

---

## 9. 工作流

```
读 AGENTS.md
  → session_list 确认目标文档 / plugin_capabilities 确认宿主
  → 先在脑子里过 §6 反模式清单，再画
  → 写 HTML（Tailwind 白名单内）→ 逐条过 §8 自检
  → code_to_design（整屏一次）
  → selection_get 校验 + 导出局部 PNG 目视
  → 偏差写进 §10，不要只写在聊天里
```

**改版时**：新画板命名带版本（`LCARS Console v2 — Main`），旧版保留原位，左右分开放置（旧版 x 偏移 -1760）。

---

## 10. 决策记录（追加式，最新在下）

| 日期 | 决策 | 原因 | 影响文件/画板 |
|---|---|---|---|
| 2026-xx-xx | 颜色语义化，纠正原版 LCARS 装饰性用色 | 原版一色多义，真实产品不可读 | §2 全表 |
| 2026-xx-xx | 正文不全大写 | 长文全大写降低可读性（尤其中文） | §4 |
| 2026-xx-xx | 左轨编号 = 真实快捷键 | 去掉装饰性噪音，是"调整后的准则"核心 | §3 R9 |
| 2026-xx-xx | **放弃压缩字体**，改为 MiSans + D-DIN + IBM Plex Mono | 压缩粗体无 CJK 字形；且中英混排下压缩+大写不可读。身份改由几何/色块承担 | §4.1 |
| 2026-xx-xx | 英文结构标签大写 + 中文正文常态 | 保留 LCARS 语气，同时让中文可读 | §4.2 |
| 2026-xx-xx | 渲染后统一做 fontName 归一化 | 实测管线忽略 `font-family`，全部输出 Inter | §8 字体 |
| 2026-xx-xx | v1 主屏已落画板（249 节点 / 0 溢出 / 112 文本已归一化） | 首次可评审稿 | `boards/board-a.html` → 画板 `LCARS v1 — MAIN CONSOLE` |
| 2026-xx-xx | **v1 被判定为“LCARS 演示稿”**：等高同距、每类工具各一次、无失败无流式、数字与内容不自洽 | 与真实 pi 输出流差异大，信息密度均匀 = 幻灯片 | §7.5 / §7.6 新增 |
| 2026-xx-xx | v2 改为“真实会话流”：失败原文 / 重试独立条 / 截断警告 / 并行 ×N / 流式 caret + 生成态 command bar | 真实感来自不均匀 + 可核验细节 | `boards/board-b.html` |
| 2026-xx-xx | 交付 web 壳 `demo/`（SDK + SSE + 原生 DOM），画板降级为校验依据 | 静态稿无法验证节奏与状态，要能真跑 | §11 |
| 2026-xx-xx | 不造假空态：`03 AGENTS` 列真实 21 个工具的 loadout，`05 SKILLS` 明写未接线 | 实测 SDK 会加载 packages 里的工具 | §11 |
| 2026-xx-xx | 交付形态定为**一条命令**：`pi-lcars`（bin）= pi 后台 + UI + 浏览器；`dist` 随包发布，构建只在源码检出发生 | `opencode web` 式启动是产品级预期；全局安装不带 vite，不能要求用户先 build | PLAN.md §8（M9）、`bin/pi-lcars.mjs`、`package.json` 的 `bin`/`files`/`prepack` |
| 2026-xx-xx | 启动前做 **pi 环境检查**：候选按“能 import + 具备所需 API”逐个探测，新版缺 API 就自动退到旧版；没装 pi 就打印平台对应安装命令（不打栈） | 用户机器上 pi 的版本/路径不可预测；“报错但不说怎么办”是启动器的最大摩擦 | `server/pi/sdk.mjs`、`bin/pi-lcars.mjs` 的 `doctor`、`test/pi-env.mjs`；PLAN §8.8 |
| 2026-xx-xx | 路径一律 `node:os.homedir()` + `node:path`，支持 `PI_CODING_AGENT_DIR` / `PI_PACKAGE_DIR` | 旧代码读 `process.env.HOME`，在 Windows 上为空；pi 官方也提供这两个 env 覆盖 | `server/pi/sdk.mjs`、`server/index.mjs` |
| 2026-xx-xx | 新增 `07 ABOUT` 站：版本 / 运行时 / 依赖许可 / LCARS 归属 / 字体 / 网络姿态；依赖清单由构建期注入而非手写 | 归因与许可证是可分发项目的基本义务；手写清单必然与 `package.json` 漂移 | `src/views/About.tsx`、`src/appInfo.ts`、`vite.config.ts`、AGENTS §7.6q |
| 2026-xx-xx | 站点**组合键直连**：`⌥1`–`⌥6`（Alt+数字）切站、`⌥0` 回日志，左轨显示 `01`–`06` | §3 R9「编号即快捷键」此前只写了没接线。不用裸数字（会抢输入），不用 `⌘1–⌘9`（浏览器标签页）与 `⌘⇧3`（macOS 截图）；`⌥` 组合在两端都空闲，靠 `e.code` 取值以避开 macOS `⌥3=£` 的字符化 | `src/views/Console.tsx`、`src/styles/lcars.css` |
| 2026-xx-xx | 动作条统一为一条语言：40px 中性底 + 4px 橙脊 + 34px 图标格 + 11px 标签，图标格与编号列同轴、标签与标题同轴（50px） | `.lnew` 被两条同名规则叠成竖排（新规则没重置 `flex-direction`），且与 `.sess` 网格对不齐 | `src/styles/lcars.css`（`.lnew`、`.add-row`、`.form-actions`、`.form-note`、`.pv-h`） |
| 2026-xx-xx | `meta.queue` 只允许文本数组，客户端 `textList()` 兜底 | 服务端一处发数字、一处发数组，`...(... ?? [])` 抛异常后整页停止重渲染（表现为"点什么都没反应"） | `server/pi/registry.mjs`、`src/views/Console.tsx` |
| 2026-xx-xx | `Esc` 统一关闭覆盖层：deck → 分支树 → 查看器 → 否则中断运行 | 只有查看器响应 Esc，deck/树关不掉，与"覆盖层可 Esc 关闭"的直觉冲突 | `src/views/Console.tsx` |
| 2026-xx-xx | 右栏 context 条只画 `USED / FREE`，并写明"细分未由 SDK 提供" | 原来写死 `system 8% / tools 4%` 是编造数字，违反 §7.6；宁可少画一段也不假装有数据 | `src/views/Console.tsx`、`src/styles/lcars.css`（`.rnote`） |
| 2026-xx-xx | 模型列表按 provider 分组、全量展示、带 `ctx · $in/$out Mtok · reasoning`，46vh 内滚 | 原来只 `slice(0, 8)` 且不给成本/窗口，等于让人盲选；pi 的 model 对象本来就带 `contextWindow` 与 `cost` | `src/views/Console.tsx`、`server/index.mjs`（`/api/models`）、`src/api.ts` |
| 2026-xx-xx | MCP 的 ADD 表单补齐 pi 的 server schema（args / env / cwd / headers / timeout / description / exposure / scope），解析放服务端 | 只有 command/url 两项时，带 env 的 stdio server 与需要鉴权头的 http server 根本写不出来；手改 mcp.json 又绕过了备份与校验 | `src/views/Console.tsx`、`server/pi/mcpConfig.mjs`、`server/index.mjs`、`test/mcp-config.mjs` |
| 2026-xx-xx | 主题选项的左内距 12px（4px 选中脊 + 8px 呼吸），标签 11px | 原来左内距 4px，选中时 4px 橙脊正压在色板上；标签还是 10.5px | `src/styles/lcars.css` |
| 2026-xx-xx | 工具读数行改为**一条 tone 驱动的色带**：状态色同时决定 4px 状态条、名字块实色、正文 9% 透明底、读数块 22% 底 | 原来正文块无底色，实色名字块与灰读数块浮在黑底上，一行像两个岛，不是 LCARS 的连续条带 | `src/styles/lcars.css`（`.tool` 的 `--tone`） |
| 2026-xx-xx | 新增 `kelvin` / `picard` 两套主题，角色语义不变；色值来自 fan-canon 调色板（trekcolors / thelcars.com 的 Picard、Nemesis 等）并逐色提到"黑字可读"的亮度 | 用户要求跟进最近两部电影与新剧的配色；原四套已够用但没有"影视新作"的表达 | `src/styles/themes.css`、`src/theme.ts`、`scripts/check-themes.mjs` |
| 2026-xx-xx | 背景图改为**自绘 SVG**（`scripts/build-backdrop.mjs` → `public/backdrop.svg`），随包按 MIT 分发；不再使用影视剧照 | 参考图能表达"舰体+星空"的味道，但素材版权不明，不能随开源包分发。自绘只用平涂与低透明度，符合 §2 R4（无渐变/发光） | `scripts/build-backdrop.mjs`、`public/backdrop.svg`、`src/styles/lcars.css` |
| 2026-xx-xx | 背景图换成用户提供的舰体静帧（`public/backdrop.jpg`，1600px / 238 KB，40% 不透明度 + 55% 黑幕）；自绘 SVG 生成脚本保留作为可复现的替代方案 | 用户要的是这张图的实际观感；同一条"最坏合成 ≤ 46"的约束仍然成立（g3 4.9:1，g2 3.3:1 非文本） | `public/backdrop.jpg`、`src/styles/lcars.css`、`scripts/build-backdrop.mjs` |
| 2026-xx-xx | 新会话在 `#load()` 里补齐默认模型与思考档：`createAgentSession()` 不传 model 时 pi 会停在 `unknown/unknown`，导致 shelf 与 `pi-lcars status` 显示假值 | “unknown/unknown” 违反 §7.6 数字自洽；同时它让 pi-lens 把 situational 工具当默认激活，工具清单虚高 | `server/pi/registry.mjs`、`test/smoke.mjs` |
| 2026-xx-xx | **内置壁纸移除**。背景改为用户自选本地图片：`SETTINGS → BACKDROP → CHOOSE…` 打开磁盘选择器（HOME / PICTURES / DESKTOP / DOWNLOADS / ROOT / 挂载卷，面包屑 + 图片行带缩略图），选定后 `settings.backdrop` 存绝对路径 | 随包分发壁纸无论自绘还是静帧都是替用户做审美决定，且要背素材来源；把选择权交给用户后包里零图片零版权负担。图片**原地读取**（`/api/backdrop/file`）不复制进项目，删掉文件即自动回到纯黑 | `server/pi/fs.mjs`（`listBackdropDir` / `backdropFile`）、`server/index.mjs`、`src/views/Console.tsx`（`BackdropPicker`）、`src/settings.ts`、`src/styles/lcars.css`、`test/smoke.mjs`、`test/ui.mjs`；删除 `public/backdrop.jpg`、`scripts/build-backdrop.mjs` |
| 2026-xx-xx | 背景仍是**纹理而非壁纸**：40% 不透明度 + 55% 黑幕的合成上界与图片内容无关（任意像素最坏 rgb(46,46,46)），所以用户换成多亮的照片都不会突破 §2 R2；不做亮度/透明度滑杆，避免第二个变量破坏对比度 | 纯色块是 LCARS 的构图基础，背景只能“看得见舰体，读得清读数”；把上界做成常量就不需要每张图人工验对比度 | `src/styles/lcars.css`（`--backdrop-image`） |
| 2026-xx-xx | ABOUT 站补齐 **UI 版本与作者**：头部副标成 `pi-lcars 0.3.2+261f880`（版本 + 构建时 git 短 sha），运行时区新增 `UI VERSION` / `UI BUILD`（构建日期 + commit），新增 `AUTHOR & MAINTENANCE` 段（姓名 + MAINTAINER + mailto） | 原来只有 package.json 的版本号，无法回答"这个标签页跑的是哪次构建"；作者与许可归属是可分发项目的基本义务，靠 npm 页面不算写明 | `vite.config.ts`（`parseAuthor`/`gitCommit`/`builtAt`）、`src/appInfo.ts`、`src/views/About.tsx`、`src/styles/lcars.css`、`package.json` 的 `author` |
| 2026-xx-xx | 输入区四项能力：**草稿持久化 + ↑ 历史召回 + 图片附件 + `@` 文件引用 + 自增高**（详规进 §4.3b） | 这四项全是"一眼看得出该有、但现在没有"的输入区缺口；实现都靠真事件（`prompt(text, {images})` / `steer(text, images)`），不造第二条消息通道 | `src/views/Console.tsx`（`Composer`）、`src/drafts.ts`、`src/api.ts`、`src/store.ts`、`server/index.mjs`（`normalizeImages` + `GET /api/files`）、`server/pi/fs.mjs`（`searchFiles`）、`server/pi/format.mjs`（`imagesOf`）、`src/components/ui.tsx`（`fmtSize`、附件 chip） |
| 2026-xx-xx | 输入区高度从"固定 96px"改为 **96px 下限 + 240px 上限的自增高**，`ENTRY` 块与按钮**固定 96 贴底** | 多行草稿（粘贴一段日志/报错）在两行高的字段里根本没法改；但整条 bar 一起长高会把按钮拉成色块板。只让字段长高、控件贴底，两个问题都解 | `src/styles/lcars.css`（`.cmdbar` / `.cmd-entry` / `.btn`）、`Composer` 的测量 effect、AGENTS §4.3 |
| 2026-xx-xx | 附件在**转录区只留数量与体积**（`{mimeType, bytes}`），不回传 base64 | 一张截图 base64 就几百 KB，塞进 SSE 会让每次重渲染都搬运一遍；模型已经拿到字节，界面只需要回答"这轮带了什么" | `server/index.mjs`（`attachmentMeta`）、`server/pi/registry.mjs`（重开后从 session 里 `imagesOf` 还原）、`src/components/ui.tsx`（`.msg-attach`） |
| 2026-xx-xx | 新增实验视图 **四分区域工作区**（`STREAM` 徽标切换 / `#stream` 深链）：同一份 items 按种类切成 thinking / base / output / action 四区，各自滚动、各自跟随；**不替换 mission log**，`Esc` 或徽标退回 | 长跑里「在读什么、产出什么、机器在干什么」混在一条时间线里，扫不动；分区是 LCARS 多仪表盘的原始用法，而按时间顺序读仍然只有 log 一种正确方式，所以做成并列视图而不是改造 log | `src/views/Console.tsx`（`zonesOf`/`Zone`/`Workspace`、`wsOpen`、hash、Esc）、`src/styles/lcars.css`（`.ws*`）、`src/i18n.ts`（`ws.*`）、`test/ui.mjs`、AGENTS §7.6r |
| 2026-xx-xx | STREAM 视图对齐真实会话响应（三处）：① 客户端 store 的 `item` / `patch` / `delta` 不再原地改数组与对象，改发布**新数组 + 新 item**；② `Zone` 的跟随从“按 `count`”改为“每次渲染按内容高度”（贴底才跟）；③ `OUTPUT` 区只收真正有 `text` 的 assistant 消息，`生成中` 改由会话的 `streaming` 推导。服务端 `#load()` 也调用 `#hydrate()`（原先只有 rewind/goto 的 `#rebuild()` 才从 `session.messages` 重建） | 三条都是“真实响应到来时视图不真实”：memo 用的 `items` 身份在整场运行里不变，四区的**成员**被冻结在开跑那一刻（只有 log 在长）；流式正文/thinking/命令输出“条数不变、高度在长”，按条数跟随等于让答案长到屏幕外；只有 toolCall 的 assistant 消息会先占一条空 caret 再消失。而历史/恢复的会话 `items` 恒为 0——真实的 `session.messages` 从来没有被读回界面 | `src/store.ts`、`src/views/Console.tsx`（`zonesOf` / `Zone` / `Workspace`）、`server/pi/registry.mjs`（`#hydrate`）、`server/pi/stream.mjs`（导出 `agentMeta` / `nestedChildren`）、`test/smoke.mjs`、AGENTS §7.6r |
| 2026-xx-xx | TERMINAL 与 OUTPUT **换位**：终端占右列（两行高），输出改满宽底栏（行高比不变：`0.78/0.58/1.55`） | 操作员要的是“命令在上、结果在下”的阅读顺序：终端是看“现在在干什么”的，贴右上就不用跨整屏回到左下；正文（markdown、宽段落）在满宽底栏读起来更顺，而终端在 360px 以上宽度下 `pre-wrap` 本来就够用。代价：终端不再是四区最大一块（输出 376px > 终端 ≈ 334px），`test/ui.mjs` 的断言同步改成“终端占右列 / 输出占满宽底栏” | `src/styles/lcars.css`（`.ws` 各 `grid-area`）、`test/ui.mjs`、AGENTS §7.6r |
| 2026-xx-xx | 输入区适配输入法（IME）：组字期间 `value` 与 DOM 逐键同步（不再“组字期间不改 state”）；`onKeyDown` 顶部统一 `imeBusy()` 短路（`composing` ref / `isComposing` / `keyCode 229`），`Enter` `↑↓` `Tab` `Esc` 让给候选窗；`growth` 改为公共 `grow()` 并在 `input` / `compositionupdate` 里量；所有全局 Esc（中断运行、关覆盖层、壁纸选择器）与其它 Enter 提交框同样短路 | 两个真实病灶：① Preact 在 `value !== dom.value` 时**每次渲染回写** `value`，而渲染由 `setCaret` 触发——于是每敲一个拼音就把半个词吐回去，字段也停在 2 行高；② 组字时的 Enter/Esc 是“选词/关候选”，被当成“发送/中断”，半成品直接发出、跑着的回合被意外停掉 | `src/views/Console.tsx`（`imeBusy` / `Composer` 的 `grow` / 各 keydown）、`test/ui.mjs`（组字四检）、AGENTS §4.3b |
| 2026-xx-xx | ACTION 区**重画成终端**并拿到最大高度（行高比 `0.78 / 0.58 / 1.55`，标签改 `TERMINAL`）：bash 显示真实命令行 + 原样输出 + `exit N`，diff 显示 `+N −M` 与着色行，跑着的条目末尾追加闪烁 `$ ▊` | 168px 的底栏只够看两条命令，而“这把到底跑了什么、回来什么”正是分区视图存在的理由；终端是唯一既能提密度又能保留原文的形态，也不与 log 里的 LCARS 读数条重复 | `src/views/Console.tsx`（`TerminalEntry` / `termCommand` / `termBody`）、`src/styles/lcars.css`（`.term*` + 行高比）、`src/views/Craft.tsx`（`?craft#workspace` 样例流）、AGENTS §7.6r |

---

## 11. Web 壳实现（`src/` + `server/`）
> 工程已升级：`src/`（Vite + Preact + TS，正式客户端）/ `server/`（Node）/
> `demo/`（v0 参考实现，保留对照）。构件与令牌在 `src/styles/tokens.css`，
> 工艺层的可视化验收页在 `src/views/Craft.tsx`（`npm run dev` 打开）。


画板之外的第二个交付形态：**浏览器里的真会话**，不是原型。

```
browser ──EventSource(/api/stream)──► server.mjs ──session.subscribe──► pi SDK (in-process)
   └──POST /api/prompt|abort|reset─────┘
```

- **零依赖**：Node `http` + SSE + 原生 DOM，没有构建步骤，`node demo/server.mjs` 就开。
- **SDK 而不是 RPC**：`createAgentSession({ cwd, sessionManager: inMemory })`；实测默认就加载了 21 个工具
  （含 `Agent` / `SubagentWorkflow` / `todo` / `web_search` / `plan_mode_*`）。
- **服务端归一化**：pi 的原始事件 → `user` / `assistant` / `tool` / `notice` 四种 item；
  前端不认 pi 的事件格式，只认 item。`delta` 走增量，`patch` 走整条更新，`meta` 走状态。
- **高度是算出来的，不是写的**：`.tool { min-height: 40px }`，失败多一行错误就自己变高 ——
  这是 §7.5 的规则第一次真的成立。

**下面这些行为都是真事件驱动的**，不许改成假数据：

| UI 现象 | 来源事件 |
|---|---|
| 文字逐字流 + `TOK/S` | `message_update` / `assistantMessageEvent.type === "text_delta"` |
| 工具行运行/成功/失败/耗时 | `tool_execution_start` / `tool_execution_end`（`isError` / `durationMs`） |
| `RETRY` 独立行 | `auto_retry_start` / `auto_retry_end` |
| 截断黄条 | tool result `details.truncated` 或输出匹配 `truncated` |
| command bar 变生成态 | `agent_end` / `agent_settled` + running 标志 |
| 上下文百分比 | assistant message 的 `usage.totalTokens ÷ model.contextWindow` |

**server 端点（M0 落地的部分）**

| method | path | 说明 |
|---|---|---|
| GET | `/api/bootstrap` | 会话列表 + active meta + policy + items |
| GET | `/api/stream` | 单通道 SSE，事件带 `sessionId` |
| POST | `/api/session` | `new / open / fork / activate / rename / delete` |
| POST | `/api/prompt` | `{text, images?}`；目标会话在跑 → `steer(text, images)`；否则进全局队列。附件只收 `png/jpeg/webp/gif`，最多 6 张，独立 32MB 请求缓冲 |
| POST | `/api/abort` · `/api/approve` · `/api/policy` | 中断 / 审批 / 策略 |
| POST | `/api/model` · `/api/thinking` | 热切换，下一轮生效 |
| GET | `/api/models` · `/api/fs` | 模型清单 / 目录浏览（仅目录） |
| GET | `/api/files` | `@` 补全用的扁平文件索引（`?q=&limit=`，跳过 `node_modules/.git/dist` 与隐藏项，20s 缓存） |

**踩过的坑（别再踩）**
- **flex 高度链断一环，footer 就不贴底**：`#root` 必须显式 `height:100%`，且 `.main / .body / .center` 每层都要 `min-height:0`，
  否则 `.scroll` 拿到的是内容高度，整页（body）反而变成滚动容器 —— 表现就是"输入框被推到屏幕外 + 侧栏跳动"。
- **派生状态不能回写自身**：`meta.running` 由「agent 原始状态 OR 队列占用」派生，
  早期版本把派生值写回同一个字段，于是 `running` 永远为 true（自己喂自己）。
  现在原始状态存 `entry.running`，`meta.running` 只在 `refreshMeta()` 里算一次。
- `node_get` 之外的「子节点坐标」是相对父层的：做布局审计必须先累加成绝对坐标（MasterGo 阶段踩过）。
- `session.prompt()` 在已流式时会**直接 reject**，必须改用 `steer()` / `followUp()`。
- 只有 tool call、没有文本的 assistant 消息**不能渲染空块**（模型经常这样）：
  `hasBody` 为空就整行不画；正在流式但还没出字时只画 caret 行。
- 服务端广播的 `meta` 会整体覆盖客户端状态，`mock` 这类本地标志必须 **merge** 而不是赋值。
- 时间轴用**服务端 `t0` 绝对时间**，不要用 `uptime` 反推（会算出 `T+-1:-32`）。
- `contextWindow` 可能到 1M，`fmtTok` 必须处理 M，否则显示 `1000.0K`。

---

## 12. 未决问题（待用户裁决）

- [x] 是否要中文界面 → **是**：英文大写结构标签 + 中文正文/对话（见 §4.2）
- [x] 是否输出动效原型（HTML 可跑）还是仅静态画板 → **可跑的 web 壳**：`src/` + `server/`，
  画板降级为视觉依据（§11）；动效语言见 §5
- [x] 亮色/浅色变体 → **不做**：LCARS 是暗屏系统，浅色会毁掉「黑缝即网格」（§2.5）
- [x] 右栏是否常驻 → **可折叠**：`⌘⇧B` 收成 24px 拉手条（§7.6f）
- [ ] 目标形态：桌面宽屏 1600×1000 为主？是否需要 1440×900 / 1280×800 适配稿？
  （当前实现只做宽度断点：1600 / 1280 / 1100 起，见 §4.2b）
