#!/usr/bin/env node
/**
 * MCP config writer tests — temp dirs only, never the real ~/.pi/agent.
 *
 *   node test/mcp-config.mjs
 *
 * Covers the fields the ADD form can set (args / env / cwd / headers / timeout /
 * description / exposure / scope), the parsers behind them, and the rule that
 * secret values are never echoed back to the client.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addServer, parseArgs, parsePairs, readMcp, removeServer, setEnabled } from "../server/pi/mcpConfig.mjs";

let failures = 0;
const results = [];
function check(name, cond, detail = "") {
  const ok = !!cond;
  if (!ok) failures++;
  results.push(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const tmp = await mkdtemp(join(tmpdir(), "lcars-mcp-"));
const agentDir = join(tmp, "agent");
const cwd = join(tmp, "ws");
const ctx = { agentDir, cwd };

try {
  /* ------------------------------------------------------------ parsers */
  check("args: whitespace split", JSON.stringify(parseArgs("-y  pkg  .")) === JSON.stringify(["-y", "pkg", "."]));
  check("args: quotes survive spaces", JSON.stringify(parseArgs('--flag "two words" x')) === JSON.stringify(["--flag", "two words", "x"]));
  check("args: JSON array", JSON.stringify(parseArgs('["-y","@mcp/server","."]')) === JSON.stringify(["-y", "@mcp/server", "."]));
  check("args: empty", parseArgs("   ").length === 0);

  let threw = null;
  try {
    parseArgs('--flag "unterminated');
  } catch (e) {
    threw = e;
  }
  check("args: unterminated quote is an error", threw?.status === 400, threw?.message);

  threw = null;
  try {
    parseArgs("[not json");
  } catch (e) {
    threw = e;
  }
  check("args: broken JSON is an error", threw?.status === 400, threw?.message);

  const env = parsePairs("API_KEY=abc\n# comment\nEMPTY=\n  BASE=https://x/y ", "env");
  check("env: KEY=VALUE lines", env?.API_KEY === "abc" && env?.BASE === "https://x/y" && env?.EMPTY === "");

  const headers = parsePairs("Authorization: Bearer ${DOCS_TOKEN}\nX-Trace:1", "headers");
  check("headers: Name: value lines", headers?.Authorization === "Bearer ${DOCS_TOKEN}" && headers?.["X-Trace"] === "1");

  threw = null;
  try {
    parsePairs("NO_SEPARATOR", "env");
  } catch (e) {
    threw = e;
  }
  check("env: a line without = is an error", /line 1/.test(threw?.message ?? ""), threw?.message);

  /* ------------------------------------------------------ stdio server */
  const secret = "sk-live-do-not-echo";
  await addServer({
    ...ctx,
    name: "fs-local",
    command: "npx",
    args: "-y @modelcontextprotocol/server-filesystem ~/projects",
    env: `API_KEY=${secret}\nBASE_URL=https://api.example.com`,
    dir: "~/projects",
    timeout: "90",
    description: "Read and search the local projects tree",
    exposure: "deferred",
    scope: "global",
  });

  const global = JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8"));
  const entry = global.mcpServers["fs-local"];
  check("stdio: command written", entry?.command === "npx", entry?.command);
  check("stdio: args parse from a string", JSON.stringify(entry?.args) === JSON.stringify(["-y", "@modelcontextprotocol/server-filesystem", "~/projects"]), JSON.stringify(entry?.args));
  check("stdio: env written", entry?.env?.API_KEY === secret && entry?.env?.BASE_URL === "https://api.example.com");
  check("stdio: cwd written", entry?.cwd === "~/projects", entry?.cwd);
  check("stdio: timeout written as a number", entry?.timeout === 90, String(entry?.timeout));
  check("stdio: description written", entry?.description === "Read and search the local projects tree");
  check("stdio: exposure written", entry?.exposure === "deferred", entry?.exposure);

  const listed = await readMcp(ctx);
  const row = listed.servers.find((s) => s.name === "fs-local");
  check("read: transport reported", row?.transport === "stdio");
  check("read: optional fields surfaced", row?.timeout === 90 && row?.dir === "~/projects" && row?.envKeys === 2, JSON.stringify({ t: row?.timeout, d: row?.dir, e: row?.envKeys }));
  check("read: secret values never leave the server", !JSON.stringify(listed).includes(secret));

  /* ------------------------------------------------------- http server */
  await addServer({
    ...ctx,
    name: "docs-remote",
    url: "https://example.com/mcp",
    headers: "Authorization: Bearer ${DOCS_TOKEN}",
    timeout: 30,
    exposure: "direct",
  });
  const doc = JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8"));
  check("http: url + headers", doc.mcpServers["docs-remote"]?.url === "https://example.com/mcp" && doc.mcpServers["docs-remote"]?.headers?.Authorization === "Bearer ${DOCS_TOKEN}");
  check("http: no stdio keys", !("command" in doc.mcpServers["docs-remote"]) && !("args" in doc.mcpServers["docs-remote"]));
  check("http: header count surfaced", (await readMcp(ctx)).servers.find((s) => s.name === "docs-remote")?.headerKeys === 1);

  /* --------------------------------------------------------- project scope */
  await addServer({ ...ctx, name: "proj-only", command: "uvx", args: "tools-mcp", scope: "project" });
  const projDoc = JSON.parse(await readFile(join(cwd, ".pi", "mcp.json"), "utf8"));
  check("project scope writes .pi/mcp.json", projDoc.mcpServers["proj-only"]?.command === "uvx");
  check("project scope keeps the agent file clean", !(JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8")).mcpServers["proj-only"]));

  /* ------------------------------------------------------------ rejects */
  const rejects = [];
  for (const [label, payload] of [
    ["bad name", { name: "Bad Name" }],
    ["no transport", { name: "empty" }],
    ["both transports", { name: "both", command: "npx", url: "https://x/mcp" }],
    ["bad exposure", { name: "expo", command: "npx", exposure: "loud" }],
    ["bad timeout", { name: "slow", command: "npx", timeout: "0" }],
    ["bad header line", { name: "hdr", url: "https://x/mcp", headers: "no-colon" }],
    ["duplicate name", { name: "fs-local", command: "npx" }],
  ]) {
    let e = null;
    try {
      await addServer({ ...ctx, ...payload });
    } catch (err) {
      e = err;
    }
    rejects.push([label, e]);
  }
  check(
    "invalid payloads are rejected with E_MCP",
    rejects.every(([, e]) => e && (e.status === 400 || e.status === 409) && e.code === "E_MCP"),
    rejects.map(([l, e]) => `${l}:${e?.status ?? "accepted"}`).join(" "),
  );

  /* ------------------------------------------------------ enable / remove */
  await setEnabled({ ...ctx, name: "docs-remote", enabled: false });
  check("toggle writes enabled:false", JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8")).mcpServers["docs-remote"].enabled === false);
  const left = await removeServer({ ...ctx, name: "docs-remote" });
  check("remove drops the entry", !(await readMcp(ctx)).servers.some((s) => s.name === "docs-remote"), left.removed.join(","));
} finally {
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed (${results.length} checks)`);
process.exit(failures ? 1 : 0);
