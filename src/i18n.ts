import { getSettings, type Locale } from "./settings";

/**
 * Chrome-only translation: navigation, composer hints and the settings panel.
 * Content (messages, tool output, skills, providers) stays as the model wrote it.
 */
const DICT = {
  en: {
    "nav.mcp": "MCP",
    "nav.skills": "SKILLS",
    "nav.providers": "PROVIDERS",
    "nav.settings": "SETTINGS",
    "nav.history": "HISTORY",
    "side.new": "NEW SESSION",
    "side.sessions": "SESSIONS",
    "side.files": "FILES",
    "cmd.send": "ENTER SEND / SHIFT+ENTER NEWLINE",
    "cmd.live": "GENERATING / ESC TO INTERRUPT / ENTER QUEUES A STEER",
    "cmd.placeholder": "Ask pi to build, refactor, or investigate…",
    "cmd.placeholderLive": "Type to steer — does not interrupt the run…",
    "cmd.run": "RUN",
    "cmd.steer": "STEER",
    "cmd.stop": "STOP",
    "cmd.fork": "FORK",
    "cmd.entry": "ENTRY",
    "set.title": "SETTINGS",
    "set.appearance": "INTERFACE",
    "set.scale": "UI SCALE",
    "set.motion": "MOTION",
    "set.locale": "LANGUAGE",
    "set.theme": "THEME",
    "set.runtime": "PI RUNTIME",
    "set.keys": "KEYBOARD",
    "set.policy": "APPROVAL POLICY",
    "set.tools": "TOOL LOADOUT",
    "set.note": "Chrome only — messages, tool output and skill text stay in their original language.",
  },
  zh: {
    "nav.mcp": "MCP",
    "nav.skills": "技能",
    "nav.providers": "模型服务",
    "nav.settings": "设置",
    "nav.history": "历史",
    "side.new": "新建会话",
    "side.sessions": "会话",
    "side.files": "文件",
    "cmd.send": "回车发送 / SHIFT+回车换行",
    "cmd.live": "生成中 / ESC 中断 / 回车排队为 STEER",
    "cmd.placeholder": "让 pi 构建、重构或调查…",
    "cmd.placeholderLive": "输入以插入消息，不打断当前生成…",
    "cmd.run": "运行",
    "cmd.steer": "插话",
    "cmd.stop": "停止",
    "cmd.fork": "分叉",
    "cmd.entry": "输入",
    "set.title": "设置",
    "set.appearance": "界面",
    "set.scale": "界面缩放",
    "set.motion": "动效",
    "set.locale": "界面语言",
    "set.theme": "配色",
    "set.runtime": "PI 运行时",
    "set.keys": "快捷键",
    "set.policy": "审批策略",
    "set.tools": "工具清单",
    "set.note": "仅界面文案；消息、工具输出与技能正文保持原文。",
  },
} as const;

export type TKey = keyof typeof DICT.en;

export function t(key: TKey): string {
  const locale: Locale = getSettings().locale;
  return DICT[locale][key] ?? DICT.en[key];
}
