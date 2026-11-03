import { useEffect, useState } from "preact/hooks";
import { api, type SkillsResult } from "../../api";
import { getState } from "../../store";
import { shortPath } from "../../format";
import { Icon } from "../../components/Icon";
import { BarButton } from "../../components/ui";

/* --------------------------------------------------------------- skills */
export function SkillsPanel({ meta, policy }: { meta: ReturnType<typeof getState>["meta"]; policy: string }) {
  const [data, setData] = useState<SkillsResult | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .skills()
      .then((d) => {
        setData(d);
        setErr(d.available ? null : d.error ?? "resource loader unavailable");
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);

  const reload = async () => {
    setBusy(true);
    try {
      const d = await api.reloadSkills();
      setData(d);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const skills = data?.skills ?? [];

  return (
    <div class="pv">
      <div class="pv-title">
        {skills.length} SKILLS / {data?.extensions.length ?? 0} EXTENSIONS / {data?.prompts.length ?? 0} PROMPTS
      </div>
      <div class="pv-sub">
        Skills are not tools: pi injects each one into the <b>system prompt</b> only when it decides the skill applies.
        The <code>description</code> below is literally what it matches on — that is the trigger.
      </div>

      {err ? (
        <div class="errbar" style={{ margin: "0 0 8px" }}>
          <Icon name="status-fail" size={13} /> {err}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "var(--gap)", marginBottom: "10px" }}>
        <BarButton tone="ok" label="RELOAD" icon="act-reload" disabled={busy} onClick={reload} />
        <span style={{ font: "400 10px/2.4 var(--mono)", color: "var(--g2)" }}>
          re-reads SKILL.md files, no restart{data?.ms ? ` · last ${data.ms}ms` : ""}
        </span>
      </div>

      {skills.map((sk) => {
        const expanded = openId === sk.name;
        return (
          <div class="sk" key={sk.name}>
            <div class="sk-head" role="button" tabIndex={0} onClick={() => setOpenId(expanded ? null : sk.name)} onKeyDown={(e) => e.key === "Enter" && setOpenId(expanded ? null : sk.name)}>
              <span class="st" data-trigger={sk.trigger} />
              <span class="nm">{sk.name}</span>
              <span class="tg" data-manual={sk.manualOnly ? "1" : "0"}>{sk.manualOnly ? "MANUAL /name" : "AUTO · description"}</span>
              <span class="sz">{sk.bytes ? `${Math.round(sk.bytes / 1024)}K` : ""}</span>
              <span class="acts">
                <button
                  type="button"
                  class="ft-act"
                  title="Copy path"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard?.writeText(sk.path).catch(() => {});
                  }}
                >
                  <Icon name="act-copy" size={10} />
                </button>
                <button
                  type="button"
                  class="ft-act"
                  title="Open SKILL.md"
                  onClick={(e) => {
                    e.stopPropagation();
                    api.openPath(sk.path, "editor").catch(() => {});
                  }}
                >
                  <Icon name="act-open" size={10} />
                </button>
              </span>
            </div>
            {sk.heading ? <div class="sk-heading">{sk.heading}</div> : null}
            <div class={`sk-desc ${expanded ? "open" : ""}`}>{sk.description || "(no description — cannot be auto-invoked)"}</div>
            <div class="sk-path">{shortPath(sk.path)}</div>
          </div>
        );
      })}

      <div class="pv-title" style={{ fontSize: "13px", marginTop: "18px" }}>HOW A SKILL FIRES</div>
      <div class="pv-sub" style={{ maxWidth: "820px" }}>
        <b>AUTO</b> — the model sees every skill's name + description in the system prompt and loads the body only when the
        task matches. You can force one by typing <code>/&lt;name&gt;</code>.<br />
        <b>MANUAL</b> — <code>disableModelInvocation</code> is set; it never auto-fires, only <code>/&lt;name&gt;</code> runs it.<br />
        Extensions ({data?.extensions.length ?? 0}) are different: they register tools and commands, and are listed in SETTINGS.
      </div>

      <div class="pv-title" style={{ fontSize: "13px", marginTop: "14px" }}>RUNTIME</div>
      <div class="pv-row">
        <div class="st" style={{ background: meta?.approvalWired ? "var(--cyan)" : "var(--tomato)" }} />
        <div class="k">APPROVAL</div>
        <div class="v">{meta?.approvalWired ? "inline extension wired" : "not wired — check server log"}</div>
        <div class="n" />
      </div>
      <div class="pv-row">
        <div class="st" style={{ background: "var(--moon)" }} />
        <div class="k">POLICY</div>
        <div class="v">{policy}</div>
        <div class="n" />
      </div>
    </div>
  );
}
