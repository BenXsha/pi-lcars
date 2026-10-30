import { useEffect, useState } from "preact/hooks";
import { api, type SystemInfo } from "../api";
import { t } from "../i18n";
import { appInfo, npmUrl, repoUrl, type Credit } from "../appInfo";

/** `[4px 条][标签][读数]` — the same row language as the config panels. */
function Fact(props: { k: string; v: string; title?: string; tone?: string }) {
  return (
    <div class="pv-row">
      <span class="st" data-tone={props.tone ?? ""} />
      <span class="k">{props.k}</span>
      <span class="v" title={props.title ?? props.v}>
        {props.v}
      </span>
      <span class="n" />
    </div>
  );
}

function CreditRow(props: Credit) {
  return (
    <div class="about-credit">
      <span class="bar" />
      <span class="nm">{props.name}</span>
      <span class="use">{props.note}</span>
      <span class="ver">{props.version}</span>
      <span class="lic">{props.license}</span>
    </div>
  );
}

function LinkRow(props: { k: string; href: string; label: string }) {
  return (
    <div class="pv-row">
      <span class="st" />
      <span class="k">{props.k}</span>
      <span class="v">
        <a href={props.href} target="_blank" rel="noreferrer noopener">
          {props.label}
        </a>
      </span>
      <span class="n" />
    </div>
  );
}

export function AboutPanel() {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  useEffect(() => {
    api
      .system()
      .then(setSys)
      .catch(() => {});
  }, []);

  const repo = repoUrl(appInfo.repo);

  return (
    <div class="pv about">
      <div class="pv-title">{t("about.title")}</div>
      <div class="pv-sub">
        <b>{appInfo.name}</b> {appInfo.version} · {appInfo.license} ·{" "}
        <a href={npmUrl} target="_blank" rel="noreferrer noopener">
          npm
        </a>
        {repo ? (
          <>
            {" · "}
            <a href={repo} target="_blank" rel="noreferrer noopener">
              {t("about.source")}
            </a>
          </>
        ) : null}
      </div>

      <div class="set-section">{t("about.runtime")}</div>
      <Fact k="NODE" v={sys?.node ?? "—"} />
      <Fact
        k="PI SDK"
        v={sys?.piVersion ?? "—"}
        title={sys?.sdk ?? undefined}
        tone="cyan"
      />
      <Fact k="PLATFORM" v={sys?.platform ?? "—"} />
      <Fact k="WORKSPACE" v={sys?.cwd ?? "—"} title={sys?.cwd ?? undefined} />
      <Fact
        k="ENDPOINT"
        v={sys ? `${appInfo.name.includes("x") ? "127.0.0.1" : "127.0.0.1"}:${sys.port}` : "—"}
        tone="ice"
      />
      <Fact k="POLICY" v={sys?.approvals.policy.toUpperCase() ?? "—"} />

      <div class="set-section">{t("about.build")}</div>
      {appInfo.deps.length ? (
        appInfo.deps.map((d) => <CreditRow key={d.name} {...d} />)
      ) : (
        <div class="about-note quiet">{t("about.devBuild")}</div>
      )}

      <div class="set-section">{t("about.lcars")}</div>
      <p class="about-note">{t("about.lcarsBody")}</p>
      <p class="about-note quiet">{t("about.fanNote")}</p>

      <div class="set-section">{t("about.fonts")}</div>
      <p class="about-note">{t("about.fontsBody")}</p>

      <div class="set-section">{t("about.network")}</div>
      <p class="about-note">{t("about.networkBody")}</p>

      <div class="set-section">{t("about.links")}</div>
      <LinkRow k="NPM" href={npmUrl} label={npmUrl.replace("https://", "")} />
      {repo ? <LinkRow k="SOURCE" href={repo} label={repo.replace("https://", "")} /> : null}
      <LinkRow k="PI" href="https://pi.dev" label="pi.dev" />
    </div>
  );
}
