import type { DisplayItem } from "@ucode/sdk";

/**
 * 工具卡片的**纯展示逻辑**：名称 → 人话、参数 → 一行摘要、输出 → 折叠预览。
 *
 * 工具名来自模型（`read` / `mcp__fs__read_file` / 自定义扩展），参数形状也各不相同，
 * 因此"显示什么"必须先归一化成一句能认出来的话——否则用户看到的是满屏 `toolName`。
 */

export type ToolItem = Extract<DisplayItem, { kind: "tool" }>;

const TOOL_LABELS: Record<string, string> = {
  read: "读取",
  read_file: "读取",
  write: "写入",
  write_file: "写入",
  edit: "编辑",
  edit_file: "编辑",
  multiedit: "多处编辑",
  apply_patch: "应用补丁",
  bash: "命令",
  shell: "命令",
  exec: "命令",
  grep: "搜索内容",
  search: "搜索内容",
  glob: "查找文件",
  find: "查找文件",
  ls: "列目录",
  list: "列目录",
  todo: "更新任务清单",
  todowrite: "更新任务清单",
  question: "向你提问",
  task: "子智能体",
  subagent: "子智能体",
  fetch: "抓取网页",
  web_fetch: "抓取网页",
};

/** MCP 工具的展示名：`mcp__服务器__工具` → `服务器 · 工具`。 */
export function toolLabel(toolName: string): string {
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/u.exec(toolName);
  if (mcp !== null) return `${mcp[1]} · ${mcp[2]}`;
  return TOOL_LABELS[toolName.toLowerCase()] ?? toolName;
}

function firstString(args: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/** 一行摘要：优先给"人一眼能认出的那个参数"（路径 / 命令 / 模式）。 */
export function toolSummary(item: ToolItem): string {
  const args = item.args;
  const name = item.toolName.toLowerCase();
  if (/^(bash|shell|exec)$/u.test(name)) return firstString(args, ["command", "cmd"]) ?? "执行命令";

  const path = firstString(args, ["path", "file_path", "filePath", "notebook_path"]);
  if (/^(read|read_file|write|write_file|edit|edit_file|multiedit|apply_patch)$/u.test(name)) {
    return path ?? "文件操作";
  }
  if (/^(ls|list)$/u.test(name)) return path ?? "列目录";

  const pattern = firstString(args, ["pattern", "query", "regex"]);
  if (/^(grep|search|glob|find)$/u.test(name)) {
    const scope = firstString(args, ["path", "include", "glob"]);
    return scope === null ? (pattern ?? "搜索") : `${pattern ?? "搜索"} · ${scope}`;
  }

  const text = firstString(args, ["description", "prompt", "question", "url", "content", "title"]);
  if (text !== null) return text.length > 120 ? `${text.slice(0, 120)}…` : text;

  const keys = Object.keys(args);
  return keys.length === 0 ? "" : keys.slice(0, 3).join(" · ");
}

/**
 * 输出的折叠预览：只留尾部 N 行（模型的命令输出是"最后几行才是有用的"），
 * 并把被省掉的行数显式说出来——不然用户以为工具什么都没输出。
 */
export function toolOutputPreview(
  output: string,
  maxLines = 12,
): { lines: string[]; hidden: number } {
  const normalized = output.replace(/\r\n/gu, "\n").replace(/\s+$/u, "");
  if (normalized === "") return { lines: [], hidden: 0 };
  const lines = normalized.split("\n");
  if (lines.length <= maxLines) return { lines, hidden: 0 };
  return { lines: lines.slice(-maxLines), hidden: lines.length - maxLines };
}

/** 写入类工具的内容预览（内容通常很长，只给开头几行）。 */
export function toolContentPreview(args: Record<string, unknown>, maxLines = 8): string | null {
  const content = firstString(args, ["content", "new_string", "newText"]);
  if (content === null) return null;
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;
  return `${lines.slice(0, maxLines).join("\n")}\n…（共 ${lines.length} 行）`;
}
