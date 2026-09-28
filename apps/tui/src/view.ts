import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
  type DisplayItem,
  type SessionSummary,
  type SessionView,
  toDisplayItems,
  type UiRequest,
} from "@ucode/sdk";
import { ink, tint } from "./theme.ts";

/**
 * TUI 的**视图层**：把 SDK 的状态映射成终端文本行。
 *
 * 刻意做成纯函数（输入状态 + 宽度、输出行数组），原因有三：
 * - 渲染逻辑可以脱离终端单测（无需 TTY、无需真实服务层）；
 * - 宽度是渲染的输入，不是渲染时才去问终端——右对齐、方框、截断因此都可测；
 * - 换行交给基座 `wrapTextWithAnsi` / `truncateToWidth`（它处理 CJK 宽度与嵌入的 ANSI），
 *   我们只负责"每一行是什么内容"。
 *
 * 视觉口径（对齐 opencode 的终端形态）：**用户输入带左侧色条、工具调用是方框、
 * 思考与通知压成暗色一行、底部一条状态栏**。信息都在，噪音不在。
 */

type ToolItem = Extract<DisplayItem, { kind: "tool" }>;
type PendingItem = Extract<DisplayItem, { kind: "pending" }>;

const BAR = "\u258C";

/** 按可见宽度补空格（方框的右边框要对齐）。 */
export function padLine(line: string, width: number): string {
  const padding = width - visibleWidth(line);
  return padding > 0 ? `${line}${" ".repeat(padding)}` : truncateToWidth(line, width);
}

export type BoxOptions = {
  /** 左上角的标题（已着色）。 */
  title: string;
  /** 右上角的标记（已着色），如状态。 */
  right?: string;
  /** 正文行（已着色，逐行截断到框内宽度）。 */
  body: readonly string[];
  width: number;
  borderTint?: (text: string) => string;
};

/**
 * 画一个方框。
 *
 * 为什么值得自己画而不是用现成组件：方框的标题、状态、右侧标记都要落在**同一条**
 * 顶边上，这是"一眼看出这是什么、成了没有"的关键；用通用的 Container 拼不出来。
 */
export function boxLines(options: BoxOptions): string[] {
  const border = options.borderTint ?? tint.border;
  const width = Math.max(8, options.width);
  const inner = Math.max(1, width - 4);
  const right = options.right === undefined ? "" : ` ${options.right} `;
  const head = `─ ${options.title} `;
  const fill = Math.max(0, width - 2 - visibleWidth(head) - visibleWidth(right));
  const lines = [`${border("╭")}${head}${border("─".repeat(fill))}${right}${border("╮")}`];
  for (const line of options.body) {
    lines.push(`${border("│")} ${padLine(line, inner)} ${border("│")}`);
  }
  lines.push(border(`╰${"─".repeat(Math.max(0, width - 2))}╯`));
  return lines;
}

/** 用户输入：左侧色条 + 正文（多行与超长都按宽度折行）。 */
export function userBlock(text: string, width: number): string[] {
  const inner = Math.max(4, width - 2);
  const rows = text
    .replace(/\r\n/gu, "\n")
    .split("\n")
    .flatMap((line) => wrapTextWithAnsi(line, inner));
  return rows.map((row) => `${tint.accent(BAR)} ${padLine(row, inner)}`.trimEnd());
}

function firstString(args: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/** 工具卡片第一行：让人一眼认出"它到底干了什么"。 */
export function toolHead(item: ToolItem): string {
  const name = item.toolName.toLowerCase();
  const args = item.args;
  if (/^(bash|shell|exec)$/u.test(name)) {
    return `$ ${firstString(args, ["command", "cmd"]) ?? "…"}`;
  }
  // 搜索类先看"搜什么"，再看"搜哪里"：只给路径等于没说在干什么。
  if (/^(grep|search|glob|find)$/u.test(name)) {
    const pattern = firstString(args, ["pattern", "query"]) ?? "…";
    const scope = firstString(args, ["path", "include", "glob"]);
    return scope === null ? pattern : `${pattern} · ${scope}`;
  }
  const path = firstString(args, ["path", "file_path", "filePath"]);
  if (path !== null) return path;
  const pattern = firstString(args, ["pattern", "query"]);
  if (pattern !== null) return pattern;
  const text = firstString(args, ["description", "prompt", "question", "url"]);
  if (text !== null) return text;
  const keys = Object.keys(args);
  return keys.length === 0 ? item.toolName : keys.slice(0, 3).join(" · ");
}

/** 工具卡片：`╭─ bash ── ✓ ─╮` + 首行摘要 + 输出（只留尾部，省掉的行数显式说出来）。 */
export function toolBlock(item: ToolItem, width: number, maxOutputLines = 12): string[] {
  const failed = item.status === "error";
  const mark =
    item.status === "running"
      ? tint.accent("运行中")
      : failed
        ? tint.danger("出错")
        : tint.success("完成");
  const body: string[] = [ink.bold(tint.content(toolHead(item)))];

  const output = item.output.replace(/\r\n/gu, "\n").replace(/\s+$/u, "");
  if (output !== "") {
    const lines = output.split("\n");
    body.push("");
    if (lines.length > maxOutputLines) {
      body.push(tint.faint(`…（省略前 ${lines.length - maxOutputLines} 行）`));
    }
    const tail = lines.slice(-maxOutputLines);
    for (const line of tail) {
      body.push(failed ? tint.danger(line) : tint.faint(line));
    }
  }

  return boxLines({
    title: tint.muted(item.toolName.replace(/^mcp__/u, "mcp · ")),
    right: mark,
    body,
    width,
    ...(failed ? { borderTint: tint.danger } : {}),
  });
}

/** 思考：压成一行（完整推理在 Web 上有折叠视图；终端里铺开会把正文顶走）。 */
export function thinkingLine(
  item: Extract<DisplayItem, { kind: "thinking" }>,
  width: number,
): string {
  const lines = item.text.trim().split("\n");
  const head = tint.accent("+") + ` ${tint.faint("思考")} ${tint.faint(`· ${lines.length} 行`)}`;
  const preview = tint.faint(ink.italic(`  ${lines[0] ?? ""}`));
  return truncateToWidth(`${head}${preview}`, Math.max(8, width));
}

export function noticeLine(
  text: string,
  width: number,
  level: "info" | "warn" | "error" = "info",
): string {
  const mark =
    level === "error" ? tint.danger("✗") : level === "warn" ? tint.warn("!") : tint.faint("·");
  const body =
    level === "error" ? tint.danger(text) : level === "warn" ? tint.warn(text) : tint.faint(text);
  return truncateToWidth(`${mark} ${body}`, Math.max(8, width));
}

/**
 * 输入框下边框上的按键提示。
 *
 * 忙时只留"还能按什么"（Enter 排队 / Ctrl+C 退出）：这时用户最需要知道的是
 * "我说的话去哪了"，而不是一堆平时才有意义的键位。
 */
export function promptHint(input: { running: boolean; answering: boolean }): string {
  if (input.answering) return "Enter 提交回答 · Esc 取消";
  if (input.running) return "生成中：Enter 排队到下一轮 · Ctrl+C 退出";
  return "Enter 发送 · Shift+Enter 换行 · / 命令 · Ctrl+C 退出";
}

export function compactionLine(summary: string, width: number): string {
  const label = ` 上下文已压缩 ${summary.replace(/\s+/gu, " ").trim()} `;
  const text = truncateToWidth(label, Math.max(8, width - 4));
  const fill = Math.max(0, width - visibleWidth(text) - 2);
  return `${tint.border("─")} ${tint.faint(text)} ${tint.border("─".repeat(fill))}`;
}

/** 待决交互（无人应答时落盘的那些）：给出可读的选项，而不是一串 JSON。 */
export function pendingBlock(item: PendingItem, width: number): string[] {
  const params = item.params as { title?: unknown; message?: unknown; options?: unknown };
  const title = typeof params.title === "string" ? params.title : item.method;
  const message = typeof params.message === "string" ? params.message : "";
  const options = Array.isArray(params.options)
    ? params.options.filter((option): option is string => typeof option === "string")
    : [];
  const body = [tint.content(title)];
  if (message !== "") body.push(tint.muted(message));
  if (options.length > 0) body.push(tint.faint(`选项：${options.join(" / ")}`));
  body.push(tint.faint("仍在等待应答：答完 agent 会据此继续。"));
  return boxLines({
    title: tint.warn("待决交互"),
    right: tint.faint(item.method),
    body,
    width,
    borderTint: tint.warn,
  });
}

export function errorLine(message: string, width: number): string {
  return truncateToWidth(`${tint.danger("✗")} ${tint.danger(message)}`, Math.max(8, width));
}

export function emptyLine(width: number): string {
  return truncateToWidth(
    tint.faint("还没有对话。直接输入内容回车即可，或输入 / 看命令。"),
    Math.max(8, width),
  );
}

/** 毫秒 → `12.3s` / `2分03秒`（超过一分钟再报小数点后一位就没意义了）。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`;
}

/** 大数字缩写（tokens 会到六位以上，铺开显示会挤掉真正的信息）。 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export type BuildInput = {
  model: string | null;
  /** 本轮开始时间（ISO）；拿不到就不显示耗时。 */
  startedAt: string | null;
  now: number;
  queued: number;
  /** 已经在流式输出（而不是仅仅在跑工具）。 */
  streaming: boolean;
};

/** 进行中的那一行：`✻ 生成中 · 模型 · 12.3s · 队列 1`。 */
export function buildLine(input: BuildInput, width: number): string {
  const parts: string[] = [];
  if (input.model !== null) parts.push(tint.muted(input.model));
  const startedAt = input.startedAt === null ? Number.NaN : Date.parse(input.startedAt);
  if (Number.isFinite(startedAt)) {
    const duration = formatDuration(input.now - startedAt);
    if (duration !== "") parts.push(tint.muted(duration));
  }
  if (input.queued > 0) parts.push(tint.warn(`队列 ${input.queued}`));
  const head = `${tint.accent("✻")} ${tint.accent(input.streaming ? "生成中" : "运行中")}`;
  return truncateToWidth([head, ...parts].join(tint.border(" · ")), Math.max(8, width));
}

export type FooterInput = {
  cwd: string | null;
  /** 家目录（ISO 路径里换成 `~`，省下的宽度给真正要看的用量）。 */
  home?: string;
  autonomy: string | null;
  model: string | null;
  tokens: number | null;
  sessionCount: number;
  connected: boolean;
  trustLevel: string | null;
  readOnly: boolean;
  /** 右侧最后一条提示（命令入口）。 */
  hint?: string;
};

/** 家目录缩写：`/Users/lyy/code/x` → `~/code/x`。 */
export function shortenCwd(cwd: string, home: string | undefined): string {
  if (home === undefined || home === "" || home === "/") return cwd;
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

/**
 * 底部状态栏：左边"我在哪"，右边"我用什么模型、花了多少、按什么键"。
 *
 * 两端对齐而不是居中或堆在一起：终端里用户的视线要么在最左（路径），要么在最右（用量），
 * 中间那一段永远是空的。
 *
 * 窄屏时按**优先级**丢：先丢"能再看一眼就知道"的（会话数、信任级别），最后才丢模型与
 * 命令入口；直接截断会把右边的用量整条切掉——那是这行里最常被看的东西。
 */
export function footerLine(input: FooterInput, width: number): string {
  const total = Math.max(20, width);
  type Segment = { side: "left" | "right"; drop: number; text: string };
  const all: Segment[] = [];
  const push = (side: Segment["side"], text: string, drop: number): void => {
    if (text !== "") all.push({ side, text, drop });
  };

  // drop 越大越舍不得丢：路径与警告是"必须看见"，会话数才是装饰。
  push("left", tint.muted(shortenCwd(input.cwd ?? "（无会话）", input.home)), 99);
  if (!input.connected) push("left", tint.warn("未连接"), 98);
  if (input.readOnly) push("left", tint.warn("只读挂载"), 97);
  push("right", input.connected ? tickFaint(input.trustLevel) : "", 20);
  push("right", tickFaint(input.model), 70);
  push(
    "right",
    input.tokens !== null && input.tokens > 0
      ? tint.faint(`${formatTokens(input.tokens)} tokens`)
      : "",
    65,
  );
  push("right", tickFaint(input.hint), 96);
  push("left", tickFaint(autonomyLabel(input.autonomy)), 45);
  const sessionText =
    input.connected && input.sessionCount > 0 ? tint.faint(`${input.sessionCount} 会话`) : "";
  push("left", sessionText, 10);

  const dropped = new Set<Segment>();
  const join = (side: Segment["side"]): string =>
    all
      .filter((segment) => segment.side === side && !dropped.has(segment))
      .map((segment) => segment.text)
      .join(tint.border(" · "));

  let leftText = join("left");
  let rightText = join("right");
  while (visibleWidth(leftText) + visibleWidth(rightText) + 1 > total) {
    const candidates = all.filter((segment) => !dropped.has(segment) && segment.drop < 90);
    if (candidates.length === 0) break;
    const lowest = candidates.reduce((min, segment) => (segment.drop < min.drop ? segment : min));
    dropped.add(lowest);
    leftText = join("left");
    rightText = join("right");
  }

  // 循环保证 left + right + 1 ≤ total（除非连警告都丢完了还放不下）；gap = 0 时挤一格空格即可。
  const gap = total - visibleWidth(leftText) - visibleWidth(rightText) - 1;
  if (gap >= 0) return `${leftText}${" ".repeat(Math.max(1, gap))}${rightText}`;
  if (rightText === "") return truncateToWidth(leftText, total);
  // 候选都丢完了还放不下：截路径，保住右边（"在用哪个模型"比完整路径更值得看）。
  const room = total - visibleWidth(rightText) - 2;
  if (room < 8) return truncateToWidth(`${leftText} ${rightText}`, total);
  return `${truncateToWidth(leftText, room)} ${rightText}`;
}

function tickFaint(text: string | null | undefined): string {
  return text === null || text === undefined ? "" : tint.faint(text);
}

const AUTONOMY_LABELS: Record<string, string> = {
  confirm: "变更前确认",
  plan: "计划模式",
  "auto-edit": "自动编辑",
  "full-access": "完全访问",
};

export function autonomyLabel(level: string | null | undefined): string | null {
  if (level === null || level === undefined || level === "") return null;
  return AUTONOMY_LABELS[level] ?? level;
}

/** 提示条（连不上、没模型、只读…）：一条方框，别让它混在正文里被划过去。 */
export function bannerBox(text: string, width: number): string[] {
  return boxLines({
    title: tint.warn("注意"),
    body: wrapTextWithAnsi(text, Math.max(4, width - 4)),
    width,
    borderTint: tint.warn,
  });
}

/** 会话列表（供 SelectList 用）。 */
export function sessionItems(
  sessions: readonly SessionSummary[],
  activeId: string | null,
): { label: string; value: string }[] {
  return sessions.map((session) => ({
    value: session.id,
    label: `${session.id === activeId ? "▸ " : "  "}${session.name ?? session.id.slice(0, 12)} — ${session.cwd}`,
  }));
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

/**
 * 一个待决交互请求"该怎么问"（纯函数：请求 → 界面元素，便于单测）。
 *
 * 三种形态对应三种输入方式：`select` 选择列表、`confirm` 允许/拒绝、`input`/`editor`
 * 把编辑器临时变成"回答这一问"。返回 `null` 表示这条请求不该弹窗（例如 select 没有选项）。
 */
export type InteractionPrompt =
  | { kind: "select"; title: string; options: string[] }
  | { kind: "confirm"; title: string; message: string }
  | { kind: "input"; title: string; placeholder: string | null; prefill: string | null };

export function interactionPrompt(request: UiRequest): InteractionPrompt | null {
  const params = request.params as {
    title?: unknown;
    options?: unknown;
    message?: unknown;
    placeholder?: unknown;
    prefill?: unknown;
  };
  const title = typeof params.title === "string" ? params.title : "需要你确认";

  if (request.method === "select") {
    const options = (Array.isArray(params.options) ? params.options : []).filter(
      (option): option is string => typeof option === "string",
    );
    return options.length === 0 ? null : { kind: "select", title, options };
  }
  if (request.method === "confirm") {
    return {
      kind: "confirm",
      title,
      message: typeof params.message === "string" ? params.message : "",
    };
  }
  return {
    kind: "input",
    title,
    placeholder: typeof params.placeholder === "string" ? params.placeholder : null,
    prefill: typeof params.prefill === "string" ? params.prefill : null,
  };
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
  if (latestError !== undefined) return latestError.message;
  if (!input.connected) return "未连接服务层，正在重连…";
  const view = input.view;
  if (view === null) return null;
  if (view.lastError !== null) return view.lastError.message;
  if (view.readOnly) {
    return "只读挂载：写权限在另一个服务层实例手上，本实例只能看（输入 /new 开一个新会话）。";
  }
  if (view.state !== null && !view.state.modelAvailable) {
    return "还没有可用的模型：用 /provider <id> <baseUrl> <模型> [密钥] 添加一个供应商。";
  }
  const latestWarn = [...input.notices].reverse().find((notice) => notice.level === "warn");
  return latestWarn === undefined ? null : latestWarn.message;
}

/** 本轮开始时间：最后一条用户消息的时间戳（拿不到就返回 null，不显示耗时）。 */
export function turnStartedAt(view: SessionView | null): string | null {
  if (view === null) return null;
  const items = toDisplayItems(view);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && (item.kind === "user" || item.kind === "pending")) {
      return item.timestamp === "" ? null : item.timestamp;
    }
  }
  return null;
}

/** 视图的最近一条助手消息长度（流式时用来判断"有没有在吐字"）。 */
export function isStreaming(view: SessionView | null): boolean {
  return view !== null && view.streaming.text.trim() !== "";
}
