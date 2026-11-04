#!/usr/bin/env node
/**
 * UI event-binding smoke — drives a real browser over CDP, no playwright.
 *
 *   node test/ui.mjs
 *
 * Boots the launcher, opens the console in headless chromium, then clicks the
 * shell's controls (stations, sessions, panes, shelf decks, theme buttons,
 * composer) and fails on any JS exception. Skipped (exit 0) when no chromium
 * is installed, so `npm test` still works on a bare box.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "pi-lcars.mjs");
const PORT = Number(process.env.TEST_UI_PORT || 4296);
const CDP_PORT = PORT + 1000;

const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  const passed = !!ok;
  if (!passed) failures++;
  results.push(`${passed ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* ------------------------------------------------------------ chromium */
async function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const cache = join(homedir(), ".cache", "ms-playwright");
  try {
    for (const dir of (await readdir(cache)).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
      for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const p = join(cache, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  } catch {
    /* no playwright cache */
  }
  for (const p of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

/* ----------------------------------------------------------------- CDP */
function connect(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
    } else {
      events.push(msg);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("cdp socket failed")), { once: true });
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send, ready, events };
}

const chrome = await findChrome();
if (!chrome) {
  console.log("skip  no chromium found (set CHROME=/path/to/chrome to run the UI checks)");
  process.exit(0);
}

const tmp = await mkdtemp(join(tmpdir(), "lcars-ui-"));
const workspace = join(tmp, "workspace");
const state = join(tmp, "state");
const sessions = join(tmp, "sessions");
const profile = join(tmp, "profile");

let server;
let browser;
let cdp;
let page;

try {
  /* --------------------------------------------------------- 1. server */
  await (await import("node:fs/promises")).mkdir(workspace, { recursive: true });
  // a couple of files so the composer's `@` palette has something to find
  await (await import("node:fs/promises")).mkdir(join(workspace, "server", "pi"), { recursive: true });
  await writeFile(join(workspace, "server", "pi", "registry.mjs"), "// fixture\n");
  // a document, not a chat message: the paragraph is soft-wrapped on purpose so
  // the viewer's PREVIEW can be checked for stray <br>s (AGENTS §3.5b)
  await writeFile(
    join(workspace, "notes.md"),
    [
      "# fixture",
      "",
      "这一段在源码里换行，但渲染后必须是同一段，不能被拆成两行。",
      "检查点就是这里：软换行折成一段，不是每行一个 <br>。",
      "",
      "| 字段 | 值 |",
      "|:-----|----:|",
      "| rows | 12 |",
      "| size | 3.4K |",
      "",
    ].join("\n"),
  );
  const env = { ...process.env, CI: "1", LCARS_STATE_DIR: state, LCARS_SESSIONS: sessions, LCARS_TRUST_PROJECT: "0" };
  server = spawn(process.execPath, [BIN, "--json", "--no-open", "--port", String(PORT)], {
    cwd: workspace,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const handshake = await new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const timer = setTimeout(() => reject(new Error(`no handshake\n${err}`)), 60_000);
    server.stdout.on("data", (chunk) => {
      out += chunk;
      const nl = out.indexOf("\n");
      if (nl === -1) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out.slice(0, nl)));
      } catch (e) {
        reject(new Error(`bad handshake: ${out.slice(0, nl)} (${e.message})`));
      }
    });
    server.stderr.on("data", (chunk) => {
      err += chunk;
    });
    server.on("exit", (code) => reject(new Error(`server exited ${code}\n${err}`)));
  });
  check("launcher handshake", !!handshake?.url, handshake?.url);
  const base = process.env.UI_BASE || handshake.url;

  /* -------------------------------------------------------- 2. browser */
  browser = spawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--window-size=1600,1000",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      .then((r) => r.json())
      .catch(() => null);
    target = list?.find((t) => t.type === "page");
  }
  if (!target) throw new Error("chromium did not expose a page target");

  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  // UI_BASE lets the harness run against `vite` (unminified stacks) instead of dist
  await cdp.send("Page.navigate", { url: process.env.UI_BASE || handshake.url });
  await sleep(1500);

  /** JSON GET against the console's own API */
  const get = async (url) => {
    const r = await fetch(url);
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const evaluate = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(`${r.exceptionDetails.text}: ${r.exceptionDetails.exception?.description ?? ""}`);
    }
    return r.result.value;
  };

  /** click by CSS selector; returns false when the element is missing */
  const click = async (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  const exists = (selector) => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
  const h1 = () => evaluate(`(document.querySelector('.center-head h1')?.textContent ?? '').trim()`);
  const hash = () => evaluate(`location.hash`);
  const attr = (selector, name) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`);
  /** the transcript lives inside #scroll too; a busy session renders rows, a fresh one the standby block */
  const inTranscript = () => exists('#scroll .standby, #scroll [data-turn="1"], #scroll .row');

  /* ----------------------------------------------------- 3. bootstrap */
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(250);
    ready = await exists(".lsessions .sess").catch(() => false);
  }
  check("console boots with a session", ready);
  check("transcript is the landing view", await inTranscript());

  /* ------------------------------------- 3b. the log's activity strip */
  // the same dot matrix the STREAM zone carries, read once for the whole
  // session: header, then strip, then the scrolled log
  const logStrip = await evaluate(
    `(() => {
      const ls = document.querySelector('.logstate');
      if (!ls) return null;
      const band = ls.querySelector('.ws-band');
      const svg = band?.querySelector('svg');
      const path = svg?.querySelector('path');
      const b = ls.getBoundingClientRect();
      const bb = band?.getBoundingClientRect();
      const head = document.querySelector('.center-head').getBoundingClientRect();
      const scroll = document.querySelector('#scroll').getBoundingClientRect();
      return {
        h: Math.round(b.height),
        rows: Number(band?.dataset.rows),
        pitch: Number(band?.dataset.pitchX),
        pitchY: Number(band?.dataset.pitchY),
        stroke: path ? parseFloat(getComputedStyle(path).strokeWidth) : 0,
        cols: bb ? Math.floor(bb.width / Number(band.dataset.pitchX)) : 0,
        dots: [...(svg?.querySelectorAll('path') ?? [])].reduce((n, p) => n + (p.getAttribute('d').match(/M/g) ?? []).length, 0),
        spine: Math.round(ls.querySelector('.ls-spine').getBoundingClientRect().width),
        label: ls.querySelector('.ls-lb')?.textContent ?? '',
        state: ls.querySelector('.ls-st')?.textContent ?? '',
        phase: ls.dataset.phase,
        sitsBetweenHeadAndLog: Math.round(b.y) >= Math.round(head.y + head.height) && Math.round(b.y + b.height) <= Math.round(scroll.y),
        seamToLog: Math.round(scroll.y - (b.y + b.height)),
      };
    })()`,
  );
  check("the log carries an activity strip", !!logStrip, JSON.stringify(logStrip));
  check(
    "the strip is the same dot matrix, read across the whole column",
    logStrip?.h === 36 && logStrip?.rows === 8 && logStrip?.pitch === 6 && logStrip?.pitchY === 4.5 && logStrip?.cols >= 80,
    JSON.stringify(logStrip && { h: logStrip.h, rows: logStrip.rows, cols: logStrip.cols, pitch: logStrip.pitch }),
  );
  check(
    "it keys the readout and states the phase",
    logStrip?.spine === 14 && /ACTIVITY/i.test(logStrip?.label ?? "") && (logStrip?.state ?? "").length > 2,
    JSON.stringify(logStrip && { spine: logStrip.spine, label: logStrip.label, state: logStrip.state }),
  );
  check(
    "it sits between the header and the log, not inside the scroll",
    logStrip?.sitsBetweenHeadAndLog === true && logStrip?.seamToLog === 8,
    JSON.stringify(logStrip && { between: logStrip.sitsBetweenHeadAndLog, seam: logStrip.seamToLog }),
  );

  /* ------------------------------------------------------- 4. stations */
  const STATIONS = [
    { view: "mcp", title: "MCP", marker: ".mcp-connect, .mcp-card" },
    { view: "skills", title: "SKILLS", marker: ".pv" },
    { view: "providers", title: "PROVIDERS", marker: ".pv" },
    { view: "history", title: "HISTORY", marker: ".pv" },
    { view: "system", title: "SYSTEM", marker: ".set-section" },
    { view: "about", title: "ABOUT", marker: ".about-credit, .about-note" },
  ];
  for (let i = 0; i < STATIONS.length; i++) {
    const st = STATIONS[i];
    const clicked = await click(`.lnav .station:nth-child(${i + 1})`);
    await sleep(250);
    check(`nav ${st.view}: clickable`, clicked);
    check(`nav ${st.view}: header swaps`, (await h1()) === st.title, await h1());
    check(`nav ${st.view}: panel rendered`, await exists(st.marker));
    check(`nav ${st.view}: hash`, (await hash()) === `#${st.view}`, await hash());
    if (st.view !== "session") {
      const swapAnim = await evaluate(`getComputedStyle(document.querySelector('.anim-swap')).animationName`);
      check(`nav ${st.view}: panel swaps in`, swapAnim === "swap", String(swapAnim));
    }
    check(`nav ${st.view}: transcript replaced`, !(await inTranscript()));
  }

  /* -------------------------------------------- 4a. MCP add form fields */
  await click(".lnav .station:nth-child(1)");
  await sleep(400);
  const mcpFields = await evaluate(`[...document.querySelectorAll('.pv-form .field .lb')].map((el) => el.textContent.trim())`);
  check(
    "mcp form exposes transport/args/env/exposure/scope",
    ["NAME", "COMMAND", "ARGS", "WORKING DIR", "ENV", "DESCRIPTION"].every((label) => mcpFields.some((f) => f.includes(label))) &&
      mcpFields.some((f) => f.includes("TIMEOUT")),
    JSON.stringify(mcpFields),
  );
  const mcpChoices = await evaluate(`[...document.querySelectorAll('.pv-form .pv-form-row .lb')].map((el) => el.textContent.trim())`);
  check("mcp form exposes choice rows", ["TRANSPORT", "EXPOSURE", "SCOPE"].every((k) => mcpChoices.includes(k)), JSON.stringify(mcpChoices));
  check("mcp form has multi-line fields", (await evaluate(`document.querySelectorAll('.pv-form textarea').length`)) >= 2);
  check("mcp add is blocked until the form is valid", await evaluate(`[...document.querySelectorAll('.pv-form .btn')].find((b) => /ADD/.test(b.textContent))?.disabled === true`));

  // switching transport swaps stdio fields for url + headers
  await evaluate(`(() => { const b = [...document.querySelectorAll('.pv-form .pv-btn')].find((el) => el.textContent.trim() === 'HTTP'); b?.click(); })()`);
  await sleep(300);
  const httpFields = await evaluate(`[...document.querySelectorAll('.pv-form .field .lb')].map((el) => el.textContent.trim())`);
  check("mcp form switches to http fields", httpFields.some((f) => f.includes("URL")) && httpFields.some((f) => f.includes("HEADERS")) && !httpFields.some((f) => f.includes("COMMAND")), JSON.stringify(httpFields));

  /* ------------------------------------------- 4b. station numbering */
  const nums = await evaluate(`[...document.querySelectorAll('.lnav .station .num')].map((el) => el.textContent)`);
  check("rail numbers the stations", JSON.stringify(nums) === JSON.stringify(["01", "02", "03", "04", "05", "06"]), JSON.stringify(nums));

  const combo = (n) =>
    `new KeyboardEvent('keydown', { key: '${n}', code: 'Digit${n}', altKey: true, bubbles: true, cancelable: true })`;

  await evaluate(`window.dispatchEvent(${combo(3)})`);
  await sleep(300);
  check("⌥3 jumps to providers", (await h1()) === "PROVIDERS", await h1());
  check("station shortcut moves the hash", (await hash()) === "#providers", await hash());

  await evaluate(`window.dispatchEvent(${combo(0)})`);
  await sleep(300);
  check("⌥0 returns to the mission log", await inTranscript(), await h1());

  // a bare digit must not navigate, and must not be swallowed either
  const bare = await evaluate(
    `(() => { const e = new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`,
  );
  await sleep(250);
  check("bare digits are not station shortcuts", (await inTranscript()) && bare === false);

  // inside a field the combo is left alone (macOS Option+digit types characters)
  await evaluate(`(() => { const t = document.querySelector('textarea'); t.focus(); t.dispatchEvent(${combo(2)}); })()`);
  await sleep(250);
  check("station combo is inert while typing", await inTranscript(), await h1());

  /* -------------------------------- 5. back to the session list (bug) */
  await click(".lsessions .sess");
  await sleep(300);
  check("session row returns to the transcript", await inTranscript(), await h1());
  check("session row clears the hash", (await hash()) === "", await hash());
  check("session row restores the mission log title", (await h1()) !== "ABOUT", await h1());

  // a second round trip: station → session row → station → session row
  await click(".lnav .station:nth-child(6)");
  await sleep(200);
  await click(".lsessions .sess");
  await sleep(300);
  check("second round trip still renders the transcript", await inTranscript());
  check("second round trip clears the hash", (await hash()) === "", await hash());

  // deep link: landing on #about from a cold load
  await cdp.send("Page.navigate", { url: `${process.env.UI_BASE || handshake.url}#about` });
  await sleep(1800);
  check("deep link lands on the station", (await h1()) === "ABOUT", await h1());
  await click(".lsessions .sess");
  await sleep(300);
  check("deep-linked station still exits to the transcript", await inTranscript());

  /* ------------------------------------------------------ 6. panes */
  const leftBefore = await attr(".app", "data-left");
  await click(".pane-foot:not(.is-right)");
  await sleep(200);
  check("left pane collapses", (await attr(".app", "data-left")) !== leftBefore, `was ${leftBefore}`);
  await click(".pane-foot:not(.is-right)");
  await sleep(200);
  check("left pane expands again", (await attr(".app", "data-left")) === leftBefore);

  await click(".pane-foot:not(.is-right)");
  await sleep(250);
  const miniNums = await evaluate(`[...document.querySelectorAll('.lnav .station .num')].map((el) => el.textContent.trim())`);
  check("collapsed rail drops the numbers", miniNums.every((n) => n === ""), JSON.stringify(miniNums));
  const overflow = await evaluate(`[...document.querySelectorAll('.lnav .station')].some((el) => el.scrollWidth > el.clientWidth + 1)`);
  check("collapsed stations do not overflow", overflow === false);
  await click(".pane-foot:not(.is-right)");
  await sleep(250);

  const rightBefore = await attr(".app", "data-right");
  await click(".pane-foot.is-right");
  await sleep(200);
  check("right pane collapses", (await attr(".app", "data-right")) !== rightBefore, `was ${rightBefore}`);
  await click(".pane-foot.is-right");
  await sleep(200);
  check("right pane expands again", (await attr(".app", "data-right")) === rightBefore);

  /* ------------------------------------- 6b. rail does not invent numbers */
  const legend = await evaluate(`[...document.querySelectorAll('.legend span')].map((el) => el.textContent.trim())`);
  check("resources meter claims only what it knows", JSON.stringify(legend) === JSON.stringify(["USED", "FREE"]), JSON.stringify(legend));
  check("resources meter states what is missing", /not reported/i.test(await evaluate(`document.querySelector('.rnote')?.textContent ?? ''`)));

  /* ------------------------------------------------------ 7. decks */
  const chips = await evaluate(`[...document.querySelectorAll('.shelf .ctl')].map((el) => el.textContent.trim())`);
  check("shelf exposes model + think chips", Array.isArray(chips) && chips.length >= 2, JSON.stringify(chips));
  await click(".shelf .ctl");
  await sleep(400);
  check("model deck opens", await exists(".deck"));
  const deckAnim = await evaluate(`getComputedStyle(document.querySelector('.deck')).animationName`);
  check("deck opens with a block wipe, not a fade", deckAnim === "wipe-down", String(deckAnim));
  const deckRows = await evaluate(`[...document.querySelectorAll('.deck .opt')].map((el) => el.textContent.trim())`);
  check("model deck lists every available model", Array.isArray(deckRows) && deckRows.length > 0, `${deckRows?.length ?? 0} rows`);
  const grouped = await evaluate(`document.querySelectorAll('.deck .deck-grp').length`);
  check("model deck groups by provider", grouped >= 1, `${grouped} groups`);
  check(
    "model rows carry context",
    await evaluate(`[...document.querySelectorAll('.deck .opt')].slice(0, 3).every((el) => /K|M/.test(el.textContent))`),
    JSON.stringify(deckRows?.slice(0, 2)),
  );
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(250);
  check("escape closes the deck", !(await exists(".deck")));

  /* ----------------------------------------------------- 8. themes */
  await click(".lnav .station:nth-child(5)"); // system
  await sleep(300);
  const toolNote = await evaluate(`[...document.querySelectorAll('.pv-note')].map((el) => el.textContent).find((t) => t.includes('tools used')) ?? ''`);
  check("tool loadout reports this-session usage", /tools used this session/.test(toolNote), toolNote.slice(0, 60));

  const themeOpts = await evaluate(`[...document.querySelectorAll('.theme-opt')].map((el) => el.textContent.trim())`);
  check("settings lists the themes", Array.isArray(themeOpts) && themeOpts.length >= 4, JSON.stringify(themeOpts));
  const themeBox = await evaluate(
    `(() => { const b = document.querySelector('.theme-opt.mini'); if (!b) return null; const sw = b.querySelector('.sw').getBoundingClientRect(); const br = b.getBoundingClientRect(); return { pad: Math.round(sw.x - br.x), sw: Math.round(sw.width), fs: getComputedStyle(b.querySelector('.nm')).fontSize }; })()`,
  );
  check("theme swatch clears the selection spine", themeBox && themeBox.pad >= 8, JSON.stringify(themeBox));
  check("theme label respects the 11px floor", themeBox && parseFloat(themeBox.fs) >= 11, String(themeBox?.fs));

  const clickedVoy = await evaluate(
    `(() => { const b = [...document.querySelectorAll('.theme-opt')].find((el) => /VOY/i.test(el.textContent)); if (!b) return false; b.click(); return true; })()`,
  );
  await sleep(300);
  check("theme button applies a theme", clickedVoy && (await attr("html", "data-theme")) === "voy", String(await attr("html", "data-theme")));
  await evaluate(`(() => { const b = [...document.querySelectorAll('.theme-opt')].find((el) => /TNG/i.test(el.textContent)); b?.click(); })()`);
  await sleep(200);

  /* ------------------------------------------------ 8b. backdrop */
  // the picker browses the real filesystem; the still is read from its own path
  const stills = join(tmp, "stills");
  await mkdir(stills, { recursive: true });
  const stillPath = join(stills, "frame.png");
  await writeFile(stillPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"));

  const bdRow = await evaluate(`document.querySelector('.bd-row')?.textContent ?? ''`);
  check("settings offers a backdrop picker, not a bundled still", /CHOOSE/.test(bdRow) && /LCARS black/.test(bdRow), bdRow.slice(0, 60));
  check("no built-in wallpaper button remains", !(await evaluate(`[...document.querySelectorAll('.set-block .seg button')].some((b) => /SHIP/.test(b.textContent))`)));

  await click("[data-bd-choose]");
  await sleep(500);
  check("backdrop picker opens", await exists(".bd-browse"));
  const rootsListed = await evaluate(`[...document.querySelectorAll('.bd-browse .ws-chip')].map((el) => el.textContent.trim())`);
  check("picker offers disk roots", rootsListed.includes("HOME"), JSON.stringify(rootsListed));
  check("picker cannot apply nothing", await evaluate(`[...document.querySelectorAll('.bd-browse .bd-foot .pv-btn')].find((b) => /USE/.test(b.textContent))?.disabled === true`));
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(250);
  check("escape closes the picker", !(await exists(".bd-browse")));
  check("closing the picker keeps settings intact", await exists(".bd-row"));

  // apply a still through the same stored setting the picker writes, then reload
  await evaluate(
    `(() => { const s = JSON.parse(localStorage.getItem('lcars.settings') || '{}'); s.backdrop = ${JSON.stringify(stillPath)}; localStorage.setItem('lcars.settings', JSON.stringify(s)); localStorage.setItem('lcars.theme', 'tng'); })()`,
  );
  await cdp.send("Page.navigate", { url: process.env.UI_BASE || handshake.url });
  await sleep(1800);
  check("stored still turns the backdrop on", (await attr("html", "data-backdrop")) === "1", String(await attr("html", "data-backdrop")));
  const bgImage = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--backdrop-image')`);
  check("backdrop url points at the chosen file", bgImage.includes("/api/backdrop/file?path=") && bgImage.includes("frame.png"), bgImage.slice(0, 80));

  await click(".lnav .station:nth-child(5)"); // settings
  await sleep(300);
  check("settings shows the chosen still", await evaluate(`/frame.png$/.test(document.querySelector('.bd-path')?.textContent.trim() ?? '')`));
  await evaluate(`[...document.querySelectorAll('.bd-acts .pv-btn')].find((b) => /CLEAR/.test(b.textContent))?.click()`);
  await sleep(250);
  check("clear turns the backdrop off", (await attr("html", "data-backdrop")) === "0", String(await attr("html", "data-backdrop")));
  check("clear forgets the path", (await evaluate(`JSON.parse(localStorage.getItem('lcars.settings')).backdrop`)) === "");

  /* --------------------------------------------------- 9. composer */
  await click(".lsessions .sess");
  await sleep(250);
  const focused = await evaluate(`(() => { const t = document.querySelector('textarea'); if (!t) return false; t.focus(); return document.activeElement === t; })()`);
  check("composer focuses", focused);
  await cdp.send("Input.insertText", { text: "hello" });
  await sleep(150);
  check("composer accepts text", (await evaluate(`document.querySelector('textarea').value`)) === "hello");
  await evaluate(`(() => { const t = document.querySelector('textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  /* ------------------------------------- 9b. composer capabilities */
  // stub /api/prompt: these checks must never reach a real model
  await evaluate(`(() => {
    window.__calls = [];
    window.__realFetch = window.fetch;
    window.fetch = (u, o) => {
      const url = String(u);
      if (url.includes('/api/prompt')) {
        try { window.__calls.push(JSON.parse(o?.body ?? '{}')); } catch { window.__calls.push({ unparsed: true }); }
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { mode: 'queued' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return window.__realFetch(u, o);
    };
    return true;
  })()`);

  const value = () => evaluate(`document.querySelector('textarea').value`);
  const typeInto = async (text) => {
    await evaluate(`document.querySelector('textarea').focus()`);
    await cdp.send("Input.insertText", { text });
    await sleep(180);
  };
  const keyIn = async (key) => {
    await evaluate(
      `document.querySelector('textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`,
    );
    await sleep(220);
  };
  const clearInput = async () => {
    await evaluate(`(() => { const t = document.querySelector('textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(120);
  };

  // auto-grow: rises with the draft, then stops at the cap
  await typeInto("a\nb\nc\nd\n");
  const grown = await evaluate(`document.querySelector('textarea').clientHeight`);
  check("composer grows with the draft", grown > 44 && grown < 240, `${grown}px`);
  await typeInto("x\n".repeat(60));
  const capped = await evaluate(`document.querySelector('textarea').clientHeight`);
  check("composer stops at its cap", capped > grown && capped <= 240, `${capped}px`);
  check("a capped field scrolls instead of growing", await evaluate(`(() => { const t = document.querySelector('textarea'); return t.scrollHeight > t.clientHeight; })()`));
  await clearInput();

  // `@` palette → file reference
  await typeInto("@registr");
  await sleep(500);
  const fileRows = await evaluate(`document.querySelectorAll('.cpal[data-kind="file"] .cp').length`);
  check("@ opens the file palette", fileRows > 0, `${fileRows} rows`);
  const firstName = await evaluate(`document.querySelector('.cpal[data-kind="file"] .cp .cn')?.textContent ?? ''`);
  check("file palette leads with the best name match", firstName === "registry.mjs", firstName);
  await keyIn("Enter");
  check("picking a file inserts a path reference", /`server\/pi\/registry\.mjs`/.test(await value()), await value());
  await clearInput();

  // image attachment → prompt payload carries base64 + mime
  await evaluate(`(() => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const input = document.querySelector('.cmd-field input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File([png], 'pixel.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  check("attaching an image shows a chip", await exists(".attach-strip .achip img"), await evaluate(`document.querySelector('.achip .an')?.textContent ?? ''`));
  await evaluate(`document.querySelector('.aux-primary .btn')?.click()`);
  await sleep(400);
  const sent = await evaluate(`window.__calls.length ? window.__calls[window.__calls.length - 1] : null`);
  check("RUN sends the attachment with the prompt", !!sent?.images?.[0]?.data && sent.images[0].mimeType === "image/png", JSON.stringify(sent)?.slice(0, 80));
  check("the composer clears the attachment after RUN", !(await exists(".achip")));

  // sent-history: ↑ walks back through what was actually sent
  await typeInto("history probe");
  await keyIn("Enter");
  check("Enter clears the field", (await value()) === "", await value());
  await keyIn("ArrowUp");
  check("↑ recalls the last prompt", (await value()) === "history probe", await value());
  await keyIn("ArrowDown");
  check("↓ returns to the draft", (await value()) === "", await value());
  await clearInput();

  /* ------------------------- 9b1. quick prompts (macro pad + editor) */
  const padCount = await evaluate(`document.querySelectorAll('.aux-matrix .qp').length`);
  check("the run row keeps its two primary keys", (await evaluate(`document.querySelectorAll('.aux-primary .btn').length`)) === 2);
  check("FORK is gone from the command bar", !(await evaluate(`/FORK/.test(document.querySelector('.cmdbar')?.textContent ?? '')`)));
  check("the quick matrix renders pads plus the edit key", padCount >= 2, `${padCount} keys`);
  const padLabel = await evaluate(`document.querySelector('.aux-matrix .qp .lb')?.textContent ?? ''`);
  const callsBefore = await evaluate(`window.__calls.length`);
  await evaluate(`document.querySelector('.aux-matrix .qp')?.click()`);
  await sleep(200);
  const drafted = await value();
  check("a pad appends its prompt to the draft", drafted.length > 0 && drafted !== padLabel, `${padLabel} → ${drafted.slice(0, 40)}`);
  check("a pad does not send by itself", (await evaluate(`window.__calls.length`)) === callsBefore);
  await clearInput();
  await evaluate(`document.querySelector('.qp.is-edit')?.click()`);
  await sleep(300);
  check("EDIT opens the quick-prompt deck", await exists(".qp-row input.kl"));
  const rowCount = await evaluate(`document.querySelectorAll('.qp-row').length`);
  check("the deck lists every pad", rowCount === padCount - 1, `${rowCount} rows / ${padCount} keys`);
  await evaluate(`(() => {
    const r = document.querySelector('.qp-row input.kl');
    r.value = 'PROBE';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);
  await evaluate(`[...document.querySelectorAll('.deck .btn')].find((b) => /SAVE/.test(b.textContent ?? ''))?.click()`);
  await sleep(300);
  check("saving rewrites the pad label", (await evaluate(`document.querySelector('.aux-matrix .qp .lb')?.textContent`)) === "PROBE", await evaluate(`document.querySelector('.aux-matrix .qp .lb')?.textContent ?? ''`));
  check("a saved pad survives a reload", (await evaluate(`localStorage.getItem('lcars.quick') ?? ''`)).includes("PROBE"));
  await evaluate(`localStorage.removeItem('lcars.quick'); window.dispatchEvent(new CustomEvent('lcars:quick'))`);
  await sleep(200);

  /* ---------------------------------- 9b2. IME (composition) safety */
  // Enter commits a candidate, Esc dismisses the window: neither may reach the
  // composer's own shortcuts, and composing text must already grow the field.
  await evaluate(`(() => {
    window.__calls.length = 0;
    const t = document.querySelector('textarea');
    t.focus();
    t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ni' }));
    window.__imeStart = t.clientHeight;
    t.value = 'ni hao shi jie\\n'.repeat(12);
    t.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ni', isComposing: true }));
    return true;
  })()`);
  await sleep(200);
  check("composing text survives the keystroke", (await evaluate(`document.querySelector('textarea').value`)).startsWith("ni hao"));
  check(
    "the field grows while composing",
    (await evaluate(`document.querySelector('textarea').clientHeight`)) > (await evaluate(`window.__imeStart`)),
    `${await evaluate(`window.__imeStart`)} → ${await evaluate(`document.querySelector('textarea').clientHeight`)}px`,
  );
  await evaluate(
    `document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }))`,
  );
  await sleep(300);
  check("Enter while composing does not send the prompt", (await evaluate(`window.__calls.length`)) === 0);
  await evaluate(`document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好世界' }))`);
  await sleep(300);
  check("the commit lands in the draft", (await value()).startsWith("ni hao"), await value());
  await clearInput();

  // draft persistence survives a reload, per session
  await typeInto("draft survives reload");
  await sleep(700);
  await cdp.send("Page.navigate", { url: process.env.UI_BASE || handshake.url });
  await sleep(2000);
  check("the draft survives a reload", (await value()) === "draft survives reload", await value());
  await clearInput();

  /* --------------------------------- 9b2. the tail control (ctrl+end) */
  // The harness session is empty, so the transcript cannot overflow on its own:
  // pad it with an inert block to exercise the follow logic itself. What is
  // being checked is the shell's behaviour, not the sample data.
  const tail = await evaluate(
    `(async () => {
      const el = document.querySelector('#scroll');
      const cmdBefore = Math.round(document.querySelector('.cmdwrap').getBoundingClientRect().y);
      const pad = document.createElement('div');
      pad.id = 'tallprobe';
      pad.style.height = '2600px';
      el.firstElementChild.appendChild(pad);
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 400));
      const btn = document.querySelector('.jumpbar');
      const cs = btn ? getComputedStyle(btn) : null;
      const b = btn?.getBoundingClientRect();
      const sc = el.getBoundingClientRect();
      const cmd = document.querySelector('.cmdwrap').getBoundingClientRect();
      const out = {
        shown: !!btn,
        text: btn?.textContent.trim().replace(/\\s+/g, ' ') ?? '',
        position: cs?.position,
        floating: !!b && b.y > sc.y && b.y + b.height <= sc.y + sc.height + 1,
        bottomRight: !!b && sc.x + sc.width - (b.x + b.width) < 40,
        movedComposer: Math.round(cmd.y) - cmdBefore,
        hint: /CTRL END/.test(btn?.textContent ?? ''),
      };
      // the click goes back to the tail and resumes following
      btn?.click();
      await new Promise((r) => setTimeout(r, 400));
      out.afterClick = { gone: !document.querySelector('.jumpbar'), gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) };
      // ctrl+end from the page (not from the composer) does the same, ctrl+home releases the tail
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      out.afterCtrlHome = { atTop: Math.round(el.scrollTop) === 0, btn: !!document.querySelector('.jumpbar') };
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      out.afterCtrlEnd = { gone: !document.querySelector('.jumpbar'), gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) };
      // ...but the composer owns ctrl+end while it has focus: park the
      // transcript at the top, press the key into the textarea, stay at the top
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 300));
      const ta = document.querySelector('.cmd-field textarea');
      ta.focus();
      // a real key press targets the focused field, not the window
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      out.composerOwnsKey = { top: Math.round(el.scrollTop), btn: !!document.querySelector('.jumpbar'), focused: document.activeElement?.tagName };
      ta.blur();
      pad.remove();
      el.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 200));
      return out;
    })()`,
  );
  check("scrolling away offers a way back to the tail", tail?.shown === true && /LATEST/.test(tail?.text ?? ""), JSON.stringify(tail && { shown: tail.shown, text: tail.text }));
  check(
    // it floats over the transcript: an in-flow bar used to shove the composer up
    "the tail control floats and moves nothing",
    tail?.position === "absolute" && tail?.floating === true && tail?.bottomRight === true && tail?.movedComposer === 0,
    JSON.stringify(tail && { pos: tail.position, floating: tail.floating, bottomRight: tail.bottomRight, moved: tail.movedComposer }),
  );
  check("it names the keybinding", tail?.hint === true);
  check(
    "pressing it returns to the newest message",
    tail?.afterClick?.gone === true && tail?.afterClick?.gap === 0,
    JSON.stringify(tail?.afterClick),
  );
  check(
    "ctrl+home / ctrl+end page the transcript like pi's TUI",
    tail?.afterCtrlHome?.atTop === true && tail?.afterCtrlHome?.btn === true && tail?.afterCtrlEnd?.gone === true && tail?.afterCtrlEnd?.gap === 0,
    JSON.stringify({ home: tail?.afterCtrlHome, end: tail?.afterCtrlEnd }),
  );
  check(
    "the composer keeps ctrl+end for its own text",
    tail?.composerOwnsKey?.top === 0 && tail?.composerOwnsKey?.btn === true,
    JSON.stringify(tail?.composerOwnsKey),
  );

  /* ----------------------------- 9c. three-zone workspace (test view) */
  const streamBadge = `[...document.querySelectorAll('.vsw-b')].find((b) => /STREAM/.test(b.textContent))`;
  const logBadge = `[...document.querySelectorAll('.vsw-b')].find((b) => /^LOG$/.test(b.textContent))`;
  check("the view switch offers both positions", !!(await evaluate(`!!${streamBadge} && !!${logBadge}`)));
  check(
    "the log position starts selected",
    (await evaluate(`document.querySelectorAll('.vsw-b')[0].getAttribute('aria-pressed')`)) === "true",
    await evaluate(`document.querySelectorAll('.vsw-b')[0].getAttribute('aria-pressed')`),
  );
  await evaluate(`${streamBadge}?.click()`);
  await sleep(400);
  check("the workspace replaces the log", await exists(".ws"));
  check("the strip yields to the zone band in STREAM", !(await exists(".logstate")));
  check(
    "it has exactly the three zones",
    (await evaluate(`[...document.querySelectorAll('.ws-zone')].map((z) => z.dataset.zone).join(',')`)) ===
      "thinking,thread,action",
    await evaluate(`[...document.querySelectorAll('.ws-zone')].map((z) => z.dataset.zone).join(',')`),
  );
  check(
    "each zone carries a tone spine and a count",
    (await evaluate(`document.querySelectorAll('.ws-hd[data-tone] .n').length`)) === 3,
  );
  // the strip numbers the cycle (I conversation, II thinking, III terminal) and
  // ends in a state block: that block is the only thing allowed to go solid
  const strips = await evaluate(
    `[...document.querySelectorAll('.ws-hd')].map((h) => ({ zone: h.closest('.ws-zone').dataset.zone, idx: h.querySelector('.idx')?.textContent ?? '', st: h.querySelector('.st')?.textContent ?? '', tone: h.querySelector('.idx') ? getComputedStyle(h.querySelector('.idx')).backgroundColor : '' }))`,
  );
  check(
    "each strip numbers the cycle and reports a live state",
    Array.isArray(strips) &&
      strips.map((s) => s.idx).join(",") === "II,I,III" &&
      strips.every((s) => s.st.length > 0 && s.tone !== "rgba(0, 0, 0, 0)"),
    JSON.stringify(strips),
  );
  // the two joints fill exactly the seam between the columns and the band
  const joints = await evaluate(
    `(() => { const band = Math.round(document.querySelector('.ws-zone[data-zone="thread"]').getBoundingClientRect().y);
      return { band, rows: [...document.querySelectorAll('.ws-joint')].map((j) => { const r = j.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) }; }) }; })()`,
  );
  check(
    "the columns feed the conversation band through two joints",
    joints?.rows?.length === 2 &&
      joints.rows.every((j) => j.h === 8 && j.w > 0 && j.y + j.h === joints.band),
    JSON.stringify(joints),
  );
  // thinking fills the left column, the terminal the right one, the exchange the bottom band
  const zoneBox = await evaluate(
    `Object.fromEntries([...document.querySelectorAll('.ws-zone')].map((z) => { const r = z.getBoundingClientRect(); return [z.dataset.zone, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }]; }))`,
  );
  check(
    "the terminal owns the right column",
    zoneBox.action.x > zoneBox.thinking.x && zoneBox.action.y === zoneBox.thinking.y && zoneBox.action.h > 0,
    JSON.stringify(zoneBox),
  );
  check(
    "the conversation gets the full-width band under both columns",
    zoneBox.thread.w > zoneBox.action.w * 1.5 &&
      zoneBox.thread.y >= zoneBox.action.y + zoneBox.action.h &&
      zoneBox.thread.h > zoneBox.action.h,
    JSON.stringify(zoneBox),
  );
  // the harness session is empty, so every zone must say so instead of rendering nothing
  check("empty zones explain themselves", (await evaluate(`document.querySelectorAll('.ws-empty').length`)) === 3);
  check("the workspace deep-links", (await hash()) === "#stream", await hash());
  check(
    "the switch moves to STREAM while the workspace is open",
    (await evaluate(`document.querySelectorAll('.vsw-b')[1].getAttribute('aria-pressed')`)) === "true" &&
      (await evaluate(`document.querySelectorAll('.vsw-b')[0].getAttribute('aria-pressed')`)) === "false",
    await evaluate(`[...document.querySelectorAll('.vsw-b')].map((b) => b.getAttribute('aria-pressed')).join('/')`),
  );
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(400);
  check("escape returns to the mission log", !(await exists(".ws")) && (await inTranscript()));
  check("leaving the workspace clears the hash", (await hash()) === "", await hash());
  // and it is reachable again from the same switch
  await evaluate(`${streamBadge}?.click()`);
  await sleep(300);
  check("the workspace reopens", await exists(".ws"));

  /* the thinking band: a drawn dot matrix in the seam under the header */
  const bandInfo = await evaluate(
    `(() => {
      const z = document.querySelector('.ws-zone[data-zone="thinking"]');
      const band = z?.querySelector('.ws-band');
      const svg = band?.querySelector('svg');
      if (!band || !svg) return null;
      const hd = z.querySelector('.ws-hd').getBoundingClientRect();
      const b = band.getBoundingClientRect();
      const body = z.querySelector('.ws-body').getBoundingClientRect();
      const paths = [...svg.querySelectorAll('path')];
      const stroke = paths[0] ? parseFloat(getComputedStyle(paths[0]).strokeWidth) : 0;
      const pitch = Number(band.dataset.pitchX);
      return {
        phase: band.dataset.phase,
        rows: Number(band.dataset.rows),
        pitch,
        pitchY: Number(band.dataset.pitchY),
        cols: Math.round(svg.getBoundingClientRect().width / pitch),
        height: Math.round(b.height),
        width: Math.round(svg.getBoundingClientRect().width),
        stroke,
        dots: paths.reduce((n, p) => n + (p.getAttribute('d').match(/M/g) ?? []).length, 0),
        layers: paths.length,
        seamTop: Math.round(b.y - (hd.y + hd.height)),
        seamBottom: Math.round(body.y - (b.y + b.height)),
        // the matrix may be a hair wider than its slot (subpixel layout), never wider than one column
        fill: svg.getBoundingClientRect().width <= b.width + 1 && b.width - svg.getBoundingClientRect().width <= pitch,
        indent: Math.round(b.x - z.getBoundingClientRect().x),
      };
    })()`,
  );
  check("the thinking zone carries a motion band", !!bandInfo, JSON.stringify(bandInfo));
  check(
    // two braille cell rows: 8 dot rows at a 6 x 4.5px pitch = a 36px band
    "the band is an eight-row dot matrix",
    bandInfo?.rows === 8 && bandInfo?.height === 36 && bandInfo?.pitch === 6 && bandInfo?.pitchY === 4.5,
    JSON.stringify(bandInfo && { rows: bandInfo.rows, height: bandInfo.height, pitch: bandInfo.pitch, py: bandInfo.pitchY }),
  );
  check(
    // the dot is DRAWN, so its size is a decision, not a side effect of the
    // typeface: 3.2px on a 6 x 4.5px grid (an 18px braille cell, uniform).
    "the dots are drawn at the cell's own cadence",
    bandInfo?.stroke > 2.8 && bandInfo?.stroke < 3.6 && bandInfo?.cols >= 40 && bandInfo?.dots > 8,
    JSON.stringify(bandInfo && { stroke: bandInfo.stroke, cols: bandInfo.cols, dots: bandInfo.dots }),
  );
  check(
    "it fills the slot without spilling",
    bandInfo?.fill === true && bandInfo?.width <= bandInfo?.cols * bandInfo?.pitch + 1,
    JSON.stringify(bandInfo && { fill: bandInfo.fill, width: bandInfo.width, cols: bandInfo.cols }),
  );
  check(
    "it sits in the seam, indented to the body's leg",
    bandInfo?.seamTop === 4 && bandInfo?.seamBottom === 4 && bandInfo?.indent === 14,
    JSON.stringify(bandInfo && { top: bandInfo.seamTop, bottom: bandInfo.seamBottom, indent: bandInfo.indent }),
  );

  // the arm used to end 20px above a hole: the band carried a 14px margin
  // instead of a rail, so the instrument looked cut in half right under the
  // fillet. The leg is now a border on the wrapper that owns band + body.
  const leg = await evaluate(
    `(() => {
      const z = document.querySelector('.ws-zone[data-zone="thinking"]');
      const box = (el) => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
      const hd = z.querySelector('.ws-hd');
      const mid = z.querySelector('.ws-mid');
      const band = z.querySelector('.ws-band');
      const body = z.querySelector('.ws-body');
      const arm = z.querySelector('.ws-arm');
      const cs = mid ? getComputedStyle(mid) : null;
      const h = box(hd), m = mid ? box(mid) : null, b = box(band), d = box(body), a = box(arm), zr = box(z);
      return {
        border: cs?.borderLeftWidth,
        sameTone: cs?.borderLeftColor === getComputedStyle(z.querySelector('.ws-hd .idx')).backgroundColor,
        seamUnderHead: m ? Math.round(m.y - (h.y + h.h)) : null,
        legToBody: m ? Math.round(m.y + m.h - (d.y + d.h)) : null,
        bandOnLeg: Math.round(b.x - zr.x),
        armToBand: Math.round(a.y + a.h - b.y),
        armW: Math.round(a.w),
        idxW: Math.round(z.querySelector('.ws-hd .idx').getBoundingClientRect().width),
      };
    })()`,
  );
  check(
    "the leg runs from the arm to the body without a hole",
    leg?.border === "14px" && leg?.sameTone === true && leg?.seamUnderHead === 4 && leg?.legToBody === 0,
    JSON.stringify(leg),
  );
  check(
    "the arm is as wide as the numeral block and reaches into the band",
    leg?.armW === leg?.idxW && leg?.bandOnLeg === 14 && leg?.armToBand > 8,
    JSON.stringify(leg && { armW: leg.armW, idxW: leg.idxW, bandOnLeg: leg.bandOnLeg, armToBand: leg.armToBand }),
  );

  const bandFrames = await evaluate(
    `(async () => {
      const band = document.querySelector('.ws-band');
      // one frame = the two paths' geometry; the matrix has no text to diff
      const frameOf = () => [...band.querySelectorAll('path')].map((p) => p.getAttribute('d')).join('|');
      const seen = new Set([frameOf()]);
      for (let i = 0; i < 7; i++) { await new Promise((r) => setTimeout(r, 220)); seen.add(frameOf()); }
      const phase = band.dataset.phase;
      document.documentElement.dataset.motion = 'reduced';
      await new Promise((r) => setTimeout(r, 700));
      const a = frameOf();
      await new Promise((r) => setTimeout(r, 800));
      const frozen = a === frameOf();
      document.documentElement.dataset.motion = 'system';
      return { distinct: seen.size, phase, frozen };
    })()`,
  );
  check("the band actually animates", bandFrames?.distinct > 1, `${bandFrames?.distinct} frames in 1.5s`);
  check("reduced motion freezes it", bandFrames?.frozen === true);
  check(
    "an idle session reads as idle",
    bandFrames?.phase === "idle" &&
      (await evaluate(
        `document.querySelector('.ws-zone[data-zone="thinking"] .ws-hd .st').textContent`,
      )) === "IDLE",
    await evaluate(`document.querySelector('.ws-band').dataset.phase`),
  );

  await evaluate(`${logBadge}?.click()`);
  await sleep(300);
  check("picking LOG switches the workspace off", !(await exists(".ws")));

  /* ------------------------------------- 9d. markdown file preview */
  // the reported bug lived here: a .md opened in the viewer used `breaks: true`,
  // so every hard-wrapped source line became a <br> and prose read as double-spaced
  await evaluate(`[...document.querySelectorAll('.lseg button')].find((b) => /FILES/.test(b.textContent))?.click()`);
  await sleep(900);
  check("FILES mode swaps the rail", await exists(".ft-row"));
  await evaluate(`[...document.querySelectorAll('.ft-row.is-file')].find((r) => /notes\\.md$/.test(r.querySelector('.nm')?.textContent ?? ''))?.click()`);
  await sleep(1200);
  const view = await evaluate(`(() => {
    const md = document.querySelector('.fv-md .md');
    if (!md) return null;
    const p = md.querySelector('p');
    const s = p ? getComputedStyle(p) : null;
    return {
      brs: md.querySelectorAll('p br').length,
      paragraphs: md.querySelectorAll('p').length,
      // geometry is not the point (the preview is wide enough to fit on one
      // line); what must hold is that both source lines landed in ONE paragraph
      merged: p ? p.textContent.includes('这一段') && p.textContent.includes('检查点就是这里') : false,
      tables: md.querySelectorAll('table').length,
      inPort: md.querySelectorAll('.md-tbl table').length,
      rightCol: md.querySelector('td[align="right"]') ? getComputedStyle(md.querySelector('td[align="right"]')).textAlign : null,
    };
  })()`);
  check("the markdown viewer previews the file", !!view);
  if (view) {
    check("soft wraps fold instead of becoming <br>", view.brs === 0, `${view.brs} <br> in ${view.paragraphs} paragraphs`);
    check("both source lines fold into one paragraph", view.merged === true && view.paragraphs === 1, `${view.merged} / ${view.paragraphs}`);
    check("tables render inside the scroll port", view.tables === 1 && view.inPort === 1, `${view.tables}/${view.inPort}`);
    check("the viewer keeps the author's alignment", view.rightCol === "right", String(view.rightCol));
  }
  await evaluate(`[...document.querySelectorAll('.pv-btn')].find((b) => /CLOSE/.test(b.textContent))?.click()`);
  await sleep(500);
  check("closing the viewer returns to the transcript", await inTranscript());
  await evaluate(`[...document.querySelectorAll('.lseg button')].find((b) => /SESSIONS/.test(b.textContent))?.click()`);
  await sleep(400);

  /* ------------------------------------------------ 10. console errors */
  const errors = cdp.events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text ?? "exception");
  const logged = cdp.events
    .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
    .map((e) => e.params.entry.text);
  check("no uncaught exceptions", errors.length === 0, errors.slice(0, 2).join(" | "));
  check("no console errors", logged.length === 0, logged.slice(0, 2).join(" | "));

  /* ------------------------------------- 10b. branch tree panel */
  const treeBadge = `[...document.querySelectorAll('.chips .badge')].find((b) => /TREE/.test(b.textContent))`;
  check("the tree button reports its state", (await evaluate(`${treeBadge}?.getAttribute('aria-pressed')`)) === "false");
  await evaluate(`${treeBadge}?.click()`);
  await sleep(1200);
  check("tree opens with tree semantics", await exists('.tv-body[role="tree"]'));
  check("the tree button lights up while open", (await evaluate(`${treeBadge}?.getAttribute('aria-pressed')`)) === "true");
  const treeRows = await evaluate(`document.querySelectorAll('.tnode[role="treeitem"]').length`);
  if (treeRows === 0) {
    // the harness runs on a throwaway session, so the tree is legitimately empty
    check("empty tree says so", await evaluate(`/nothing in this session/i.test(document.querySelector('.tv')?.textContent ?? '')`));
    results.push("skip  populated-tree checks — run with UI_MODEL=1 for a session with entries");
  } else {
    check("tree lists entries", treeRows > 0, `${treeRows} rows`);
    check(
      "every entry carries a lane rail",
      (await evaluate(`document.querySelectorAll('.tnode .lane i').length`)) === treeRows,
    );
    check("entries are grouped into turns", (await evaluate(`document.querySelectorAll('.tsep').length`)) >= 1);
    check(
      "tree does not scroll sideways",
      (await evaluate(`(() => { const b = document.querySelector('.tv-body'); return b.scrollWidth > b.clientWidth; })()`)) === false,
    );
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))`);
    await sleep(200);
    check("arrow keys move the tree cursor", await exists('.tnode[data-cursor="1"]'));
  }
  // the same button closes it again — CLOSE inside the panel is only a second way out
  await evaluate(`${treeBadge}?.click()`);
  await sleep(400);
  check("clicking TREE again closes the tree", !(await exists(".tv-body")) && (await inTranscript()));
  check("the tree button clears its state", (await evaluate(`${treeBadge}?.getAttribute('aria-pressed')`)) === "false");

  /* ------------------------------------- 10c. markdown surface */
  // the craft page carries the markdown fixture, so prose/code/table rhythm is
  // measurable without a model: §3.5b is a contract, not a taste
  await cdp.send("Page.navigate", { url: `${process.env.UI_BASE || handshake.url}?craft#markdown` });
  await sleep(2200);
  const md = await evaluate(`(() => {
    const box = document.querySelector('#markdown .md');
    if (!box) return null;
    const g = (sel) => { const el = box.querySelector(sel); return el ? getComputedStyle(el) : null; };
    const para = g('p');
    const probe = (html) => {
      const d = document.createElement('div');
      d.className = 'md'; d.style.position = 'absolute'; d.style.left = '-9999px'; d.style.width = '600px';
      d.innerHTML = html; document.body.appendChild(d);
      const h = d.querySelector('p').getBoundingClientRect().height; d.remove(); return Math.round(h * 10) / 10;
    };
    const plain = probe('<p>按 IP 建令牌桶，60 秒 10 次，超限返回 429。中间件按路由挂载。</p>');
    const withCode = probe('<p>按 IP 建令牌桶，<code>60</code> 秒 <code>10</code> 次，超限返回 <code>429</code>。</p>');
    const tbl = box.querySelector('.md-tbl');
    const th = [...box.querySelectorAll('th')].map((e) => e.getAttribute('align') + ':' + getComputedStyle(e).textAlign);
    const right = box.querySelector('td[align="right"]');
    return {
      prose: parseFloat(para.lineHeight) / parseFloat(para.fontSize),
      plain, withCode,
      codeLH: parseFloat(g('.cb-bd').lineHeight) / parseFloat(g('.cb-bd').fontSize),
      codePad: g('.cb-bd code').paddingTop,
      align: th.join(' '),
      rightAlign: right ? getComputedStyle(right).textAlign : null,
      scrollPort: tbl ? getComputedStyle(tbl).overflowX : null,
      fits: tbl ? tbl.scrollWidth <= tbl.clientWidth : null,
    };
  })()`);
  check("markdown fixture renders", !!md);
  if (md) {
    check("prose line-height is 1.5–1.7", md.prose >= 1.5 && md.prose <= 1.7, md.prose.toFixed(2));
    check("inline code does not inflate the line box", Math.abs(md.withCode - md.plain) < 0.6, `${md.plain} vs ${md.withCode}`);
    check("code block line-height is 1.4–1.7", md.codeLH >= 1.4 && md.codeLH <= 1.7, md.codeLH.toFixed(2));
    check("the block's <code> adds no inline padding", md.codePad === "0px", md.codePad);
    check("table honours the author's alignment", /center:center/.test(md.align) && /right:right/.test(md.align), md.align);
    check("right-aligned cells use tabular numerals", md.rightAlign === "right", String(md.rightAlign));
    check("a wide table scrolls inside its own port", md.scrollPort === "auto" && md.fits !== false, `${md.scrollPort} fits=${md.fits}`);
  }
  await cdp.send("Page.navigate", { url: process.env.UI_BASE || handshake.url });
  await sleep(1800);

  /* ------------------------------------- 10c. the two desktop targets */
  // 1600x1000 is the design size; 1440x900 and 1280x800 are the laptops this
  // actually runs on. Neither may introduce a horizontal scroll, a wrapped
  // header, or a sidebar that squeezes the input field (AGENTS §4.2b).
  for (const [w, h] of [
    [1440, 900],
    [1280, 800],
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: (process.env.UI_BASE || handshake.url).replace(/\/$/, "") + "/#stream" });
    await sleep(1800);
    const fit = await evaluate(
      `(() => {
        const head = document.querySelector('.center-head');
        const field = document.querySelector('.cmd-field');
        const band = document.querySelector('.ws-band');
        const zones = {};
        for (const z of document.querySelectorAll('.ws-zone')) {
          const zr = z.getBoundingClientRect();
          const body = z.querySelector('.ws-body');
          zones[z.dataset.zone] = {
            w: Math.round(zr.width),
            h: Math.round(zr.height),
            body: body ? Math.round(body.getBoundingClientRect().height) : 0,
          };
        }
        return {
          vp: [innerWidth, innerHeight],
          doc: document.documentElement.scrollWidth,
          headOver: head ? head.scrollHeight - head.clientHeight : null,
          headH: head ? Math.round(head.getBoundingClientRect().height) : null,
          field: field ? Math.round(field.getBoundingClientRect().width) : null,
          zones,
          cols: band ? Math.floor(band.getBoundingClientRect().width / Number(band.dataset.pitchX)) : 0,
        };
      })()`,
    );
    check(`layout ${w}x${h}: still two columns`, fit?.zones?.thinking?.w > 200 && fit?.zones?.action?.w > 300, JSON.stringify(fit?.zones && { t: fit.zones.thinking, a: fit.zones.action }));
    check(`layout ${w}x${h}: the header stays one band tall`, fit?.headH === 52 && fit?.headOver === 0, JSON.stringify(fit && { h: fit.headH, over: fit.headOver }));
    check(`layout ${w}x${h}: the input field keeps its width`, fit?.field >= 300, String(fit?.field));
    check(
      `layout ${w}x${h}: every instrument keeps a usable body`,
      ["thinking", "thread", "action"].every((k) => (fit?.zones?.[k]?.body ?? 0) >= 150),
      JSON.stringify(fit && Object.fromEntries(Object.entries(fit.zones).map(([k, v]) => [k, v.body]))),
    );
    check(`layout ${w}x${h}: the dot matrix still holds 40+ columns`, (fit?.cols ?? 0) >= 40, String(fit?.cols));
    check(`layout ${w}x${h}: no horizontal scroll`, fit?.doc === w, `${fit?.doc} vs ${w}`);
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await sleep(600);

  /* -------------------------- 11. a crash surfaces, and reports to the server */
  await cdp.send("Page.navigate", { url: process.env.UI_BASE || handshake.url });
  await sleep(2200);
  await evaluate(`window.dispatchEvent(new ErrorEvent('error', { message: 'probe fault', error: new Error('probe fault') }))`);
  await sleep(500);
  check("a crash paints a fault report", await exists(".panic"), await evaluate(`document.querySelector('.panic-msg')?.textContent ?? ''`));
  check("the fault report keeps the stack", await exists(".panic-stack"));
  const recorded = await get(`${base}/api/system`);
  check(
    "the fault reaches the server",
    (recorded.body?.data?.clientErrors ?? []).some((e) => /probe fault/.test(e.message)),
    JSON.stringify(recorded.body?.data?.clientErrors?.slice(-1)),
  );
} catch (e) {
  check("ui harness", false, e.message);
} finally {
  try {
    cdp?.ws?.close();
  } catch {
    /* ignore */
  }
  if (server) server.kill("SIGTERM");
  if (browser) browser.kill("SIGKILL");
  await sleep(300);
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed (${results.length} checks)`);
process.exit(failures ? 1 : 0);
