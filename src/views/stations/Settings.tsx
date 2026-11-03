import { useEffect, useMemo, useState } from "preact/hooks";
import { api, type BackdropDir, type BackdropImage, type Item, type SystemInfo } from "../../api";
import { actions, getState } from "../../store";
import { THEMES, type ThemeId } from "../../theme";
import { getSettings, setSettings, subscribeSettings, touchBackdrop } from "../../settings";
import { t } from "../../i18n";
import { fmtSize, shortPath } from "../../format";
import { Icon } from "../../components/Icon";
import { BarButton, PickRow } from "../../components/ui";
import { imeBusy } from "../../ime";

/* ------------------------------------------------------------- settings */
const SHORTCUTS: [string, string][] = [
  ["⌥1 – ⌥6  /  Alt 1 – Alt 6", "switch station (the numbers on the rail)"],
  ["⌥0  /  Alt 0", "back to the mission log"],
  ["⌘K / Ctrl K", "focus the composer"],
  ["ENTER", "send (steer while running)"],
  ["SHIFT+ENTER", "newline"],
  ["ESC", "stop the current run"],
  ["⌘B / Ctrl B", "collapse or expand the left rail"],
  ["⌘⇧B / Ctrl ⇧B", "collapse or expand the resources rail"],
];

/**
 * Backdrop picker. Deliberately not workspace-scoped: an operator's stills live
 * wherever they live (Pictures, Desktop, an external volume), so this browses
 * the real filesystem. The server streams the chosen file from its original
 * path — nothing is copied into the project, and deleting the file simply turns
 * the backdrop off.
 */
function BackdropPicker({
  current,
  onUse,
  onClose,
}: {
  current: string;
  onUse: (path: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<BackdropDir | null>(null);
  const [sel, setSel] = useState<BackdropImage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = (dir?: string) => {
    api
      .backdrop(dir)
      .then((d) => {
        setData(d);
        setSel(null);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  // Escape closes the picker only — the applied backdrop is not touched.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || imeBusy(e)) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const path = data?.path ?? "";
  // keep the separators so POSIX and Windows paths both split into prefixes
  const parts = path.split(/(?<=[\\/])/).filter(Boolean);
  const crumbPath = (i: number) => parts.slice(0, i + 1).join("");

  return (
    <div class="bd-browse">
      <div class="hd">
        <span class="lb">{t("bd.pickTitle")}</span>
        <span class="sub">{t("bd.pickSub")}</span>
      </div>

      <div class="ws-crumbs">
        {parts.map((seg, i) => (
          <button type="button" class="ws-crumb" key={crumbPath(i)} onClick={() => load(crumbPath(i))}>
            {seg.replace(/[\\/]$/, "") || seg}
          </button>
        ))}
      </div>

      <div class="ws-recent">
        <span class="lb">{t("bd.goTo")}</span>
        {(data?.roots ?? []).map((r) => (
          <button type="button" key={r.path} class="ws-chip" onClick={() => load(r.path)}>
            {r.label}
          </button>
        ))}
      </div>

      {err ? <div class="bd-empty" style={{ color: "var(--tomato)" }}>{err}</div> : null}

      <div class="bd-scroll">
        {(data?.dirs ?? []).map((d) => (
          <PickRow key={d.path} icon="fld-path" name={d.name} onClick={() => load(d.path)} />
        ))}
        {(data?.images ?? []).length ? (
          <div class="bd-imgs">
            {(data?.images ?? []).map((img) => (
              <button
                type="button"
                key={img.path}
                class="bd-img"
                aria-selected={sel?.path === img.path ? "true" : "false"}
                title={img.path}
                onClick={() => setSel(img)}
              >
                <span class="st" />
                <span class="th" style={{ backgroundImage: `url("${api.backdropUrl(img.path, img.mtime)}")` }} />
                <span class="nm">{img.name}</span>
                <span class="mt">{fmtSize(img.size)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div class="bd-empty">{t("bd.noImages")}</div>
        )}
        {data?.truncated ? <div class="bd-empty">{t("bd.truncated")}</div> : null}
      </div>

      <div class="bd-foot">
        <span class="picked" title={sel?.path ?? current}>
          {sel ? shortPath(sel.path) : current ? shortPath(current) : t("bd.none")}
        </span>
        <button type="button" class="pv-btn ghost" disabled={!data?.parent} onClick={() => data?.parent && load(data.parent)}>
          {t("bd.up")}
        </button>
        <button type="button" class="pv-btn ghost" onClick={onClose}>
          {t("bd.cancel")}
        </button>
        <button type="button" class="pv-btn" disabled={!sel} onClick={() => sel && onUse(sel.path)}>
          {t("bd.use")}
        </button>
      </div>
    </div>
  );
}

export function SettingsPanel({
  items,
  meta,
  policy,
  theme,
  onTheme,
}: {
  items: Item[];
  meta: ReturnType<typeof getState>["meta"];
  policy: string;
  theme: ThemeId;
  onTheme: (id: ThemeId) => void;
}) {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [, force] = useState(0);
  const prefs = getSettings();

  useEffect(() => subscribeSettings(() => force((n) => n + 1)), []);
  useEffect(() => {
    api.system().then(setSys).catch(() => {});
  }, []);

  // per-tool call stats for the loadout chips (S9: usage without a new station)
  const toolStats = useMemo(() => {
    const acc = new Map<string, { n: number; ms: number; err: number }>();
    for (const it of items) {
      if (it.kind !== "tool") continue;
      const cur = acc.get(it.name) ?? { n: 0, ms: 0, err: 0 };
      cur.n += 1;
      if (typeof it.ms === "number") cur.ms += it.ms;
      if (it.status === "error") cur.err += 1;
      acc.set(it.name, cur);
    }
    return acc;
  }, [items]);

  const flash = (m: string) => {
    setNote(m);
    setTimeout(() => setNote(null), 1400);
  };

  const row = (k: string, v: string, acts?: any) => (
    <div class="set-row" key={k}>
      <span class="k">{k}</span>
      <span class="v" title={v}>
        {v}
      </span>
      <span class="a">{acts}</span>
    </div>
  );

  const copy = (text: string, label: string) =>
    navigator.clipboard?.writeText(text).then(
      () => flash(`copied ${label}`),
      () => flash("clipboard blocked"),
    );

  return (
    <div class="pv">
      <div class="pv-title">{t("set.title")}</div>
      <div class="pv-sub">{t("set.note")}</div>

      <div class="set-section">{t("set.appearance")}</div>

      <div class="set-block">
        <span class="lb">{t("set.theme")}</span>
        <div class="set-themes">
          {THEMES.map((th) => (
            <button
              type="button"
              key={th.id}
              class="theme-opt mini"
              aria-selected={theme === th.id ? "true" : "false"}
              onClick={() => onTheme(th.id)}
            >
              <span class="sw">
                {th.swatch.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <span class="nm">{th.short}</span>
            </button>
          ))}
        </div>
      </div>

      <div class="set-block" data-open={picking ? "1" : "0"}>
        <span class="lb">{t("set.backdrop")}</span>
        <div>
          <div class="bd-row">
            <span
              class="bd-thumb"
              data-empty={prefs.backdrop ? "0" : "1"}
              style={prefs.backdrop ? { backgroundImage: `url("${api.backdropUrl(prefs.backdrop)}")` } : undefined}
            >
              {prefs.backdrop ? null : <Icon name="fld-image" size={13} />}
            </span>
            <span class="bd-path" data-empty={prefs.backdrop ? "0" : "1"} title={prefs.backdrop || t("bd.none")}>
              {prefs.backdrop ? shortPath(prefs.backdrop) : t("bd.none")}
            </span>
            <span class="bd-acts">
              <button type="button" class="pv-btn" data-bd-choose="1" onClick={() => setPicking((v) => !v)}>
                {prefs.backdrop ? t("bd.change") : t("bd.choose")}
              </button>
              {prefs.backdrop ? (
                <button
                  type="button"
                  class="pv-btn ghost"
                  onClick={() => {
                    setSettings({ backdrop: "" });
                    setPicking(false);
                    flash(t("bd.cleared"));
                  }}
                >
                  {t("bd.clear")}
                </button>
              ) : null}
            </span>
          </div>

          {picking ? (
            <BackdropPicker
              current={prefs.backdrop}
              onClose={() => setPicking(false)}
              onUse={(path) => {
                setSettings({ backdrop: path });
                touchBackdrop();
                setPicking(false);
                flash(`${t("bd.applied")} · ${shortPath(path)}`);
              }}
            />
          ) : null}
        </div>
      </div>

      <div class="set-block">
        <span class="lb">{t("set.scale")}</span>
        <div class="seg small">
          {([0.9, 1, 1.1] as const).map((v) => (
            <button type="button" key={v} aria-pressed={prefs.scale === v ? "true" : "false"} onClick={() => setSettings({ scale: v })}>
              {Math.round(v * 100)}%
            </button>
          ))}
        </div>
      </div>

      <div class="set-block">
        <span class="lb">{t("set.motion")}</span>
        <div class="seg small">
          <button type="button" aria-pressed={prefs.motion === "system" ? "true" : "false"} onClick={() => setSettings({ motion: "system" })}>
            SYSTEM
          </button>
          <button type="button" aria-pressed={prefs.motion === "reduced" ? "true" : "false"} onClick={() => setSettings({ motion: "reduced" })}>
            REDUCED
          </button>
        </div>
      </div>

      <div class="set-block">
        <span class="lb">{t("set.locale")}</span>
        <div class="seg small">
          <button type="button" aria-pressed={prefs.locale === "en" ? "true" : "false"} onClick={() => setSettings({ locale: "en" })}>
            EN
          </button>
          <button type="button" aria-pressed={prefs.locale === "zh" ? "true" : "false"} onClick={() => setSettings({ locale: "zh" })}>
            中文
          </button>
        </div>
      </div>

      <div class="set-section">{t("set.runtime")}</div>
      {row(
        "PI SDK",
        sys?.sdk ? shortPath(sys.sdk) : "—",
        <>
          <button type="button" class="pv-btn ghost" onClick={() => sys?.sdk && copy(sys.sdk, "sdk path")}>COPY</button>
          <button type="button" class="pv-btn ghost" onClick={() => sys?.sdk && api.openPath(sys.sdk, "reveal").catch(() => {})}>REVEAL</button>
        </>,
      )}
      {row("VERSION", `${sys?.piVersion ?? "—"} · node ${sys?.node ?? "—"}`)}
      {row("PLATFORM", sys?.platform ?? "—")}
      {row(
        "AGENT DIR",
        sys?.agentDir ? shortPath(sys.agentDir) : "—",
        <>
          <button type="button" class="pv-btn ghost" onClick={() => sys?.agentDir && copy(sys.agentDir, "agent dir")}>COPY</button>
          <button type="button" class="pv-btn ghost" onClick={() => sys?.agentDir && api.openPath(sys.agentDir, "reveal").catch(() => {})}>REVEAL</button>
        </>,
      )}
      {row("WORKSPACE", sys?.cwd ? shortPath(sys.cwd) : "—")}
      {row("SERVER", `127.0.0.1:${sys?.port ?? "—"} · MCP ${sys?.mcpEnabled ? "on" : "off"}`)}

      <div class="set-section">{t("set.keys")}</div>
      <div class="set-keys">
        {SHORTCUTS.map(([k, d]) => (
          <div class="set-key" key={k}>
            <kbd>{k}</kbd>
            <span>{d}</span>
          </div>
        ))}
      </div>

      <div class="set-section">{t("set.policy")}</div>
      <div style={{ display: "flex", gap: "var(--gap)", alignItems: "center", marginBottom: "10px" }}>
        {(["off", "risky", "all"] as const).map((m) => (
          <BarButton key={m} label={m.toUpperCase()} tone={policy === m ? "ok" : "quiet"} onClick={() => actions.policy(m)} />
        ))}
        <span class="pv-note">risky = bash / write / edit · pending calls are released on abort</span>
      </div>

      <div class="set-section">{t("set.tools")} / {meta?.tools.length ?? 0}</div>
      <div class="set-tools">
        {(meta?.tools ?? []).map((n) => {
          const st = toolStats.get(n);
          return (
            <span class="set-tool" key={n} data-used={st ? "1" : "0"}>
              {n}
              {st ? (
                <em data-err={st.err ? "1" : "0"}>
                  {st.n}× · {st.ms ? `${Math.round(st.ms / st.n)}ms` : "—"}
                  {st.err ? ` · ${st.err} err` : ""}
                </em>
              ) : null}
            </span>
          );
        })}
      </div>
      <span class="pv-note">
        {toolStats.size} of {(meta?.tools ?? []).length} tools used this session ·{" "}
        {[...toolStats.values()].reduce((n, v) => n + v.n, 0)} calls ·{" "}
        {[...toolStats.values()].reduce((n, v) => n + v.err, 0)} errors
      </span>

      {note ? <div class="ft-note" style={{ marginTop: "10px" }}>{note}</div> : null}
    </div>
  );
}
