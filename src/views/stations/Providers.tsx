import {useEffect, useState} from "preact/hooks";
import {api, type ModelInfo, type ProviderRow, type ProvidersResult} from "../../api";
import {actions, getState} from "../../store";
import {fmtTok, shortPath} from "../../format";
import {Icon} from "../../components/Icon";
import {BarButton, FieldRow} from "../../components/ui";
import {imeBusy} from "../../ime";

/* ------------------------------------------------------------ providers */
export function ProvidersPanel({ meta }: { meta: ReturnType<typeof getState>["meta"] }) {
  const [data, setData] = useState<ProvidersResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, ModelInfo[]>>({});
  const [tests, setTests] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ id: "", name: "", baseUrl: "", api: "openai-completions", apiKey: "", models: "" });

  const load = () =>
    api
      .providers()
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);

  const configured = (data?.providers ?? []).filter((p) => p.auth !== "none");
  const others = (data?.providers ?? []).filter((p) => p.auth === "none");

  const toggle = async (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (next && !models[id]) {
      setBusy(id);
      try {
        setModels((m) => ({ ...m, [id]: [] }));
        const list = await api.providerModels(id);
        setModels((m) => ({ ...m, [id]: list }));
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(null);
      }
    }
  };

  const test = async (id: string) => {
    setBusy(`t:${id}`);
    try {
      const r = await api.providerTest(id);
      setTests((t) => ({ ...t, [id]: `${r.status.toUpperCase()} · ${r.ms}ms${r.reason ? ` · ${r.reason}` : ""}` }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: `ERROR · ${(e as Error).message}` }));
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async (id: string) => {
    const key = (keys[id] ?? "").trim();
    if (!key) return;
    setBusy(`k:${id}`);
    try {
      await api.providerKey(id, key);
      setKeys((k) => ({ ...k, [id]: "" }));
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const row = (p: ProviderRow, dim = false) => {
    const expanded = open === p.id;
    return (
      <div class="pv-card" key={p.id} data-dim={dim ? "1" : "0"}>
        <div class="pv-head" role="button" tabIndex={0} onClick={() => toggle(p.id)} onKeyDown={(e) => e.key === "Enter" && toggle(p.id)}>
          <span class="st" data-auth={p.auth} />
          <Icon name="station-provider" size={12} />
          <span class="nm">{p.name}</span>
          <span class="at">{p.auth === "none" ? "no key" : p.auth === "oauth" ? "oauth" : p.keyMask ?? "api key"}</span>
          <span class="ct">{p.models} models</span>
          {p.custom ? <span class="cur custom">CUSTOM</span> : null}
          {p.current ? <span class="cur">ACTIVE</span> : null}
          {p.auth !== "none" ? (
            <button
              type="button"
              class="pv-btn"
              disabled={busy === `t:${p.id}`}
              onClick={(e) => {
                e.stopPropagation();
                test(p.id);
              }}
            >
              TEST
            </button>
          ) : null}
        </div>
        {tests[p.id] ? <div class={`pv-test ${tests[p.id].startsWith("READY") ? "ok" : ""}`}>{tests[p.id]}</div> : null}

        {expanded ? (
          <div class="pv-body">
            {busy === p.id ? <div class="pv-note">loading models…</div> : null}
            {(models[p.id] ?? []).slice(0, 24).map((m) => (
              <div class="pv-model" key={m.id}>
                <span class="nm">{m.id}</span>
                <span class="cx">{m.contextWindow ? fmtTok(m.contextWindow) : "—"}</span>
                <button
                  type="button"
                  class="pv-btn"
                  onClick={async () => {
                    await actions.setModel(m.provider, m.id);
                    load();
                  }}
                >
                  USE
                </button>
                <button
                  type="button"
                  class="pv-btn ghost"
                  onClick={async () => {
                    try {
                      await api.providerDefault(m.provider, m.id);
                      await load();
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  DEFAULT
                </button>
              </div>
            ))}

            {p.baseUrl ? <div class="pv-note">baseUrl <code>{p.baseUrl}</code></div> : null}
            {p.custom ? (
              <div style={{ display: "flex", gap: "var(--gap)", marginTop: "4px" }}>
                <button
                  type="button"
                  class="pv-btn ghost"
                  onClick={async () => {
                    try {
                      await api.providerRemove(p.id);
                      await api.providerReload();
                      await load();
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  REMOVE PROVIDER
                </button>
                <span class="pv-note" style={{ alignSelf: "center" }}>defined in models.json</span>
              </div>
            ) : null}
            <div class="pv-key">
              <span class="lb">{p.auth === "none" ? "ADD API KEY" : "REPLACE KEY"}</span>
              <input
                type="password"
                value={keys[p.id] ?? ""}
                placeholder={p.keyMask ?? "sk-…"}
                onInput={(e) => setKeys((k) => ({ ...k, [p.id]: (e.target as HTMLInputElement).value }))}
                onKeyDown={(e) => !imeBusy(e) && e.key === "Enter" && saveKey(p.id)}
              />
              <button type="button" class="pv-btn" disabled={busy === `k:${p.id}` || !(keys[p.id] ?? "").trim()} onClick={() => saveKey(p.id)}>
                SAVE
              </button>
            </div>
            <div class="pv-note">
              written to <code>{data?.files.auth ? shortPath(data.files.auth) : "~/.pi/agent/auth.json"}</code> with a .bak
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div class="pv">
      <div class="pv-title">
        {configured.length} CONFIGURED / {(data?.providers ?? []).length} KNOWN
      </div>
      <div class="pv-sub">
        Default for new sessions: <code>{data?.defaultProvider ?? "—"} / {data?.defaultModel ?? "—"}</code>. A model switched here applies to
        the next turn; DEFAULT writes it to <code>settings.json</code>.
      </div>
      {err ? (
        <div class="errbar" style={{ margin: "0 0 8px" }}>
          <Icon name="status-fail" size={13} /> {err}
        </div>
      ) : null}

      {configured.map((p) => row(p))}

      {others.length ? (
        <>
          <button type="button" class="pv-more" onClick={() => setMore(!more)}>
            {more ? "− HIDE" : "+ SHOW"} {others.length} PROVIDERS WITHOUT A KEY
          </button>
          {more ? others.map((p) => row(p, true)) : null}
        </>
      ) : null}

      <div class="pv-h">ADD CUSTOM PROVIDER</div>
      <div class="pv-sub" style={{ marginBottom: "8px", maxWidth: "760px" }}>
        Any OpenAI-, Anthropic- or Google-compatible endpoint can be added by base URL. Models are just ids — pi learns
        capabilities when it first calls them. Setting only <code>baseUrl</code> for an id that already exists routes that
        built-in provider through a proxy.
      </div>
      {!adding ? (
        <button type="button" class="add-row" onClick={() => setAdding(true)}>
          <span class="ic">
            <Icon name="act-new" size={13} />
          </span>
          <span class="lb">NEW PROVIDER</span>
          <span class="hint">models.json</span>
        </button>
      ) : (
        <div class="pv-form">
          <FieldRow label="ID" icon="station-provider" value={draft.id} placeholder="local-proxy" onInput={(v) => setDraft({ ...draft, id: v })} required />
          <FieldRow label="NAME" icon="station-provider" value={draft.name} placeholder="Local Proxy" onInput={(v) => setDraft({ ...draft, name: v })} />
          <FieldRow
            label="BASE URL"
            icon="fld-url"
            value={draft.baseUrl}
            placeholder="http://127.0.0.1:11434/v1"
            onInput={(v) => setDraft({ ...draft, baseUrl: v })}
            required
            unit="V1"
          />
          <div class="pv-form-row">
            <span class="lb">API</span>
            {[
              ["openai-completions", "CHAT"],
              ["openai-responses", "RESPONSES"],
              ["anthropic-messages", "ANTHROPIC"],
              ["google-generative-ai", "GOOGLE"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                class="pv-btn"
                title={value}
                data-on={draft.api === value ? "1" : "0"}
                onClick={() => setDraft({ ...draft, api: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <FieldRow label="API KEY" icon="fld-key" value={draft.apiKey} placeholder="sk-… or $ENV_VAR" onInput={(v) => setDraft({ ...draft, apiKey: v })} mask />
          <FieldRow
            label="MODELS"
            icon="fld-model"
            value={draft.models}
            placeholder="qwen2.5-coder:7b, llama-3.3-70b"
            onInput={(v) => setDraft({ ...draft, models: v })}
          />
          <div class="form-actions">
            <BarButton
              tone="ok"
              label="ADD"
              icon="act-new"
              disabled={busy === "add" || !draft.id || !draft.baseUrl}
              onClick={async () => {
                setBusy("add");
                try {
                  await api.providerAdd(draft);
                  const r = await api.providerReload();
                  await load();
                  setAdding(false);
                  setDraft({ id: "", name: "", baseUrl: "", api: "openai-completions", apiKey: "", models: "" });
                  setErr(r.reloaded ? null : "saved, but the runtime did not reload — restart the session");
                } catch (e) {
                  setErr((e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            />
            <BarButton tone="quiet" label="CANCEL" icon="act-close" onClick={() => setAdding(false)} />
          </div>
          <span class="form-note">writes models.json with a .bak, then reloads the model runtime</span>
        </div>
      )}

      <div class="pv-note" style={{ marginTop: "12px" }}>
        Session model: <code>{meta?.model ?? "—"}</code> · keys are masked on read and never sent back from the server
      </div>
    </div>
  );
}
