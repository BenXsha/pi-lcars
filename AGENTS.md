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
- 输入区顶部一行 9.5px 元信息：左「快捷键提示」右「字符数 / INPUT」，运行态时左侧变 `--orange`。
- 高度固定 96px，**永远贴在窗口底部**（footer），不随消息流滚动。

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
| 右栏 resource | context 分段条（system/tools/history/free）· tokens · 费用 · 延迟 | usage |
| 底部 command | 输入框 + `RUN`（回车）· `PLAN`（plan mode）· `STOP`（中断） | keybindings |
| 阻断层 | 工具审批：`tomato` 块 + `APPROVE / DENY / ALWAYS` | approvals |

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
- SETTINGS 站只放**界面相关**的东西：配色 / 界面缩放 / 动效 / 语言 / PI 运行时路径 / 快捷键表 / 审批策略。
  运行时数值（模型、token）不放这里 —— 它们在 rail 与 CONTEXT 站。
- 语言只翻**界面外壳**（导航、按钮、输入提示、设置面板），消息与工具输出保持原文，
  面板底部明确写出这一点；新增文案先加 `i18n.ts` 的 key，不要在组件里写死中英文。

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
| POST | `/api/prompt` | 目标会话在跑 → `steer()`；否则进全局队列 |
| POST | `/api/abort` · `/api/approve` · `/api/policy` | 中断 / 审批 / 策略 |
| POST | `/api/model` · `/api/thinking` | 热切换，下一轮生效 |
| GET | `/api/models` · `/api/fs` | 模型清单 / 目录浏览（仅目录） |

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

- [ ] 目标形态：桌面宽屏 1600×1000 为主？是否需要 1440×900 / 1280×800 适配稿？
- [x] 是否要中文界面 → **是**：英文大写结构标签 + 中文正文/对话（见 §4.2）
- [ ] 是否输出动效原型（HTML 可跑）还是仅静态画板？
- [ ] 亮色/浅色变体是否需要（原版 LCARS 有浅色屏版本，但本项目建议只做暗色）
- [ ] 右栏是否常驻，还是可折叠（宽度换取主区呼吸感）？
