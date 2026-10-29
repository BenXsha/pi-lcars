import { useState } from "preact/hooks";
import { ICONS, type IconName } from "../icons";
import { Icon } from "../components/Icon";
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
  { name: "/Users/liuyunkai/Projects/design", meta: "AGENTS.md · demo/ · src/" },
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

          <Section id="tools" title="TOOL STRIPS / 读数条" note="4 种状态，高度随内容">
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <ToolStrip name="bash" icon="tool-bash" args='rg -n "login" src/ --type ts' output={"src/auth/login.ts:14\nsrc/routes/index.ts:9"} state="ok" ms={412} />
              <ToolStrip name="read" icon="tool-read" args="src/auth/login.ts / lines 1-48" output={"1  import { Router } from 'express'\n2  const router = Router()\n3  router.post('/login', handler)"} state="ok" ms={12} count={2} expanded={toolOpen} onToggle={() => setToolOpen(!toolOpen)} />
              <ToolStrip name="bash" icon="tool-bash" args="npm test -- --run" state="run" />
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
                <div class="tool" data-state="ok">
                  <div class="st" />
                  <div class="ic"><Icon name="station-context" size={15} /></div>
                  <div class="nm">CTX</div>
                  <div class="bd"><div class="args">compaction at 80% · auto</div></div>
                  <div class="mt">38%</div>
                </div>
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
              <span style={{ font: "400 11px/1.6 var(--mono)", color: "var(--g2)", maxWidth: "440px" }}>
                block-wipe（左脊向右展开）/ hard-swap（跳两帧再亮）/ pulse（审批 2 次）
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
