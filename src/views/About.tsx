import { useEffect, useState } from "preact/hooks";
import { api, type SystemInfo } from "../api";
import { t } from "../i18n";
import { appInfo, authorEmail, npmUrl, repoUrl, uiBuildStamp, type Author, type Credit } from "../appInfo";
import { DECO_CANDIDATES, decoFace } from "../fonts";
import { FONT_PACK, FONT_PACK_BYTES, type FontPackEntry } from "../fontPack";
import { fmtSize } from "../components/ui";

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

/* font rows reuse the credit grid: [bar][family + weights][role][bytes][licence] */
function FontRow(props: { font: FontPackEntry }) {
  const { font } = props;
  const role =
    font.role === "instrument"
      ? t("about.roleInstrument")
      : font.role === "deco"
        ? t("about.roleDeco")
        : t("about.roleCode");
  return (
    <div class="about-credit fontrow">
      <span class="bar" />
      <span class="nm" title={`${font.family} ${font.weights.join("/")} — ${font.project}`}>
        {font.family} <span class="wt">{font.weights.join(" / ")}</span>
      </span>
      <span class="use">{role}</span>
      <span class="ver">{fmtSize(font.bytes)}</span>
      <span class="lic">{font.license}</span>
    </div>
  );
}

/**
 * Spam has to scrape, people can click. The address is printed as
 * `name [at] host` and never as a `mailto:` — that href is exactly the token a
 * harvester collects — while a click hands the real string to the clipboard.
 * The literal never sits in the DOM, and the bundle carries only the two halves
 * (see `Author`), so a regex over either finds nothing to harvest.
 */
function AuthorBlock(props: { author: Author }) {
  const { author } = props;
  const [copied, setCopied] = useState(false);
  const address = authorEmail(author);
  const copyEmail = () => {
    if (!address) return;
    navigator.clipboard?.writeText(address).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };
  return (
    <div class="about-author">
      <span class="bar" />
      <span class="nm">{author.name}</span>
      <span class="role">{t("about.authorRole")}</span>
      {author.email ? (
        <button
          type="button"
          class="mail"
          data-copied={copied ? "1" : undefined}
          title={t("about.copyEmail")}
          onClick={copyEmail}
        >
          {copied ? t("about.emailCopied") : `${author.email.local} [at] ${author.email.domain}`}
        </button>
      ) : author.url ? (
        <a class="mail" href={author.url} target="_blank" rel="noreferrer noopener">
          {author.url}
        </a>
      ) : (
        <span class="mail quiet">—</span>
      )}
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
  const [deco, setDeco] = useState<string | null>(null);
  useEffect(() => {
    api
      .system()
      .then(setSys)
      .catch(() => {});
    // measured, not assumed: wrong answer here would be a fake readout. It waits
    // for the bundled woff2, so a slow first paint cannot report the fallback.
    let live = true;
    void decoFace().then((face) => {
      if (live) setDeco(face);
    });
    return () => {
      live = false;
    };
  }, []);

  const repo = repoUrl(appInfo.repo);

  return (
    <div class="pv about">
      <div class="pv-title">{t("about.title")}</div>
      <div class="pv-sub">
        <b>{appInfo.name}</b> {uiBuildStamp()} · {appInfo.license} ·{" "}
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
      <Fact k={t("about.uiVersion")} v={appInfo.version} tone="orange" />
      <Fact k={t("about.uiBuild")} v={`${appInfo.builtAt} · ${appInfo.commit ? "git " + appInfo.commit : "no git"}`} />
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

      <div class="set-section">{t("about.author")}</div>
      {appInfo.author ? (
        <AuthorBlock author={appInfo.author} />
      ) : (
        <div class="about-note quiet">{t("about.noAuthor")}</div>
      )}

      <div class="set-section">{t("about.lcars")}</div>
      <p class="about-note">{t("about.lcarsBody")}</p>
      <p class="about-note quiet">{t("about.fanNote")}</p>

      <div class="set-section">{t("about.fonts")}</div>
      <p class="about-note">{t("about.fontsBody")}</p>
      {FONT_PACK.map((font) => (
        <FontRow key={font.family} font={font} />
      ))}
      {/* two real readouts: what actually shipped, and which face is rendering */}
      <Fact
        k={t("about.fontPayload")}
        v={`${FONT_PACK.reduce((n, f) => n + f.weights.length, 0)} woff2 · ${fmtSize(FONT_PACK_BYTES)}`}
        title={`${t("about.fontLicences")}: public/fonts/OFL-*.txt`}
      />
      <Fact
        k={t("about.deco")}
        tone={deco ? "ice" : ""}
        v={deco ?? t("about.decoNone")}
        title={deco ?? `${t("about.decoNone")} — ${DECO_CANDIDATES.join(" / ")}`}
      />

      <div class="set-section">{t("about.network")}</div>
      <p class="about-note">{t("about.networkBody")}</p>

      <div class="set-section">{t("about.links")}</div>
      <LinkRow k="NPM" href={npmUrl} label={npmUrl.replace("https://", "")} />
      {repo ? <LinkRow k="SOURCE" href={repo} label={repo.replace("https://", "")} /> : null}
      <LinkRow k="PI" href="https://pi.dev" label="pi.dev" />
    </div>
  );
}
