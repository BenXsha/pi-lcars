import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/** Only the languages this console actually meets — keeps the bundle small. */
const LANGS: Record<string, any> = {
  bash,
  sh: bash,
  shell: bash,
  zsh: bash,
  css,
  diff,
  go,
  json,
  jsonc: json,
  markdown: markdown,
  md: markdown,
  python,
  py: python,
  rust,
  sql,
  ts: typescript,
  tsx: typescript,
  typescript,
  js: typescript,
  jsx: typescript,
  javascript: typescript,
  html: xml,
  xml,
  svg: xml,
  yaml,
  yml: yaml,
};

for (const [name, lang] of Object.entries(LANGS)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, lang);
}

const EXT: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  mts: "ts",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "css",
  html: "html",
  vue: "html",
  py: "python",
  sh: "bash",
  zsh: "bash",
  rs: "rust",
  go: "go",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  toml: "ini",
  diff: "diff",
  patch: "diff",
};

export const langFromPath = (path: string) => {
  const ext = (path.split(".").pop() || "").toLowerCase();
  return EXT[ext] ?? "";
};

/** Returns highlighted HTML (already escaped) or null when unknown. */
export function highlight(code: string, lang?: string): string | null {
  const key = (lang || "").toLowerCase().trim();
  if (!key || !hljs.getLanguage(key)) return null;
  try {
    return hljs.highlight(code, { language: key, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
