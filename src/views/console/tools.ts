import type { IconName } from "../../components/Icon";

/** Tool name → icon, so every row in every view agrees. */

const TOOL_ICON: Record<string, IconName> = {
  bash: "tool-bash",
  read: "tool-read",
  write: "tool-write",
  edit: "tool-edit",
  grep: "tool-grep",
  find: "tool-find",
  ls: "tool-ls",
  web_search: "tool-web",
  fetch_content: "tool-web",
  Agent: "tool-agent",
  SubagentWorkflow: "tool-workflow",
  steer_subagent: "tool-agent",
  get_subagent_result: "tool-agent",
  todo: "tool-todo",
  batch_run: "tool-batch",
  batch_status: "tool-batch",
  codemode: "tool-codemode",
};
export const toolIcon = (name: string): IconName => TOOL_ICON[name] ?? "station-tools";
