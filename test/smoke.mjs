#!/usr/bin/env node
/**
 * Endpoint smoke test. Boots the real server against a throwaway session dir
 * and exercises every route exactly once — no model calls, so it is free to run
 * before every commit.
 *
 *   node test/smoke.mjs
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.TEST_PORT || 4288);
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const results = [];
function check(name, cond, detail = "") {
  const ok = !!cond;
  if (!ok) failures++;
  results.push(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = async (p, b) => {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b ?? {}),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const dir = await mkdtemp(join(tmpdir(), "lcars-smoke-"));
const child = spawn(process.execPath, [join(ROOT, "server", "index.mjs")], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), LCARS_SESSIONS: dir, PI_CWD: ROOT },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

async function waitReady(timeout = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const r = await fetch(`${BASE}/api/state`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  const ready = await waitReady();
  check("server boots", ready, ready ? "" : log.slice(-400));
  if (!ready) throw new Error("server never became ready");

  /* ---------------- read ---------------- */
  const state = await get("/api/state");
  check("GET /api/state", state.status === 200 && state.body?.ok, JSON.stringify(state.body?.error ?? ""));
  check("boot created a session", state.body?.data?.sessions?.length >= 1);
  check("meta carries a model", typeof state.body?.data?.meta?.model === "string");
  check("meta lists active tools", (state.body?.data?.meta?.tools ?? []).length > 0, `${state.body?.data?.meta?.tools?.length ?? 0} tools`);

  const fs1 = await get(`/api/fs?path=${encodeURIComponent(ROOT)}`);
  check("GET /api/fs", fs1.status === 200 && Array.isArray(fs1.body?.data?.dirs));
  const names = (fs1.body?.data?.dirs ?? []).map((d) => d.name);
  check("fs lists src + server", names.includes("src") && names.includes("server"), names.join(","));

  const tree = await get("/api/tree?path=src");
  check("GET /api/tree", tree.status === 200 && Array.isArray(tree.body?.data?.entries), `${tree.body?.data?.entries?.length ?? 0} entries`);
  check("tree lists dirs first", tree.body?.data?.entries?.[0]?.type === "dir");
  const outside = await post("/api/open", { path: "../../etc/hosts" });
  check("open refuses paths outside the workspace", outside.status === 403 && outside.body?.code === "E_OUTSIDE");

  /* ------------- backdrop: the operator's own still, read in place ------------- */
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  const pngBytes = Buffer.from(PNG, "base64");
  const stills = join(dir, "stills");
  await mkdir(stills, { recursive: true });
  await writeFile(join(stills, "frame.png"), pngBytes);
  await writeFile(join(stills, "notes.txt"), "not an image");

  const bd = await get(`/api/backdrop?dir=${encodeURIComponent(stills)}`);
  check("GET /api/backdrop lists folders + stills", bd.status === 200 && Array.isArray(bd.body?.data?.dirs) && bd.body?.data?.images?.length === 1, `${bd.body?.data?.images?.length ?? "?"} images`);
  check("backdrop lists only images", bd.body?.data?.images?.[0]?.name === "frame.png", JSON.stringify(bd.body?.data?.images?.map((i) => i.name)));
  check("backdrop picker offers roots", (bd.body?.data?.roots ?? []).some((r) => r.label === "HOME"), JSON.stringify(bd.body?.data?.roots?.map((r) => r.label)));

  const img = await fetch(`${BASE}/api/backdrop/file?path=${encodeURIComponent(join(stills, "frame.png"))}`);
  const imgLen = (await img.arrayBuffer()).byteLength;
  check("backdrop still is served from its own path", img.status === 200 && img.headers.get("content-type") === "image/png", String(img.status));
  check("backdrop still keeps its bytes", imgLen === pngBytes.length, `${imgLen} vs ${pngBytes.length}`);

  const notImage = await get(`/api/backdrop/file?path=${encodeURIComponent(join(stills, "notes.txt"))}`);
  check("backdrop refuses non-images", notImage.status === 415 && notImage.body?.code === "E_NOT_IMAGE", String(notImage.status));
  const relative = await get(`/api/backdrop/file?path=stills/frame.png`);
  check("backdrop requires an absolute path", relative.status === 400 && relative.body?.code === "E_ARGS", String(relative.status));
  const bundled = await fetch(`${BASE}/backdrop.jpg`);
  check("no wallpaper ships with the client", bundled.status === 404, String(bundled.status));

  const cmds = await get("/api/commands");
  check("GET /api/commands", cmds.status === 200 && Array.isArray(cmds.body?.data?.commands), `${cmds.body?.data?.commands?.length ?? 0} commands`);

  const hist = await get("/api/history?limit=5");
  check("GET /api/history never blocks", hist.status === 200 && typeof hist.body?.data?.ready === "boolean");
  check("history reports its scan", hist.body?.data && ["scanning", "scanned", "matched"].every((k) => k in hist.body.data));

  const skills = await get("/api/skills");
  check("GET /api/skills", skills.status === 200 && skills.body?.data?.available === true, `${skills.body?.data?.skills?.length ?? 0} skills`);
  check("skills carry a description (the trigger)", (skills.body?.data?.skills ?? []).every((s) => typeof s.description === "string"));
  check("skills report how they fire", (skills.body?.data?.skills ?? []).every((s) => ["manual", "description"].includes(s.trigger)));

  const prov = await get("/api/providers");
  check("GET /api/providers", prov.status === 200 && Array.isArray(prov.body?.data?.providers), `${prov.body?.data?.providers?.length ?? 0} providers`);
  check("providers expose auth state", (prov.body?.data?.providers ?? []).every((p) => ["oauth", "api_key", "none"].includes(p.auth)));
  check("provider keys are masked", (prov.body?.data?.providers ?? []).filter((p) => p.keyMask).every((p) => p.keyMask.includes("…")));
  const provTest = await post("/api/providers", { op: "test", provider: "definitely-not-a-provider" });
  check("provider test answers even for unknown ids", provTest.status === 200 && !!provTest.body?.data?.status);
  const provBad = await post("/api/providers", { op: "default", provider: "", model: "" });
  check("default model rejects empty args", provBad.status === 400);
  const keyBad = await post("/api/providers", { op: "key", provider: "x", key: "" });
  check("key write rejects empty key", keyBad.status === 400);

  // custom provider validation never writes on failure
  const badId = await post("/api/providers", { op: "add", id: "BAD ID", baseUrl: "http://x" });
  check("custom provider rejects bad id", badId.status === 400);
  const badUrl = await post("/api/providers", { op: "add", id: "ok", baseUrl: "ftp://x" });
  check("custom provider rejects non-http baseUrl", badUrl.status === 400);
  const badApi = await post("/api/providers", { op: "add", id: "ok", baseUrl: "http://x", api: "nope" });
  check("custom provider rejects unknown api", badApi.status === 400);
  const removeBuiltin = await post("/api/providers", { op: "remove", id: "openai" });
  check("built-in providers cannot be removed", removeBuiltin.status === 404);

  const models = await get("/api/models");
  check("GET /api/models", models.status === 200 && Array.isArray(models.body?.data?.models));
  check("models are not empty", (models.body?.data?.models ?? []).length > 0, `${models.body?.data?.models?.length ?? 0} models`);

  /* ---------------- sessions ---------------- */
  const first = state.body.data.activeId;
  const created = await post("/api/session", { op: "new" });
  check("POST session new", created.status === 200 && created.body?.ok);
  const second = created.body?.data?.activeId;
  check("new session id differs", second && second !== first);
  check("session list grew", created.body?.data?.sessions?.length >= 2);

  // a fresh session must land on a real model, not pi's "unknown/unknown"
  const fresh = await get("/api/bootstrap");
  const freshModel = fresh.body?.data?.meta?.model ?? "";
  check("new session resolves a model", Boolean(freshModel) && !freshModel.includes("unknown"), freshModel);
  check("new session model is provider/id", /^[^/]+\/[^/]+$/.test(freshModel), freshModel);

  // a session with no transcript cannot be forked — the server must say so, not 500
  const forkEmpty = await post("/api/session", { op: "fork", id: second });
  check("fork on empty session → 409", forkEmpty.status === 409 && forkEmpty.body?.code === "E_EMPTY", JSON.stringify(forkEmpty.body));

  if (process.env.SMOKE_MODEL === "1") {
    // opt-in: one real turn, then fork it. costs a model call.
    const ran = await post("/api/prompt", { text: "reply with the single word: ok" });
    check("prompt accepted", ran.status === 200, JSON.stringify(ran.body));
    let idle = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const s2 = await get("/api/state");
      if (!s2.body?.data?.meta?.running) {
        idle = true;
        break;
      }
    }
    check("run settles", idle);
    const forked = await post("/api/session", { op: "fork", id: second });
    check("fork after a turn", forked.status === 200 && forked.body?.ok, JSON.stringify(forked.body?.error ?? ""));
  }

  const badRewind = await post("/api/session", { op: "rewind", turn: 99 });
  check("rewind rejects unknown exchanges", badRewind.status === 400 && badRewind.body?.code === "E_TURN");

  const renamed = await post("/api/session", { op: "rename", id: second, name: "SMOKE" });
  check("POST session rename", renamed.status === 200 && renamed.body?.ok);
  check("rename lands in list", renamed.body?.data?.sessions.some((s) => s.id === second && s.name === "SMOKE"));

  /* ---------------- controls ---------------- */
  const think = await post("/api/thinking", { level: "high" });
  check(
    "POST thinking high",
    think.status === 200 && ["off", "low", "medium", "high"].includes(think.body?.data?.thinking),
    JSON.stringify(think.body?.data ?? think.body),
  );
  const thinkBad = await post("/api/thinking", { level: "maximum" });
  check("thinking rejects junk", thinkBad.status === 400);

  const policy = await post("/api/policy", { mode: "risky" });
  check("POST policy risky", policy.status === 200 && policy.body?.data?.policy === "risky");
  const policyBad = await post("/api/policy", { mode: "sometimes" });
  check("policy rejects junk", policyBad.status === 400);
  await post("/api/policy", { mode: "off" });

  const model = models.body.data.models[0];
  const setModel = await post("/api/model", { provider: model.provider, model: model.id });
  check("POST model switches", setModel.status === 200 && setModel.body?.data?.modelId === model.id);
  const badModel = await post("/api/model", { provider: "nope", model: "nope" });
  check("model rejects unknown", badModel.status === 404);

  /* ---------------- guards ---------------- */
  const emptyPrompt = await post("/api/prompt", { text: "   " });
  check("prompt rejects empty", emptyPrompt.status === 400);
  const badApprove = await post("/api/approve", { id: "ap-nope", decision: "approve" });
  check("approve rejects unknown", badApprove.status === 404);
  const badRoute = await get("/api/nope");
  // a missing asset must be a 404, not the HTML shell (that turns a stale tab white)
  const missing = await fetch(`${BASE}/assets/nope-${Date.now()}.js`);
  const missingBody = await missing.text();
  check("missing asset → 404, not HTML", missing.status === 404 && !missingBody.includes("<div id=\"root\">"), `${missing.status} ${missingBody.slice(0, 40)}`);

  check("unknown endpoint 404", badRoute.status === 404);

  /* ---------------- sse ---------------- */
  const hello = await new Promise((resolve) => {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort();
      resolve(null);
    }, 5000);
    fetch(`${BASE}/api/stream`, { signal: ac.signal })
      .then(async (r) => {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const line = buf.split("\n").find((l) => l.startsWith("data: "));
          if (line) {
            clearTimeout(timer);
            ac.abort();
            resolve(JSON.parse(line.slice(6)));
            return;
          }
        }
      })
      .catch(() => resolve(null));
  });
  check("GET /api/stream sends hello", hello?.e === "hello" && Array.isArray(hello?.sessions));
  check("hello carries items", Array.isArray(hello?.items));

  /* ---------------- delete ---------------- */
  const del = await post("/api/session", { op: "delete", id: second });
  check("POST session delete", del.status === 200 && del.body?.ok);
  check("deleted session is gone", !del.body?.data?.sessions.some((s) => s.id === second));
} catch (e) {
  check("test run", false, e.message);
} finally {
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 600));
  child.kill("SIGKILL");
  await rm(dir, { recursive: true, force: true });
}

console.log(results.join("\n"));
console.log(`\n${failures ? `${failures} failing` : "all checks passed"} (${results.length} checks)`);
if (failures) {
  console.error("\n--- server log ---\n" + log.slice(-2000));
  process.exit(1);
}
