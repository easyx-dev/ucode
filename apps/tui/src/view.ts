import { Text } from "@earendil-works/pi-tui";
import {
  type DisplayItem,
  type SessionSummary,
  type SessionView,
  toDisplayItems,
} from "@ucode/sdk";

/**
 * TUI 的**视图层**：把 SDK 的状态映射成终端文本。
 *
 * 刻意做成纯函数（输入状态、输出字符串/行），原因有二：
 * - 渲染逻辑可以脱离终端单测（无需 TTY、无需真实核心层）；
 * - 换行交给基座 `@earendil-works/pi-tui` 的 `Text`（它会处理 CJK 宽度），
 *   我们只负责"每一行是什么内容"，不重复实现宽度计算。
 */

/** 一条展示项 → 若干行文本（前缀 + 正文；工具卡片压成两三行）。 */
export function formatItem(item: DisplayItem): string {
  switch (item.kind) {
    case "user":
      return `你 > ${item.text}`;
    case "assistant":
      return `助手 > ${item.markdown}`;
    case "thinking":
      return `(思考) ${item.text}`;
    case "notice":
      return `· ${item.text}`;
    case "compaction":
      return `(上下文已压缩) ${item.summary}`;
    case "pending":
      return `[待决交互] ${item.method} ${summarize(item.params)}`;
    case "tool": {
      const mark = item.status === "running" ? "..." : item.status === "error" ? "x" : "v";
      const head = `[工具 ${mark}] ${item.toolName}${summarize(item.args)}`;
      if (item.output.trim() === "") return head;
      return `${head}\n${indent(item.output.trim(), "    ")}`;
    }
  }
}

function summarize(args: Record<string, unknown>): string {
  const entries = Object.entries(args).slice(0, 3);
  if (entries.length === 0) return "";
  return ` ${entries
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      const short = text === undefined ? "" : text.length > 80 ? `${text.slice(0, 80)}…` : text;
      return `${key}=${short}`;
    })
    .join(" ")}`;
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export type TranscriptOptions = {
  width: number;
  /** 只渲染最近 N 项（终端回滚区有限，TUI 不做完整历史滚动）。 */
  maxItems?: number;
};

/**
 * 会话视图 → 终端行。
 *
 * 流式（尚未落盘的）尾部内容**不在这里补**：`toDisplayItems` 已经把它作为
 * `__streaming__` / `__streaming_thinking__` 两项吐出来了。再补一遍会让屏幕上
 * 同时出现两段一模一样的回答——这个重复正是"看着不对"的来源。
 */
export function transcriptLines(view: SessionView, options: TranscriptOptions): string[] {
  const items = toDisplayItems(view);
  const maxItems = options.maxItems ?? 200;
  const shown = items.length > maxItems ? items.slice(-maxItems) : items;

  const blocks: string[] = [];
  if (items.length > shown.length) {
    blocks.push(`…（省略较早的 ${items.length - shown.length} 项）`);
  }
  for (const item of shown) blocks.push(formatItem(item));

  if (blocks.length === 0) blocks.push("(还没有对话。输入内容回车，或 /help 看命令。)");
  if (view.lastError !== null) blocks.push(`[错误] ${view.lastError.message}`);

  const lines: string[] = [];
  for (const block of blocks) {
    lines.push(...new Text(block).render(options.width));
    lines.push(""); // 项之间空一行
  }
  return lines;
}

export type StatusInput = {
  productName: string;
  connected: boolean;
  trustLevel: string | null;
  sessionCount: number;
  view: SessionView | null;
  model: string | null;
};

/** 一行状态栏：产品名 · 工作目录 · 模型 · 状态 · 会话数 · 队列 · 只读提示。 */
export function statusLine(input: StatusInput): string {
  const parts: string[] = [input.productName];
  parts.push(input.connected ? `已连接(${input.trustLevel ?? "?"})` : "未连接");
  if (input.view !== null) {
    parts.push(input.view.state?.cwd ?? "?");
    const modelId = input.model ?? input.view.state?.model?.modelId ?? null;
    parts.push(modelId ?? "无模型");
    parts.push(input.view.state?.status ?? "idle");
    parts.push(`待决 ${input.view.pendingInteractions}`);
    const queued = input.view.state?.pendingMessages ?? 0;
    if (queued > 0) parts.push(`队列 ${queued}`);
    if (input.view.readOnly) parts.push("只读挂载");
  }
  parts.push(`会话 ${input.sessionCount}`);
  return parts.join(" · ");
}

/** 会话列表（供 SelectList 用）。 */
export function sessionItems(
  sessions: readonly SessionSummary[],
  activeId: string | null,
): { label: string; value: string }[] {
  return sessions.map((session) => ({
    value: session.id,
    label: `${session.id === activeId ? "* " : "  "}${session.name ?? session.id}  ${session.cwd}`,
  }));
}

/**
 * 输入框上方那一行常驻提示。
 *
 * zcode 把这类提示放在输入框 placeholder 里；终端里没有 placeholder，
 * 所以给它一行固定位置——否则"要按什么键"只能靠 /help 去猜，这正是实测里
 * "没有命令提示"的那条反馈。
 */
export function hintLine(input: { running: boolean; streaming: boolean }): string {
  if (input.running) {
    return input.streaming
      ? "生成中…（Enter 排队到下一轮；Ctrl+C 退出）"
      : "运行中…（Enter 排队到下一轮；Ctrl+C 退出）";
  }
  return "输入 / 查看命令 · Enter 发送 · Shift+Enter 换行 · Tab 补全 · Ctrl+C 退出";
}

/**
 * 最需要用户知道的那一件事，按"挡不挡得住用"排序。
 *
 * 只显示一条：把五条问题一起糊在屏幕上，等于一条都没说清楚。
 * 这些恰恰是"发了没反应"的四种真实成因——所以必须显式，不能只写进日志。
 */
export function bannerFor(input: {
  connected: boolean;
  view: SessionView | null;
  notices: readonly { level: "info" | "warn" | "error"; message: string }[];
}): string | null {
  const latestError = [...input.notices].reverse().find((notice) => notice.level === "error");
  if (latestError !== undefined) return `✗ ${latestError.message}`;
  if (!input.connected) return "⚠ 未连接核心层，正在重连…";
  const view = input.view;
  if (view === null) return null;
  if (view.lastError !== null) return `✗ ${view.lastError.message}`;
  if (view.readOnly) {
    return "⚠ 只读挂载：写权限在另一个核心层实例手上，本实例只能看（输入 /new 开一个新会话）。";
  }
  if (view.state !== null && !view.state.modelAvailable) {
    return "⚠ 还没有可用的模型：用 /provider <id> <baseUrl> <模型> [密钥] 添加一个供应商。";
  }
  const latestWarn = [...input.notices].reverse().find((notice) => notice.level === "warn");
  return latestWarn === undefined ? null : `⚠ ${latestWarn.message}`;
}

export function helpText(): string {
  const width = Math.max(...COMMAND_SPECS.map((spec) => usageOf(spec).length));
  return [
    "命令（输入 / 会自动提示）：",
    ...COMMAND_SPECS.map((spec) => `  ${usageOf(spec).padEnd(width)}  ${spec.description}`),
    "",
    "Enter 发送 · Shift+Enter / Ctrl+J 换行 · ↑↓ 历史 · Tab 补全 · Ctrl+C 退出",
    "直接输入内容回车即发送给 agent。",
  ].join("\n");
}

export type CommandSpec = {
  name: string;
  /** 参数占位（如 `<级别>`）；没有参数则省略。 */
  args?: string;
  description: string;
};

/**
 * 命令清单：**帮助文本与自动补全的唯一来源**。
 *
 * 两处分开写迟早会漂：补全提示了 `/provider` 而帮助里没有，用户就会以为那是 bug。
 */
export const COMMAND_SPECS: readonly CommandSpec[] = [
  { name: "/help", description: "显示本帮助" },
  { name: "/new", args: "[目录]", description: "新建会话（可指定工作目录）" },
  { name: "/sessions", description: "切换会话（选择列表）" },
  { name: "/model", args: "[供应商/模型]", description: "查看或切换模型" },
  {
    name: "/provider",
    args: "<id> <baseUrl> <模型> [密钥]",
    description: "添加模型供应商（写进数据层的 models.json）",
  },
  {
    name: "/autonomy",
    args: "<级别>",
    description: "自主级别：confirm | auto-edit | plan | full-access",
  },
  { name: "/tasks", description: "自动化任务一览（只读；面板在 Web/桌面壳）" },
  { name: "/quit", description: "退出" },
];

export function usageOf(spec: CommandSpec): string {
  return spec.args === undefined ? spec.name : `${spec.name} ${spec.args}`;
}

/**
 * 按当前输入给出命令提示。
 *
 * 只在"还在写命令名"时提示（`/mod`、`/`）；一旦已经进入参数（`/model x/`）就不再
 * 拿一屏命令名盖住用户要看的内容——那时该提示的是参数，而参数的合法取值来自运行期，
 * 不是这张静态表能回答的。
 */
export function commandSuggestions(input: string, limit = 8): CommandSpec[] {
  const text = input.trimStart();
  if (!text.startsWith("/") || text.includes(" ")) return [];
  const needle = text.toLowerCase();
  return COMMAND_SPECS.filter((spec) => spec.name.startsWith(needle)).slice(0, limit);
}
