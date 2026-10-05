/**
 * 权限引擎：把「工具调用」映射成可匹配的对象，再按声明式规则算出放行 / 审批 / 阻断。
 *
 * 规则按工具名分键、`*` 通配匹配，**最后命中者胜**（与 opencode / Claude Code 一致），
 * 未命中任何规则时默认放行。`external_directory` 不是真实工具，是「工作目录之外的路径」
 * 这一独立检查项，与工具自身规则的判定取更严的一档。
 */
import { isAbsolute, posix, relative, resolve, sep } from "node:path";

import type { PermissionAction, PermissionMode } from "@ucode/contracts";

import { toPosixPath } from "../../utils/path";

export type PermissionRule = {
  /** 工具名；`external_directory` 表示工作目录之外的路径检查 */
  tool: string;
  /** 匹配串，`*` 匹配任意字符（含路径分隔符），`**` 同义 */
  pattern: string;
  action: PermissionAction;
  /** 规则用途说明，展示与排障用 */
  note?: string;
};

/** 一次待判定的工具调用：工具名 + 匹配对象 */
export type PermissionRequest = {
  tool: string;
  subject: string;
};

/** 审批请求：交给用户确认时携带的上下文 */
export type PermissionAsk = {
  tool: string;
  subject: string;
  /** 本次授权覆盖的范围；用户选「本会话恒允」时按它记账 */
  scope: string;
};

/** 判定结果：动作 + 命中的工具 / 对象 / 规则，以及可授权的范围 */
export type PermissionVerdict = {
  action: PermissionAction;
  tool: string;
  subject: string;
  /** 「本会话恒允」要记下的范围：规则类 ask 是规则串，越界检查是父目录通配 */
  scope: string;
  rule?: PermissionRule;
};

/** pattern 编译成正则：仅 `*` 是通配符，其余字符按字面量处理 */
const toRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
};

export const matchPattern = (pattern: string, subject: string): boolean =>
  pattern === "*" || toRegExp(pattern).test(subject);

/** 依次匹配，保留最后一个命中的规则（最后命中者胜） */
export const evaluateRules = (
  rules: readonly PermissionRule[],
  request: PermissionRequest,
): { action: PermissionAction; rule?: PermissionRule } => {
  let matched: PermissionRule | undefined;
  for (const rule of rules) {
    if (rule.tool !== request.tool && rule.tool !== "*") continue;
    if (!matchPattern(rule.pattern, request.subject)) continue;
    matched = rule;
  }
  return matched ? { action: matched.action, rule: matched } : { action: "allow" };
};

/** 路径类工具：入参是文件 / 目录路径 */
const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

export type ToolTarget = {
  /** 规则匹配对象：路径类工具用归一化后的绝对路径，其余是命令 / URL / 查询词 */
  subject: string;
  /** 路径类工具的绝对路径，供工作目录之外的判断；非路径类为 undefined */
  absolutePath?: string;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * 解析工具调用的匹配对象。路径类工具统一归一到 posix 绝对路径，规则不必关心
 * 会话工作目录在哪（`*.env` 里的 `*` 跨分隔符，仍能命中任意层级的 `.env`）。
 */
export const toolTarget = (
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
): ToolTarget => {
  if (PATH_TOOLS.has(tool)) {
    // grep / find / ls 的 path 可省，含义是当前目录
    const absolutePath = resolve(cwd, text(input.path) || ".");
    return { subject: toPosixPath(absolutePath), absolutePath };
  }
  switch (tool) {
    case "bash":
      return { subject: text(input.command) };
    case "webfetch":
      return { subject: text(input.url) };
    case "websearch":
      return { subject: text(input.query) };
    default:
      return { subject: "" };
  }
};

/** 路径是否在工作目录之外；同名兄弟目录（`..foo`）不算越界 */
export const isExternal = (cwd: string, absolutePath: string): boolean => {
  const rel = relative(cwd, absolutePath);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
};

/**
 * 越界授权的范围：取目标所在目录，整目录通配（与 opencode 对 `external_directory`
 * 按目录授权一致）。目标本身是根目录时退回自身，避免 `/**` 变成全盘放行。
 */
export const externalScope = (absolutePath: string): string => {
  const path = toPosixPath(absolutePath);
  const dir = posix.dirname(path);
  return dir === "/" || dir === "." ? `${path}/**` : `${dir}/**`;
};

const SEVERITY = { allow: 0, ask: 1, deny: 2 } as const;

/** 动作严格程度：`allow < ask < deny`；用于父子能力取交集时「取较严者」 */
export const severityOf = (action: PermissionAction): number => SEVERITY[action];

const strongest = (a: PermissionAction, b: PermissionAction): PermissionAction =>
  SEVERITY[a] >= SEVERITY[b] ? a : b;

/** 判定一次工具调用：先按工具规则，再看是否越界并取更严的一档 */
export const decidePermission = (
  rules: readonly PermissionRule[],
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
): PermissionVerdict => {
  const target = toolTarget(tool, input, cwd);
  const verdict = evaluateRules(rules, { tool, subject: target.subject });

  // 已阻断或非路径类工具无需再做越界检查
  if (verdict.action === "deny" || !target.absolutePath || !isExternal(cwd, target.absolutePath)) {
    return { ...verdict, tool, subject: target.subject, scope: verdict.rule?.pattern ?? "*" };
  }

  const external = evaluateRules(rules, {
    tool: "external_directory",
    subject: target.absolutePath,
  });
  return {
    action: strongest(verdict.action, external.action),
    tool: "external_directory",
    subject: toPosixPath(target.absolutePath),
    scope: externalScope(target.absolutePath),
    rule: external.rule ?? verdict.rule,
  };
};

/**
 * 按会话权限档位改写判定结果：只放宽 `ask`，`deny` 永不突破。
 * `auto` 保留越界目录（`external_directory`）的审批，`full` 连越界一并放行。
 * 传入的 `tool` 应是判定给出的工具名（越界检查恒为 `external_directory`）。
 */
export const applyApprovalMode = (
  action: PermissionAction,
  tool: string,
  mode: PermissionMode,
): PermissionAction => {
  if (action !== "ask" || mode === "default") return action;
  if (mode === "auto" && tool === "external_directory") return action;
  return "allow";
};
