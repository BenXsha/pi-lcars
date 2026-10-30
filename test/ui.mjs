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
import { mkdtemp, readdir, rm } from "node:fs/promises";
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
  const backBySession = await click(".lsessions .sess");
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

  /* --------------------------------------------------- 9. composer */
  await click(".lsessions .sess");
  await sleep(250);
  const focused = await evaluate(`(() => { const t = document.querySelector('textarea'); if (!t) return false; t.focus(); return document.activeElement === t; })()`);
  check("composer focuses", focused);
  await cdp.send("Input.insertText", { text: "hello" });
  await sleep(150);
  check("composer accepts text", (await evaluate(`document.querySelector('textarea').value`)) === "hello");
  await evaluate(`(() => { const t = document.querySelector('textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  /* ------------------------------------------------ 10. console errors */
  const errors = cdp.events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text ?? "exception");
  const logged = cdp.events
    .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
    .map((e) => e.params.entry.text);
  check("no uncaught exceptions", errors.length === 0, errors.slice(0, 2).join(" | "));
  check("no console errors", logged.length === 0, logged.slice(0, 2).join(" | "));

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
