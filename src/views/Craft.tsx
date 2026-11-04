import { useState } from "preact/hooks";
import type { Item } from "../api";
import { Workspace } from "./console/Workspace";
import { LogState } from "./console/LogState";
import { ICONS, type IconName } from "../icons";
import { THEMES, appliedTheme, applyTheme, type ThemeId } from "../theme";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import {
  ApprovalDeck,
  BarButton,
  ControlChip,
  Deck,
  Elbow,
  FieldRow,
  MessageRow,
  Meter,
  NoticeRow,
  PickRow,
  Readout,
  Segmented,
  Shelf,
  Station,
  ToolStrip,
} from "../components/ui";

/* -------------------------------------------------- three-zone workspace */
/* Sample stream for the workspace view: the same shapes the live one produces
 * (a command, a diff, a failure, a notice) so the terminals read like the real
 * thing without a model behind them. */
const WS_T0 = 1_700_000_000_000;
const WS_ITEMS: Item[] = [
  {
    kind: "user",
    id: "w1",
    text: "给 /login 加个令牌桶限流，跑一遍测试，把改动列出来。",
    ts: WS_T0,
  },
  {
    kind: "assistant",
    id: "w2",
    text: "",
    thinking:
      "先确认中间件目录和测试怎么组织。限流要按 IP 建桶，得先看 req.ip 在这套 express 版本里拿到的是什么——如果反代在中间，直接取 ip 会把所有人算成一个桶。读完 server/middleware 再决定 key。",
    streaming: false,
    ts: WS_T0 + 6_000,
  },
  {
    kind: "tool",
    id: "w3",
    callId: "c1",
    name: "bash",
    args: `rg -n "rate.?limit|token.?bucket" server/ --glob '!node_modules'`,
    status: "ok",
    output: "server/middleware/auth.ts:14:  // TODO: rate limit per ip before the token check\nserver/config.ts:31:  ttl: 60_000,\n\n2 files, 2 matches",
    ms: 112,
    exitCode: 0,
    ts: WS_T0 + 12_000,
  },
  {
    kind: "tool",
    id: "w4",
    callId: "c2",
    name: "edit",
    args: "server/middleware/ratelimit.ts",
    status: "ok",
    output: "",
    ms: 41,
    ts: WS_T0 + 20_000,
    diff: {
      path: "server/middleware/ratelimit.ts",
      stat: { add: 14, del: 2 },
      hunks: [
        {
          hdr: "@@ -8,7 +8,19 @@",
          oldNo: 8,
          newNo: 8,
          lines: [
            { t: " ", o: 8, n: 8, text: "export function ratelimit(opts: Opts) {" },
            { t: "-", o: 9, text: "  const hits = new Map<string, number>();" },
            { t: "+", n: 9, text: "  const buckets = new Map<string, Bucket>();" },
            { t: "+", n: 10, text: "  return (req, res, next) => {" },
            { t: "+", n: 11, text: "    const key = forwardedFor(req) ?? req.ip;" },
            { t: "+", n: 12, text: "    if (!spend(buckets, key, opts)) return res.status(429).end();" },
            { t: "+", n: 13, text: "    next();" },
            { t: "+", n: 14, text: "  };" },
          ],
        },
      ],
    },
  },
  {
    kind: "tool",
    id: "w5",
    callId: "c3",
    name: "bash",
    args: "npm test -- --run test/login.test.ts",
    status: "error",
    output: "",
    errorText:
      "FAIL test/login.test.ts\n  ● POST /login › refuses the 11th attempt in a minute\n    expected 429, received 200\n      at Object.<anonymous> (test/login.test.ts:42:18)\n\nTests: 1 failed, 12 passed",
    ms: 8_420,
    exitCode: 1,
    ts: WS_T0 + 40_000,
  },
  {
    kind: "notice",
    id: "w6",
    label: "TRUNCATED",
    tone: "warn",
    text: "warning: truncated output (original token count: 11764) — full output at /var/folders/..",
    ts: WS_T0 + 44_000,
  },
  {
    kind: "assistant",
    id: "w7",
    text:
      "限流加好了，但测试只走了 429 那条的一半：现有的 `login.test.ts` 在 11 次后仍拿到 200，因为桶的 key 取的是 `req.ip`，而测试用 `supertest` 打上来时是 `127.0.0.1:0` 同一个人。把 key 换成 forwarded-for 首段后重跑。",
    thinking: "",
    streaming: false,
    usage: { input: 18_240, output: 412, cost: 0.002, total: 18_652 },
    ts: WS_T0 + 52_000,
  },
  /* ---- second exchange: the cycle read twice is what makes it a cycle ---- */
  {
    kind: "user",
    id: "w8",
    text: "那就把 key 换成 forwarded-for，再跑一次；顺带把那两个被吃掉的测试改成断言 429。",
    ts: WS_T0 + 60_000,
  },
  {
    kind: "assistant",
    id: "w9",
    text: "",
    thinking:
      "forwarded-for 可能有多段（client, proxy1, proxy2），只取首段；测试里要显式带 X-Forwarded-For 才能复现不同的人。先看测试文件怎么造请求。",
    streaming: false,
    ts: WS_T0 + 66_000,
  },
  {
    kind: "tool",
    id: "w10",
    callId: "c4",
    name: "read",
    args: "test/login.test.ts",
    status: "ok",
    output: "1  import request from 'supertest';\n2  import { app } from '../server/app';\n…\n38  it('refuses the 11th attempt in a minute', async () => {",
    ms: 18,
    ts: WS_T0 + 70_000,
  },
  {
    kind: "tool",
    id: "w11",
    callId: "c5",
    name: "edit",
    args: "test/login.test.ts",
    status: "ok",
    output: "",
    ms: 55,
    ts: WS_T0 + 74_000,
    diff: {
      path: "test/login.test.ts",
      stat: { add: 4, del: 1 },
      hunks: [
        {
          hdr: "@@ -38,7 +38,10 @@",
          oldNo: 38,
          newNo: 38,
          lines: [
            { t: " ", o: 38, n: 38, text: "  it('refuses the 11th attempt in a minute', async () => {" },
            { t: "-", o: 39, text: "    await request(app).post('/login');" },
            { t: "+", n: 39, text: "    const send = (n: number) =>" },
            { t: "+", n: 40, text: "      request(app).post('/login').set('X-Forwarded-For', `10.0.0.${n}`);" },
            { t: "+", n: 41, text: "    for (let i = 1; i <= 11; i++) await send(i);" },
            { t: "+", n: 42, text: "    expect((await send(12)).status).toBe(429);" },
          ],
        },
      ],
    },
  },
  {
    kind: "tool",
    id: "w12",
    callId: "c6",
    name: "bash",
    args: "npm test -- --run test/login.test.ts",
    status: "run",
    output: " RUN  v3.2.4 /Users/liuyunkai/Projects/design\n\n ✓ test/login.test.ts (2 tests) 41ms",
    ms: undefined,
    ts: WS_T0 + 82_000,
  },
  {
    kind: "assistant",
    id: "w13",
    text: "",
    thinking: "测试在跑，先把结论写一半：key 取 forwarded-for 首段后，每个虚拟 IP 一个桶。",
    streaming: true,
    ts: WS_T0 + 88_000,
  },
];

/* ---------------------------------------------------------------- markdown */
/* The one surface §3.5b is about: prose rhythm, an aligned table, a fenced
 * block and inline code in a sentence. Kept here so the file viewer's PREVIEW
 * and the transcript's prose can both be eyeballed without a session. */
const MD_SAMPLE = `### 限流接入说明

按 IP 建令牌桶，\`60\` 秒 \`10\` 次，超限返回 \`429\`。中间件按路由挂载，现有接口行为不变；
细节见 [README](https://example.com/readme)。

| 字段 | 类型 | 默认值 | 说明 |
|:-----|:----:|------:|------|
| \`key\` | string | \`req.ip\` | 令牌桶键 |
| \`limit\` | number | 10 | 窗口内允许次数 |
| \`windowMs\` | number | 60000 | 窗口长度 |

\`\`\`ts
import { Router } from "express";

const router = Router();
router.post("/login", handler);   // 429 when the bucket is empty
export default router;
\`\`\`

1. 挂载中间件到 \`/login\`
2. 补一条 429 的测试

> 拒绝不等于报错：超限是有意的返回，不进 error 分支。`;

/* ---------------------------------------------------------------- helpers */
function Section(props: { id: string; title: string; note?: string; children: any }) {
  return (
    <section id={props.id} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <div style={{ width: "4px", height: "22px", background: "var(--amber)", borderRadius: "2px" }} />
        <span style={{ font: "700 11px/1 var(--din)", letterSpacing: "0.18em", color: "var(--amber)" }}>
          {props.title}
        </span>
        {props.note ? (
          <span style={{ font: "400 11px/1.4 var(--mono)", color: "var(--g2)" }}>{props.note}</span>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}

const DIRS = [
  { name: "/Users/liuyunkai/Projects/design", meta: "AGENTS.md · src/ · server/" },
  { name: "/Users/liuyunkai/Projects/design/demo", meta: "server.mjs · public/" },
  { name: "/Users/liuyunkai/Projects/design/src", meta: "components/ · views/" },
  { name: "/Users/liuyunkai/Projects/master-local-mcp", meta: "mgpilot-mcp/" },
  { name: "/Users/liuyunkai/Projects", meta: "12 dirs" },
];

const MODELS = [
  { p: "ai-native-x", m: "deepseek-v4-flash", ctx: "1.0M", sel: true },
  { p: "ai-native-x", m: "deepseek-v4-pro", ctx: "256K", sel: false },
  { p: "zai-free", m: "glm-4.6", ctx: "200K", sel: false },
  { p: "anthropic", m: "claude-sonnet-4.5", ctx: "400K", sel: false },
];

/* ---------------------------------------------------------------- view */
export function Craft() {
  const [deck, setDeck] = useState<"cwd" | "model" | "think" | null>(null);
  const [cwd, setCwd] = useState(DIRS[0].name);
  const [model, setModel] = useState("deepseek-v4-flash");
  const [think, setThink] = useState<"off" | "low" | "medium" | "high">("off");
  const [toolOpen, setToolOpen] = useState(false);
  const [apState, setApState] = useState<"pending" | "approved" | "denied">("pending");
  const [motionKey, setMotionKey] = useState(0);
  const [motion, setMotion] = useState<"wipe" | "swap" | "pulse">("wipe");
  const [theme, setTheme] = useState<ThemeId>(appliedTheme());

  const replay = (m: typeof motion) => {
    setMotion(m);
    setMotionKey((k) => k + 1);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Shelf brand="PI AGENT CONSOLE" tag="CRAFT LAYER / PRIMITIVES">
        <ControlChip
          icon="fld-path"
          label="WORKSPACE"
          value={cwd.replace("/Users/liuyunkai/", "~/")}
          open={deck === "cwd"}
          onClick={() => setDeck(deck === "cwd" ? null : "cwd")}
        />
        <ControlChip
          icon="fld-model"
          label="MODEL"
          value={model}
          open={deck === "model"}
          onClick={() => setDeck(deck === "model" ? null : "model")}
        />
        <ControlChip
          icon="role-system"
          label="THINK"
          value={think.toUpperCase()}
          off={think === "off"}
          open={deck === "think"}
          onClick={() => setDeck(deck === "think" ? null : "think")}
        />
        <ControlChip icon="station-context" label="CTX" value="2.4%" />
      </Shelf>

      {deck === "cwd" ? (
        <Deck
          label="WORKSPACE"
          sub="APPLIES TO NEW SESSIONS"
          actions={
            <>
              <BarButton tone="quiet" label="UP" icon="act-expand" />
              <BarButton tone="ok" label="NEW SESSION" icon="act-new" />
            </>
          }
        >
          <div style={{ font: "400 12px/1.6 var(--mono)", color: "var(--g3)", padding: "0 0 4px 2px" }}>
            ~/Projects/design <span style={{ color: "var(--g2)" }}>· existing session keeps its cwd (read-only)</span>
          </div>
          {DIRS.map((d) => (
            <PickRow key={d.name} icon="fld-path" name={d.name} meta={d.meta} selected={d.name === cwd} onClick={() => { setCwd(d.name); setDeck(null); }} />
          ))}
        </Deck>
      ) : null}

      {deck === "model" ? (
        <Deck label="MODEL" sub="NEXT TURN" actions={<BarButton tone="ok" label="APPLY" hint="↵" icon="status-ok" />}>
          {MODELS.map((m) => (
            <PickRow
              key={m.m}
              icon="fld-model"
              name={m.m}
              meta={`${m.p} · ${m.ctx}`}
              selected={m.m === model}
              onClick={() => { setModel(m.m); setDeck(null); }}
            />
          ))}
        </Deck>
      ) : null}

      {deck === "think" ? (
        <Deck label="THINKING" sub="BUDGET PER TURN" actions={<BarButton tone="ok" label="APPLY" icon="status-ok" />}>
          <Segmented
            value={think}
            onChange={(v) => setThink(v)}
            options={[
              { value: "off", label: "OFF" },
              { value: "low", label: "LOW" },
              { value: "medium", label: "MED" },
              { value: "high", label: "HIGH" },
            ]}
          />
          <div style={{ font: "400 11px/1.5 var(--mono)", color: "var(--g2)", padding: "6px 2px 0" }}>
            off → THINKING rows disappear from the stream. switching mid-run queues the change for the next turn.
          </div>
        </Deck>
      ) : null}

      <div class="scroll" style={{ padding: "8px 16px 64px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "28px", maxWidth: "1060px" }}>
          <header style={{ paddingTop: "8px" }}>
            <h1 style={{ font: "700 28px/1.2 var(--din)", letterSpacing: "0.02em" }}>CRAFT LAYER</h1>
            <p style={{ font: "400 13px/1.7 var(--text)", color: "var(--g3)", marginTop: "6px", maxWidth: "760px" }}>
              曲线 / 微动效 / 图标三件事的落地形态。所有构件都从 <code style={{ font: "400 12px var(--mono)", color: "var(--ice)" }}>tokens.css</code> 取值，
              圆角只出现在外沿一侧，动效只用 linear 且不超过 240ms。
            </p>
          </header>

          <Section id="theme" title="THEME / 配色" note="同一套语义角色，换一组色相">
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  class="theme-card"
                  data-active={theme === t.id ? "1" : "0"}
                  onClick={() => {
                    applyTheme(t.id);
                    setTheme(t.id);
                  }}
                >
                  <span class="sw">
                    {t.swatch.map((c) => (
                      <i key={c} style={{ background: c }} />
                    ))}
                  </span>
                  <span class="nm">{t.name}</span>
                  <span class="nt">{t.note}</span>
                </button>
              ))}
            </div>
            <span style={{ font: "400 11px/1.6 var(--mono)", color: "var(--g2)", maxWidth: "720px" }}>
              九个语义角色（focus / secondary / running / error / memory / agent / readonly / plan / system）在每套主题里都保持色相分离；
              已写入 localStorage，刷新后保持。新增主题只需在 themes.css 加一段 + THEMES 里加一行。
            </span>
          </Section>

          <Section id="geom" title="GEOMETRY / 曲线" note="elbow · pill · 单向圆角">
            <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ color: "var(--orange)" }}>
                <Elbow vw={56} vh={104} hw={280} hh={40} r={24} />
              </div>
              <div style={{ color: "var(--lav)" }}>
                <Elbow vw={40} vh={76} hw={172} hh={28} r={16} />
              </div>
              <div style={{ color: "var(--cyan)" }}>
                <Elbow vw={88} vh={140} hw={120} hh={88} r={36} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", justifyContent: "center" }}>
                <div class="bar bar-end-r" style={{ width: "220px", height: "32px", background: "var(--amber)" }} />
                <div class="bar bar-end-l" style={{ width: "180px", height: "24px", background: "var(--ice)" }} />
                <div class="bar bar-corner-br" style={{ width: "140px", height: "56px", background: "var(--g1)" }} />
                <span style={{ font: "400 10px/1.4 var(--mono)", color: "var(--g2)" }}>pill-r / pill-l / corner-br</span>
              </div>
            </div>
          </Section>

          <Section id="spine" title="SPINE / 站点" note="图标 + 编号 + 标签，三件套一起出现">
            <div style={{ display: "flex", gap: "24px" }}>
              <div class="spine" style={{ width: "232px" }}>
                <Station num="01" label="SESSION" icon="station-session" tone="orange" w={224} h={56} active />
                <Station num="02" label="TOOLS" icon="station-tools" tone="amber" w={196} />
                <Station num="03" label="AGENTS" icon="station-agents" tone="lav" w={168} />
                <Station num="04" label="CONTEXT" icon="station-context" tone="moon" w={204} />
                <Station num="05" label="SKILLS" icon="station-skills" tone="ice" w={156} />
                <Station num="06" label="SYSTEM" icon="station-system" tone="cyan" w={184} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <Station num="07" label="PROVIDERS" icon="station-provider" w={188} />
                <Station num="08" label="MCP" icon="station-mcp" w={150} />
                <Station num="09" label="HISTORY" icon="station-history" w={176} />
                <span style={{ font: "400 11px/1.6 var(--mono)", color: "var(--g2)", maxWidth: "300px" }}>
                  原版 LCARS 只有文字。图标只做“扫视锚点”，永远和标签同时出现，不替代文字。
                </span>
              </div>
            </div>
          </Section>

          <Section id="tools" title="TOOL STRIPS / 读数条" note="4 种状态 · 长工具名占满整条臂，不截断">
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <ToolStrip name="bash" icon="tool-bash" args='rg -n "login" src/ --type ts' output={"src/auth/login.ts:14\nsrc/routes/index.ts:9"} state="ok" ms={412} />
              <ToolStrip name="read" icon="tool-read" args="src/auth/login.ts / lines 1-48" output={"1  import { Router } from 'express'\n2  const router = Router()\n3  router.post('/login', handler)"} state="ok" ms={12} count={2} expanded={toolOpen} onToggle={() => setToolOpen(!toolOpen)} />
              <ToolStrip name="bash" icon="tool-bash" args="npm test -- --run" state="run" />
              <ToolStrip name="SubagentWorkflow" icon="tool-workflow" args='{"steps":[{"agent":"explore","prompt":"find the login handler"},{"agent":"general-purpose","prompt":"write the limiter"}]}' output={"running 2 subagents in parallel"} state="run" />
              <ToolStrip name="get_subagent_result" icon="tool-agent" args="agent_id: auth-audit, wait: false" output={"still running · 14 tool calls"} state="ok" ms={38} />
              <ToolStrip name="edit" icon="tool-edit" args="src/middleware/limit.ts / +18 -2" errorText={"Error: string not found in file\n  at edit (tools/edit.ts:88)"} state="error" />
              <ToolStrip name="grep" icon="tool-grep" args="tests/**/*.ts" output={"148 matches"} state="warn" ms={140} truncated />
            </div>
          </Section>

          <Section id="msgs" title="MESSAGES / 消息" note="thinking 折叠 · 流式 caret">
            <div style={{ display: "flex", flexDirection: "column" }}>
              <MessageRow role="user" time="T+38:12" text="给 /login 加个限流，然后跑一遍测试，把改动列出来。" />
              <MessageRow
                role="assistant"
                time=""
                model="DEEPSEEK"
                thinking="先看现有中间件和测试结构，预计改动 2 个文件。"
                thinkingOpen={false}
                text="按 IP 建令牌桶：60 秒 10 次，超限返回 429。中间件按路由挂载，现有接口行为不变。"
              />
              <MessageRow role="assistant" time="" model="DEEPSEEK" text="修好了：把 key 从 req.ip 换成 forwarded-for 首段。" streaming rate={41} />
              <NoticeRow label="RETRY" tone="warn" text="1/2 · tool timed out after 120s — retrying with a longer budget" />
            </div>
          </Section>

          <Section id="workspace" title="WORKSPACE / 三区" note="I 指令 · II 推理 · III 执行 — 交换的 footer 把三者连起来">
            <div style={{ display: "flex", flexDirection: "column", height: "900px" }}>
              <Workspace items={WS_ITEMS} />
            </div>
          </Section>

          <Section
            id="logstrip"
            title="ACTIVITY / 会话读数条"
            note="同一份点阵，放在 log 上：4 点行 × 11px 间距 = 44px，点 6px；相位色即脊色"
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ width: "936px", maxWidth: "100%" }}>
                <LogState items={WS_ITEMS} />
              </div>
              <div style={{ width: "676px", maxWidth: "100%" }}>
                <LogState items={[]} />
              </div>
            </div>
          </Section>

          <Section id="markdown" title="MARKDOWN / 文档" note="16/1.6 正文 · 13.5/1.55 代码 · 表格对着作者的 :-- 对齐">
            <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
              <div style={{ width: "760px", maxWidth: "100%" }}>
                <Markdown text={MD_SAMPLE} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxWidth: "300px" }}>
                <span style={{ font: "400 11px/1.6 var(--mono)", color: "var(--g2)" }}>
                  聊天视图用 breaks:true（单换行即是换行）；查看器里的 .md 用 breaks:false
                  （软换行折成一段，否则每个源码行都变成 &lt;br&gt;，读起来就是“间距过大”）。
                </span>
                <span style={{ font: "400 11px/1.6 var(--mono)", color: "var(--g2)" }}>
                  表格包在 .md-tbl 里横向滚动：宽表不得把消息列撑宽。
                </span>
              </div>
            </div>
          </Section>

          <Section id="approval" title="APPROVAL / 阻断" note="tomato · 2 次脉冲后常亮">
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <ApprovalDeck tool="bash" args="rm -rf dist && npm run build" state={apState} onDecide={(d) => setApState(d === "deny" ? "denied" : "approved")} />
              <div style={{ display: "flex", gap: "4px" }}>
                <BarButton tone="quiet" label="REPLAY" icon="act-reload" onClick={() => setApState("pending")} />
                <span style={{ font: "400 11px/2 var(--mono)", color: "var(--g2)" }}>
                  A / D / L 快捷键；abort 时自动释放挂起调用
                </span>
              </div>
            </div>
          </Section>

          <Section id="form" title="FORM / 配置字段" note="不是输入框：底部读数条 + 左侧状态条">
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxWidth: "860px" }}>
              <FieldRow label="PROVIDER" icon="station-provider" value="ai-native-x" state="ok" message="OK · 142ms · 6 models" unit="7/12" />
              <FieldRow label="BASE URL" icon="fld-url" value="https://api.z.ai/v1" required />
              <FieldRow label="API KEY" icon="fld-key" required value="sk-9f2c4a71b0e34f7d" mask message="stored in ~/.pi/agent/auth.json" />
              <FieldRow label="MCP COMMAND" icon="fld-host" placeholder="npx -y @modelcontextprotocol/server-filesystem ." />
              <FieldRow label="TIMEOUT" icon="act-test" value="120" unit="SEC" state="error" message="must be between 5 and 600" />
              <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
                <BarButton tone="ok" label="TEST" hint="T" icon="act-test" />
                <BarButton tone="go" label="APPLY" hint="↵" icon="status-ok" />
                <BarButton tone="stop" label="DELETE" icon="act-delete" />
              </div>
            </div>
          </Section>

          <Section id="readout" title="READOUT / 计量" note="宽度变化 240ms linear">
            <div style={{ display: "flex", gap: "32px", alignItems: "flex-end" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "320px" }}>
                <Readout value="19.2K" unit="/ 400K" />
                <Meter segments={[{ tone: "sys", pct: 8 }, { tone: "tool", pct: 4 }, { tone: "hist", pct: 22 }, { pct: 62 }]} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 auto" }}>
                <ToolStrip name="context" icon="station-context" args="compaction at 80% · auto" state="warn" />
              </div>
            </div>
          </Section>

          <Section id="motion" title="MOTION LAB / 动效" note="只用 linear · 90 / 140 / 240ms">
            <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
              <BarButton tone="ok" label="WIPE" hint="140ms" onClick={() => replay("wipe")} />
              <BarButton tone="go" label="SWAP" hint="90ms" onClick={() => replay("swap")} />
              <BarButton tone="stop" label="PULSE" hint="2×300ms" onClick={() => replay("pulse")} />
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", height: "48px" }}>
              <div key={motionKey} class={motion === "wipe" ? "anim-wipe" : motion === "swap" ? "anim-swap" : "anim-pulse"} style={{ width: "260px", height: "40px", background: "var(--orange)", borderRadius: "0 var(--r-2) var(--r-2) 0" }} />
              <div key={`${motionKey}-b`} class={motion === "wipe" ? "anim-wipe-down" : ""} style={{ width: "120px", height: "40px", background: "var(--lav)", borderRadius: "0 var(--r-1) var(--r-1) 0", animationDelay: "60ms" }} />
              {/* the third move: BUSY scans in three stepped phases, 900ms loop */}
              <div style={{ position: "relative", width: "180px", height: "40px", background: "var(--g0)", borderRadius: "0 var(--r-1) var(--r-1) 0", overflow: "hidden" }}>
                <i class="sweep-strip" />
              </div>
              <span style={{ font: "400 11px/1.6 var(--mono)", color: "var(--g2)", maxWidth: "440px" }}>
                block-wipe（左脊向右展开）/ hard-swap（跳两帧再亮）/ pulse（审批 2 次）/ sweep（运行态三段扫描）
                打开系统「减弱动效」时全部降为瞬时。
              </span>
            </div>
          </Section>

          <Section id="icons" title={`ICON SET / ${Object.keys(ICONS).length}`} note="remixicon 内联 path，无字体、无网络">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "2px" }}>
              {(Object.keys(ICONS) as IconName[]).map((n) => (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 8px", background: "var(--g0)", borderRadius: "0 var(--r-1) var(--r-1) 0" }}>
                  <Icon name={n} size={15} />
                  <span style={{ font: "400 10px/1.3 var(--mono)", color: "var(--g3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
