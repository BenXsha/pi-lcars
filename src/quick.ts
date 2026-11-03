import { getSettings } from "./settings";

/**
 * Quick prompts: the operator's own macro pad, sitting between the draft and the
 * run button. A pad is a *label* (what the key says, ≤ 12 chars) plus a *text*
 * (what actually gets sent). Built-ins ship in the interface language — they are
 * prompts, so they reach the model in the language the operator reads.
 *
 * Stored per browser, not per session: the pad belongs to the operator, not to
 * the workspace. `RESET` simply drops the key and falls back to the built-ins.
 */
export type QuickPrompt = { id: string; label: string; text: string };

const STORE = "lcars.quick";
const EVENT = "lcars:quick";

/** slots in the matrix: 5 pads + the edit key fills the 3x2 grid exactly */
export const QUICK_SLOTS = 5;
const MAX_LABEL = 12;
const MAX_TEXT = 400;

/**
 * Built-ins are the five things this console is asked to do all day: land the
 * work (commit+push), leave the code better than you found it, get a fresh
 * checkout running, understand a requirement before coding it, then plan it.
 */
const BUILTIN: Record<"en" | "zh", QuickPrompt[]> = {
  en: [
    { id: "b-push", label: "COMMIT", text: "Review the diff, then stage, commit and push it with a message that says why." },
    { id: "b-structure", label: "STRUCTURE", text: "Improve this code's structure: split responsibilities, remove duplication, keep behaviour identical." },
    { id: "b-boot", label: "BOOT", text: "Get this project running locally: install, start it, and report exactly what breaks." },
    { id: "b-analyse", label: "ANALYSE", text: "Analyse this requirement against the current architecture: affected modules, risks, and the shortest path to implement it." },
    { id: "b-plan", label: "PLAN", text: "Write a development plan for this task: verifiable steps, order of work, and the risks to watch." },
  ],
  zh: [
    { id: "b-push", label: "提交推送", text: "先看一遍 diff，然后提交这次改动并推送到远端，提交信息写清楚为什么。" },
    { id: "b-structure", label: "结构优化", text: "优化这段代码的结构：拆分职责、去掉重复，行为保持不变。" },
    { id: "b-boot", label: "启动项目", text: "把这个项目在本地跑起来：装依赖、启动服务，然后告诉我哪里报错。" },
    { id: "b-analyse", label: "需求分析", text: "先分析这个需求与现有架构的关系：影响哪些模块、风险在哪、最短实现路径是什么。" },
    { id: "b-plan", label: "开发计划", text: "为这个任务写一份开发计划：拆成可验证的步骤，排好顺序，标出风险。" },
  ],
};

const builtinQuick = (): QuickPrompt[] =>
  (BUILTIN[getSettings().locale as "en" | "zh"] ?? BUILTIN.en).map((q) => ({ ...q }));

const clean = (list: QuickPrompt[]): QuickPrompt[] =>
  list
    .filter((q) => q && typeof q.label === "string" && typeof q.text === "string" && q.text.trim())
    .slice(0, QUICK_SLOTS)
    .map((q, i) => ({
      id: typeof q.id === "string" && q.id ? q.id : `q${i}-${Math.random().toString(36).slice(2, 7)}`,
      label: q.label.trim().slice(0, MAX_LABEL) || q.text.trim().slice(0, MAX_LABEL).toUpperCase(),
      text: q.text.trim().slice(0, MAX_TEXT),
    }));

export function loadQuick(): QuickPrompt[] {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return builtinQuick();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return builtinQuick();
    const list = clean(parsed as QuickPrompt[]);
    // an empty stored list is a valid choice (the operator removed every pad)
    return list;
  } catch {
    return builtinQuick();
  }
}

export function saveQuick(list: QuickPrompt[]): QuickPrompt[] {
  const next = clean(list);
  try {
    localStorage.setItem(STORE, JSON.stringify(next));
  } catch {
    /* private mode / quota: the pads keep working for this session */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
  return next;
}

export function resetQuick(): QuickPrompt[] {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
  return builtinQuick();
}

export function onQuickChange(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

export function newQuick(): QuickPrompt {
  return { id: `q-${Math.random().toString(36).slice(2, 8)}`, label: "", text: "" };
}
