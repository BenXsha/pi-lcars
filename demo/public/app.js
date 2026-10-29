/* LCARS Agent Console — browser client
   Renders the normalized event stream from /api/stream. */

const S = {
  items: [],
  byId: new Map(),
  meta: { running: false },
  view: "session",
  nodes: new Map(),
  pinned: true,
  t0: Date.now(),
  streamStart: 0,
  streamChars: 0,
};

const $ = (id) => document.getElementById(id);
const scrollEl = $("scroll");
const logEl = $("log");
const railEl = $("rail");
const inputEl = $("input");

/* ---------------------------------------------------------------- utils */
const fmtMs = (ms) => (ms == null ? "" : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`);
const fmtTok = (n) =>
  n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const shortModel = (id = "") => {
  const key = String(id).split(/[-/]/)[0].toUpperCase();
  return key.slice(0, 8) || "PI";
};

/* ------------------------------------------------------------- renderers */
function toolState(it) {
  if (it.status === "run") return "run";
  if (it.status === "error") return "error";
  if (it.truncated) return "warn";
  return "ok";
}

function renderTool(it) {
  const node = el("div", "tool");
  node.dataset.id = it.id;
  node.dataset.state = toolState(it);
  node.dataset.expanded = "0";

  node.append(el("div", "st"));
  const nm = el("div", "nm");
  nm.append(el("span", null, it.name.toUpperCase()));
  if (it.count > 1) nm.append(el("small", null, `x${it.count}`));
  node.append(nm);

  const bd = el("div", "bd");
  bd.append(el("div", "args", it.args || ""));

  // raw output: errors keep 3 visible lines, successful output keeps 2
  const raw = (node.dataset.state === "error" ? it.errorText || it.output || "" : it.output || "").trim();
  if (raw) {
    const lines = raw.split("\n");
    const visible = node.dataset.state === "error" ? 3 : 2;
    const pre = el("pre", node.dataset.state === "error" ? "err" : "out", lines.slice(0, visible).join("\n"));
    bd.append(pre);
    if (lines.length > visible) {
      const more = el("button", "more", `+ ${lines.length - visible} LINES`);
      more.type = "button";
      more.onclick = () => {
        const open = node.dataset.expanded === "1";
        node.dataset.expanded = open ? "0" : "1";
        pre.textContent = (open ? lines.slice(0, visible) : lines).join("\n");
        more.textContent = open ? `+ ${lines.length - visible} LINES` : "− COLLAPSE";
      };
      bd.append(more);
    }
  }
  if (it.truncated) {
    bd.append(el("div", "warn", it.truncatedNote || "warning: truncated output (full output on disk)"));
  }
  node.append(bd);

  const mt = el("div", "mt");
  if (node.dataset.state === "run") {
    const scan = el("span", "scan");
    scan.append(el("i"), el("i"), el("i"));
    mt.append(scan);
  } else if (node.dataset.state === "error") {
    mt.textContent = "EXIT 1";
  } else {
    mt.textContent = fmtMs(it.ms);
  }
  node.append(mt);
  return node;
}

function renderAssistant(it) {
  const row = el("div", "row assistant turn");
  row.dataset.id = it.id;

  const chip = el("div", "chip");
  chip.append(el("span", "who", "PI"), el("span", null, shortModel(S.meta.modelId)));
  row.append(chip);

  const body = el("div", "body-cell");

  if (it.thinking) {
    const th = el("div", "think");
    th.dataset.open = "0";
    th.append(el("span", "t-label", "THINKING"));
    th.append(el("div", "t-body", it.thinking));
    th.onclick = () => (th.dataset.open = th.dataset.open === "1" ? "0" : "1");
    body.append(th);
  }

  if (it.text && it.text.trim()) body.append(el("div", "txt", it.text));

  if (it.streaming) {
    const s = el("div", "stream");
    s.append(el("span", "caret"));
      const rate = S.streamChars > 0 && S.streamStart
    ? Math.round(S.streamChars / 3 / ((Date.now() - S.streamStart) / 1000))
    : 0;
    s.append(el("span", null, `STREAMING${rate ? ` / ${rate} TOK/S` : ""}`));
    body.append(s);
  }
  row.append(body);
  return row;
}

function renderUser(it) {
  const row = el("div", "row user turn");
  row.dataset.id = it.id;
  const chip = el("div", "chip");
  chip.append(el("span", null, `T+${mmss((it.ts - S.t0) / 1000)}`), el("span", null, "OPERATOR"));
  row.append(chip);
  const body = el("div", "body-cell");
  if (it.steer) body.append(el("div", "steer-tag", "QUEUED AS STEER"));
  body.append(el("div", "txt", it.text));
  row.append(body);
  return row;
}

/* ------------------------------------------------------ approval (red zone)
   A held tool call is the one thing on this screen that stops the machine.
   Structure: 4px tomato spine · tomato head strip · black body · three-bar deck. */
const AP_TEXT = {
  approved: ["RELEASED", "operator approved — the call runs now"],
  always: ["ALWAYS", "approved, and this tool is no longer gated this session"],
  denied: ["DENIED", "passed back to the model as a blocked tool call"],
  timeout: ["TIMEOUT", "nobody answered — treated as denied"],
  sent: ["SENDING", "decision in flight"],
};

function answer(id, decision) {
  const node = logEl.querySelector(`.approval[data-id="${id}"]`);
  if (node) {
    node.dataset.state = "sent";
    node.querySelectorAll("button").forEach((b) => (b.disabled = true));
  }
  fetch("/api/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, decision }),
  }).catch(() => {});
}

function renderApproval(it) {
  const pending = it.status === "pending";
  const row = el("div", "approval");
  row.dataset.id = it.id;
  row.dataset.state = it.status || "pending";

  row.append(el("div", "ap-st"));

  const body = el("div", "ap-body");
  const head = el("div", "ap-head");
  head.append(el("span", "ap-tag", pending ? "APPROVAL REQUIRED" : "APPROVAL"));
  head.append(el("span", "ap-tool", String(it.tool || "tool").toUpperCase()));
  head.append(el("span", "ap-wait", pending ? "BLOCKING" : fmtMs(it.decidedMs)));
  body.append(head);
  body.append(el("div", "ap-args", it.args || ""));
  if (!pending) {
    const [tag, why] = AP_TEXT[it.status] || [String(it.status).toUpperCase(), ""];
    const res = el("div", "ap-res");
    res.append(el("b", null, tag), el("span", null, why));
    body.append(res);
  }
  row.append(body);

  if (pending) {
    const deck = el("div", "ap-deck");
    for (const [label, decision, hint, cls] of [
      ["APPROVE", "approve", "A", "ok"],
      ["DENY", "deny", "D", "no"],
      ["ALWAYS", "always", "L", "all"],
    ]) {
      const b = el("button", `ap-btn ${cls}`);
      b.type = "button";
      b.append(el("span", null, label), el("em", null, hint));
      b.onclick = () => answer(it.id, decision);
      deck.append(b);
    }
    row.append(deck);
  } else {
    row.append(el("div", "ap-deck is-spent"));
  }
  return row;
}

function renderNotice(it) {
  const row = el("div", "row notice");
  row.dataset.id = it.id;
  row.dataset.tone = it.tone || "info";
  const chip = el("div", "chip");
  chip.append(el("span", null, it.label || "NOTE"));
  row.append(chip);
  const body = el("div", "body-cell");
  if (it.text && it.text.trim()) body.append(el("div", "txt", it.text));
  row.append(body);
  return row;
}

function renderItem(it) {
  if (it.kind === "assistant") {
    const hasBody = (it.text && it.text.trim()) || (it.thinking && it.thinking.trim()) || it.streaming;
    if (!hasBody) return null;
  }
  if (it.kind === "user") return renderUser(it);
  if (it.kind === "assistant") return renderAssistant(it);
  if (it.kind === "approval") return renderApproval(it);
  if (it.kind === "tool") return renderTool(it);
  return renderNotice(it);
}

/* ------------------------------------------------------------- transcript */
function appendOrReplace(it) {
  if (S.view !== "session") return;
  const prev = S.nodes.get(it.id);
  const node = renderItem(it);
  if (!node) {
    if (prev) { prev.remove(); S.nodes.delete(it.id); }
    return;
  }
  if (prev) prev.replaceWith(node);
  else logEl.append(node);
  S.nodes.set(it.id, node);
}

function rerenderLog() {
  logEl.textContent = "";
  S.nodes.clear();
  if (S.view !== "session") return renderView();
  if (!S.items.length) {
    logEl.append(emptyTranscript());
    return;
  }
  for (const it of S.items) {
    const node = renderItem(it);
    if (!node) continue;
    logEl.append(node);
    S.nodes.set(it.id, node);
  }
  scrollToEnd();
}

function emptyTranscript() {
  const wrap = el("div", "panelview");
  wrap.append(el("div", "pv-title", "STANDING BY"));
  const p = el("div", "pv-sub");
  p.innerHTML =
    "This console is wired to a live <code>pi</code> session through the SDK. Type below and press <code>ENTER</code>." +
    "<br><br>Every row on screen comes from a real event: <code>message_update</code> deltas, " +
    "<code>tool_execution_start/end</code>, <code>auto_retry_*</code>, <code>queue_update</code>. " +
    "Nothing is scripted — run lengths, failures and truncation come from the session itself.";
  wrap.append(p);
  return wrap;
}

function scrollToEnd() {
  if (!S.pinned) return;
  requestAnimationFrame(() => (scrollEl.scrollTop = scrollEl.scrollHeight));
}

scrollEl.addEventListener("scroll", () => {
  S.pinned = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 48;
});

/* --------------------------------------------------------------- panels */
function statRows(pairs) {
  const box = el("div", "rows");
  for (const [k, v, cls] of pairs) {
    const r = el("div", "mrow");
    r.append(el("span", null, k));
    const val = el("span", cls || "", v);
    r.append(val);
    box.append(r);
  }
  return box;
}

function pvRows(pairs) {
  const box = el("div", "panelview");
  for (const [k, v, n] of pairs) {
    const row = el("div", "pv-row");
    row.append(el("div", "st"));
    row.append(el("div", "k", k));
    row.append(el("div", "v", v));
    row.append(el("div", "n", n ?? ""));
    box.append(row);
  }
  return box;
}

function renderView() {
  if (S.view === "session") return;
  logEl.textContent = "";
  const wrap = el("div", "panelview");
  const tools = toolStats(S.items);

  if (S.view === "tools") {
    const names = (S.meta.tools || []).slice().sort((a, b) => (tools[b]?.calls || 0) - (tools[a]?.calls || 0));
    wrap.append(el("div", "pv-title", `TOOL LOADOUT / ${names.length}`));
    wrap.append(
      el("div", "pv-sub", "Every tool the model can actually call in this session, straight from getActiveToolNames()."),
    );
    for (const name of names) {
      const s = tools[name] || { calls: 0, fails: 0, trunc: 0, ms: 0 };
      const row = el("div", "pv-row");
      row.append(el("div", "st"));
      row.append(el("div", "k", name));
      row.append(
        el("div", "v", `${s.calls} calls · ${s.fails} failed · ${s.trunc} truncated`)
      );
      row.append(el("div", "n", s.calls ? fmtMs(s.ms) : "—"));
      wrap.append(row);
    }
  }

  if (S.view === "agents") {
    const AG = ["Agent", "SubagentWorkflow", "steer_subagent", "get_subagent_result"];
    const known = AG.filter((n) => (S.meta.tools || []).includes(n));
    wrap.append(el("div", "pv-title", `AGENTS / ${known.length} TOOLS`));
    wrap.append(
      el(
        "div",
        "pv-sub",
        known.length
          ? "Subagent tools are loaded from the installed pi packages. Rows below fill in as soon as the model spawns one."
          : "No subagent tool in this session.",
      ),
    );
    for (const name of known) {
      const s = tools[name] || { calls: 0, fails: 0, trunc: 0, ms: 0 };
      const row = el("div", "pv-row");
      row.append(el("div", "st"));
      row.append(el("div", "k", name.toUpperCase()));
      row.append(el("div", "v", s.calls ? `${s.calls} runs · ${s.fails} failed` : "idle · never called this session"));
      row.append(el("div", "n", s.calls ? fmtMs(s.ms) : "—"));
      wrap.append(row);
    }
    if (known.length) {
      const e2 = el("div", "empty");
      e2.textContent =
        "Subagent transcripts are not merged into this view yet — a spawned Agent reports back through its own tool result, which shows up in the main log as one row.";
      wrap.append(e2);
    }
  }

  if (S.view === "context") {
    const u = S.meta.usage || {};
    const win = S.meta.contextWindow || 200000;
    const pct = S.meta.contextPct || 0;
    wrap.append(el("div", "pv-title", `${pct}% OF CONTEXT`));
    wrap.append(
      el(
        "div",
        "pv-sub",
        `${fmtTok(u.total)} tokens in the last request · window ${fmtTok(win)} · window resets per request`,
      ),
    );
    const bar = el("div", "ctx-bar");
    const segs = [
      ["sys", pct * 0.18],
      ["tool", pct * 0.12],
      ["hist", pct * 0.7],
      ["", 100 - pct],
    ];
    for (const [cls, w] of segs) {
      const i = el("i", cls);
      i.style.width = `${Math.max(0.4, w)}%`;
      bar.append(i);
    }
    wrap.append(bar);
    wrap.append(
      pvRows([
        ["SYSTEM PROMPT", "fixed · injected by resource loader", ""],
        ["TOOL RESULTS", `${Object.values(tools).reduce((a, b) => a + b.calls, 0)} calls`, ""],
        ["INPUT TOKENS", fmtTok(u.input), u.input ? "" : ""],
        ["OUTPUT TOKENS", fmtTok(u.output), ""],
        ["COST", `$${(u.cost || 0).toFixed(4)}`, ""],
        ["COMPACTION", "auto at threshold", ""],
      ]),
    );
  }

  if (S.view === "skills") {
    const sk = S.meta.skills || [];
    const pr = S.meta.prompts || [];
    const ex = S.meta.extensions || [];
    wrap.append(el("div", "pv-title", `SKILLS / ${sk.length}`));
    wrap.append(
      el(
        "div",
        "pv-sub",
        "Read from the session's own resource loader — these are the files that were actually injected into the system prompt, not a guess about them.",
      ),
    );
    if (!sk.length) {
      wrap.append(el("div", "empty", "No skill matched the resource loader's search paths for this project."));
    }
    for (const s of sk) {
      const row = el("div", "pv-row");
      row.append(el("div", "st"));
      row.append(el("div", "k", String(s.name || "").toUpperCase()));
      row.append(el("div", "v", s.description || "—"));
      row.append(el("div", "n", s.manual ? "MANUAL" : "AUTO"));
      wrap.append(row);
    }
    wrap.append(el("div", "phead ice", `PROMPT TEMPLATES / ${pr.length}`));
    wrap.append(
      pr.length
        ? pvRows(pr.map((n) => [String(n).toUpperCase(), "injected as a slash command", ""]))
        : el("div", "empty", "No prompt template loaded."),
    );
    wrap.append(el("div", "phead cyan", `EXTENSIONS / ${ex.length}`));
    wrap.append(
      ex.length
        ? pvRows(ex.map((n) => [String(n).toUpperCase(), "loaded into this session", ""]))
        : el("div", "empty", "No extension loaded."),
    );
  }

  if (S.view === "system") {
    wrap.append(el("div", "pv-title", "SYSTEM"));
    wrap.append(
      pvRows([
        ["MODEL", S.meta.model || "—", ""],
        ["THINKING", String(S.meta.thinking ?? "—"), ""],
        ["TOOLS", `${(S.meta.tools || []).length} active`, ""],
        ["CWD", S.meta.cwd || "—", ""],
        ["TRANSPORT", "SSE · in-process SDK", ""],
        ["MODE", S.meta.mock ? "MOCK REPLAY" : "LIVE SESSION", ""],
      ]),
    );

    wrap.append(el("div", "pv-title", "APPROVAL GATE"));
    wrap.append(
      el(
        "div",
        "pv-sub",
        "Calls that can mutate the repo or the machine are held on a tool_call hook until an operator answers. Turning the gate off releases whatever it is holding; ALWAYS stops asking for that one tool until the session resets.",
      ),
    );
    const deck = el("div", "pol-deck");
    for (const [mode, label, note] of [
      ["off", "OFF", "never hold"],
      ["risky", "RISKY", "bash / write / edit"],
      ["all", "ALL", "every tool call"],
    ]) {
      const b = el("button", "pol-btn");
      b.type = "button";
      b.dataset.on = S.meta.policy === mode ? "1" : "0";
      b.append(el("span", null, label), el("em", null, note));
      b.onclick = () => setPolicy(mode);
      deck.append(b);
    }
    wrap.append(deck);
    wrap.append(
      pvRows([
        ["PENDING", `${S.meta.pending || 0} held`, ""],
        ["ALWAYS", (S.meta.always || []).join(" ").toUpperCase() || "—", ""],
        ["TIMEOUT", `${Math.round((S.meta.approvalTimeout || 120000) / 1000)}s then deny`, ""],
        ["HOOK", S.meta.approvalWired ? "tool_call · inline extension" : "not wired", ""],
      ]),
    );
  }

  logEl.append(wrap);
}

/* ------------------------------------------------------------- right rail */
function toolStats(items) {
  const out = {};
  for (const it of items) {
    if (it.kind !== "tool") continue;
    const key = it.name;
    out[key] ||= { calls: 0, fails: 0, trunc: 0, ms: 0 };
    out[key].calls++;
    if (it.status === "error") out[key].fails++;
    if (it.truncated) out[key].trunc++;
    out[key].ms += it.ms || 0;
  }
  return out;
}

function renderRail() {
  const u = S.meta.usage || {};
  const win = S.meta.contextWindow || 200000;
  const pct = S.meta.contextPct || 0;
  const tools = toolStats(S.items);
  const calls = Object.values(tools).reduce((a, b) => a + b.calls, 0);
  const fails = S.items.filter((i) => i.kind === "tool" && i.status === "error");
  railEl.textContent = "";

  railEl.append(el("div", "phead", "RESOURCES"));

  const held = S.items.filter((i) => i.kind === "approval" && i.status === "pending");
  if (held.length) {
    railEl.append(el("div", "phead tomato", `HELD / ${held.length}`));
    const heldBox = el("div", "panel");
    for (const h of held) {
      const row = el("div", "hold");
      row.append(el("i"));
      row.append(el("b", null, String(h.tool || "").toUpperCase()));
      row.append(el("code", null, h.args || "(no args)"));
      heldBox.append(row);
    }
    railEl.append(heldBox);
  }

  const ctx = el("div", "panel");
  const top = el("div", "ctx-top");
  top.append(el("span", null, "CONTEXT WINDOW"));
  top.append(el("b", null, `${pct}%`));
  ctx.append(top);
  const nums = el("div", "ctx-num");
  nums.append(el("b", null, fmtTok(u.total)), el("span", null, `/ ${fmtTok(win)}`));
  ctx.append(nums);
  const bar = el("div", "ctx-bar");
  for (const [cls, w] of [
    ["sys", Math.max(0.6, pct * 0.18)],
    ["tool", Math.max(0.6, pct * 0.12)],
    ["hist", Math.max(0.6, pct * 0.7)],
    ["", Math.max(0.6, 100 - pct)],
  ]) {
    const i = el("i", cls);
    i.style.width = `${w}%`;
    bar.append(i);
  }
  ctx.append(bar);
  const legend = el("div", "legend");
  for (const [cls, label] of [
    ["var(--cyan)", "SYSTEM"],
    ["var(--ice)", "TOOLS"],
    ["var(--orange)", "HISTORY"],
    ["var(--g1)", "FREE"],
  ]) {
    const s = el("span");
    const i = el("i");
    i.style.background = cls;
    s.append(i, document.createTextNode(label));
    legend.append(s);
  }
  ctx.append(legend);
  railEl.append(ctx);

  railEl.append(el("div", "phead ice", "TOOL CALLS / THIS SESSION"));
  const rows = el("div", "rows");
  const entries = Object.entries(tools).sort((a, b) => b[1].calls - a[1].calls);
  if (!entries.length) rows.append(el("div", "empty", "No calls yet."));
  for (const [name, s] of entries) {
    const r = el("div", "mrow");
    r.append(el("span", null, name.toUpperCase()));
    r.append(
      el(
        "span",
        s.fails ? "bad" : s.trunc ? "warnval" : "ok",
        `${s.calls}${s.fails ? ` / ${s.fails} FAIL` : ""}${s.trunc ? ` / ${s.trunc} TRUNC` : ""}`,
      ),
    );
    rows.append(r);
  }
  railEl.append(rows);

  if (fails.length) {
    railEl.append(el("div", "phead tomato", "FAILURES"));
    const box = el("div", "panel");
    for (const f of fails.slice(-4).reverse()) {
      const row = el("div", "fail");
      row.append(el("i"));
      row.append(el("code", null, `${f.name}: ${(f.errorText || f.output || "failed").split("\n")[0]}`));
      row.append(el("small", null, `T+${mmss((f.ts - S.t0) / 1000)}`));
      box.append(row);
    }
    railEl.append(box);
  }

  railEl.append(el("div", "phead cyan", "SYSTEM"));
  railEl.append(
    statRows([
      ["MODEL", S.meta.modelId || "—"],
      ["THINKING", String(S.meta.thinking ?? "—")],
      ["TOOLS", String((S.meta.tools || []).length)],
      ["MODE", S.meta.mock ? "MOCK" : "LIVE"],
      ["TRANSPORT", "SSE"],
    ]),
  );
}

/* ------------------------------------------------------------------ chrome */
function renderChrome() {
  const calls = S.items.filter((i) => i.kind === "tool").length;
  const pct = S.meta.contextPct || 0;
  const held = S.items.filter((i) => i.kind === "approval" && i.status === "pending");
  $("shelfModel").textContent = (S.meta.model || "—").toUpperCase();
  $("badgeMode").textContent = held.length
    ? `HELD ${held.length}`
    : S.meta.running
      ? "RUNNING"
      : S.meta.mock
        ? "MOCK"
        : "IDLE";
  $("badgeMode").className = `badge ${held.length ? "tomato" : S.meta.running ? "moon" : S.meta.mock ? "tomato" : "dim"}`;
  $("badgeCalls").textContent = `${calls} CALLS`;
  $("badgeCtx").textContent = `CTX ${pct}%`;
  $("verMode").textContent = S.meta.mock ? "PI 1.4.0 / MOCK" : "PI 1.4.0 / LIVE";

  $("btnRun").disabled = !!S.meta.running || held.length > 0;
  $("btnStop").disabled = !S.meta.running && held.length === 0;
  const help = $("cmdHelp");
  help.classList.remove("live", "held");
  if (held.length) {
    help.textContent = `TOOL HELD FOR APPROVAL — A APPROVE / D DENY / L ALWAYS`;
    help.classList.add("held");
    inputEl.placeholder = "审批未决：先 A 放行 / D 拒绝 / L 以后都放行…";
  } else if (S.meta.running) {
    help.textContent = "GENERATING / ESC TO INTERRUPT / ENTER QUEUES A STEER";
    help.classList.add("live");
    inputEl.placeholder = "插入一条消息，不打断当前生成…";
  } else {
    help.textContent = "ENTER SEND / SHIFT+ENTER NEWLINE";
    inputEl.placeholder = "让 pi 构建、重构或调查…";
  }

  const station = document.querySelector(`.station[data-view="${S.view}"]`);
  if (station) {
    document.querySelectorAll(".station").forEach((s) => s.classList.remove("is-active"));
    station.classList.add("is-active");
    $("stationTag").textContent = `MISSION LOG / ${station.querySelector(".num").textContent}`;
  }

  const titles = {
    session: ["SESSION 01 / LCARS CONSOLE", `${calls} TOOL CALLS / ${pct}% CONTEXT / SSE`],
    tools: ["STATION 02 / TOOLS", "tool loadout and per-tool execution stats"],
    agents: ["STATION 03 / AGENTS", "not available in this SDK session"],
    context: ["STATION 04 / CONTEXT", "context window composition"],
    skills: ["STATION 05 / SKILLS", "not loaded in this SDK session"],
    system: ["STATION 06 / SYSTEM", "runtime and transport"],
  }[S.view];
  $("viewTitle").textContent = titles[0];
  $("viewMeta").textContent = titles[1];
}

/* -------------------------------------------------------------------- sse */
function onSnap(data) {
  S.items = data.items || [];
  S.byId = new Map(S.items.map((i) => [i.id, i]));
  S.meta = { ...(data.meta || {}), mock: !!data.mock };
  S.t0 = data.meta?.t0 || Date.now() - (data.meta?.uptime || 0) * 1000;
  rerenderLog();
  renderRail();
  renderChrome();
}

const es = new EventSource("/api/stream");es.onmessage = (ev) => {
  const data = JSON.parse(ev.data);
  if (data.e === "snap") return onSnap(data);

  if (data.e === "item") {
    const it = data.item;
    S.byId.set(it.id, it);
    const i = S.items.findIndex((x) => x.id === it.id);
    if (i === -1) S.items.push(it);
    else S.items[i] = it;
    if (it.kind === "assistant") {
      S.streamStart = Date.now();
      S.streamChars = 0;
    }
    appendOrReplace(it);
    renderRail();
    renderChrome();
    scrollToEnd();
    return;
  }

  if (data.e === "patch") {
    const it = S.byId.get(data.id);
    if (!it) return;
    Object.assign(it, data.patch);
    if (it.kind === "tool" && data.patch.name) it.name = data.patch.name;
    appendOrReplace(it);
    renderRail();
    renderChrome();
    scrollToEnd();
    return;
  }

  if (data.e === "delta") {
    const it = S.byId.get(data.id);
    if (!it) return;
    it[data.field] = (it[data.field] || "") + data.d;
    if (data.field === "text") S.streamChars += data.d.length;
    const node = S.nodes.get(data.id);
    if (node) {
      const txt = node.querySelector(".txt");
      if (txt) {
        txt.textContent = it.text || "";
        scrollToEnd();
      }
      const th = node.querySelector(".t-body");
      if (th && data.field === "thinking") th.textContent = it.thinking;
    }
    return;
  }

  if (data.e === "meta") {
    S.meta = { ...S.meta, ...data.meta };
    renderRail();
    renderChrome();
  }
};

es.onerror = () => {
  $("badgeMode").textContent = "LINK DOWN";
  $("badgeMode").className = "badge tomato";
};

/* ---------------------------------------------------------------- actions */
/* ---------------------------------------------------------------- actions */
function setPolicy(mode) {
  S.meta.policy = mode;
  fetch("/api/policy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  }).catch(() => {});
  rerenderLog();
  renderChrome();
  renderRail();
}

$("cmd").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  autoGrow();
  S.pinned = true;
  fetch("/api/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => {});
});

$("btnStop").addEventListener("click", () => fetch("/api/abort", { method: "POST" }));
$("btnNew").addEventListener("click", () => {
  S.pinned = true;
  fetch("/api/reset", { method: "POST" });
});

document.addEventListener("keydown", (e) => {
  const held = S.items.find((i) => i.kind === "approval" && i.status === "pending");
  if (held && document.activeElement !== inputEl && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const map = { a: "approve", d: "deny", l: "always" };
    const decision = map[e.key.toLowerCase()];
    if (decision) {
      e.preventDefault();
      answer(held.id, decision);
      return;
    }
  }
  if (e.key === "Escape" && (S.meta.running || held)) {
    e.preventDefault();
    fetch("/api/abort", { method: "POST" });
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    inputEl.focus();
  }
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("cmd").requestSubmit();
  }
});

function autoGrow() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(48, inputEl.scrollHeight)}px`;
  inputEl.style.overflowY = inputEl.scrollHeight > 48 ? "auto" : "hidden";
}
inputEl.addEventListener("input", autoGrow);

document.querySelectorAll(".station").forEach((btn) => {
  btn.addEventListener("click", () => {
    S.view = btn.dataset.view;
    rerenderLog();
    renderChrome();
    scrollEl.scrollTop = 0;
  });
});

setInterval(() => {
  const sec = (Date.now() - S.t0) / 1000;
  $("shelfClock").textContent = `T+${mmss(sec)}`;
}, 1000);
