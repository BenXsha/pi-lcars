import { useMemo } from "preact/hooks";
import { Marked } from "marked";

/**
 * Markdown → LCARS HTML for assistant output.
 *
 * Raw HTML in the model output is dropped (not passed through), links get
 * target/rel, and fenced code becomes the same block language the tool strips
 * use: [4px accent][LANG][COPY] + a scrollable body capped at 52vh.
 */
const md = new Marked({ gfm: true, breaks: true });

md.use({
  renderer: {
    // never let model output inject markup
    html: () => "",
    code({ text, lang }) {
      const language = (lang || "").split(/\s+/)[0] || "text";
      const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<div class="codeblk" data-lang="${language}">
  <div class="cb-hd">
    <span class="cb-lang">${language.toUpperCase()}</span>
    <button type="button" class="cb-copy" data-copy>COPY</button>
  </div>
  <pre class="cb-bd"><code>${escaped}</code></pre>
</div>`;
    },
    link({ href, title, text }) {
      const safe = /^(https?:|mailto:|#|\/)/i.test(href || "") ? href : "#";
      const t = title ? ` title="${title.replace(/"/g, "&quot;")}"` : "";
      return `<a href="${safe}"${t} target="_blank" rel="noreferrer noopener">${text}</a>`;
    },
  },
});

export function Markdown({ text, class: cls }: { text: string; class?: string }) {
  const html = useMemo(() => md.parse(text || "") as string, [text]);
  return (
    <div
      class={`md ${cls ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const btn = (e.target as HTMLElement).closest("[data-copy]");
        if (!btn) return;
        const code = btn.closest(".codeblk")?.querySelector("code")?.textContent ?? "";
        navigator.clipboard?.writeText(code).then(
          () => {
            btn.textContent = "COPIED";
            setTimeout(() => (btn.textContent = "COPY"), 1200);
          },
          () => {},
        );
      }}
    />
  );
}
