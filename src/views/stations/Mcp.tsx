import { useEffect, useState } from "preact/hooks";
import { api, type McpConfig } from "../../api";
import { shortPath } from "../../format";
import { Icon } from "../../components/Icon";
import { BarButton, FieldArea, FieldRow } from "../../components/ui";

/* ------------------------------------------------------------------ mcp */
const MCP_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,40}$/i;

const EMPTY_MCP_DRAFT = {
  name: "",
  transport: "auto" as "auto" | "stdio" | "http",
  command: "",
  args: "",
  url: "",
  headers: "",
  env: "",
  dir: "",
  timeout: "",
  description: "",
  exposure: "codemode",
  scope: "global",
};

const EXPOSURE_HINT: Record<string, string> = {
  codemode: "callable from codemode scripts; not declared to the model (default)",
  "codemode-deferred": "alias of codemode",
  deferred: "declared after tool_search loads a match",
  direct: "declared like a built-in tool",
  hidden: "registered but unreachable",
};

/** `[label][choice buttons]` — the same row language as the provider API picker. */
function ChoiceRow(props: { label: string; value: string; options: [string, string][]; onPick: (v: string) => void }) {
  return (
    <div class="pv-form-row">
      <span class="lb">{props.label}</span>
      {props.options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          class="pv-btn"
          data-on={props.value === value ? "1" : "0"}
          onClick={() => props.onPick(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function McpPanel() {
  const [data, setData] = useState<McpConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showTools, setShowTools] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState(EMPTY_MCP_DRAFT);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectNote, setConnectNote] = useState<string | null>(null);

  const load = () =>
    api
      .mcp()
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const totals = data?.totals;

  // "auto" follows whatever was filled first: a URL means http, otherwise stdio
  const transport = draft.transport === "auto" ? (draft.url.trim() ? "http" : "stdio") : draft.transport;
  const isHttp = transport === "http";
  const problem = !MCP_NAME_RE.test(draft.name)
    ? "name: letters, digits, dot, dash, underscore"
    : draft.command.trim() && draft.url.trim()
      ? "fill command (stdio) or url (http), not both"
      : isHttp && !/^https?:\/\//.test(draft.url.trim())
        ? "url: must start with http:// or https://"
        : !isHttp && !draft.command.trim()
          ? "command: required for stdio servers"
          : null;

  return (
    <div class="pv">
      <div class="pv-title">
        {totals?.connected ?? 0} CONNECTED / {totals?.servers ?? 0} SERVERS · {totals?.tools ?? 0} TOOLS
      </div>
      <div class="pv-sub">
        Status is read from the live session: a server counts as connected when its
        <code> mcp__&lt;name&gt;__&lt;tool&gt;</code> tools actually exist. Config edits take effect on the next session.
      </div>

      {err ? (
        <div class="errbar" style={{ margin: "0 0 8px" }}>
          <Icon name="status-fail" size={13} /> {err}
        </div>
      ) : null}

      {data && !data.bound ? (
        <div class="mcp-connect">
          <div class="cc-txt">
            <b>MCP NOT CONNECTED.</b> {data.servers.length} servers configured, 0 tools loaded.
            Connecting binds them into this session — that is what costs a few seconds at startup,
            so it is your call.
          </div>
          <BarButton
            tone="ok"
            label={connecting ? "CONNECTING…" : "CONNECT"}
            icon="act-reload"
            disabled={connecting}
            onClick={async () => {
              setConnecting(true);
              setConnectNote(null);
              try {
                const r = await api.mcpConnect();
                setData(r);
                setConnectNote(
                  r.pending
                    ? `connected ${r.totals.connected}/${r.totals.servers} in ${r.connectMs}ms — the rest reported no tools`
                    : `${r.totals.connected} servers · ${r.totals.tools} tools in ${r.connectMs}ms`,
                );
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setConnecting(false);
              }
            }}
          />
          {connecting ? <span class="cc-wait">this can take a few seconds (stdio servers spawn a process)</span> : null}
        </div>
      ) : null}

      {connectNote ? <div class="pv-note" style={{ color: "var(--cyan)", marginBottom: "8px" }}>{connectNote}</div> : null}

      {(data?.servers ?? []).map((m) => {
        const expanded = open === m.name;
        const allTools = showTools[m.name];
        const tools = allTools ? m.tools : m.tools.slice(0, 6);
        return (
          <div class="mcp-card" key={m.name} data-off={m.enabled ? "0" : "1"} data-live={m.connected ? "1" : "0"}>
            <div class="mcp-head">
              <span class="st" />
              <button type="button" class="mcp-name" onClick={() => setOpen(expanded ? null : m.name)}>
                <Icon name={expanded ? "act-collapse" : "act-expand"} size={10} />
                <b>{m.name}</b>
              </button>
              <span class="tr">{m.transport === "stdio" ? "STDIO" : "HTTP"}</span>
              <span class="ex">{m.exposure}</span>
              <span class="ct">{m.toolCount} TOOLS</span>
              <span class="state">{m.connected ? "LIVE" : m.enabled ? "NO TOOLS" : "OFF"}</span>
              <button
                type="button"
                class="tgl"
                aria-pressed={m.enabled ? "true" : "false"}
                disabled={busy}
                onClick={() => run(() => api.mcpToggle(m.name, !m.enabled))}
              >
                {m.enabled ? "ON" : "OFF"}
              </button>
              <button type="button" class="tgl ghost" disabled={busy} title="Remove server" onClick={() => run(() => api.mcpRemove(m.name))}>
                <Icon name="act-delete" size={11} />
              </button>
            </div>

            <div class="mcp-target">{m.transport === "stdio" ? `${m.command} ${m.args.join(" ")}` : m.url}</div>
            {m.description ? <div class={`mcp-desc ${expanded ? "open" : ""}`}>{m.description}</div> : null}

            {expanded ? (
              <div class="mcp-tools">
                {tools.length === 0 ? <div class="pv-note">no tools registered — check the server is reachable</div> : null}
                {tools.map((t) => (
                  <div class="mcp-tool" key={t.name}>
                    <span class="nm">{t.name}</span>
                    <span class="bd">{t.exposure}</span>
                    <span class="ds" title={t.description}>{t.description || "—"}</span>
                  </div>
                ))}
                {m.tools.length > 6 ? (
                  <button type="button" class="pv-more" onClick={() => setShowTools((s) => ({ ...s, [m.name]: !allTools }))}>
                    {allTools ? "− SHOW LESS" : `+ ${m.tools.length - 6} MORE TOOLS`}
                  </button>
                ) : null}
                <div class="pv-note">
                  {m.scope} config{m.override ? ` · overridden in ${shortPath(m.override)}` : ""} · {m.pinned.length ? `${m.pinned.length} pinned to direct` : "all deferred to the caller"}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      <div class="pv-h">ADD SERVER</div>
      <div class="pv-form" style={{ maxWidth: "820px" }}>
        <FieldRow
          label="NAME"
          icon="station-mcp"
          value={draft.name}
          placeholder="filesystem"
          onInput={(v) => setDraft({ ...draft, name: v })}
          required
          state={draft.name && !MCP_NAME_RE.test(draft.name) ? "error" : "idle"}
          message={draft.name && !MCP_NAME_RE.test(draft.name) ? "letters, digits, dot, dash, underscore" : undefined}
        />
        <ChoiceRow
          label="TRANSPORT"
          value={draft.transport}
          options={[
            ["auto", "AUTO"],
            ["stdio", "STDIO"],
            ["http", "HTTP"],
          ]}
          onPick={(v) => setDraft({ ...draft, transport: v as typeof draft.transport })}
        />

        {!isHttp ? (
          <>
            <FieldRow
              label="COMMAND"
              icon="tool-bash"
              value={draft.command}
              placeholder="npx"
              onInput={(v) => setDraft({ ...draft, command: v })}
              required
            />
            <FieldArea
              label="ARGS"
              icon="fld-args"
              value={draft.args}
              rows={2}
              placeholder="-y @modelcontextprotocol/server-filesystem ~/projects   (or a JSON array)"
              onInput={(v) => setDraft({ ...draft, args: v })}
            />
            <FieldRow
              label="WORKING DIR"
              icon="fld-path"
              value={draft.dir}
              placeholder="optional · absolute, ~/…, or relative to the session"
              onInput={(v) => setDraft({ ...draft, dir: v })}
            />
            <FieldArea
              label="ENV"
              icon="fld-key"
              value={draft.env}
              rows={2}
              placeholder={"GITHUB_TOKEN=${GITHUB_TOKEN}\nAPI_BASE=https://api.example.com"}
              onInput={(v) => setDraft({ ...draft, env: v })}
            />
          </>
        ) : (
          <>
            <FieldRow
              label="URL"
              icon="fld-host"
              value={draft.url}
              placeholder="https://example.com/mcp"
              onInput={(v) => setDraft({ ...draft, url: v })}
              required
            />
            <FieldArea
              label="HEADERS"
              icon="fld-key"
              value={draft.headers}
              rows={2}
              placeholder={"Authorization: Bearer ${DOCS_TOKEN}"}
              onInput={(v) => setDraft({ ...draft, headers: v })}
            />
          </>
        )}

        <FieldRow
          label="TIMEOUT"
          icon="act-time"
          value={draft.timeout}
          placeholder="60"
          unit="SEC"
          onInput={(v) => setDraft({ ...draft, timeout: v })}
        />
        <FieldRow
          label="DESCRIPTION"
          icon="act-info"
          value={draft.description}
          placeholder="one sentence — listed in the system prompt"
          onInput={(v) => setDraft({ ...draft, description: v })}
        />
        <ChoiceRow
          label="EXPOSURE"
          value={draft.exposure}
          options={[
            ["codemode", "CODEMODE"],
            ["deferred", "DEFERRED"],
            ["direct", "DIRECT"],
            ["hidden", "HIDDEN"],
          ]}
          onPick={(v) => setDraft({ ...draft, exposure: v })}
        />
        <span class="form-note">{EXPOSURE_HINT[draft.exposure] ?? ""}</span>
        <ChoiceRow
          label="SCOPE"
          value={draft.scope}
          options={[
            ["global", "GLOBAL"],
            ["project", "PROJECT"],
          ]}
          onPick={(v) => setDraft({ ...draft, scope: v })}
        />
        <span class="form-note">
          {draft.scope === "project"
            ? `written to ${shortPath(data?.paths.project ?? ".pi/mcp.json")} — project servers load after project trust`
            : `written to ${shortPath(data?.paths.global ?? "~/.pi/agent/mcp.json")} with a .bak`}
        </span>

        {addError ? (
          <span class="form-note" data-err="1">
            {addError}
          </span>
        ) : null}

        <div class="form-actions">
          <BarButton
            tone="ok"
            label="ADD"
            icon="act-new"
            disabled={busy || Boolean(problem)}
            onClick={() =>
              run(async () => {
                setAddError(null);
                try {
                  await api.mcpAdd({
                    name: draft.name.trim(),
                    command: isHttp ? undefined : draft.command.trim(),
                    args: isHttp ? undefined : draft.args,
                    url: isHttp ? draft.url.trim() : undefined,
                    headers: isHttp ? draft.headers : undefined,
                    env: isHttp ? undefined : draft.env,
                    dir: isHttp ? undefined : draft.dir,
                    timeout: draft.timeout,
                    description: draft.description,
                    exposure: draft.exposure,
                    scope: draft.scope,
                  });
                  setDraft(EMPTY_MCP_DRAFT);
                } catch (e) {
                  setAddError((e as Error).message);
                }
              })
            }
          />
          <BarButton tone="quiet" label="RELOAD" icon="act-reload" onClick={() => load()} />
          <span class="form-note">{problem ?? "args, env and headers accept one entry per line"}</span>
        </div>
      </div>
    </div>
  );
}
