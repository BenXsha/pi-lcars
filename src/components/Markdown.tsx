import { useMemo } from "preact/hooks";
import { Marked } from "marked";
import { highlight } from "../highlight";

/**
 * Markdown → LCARS HTML.
 *
 * Two dialects, because the same parser was answering two different questions:
 *
 *   CHAT (breaks: true)  — streaming assistant output. A lone newline really is
 *                          a line break there; the model writes short lines.
 *   DOC  (breaks: false) — a `.md` file opened in the viewer. CommonMark/GitHub
 *                          fold soft-wrapped lines into one paragraph; keeping
 *                          `breaks` here turned every hard-wrapped README into
 *                          a column of <br>s, which reads as double spacing.
 *
 * Raw HTML in the source is dropped (never passed through), links get
 * target/rel, fenced code becomes the same block language the tool strips use
 * ([LANG][COPY] + a scrollable body capped at 52vh), and tables get a scroll
 * wrapper so a wide table cannot stretch the message column.
 */

/** marked's renderer object; `this.parser` is only valid in function form */
type Ctx = { parser: { parseInline(tokens: unknown[]): string } };

function build(breaks: boolean) {
  const md = new Marked({ gfm: true, breaks });
  md.use({
    renderer: {
      // never let model output inject markup
      html: () => "",
      code({ text, lang }) {
        const language = (lang || "").split(/\s+/)[0] || "text";
        const highlighted = highlight(text, language);
        const body = highlighted ?? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<div class="codeblk" data-lang="${language}">
  <div class="cb-hd">
    <span class="cb-lang">${language.toUpperCase()}</span>
    <button type="button" class="cb-copy" data-copy>COPY</button>
  </div>
  <pre class="cb-bd"><code class="hljs">${body}</code></pre>
</div>`;
      },
      link({ href, title, text }) {
        const safe = /^(https?:|mailto:|#|\/)/i.test(href || "") ? href : "#";
        const t = title ? ` title="${title.replace(/"/g, "&quot;")}"` : "";
        return `<a href="${safe}"${t} target="_blank" rel="noreferrer noopener">${text}</a>`;
      },
      /* `:--` / `:-:` / `--:` are part of the syntax — dropping them silently
       * left every numeric column staring left, which is what "table looks
       * wrong" actually was. The wrapper keeps a wide table inside its column. */
      table(this: Ctx, token: { align?: (string | null)[]; header: { tokens: unknown[] }[]; rows: { tokens: unknown[] }[][] }) {
        const alignAt = (i: number) => token.align?.[i] || "";
        const cell = (tag: "th" | "td", i: number, c: { tokens: unknown[] }) => {
          const a = alignAt(i);
          return `<${tag}${a ? ` align="${a}"` : ""}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        };
        const head = `<thead><tr>${token.header.map((c, i) => cell("th", i, c)).join("")}</tr></thead>`;
        const body = token.rows.map((row) => `<tr>${row.map((c, i) => cell("td", i, c)).join("")}</tr>`).join("");
        return `<div class="md-tbl"><table>${head}<tbody>${body}</tbody></table></div>`;
      },
    },
  });
  return md;
}

const CHAT = build(true);
const DOC = build(false);

export function Markdown({ text, class: cls, breaks = true }: { text: string; class?: string; breaks?: boolean }) {
  const html = useMemo(() => (breaks ? CHAT : DOC).parse(text || "") as string, [text, breaks]);
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
