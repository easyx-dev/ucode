import { readFile } from "node:fs/promises";
import { storePaths } from "@ucode/store";
import { type HookEvent, type HookRegistration, isHookEvent } from "./types.ts";

/**
 * 钩子配置的加载与校验（F-3.7）。
 *
 * 配置来自**数据层**（用户自有、可信）：`<数据层>/hooks.json`。刻意不支持"项目内 hooks.json"——
 * 那等于让被克隆的仓库在你机器上执行任意命令，必须另配可信来源白名单才安全；首发不做，
 * 留待插件化（F-3.5）时按插件来源的可信级别处置。
 */

export type LoadHooksResult = {
  registrations: HookRegistration[];
  /** 配置层面的问题（不合法条目被跳过，但在诊断里留痕）。 */
  errors: string[];
};

export function hooksFileFor(dataDir: string): string {
  return storePaths(dataDir).hooks;
}

export async function loadHookRegistrations(hooksFile: string): Promise<LoadHooksResult> {
  let raw: string;
  try {
    raw = await readFile(hooksFile, "utf8");
  } catch {
    return { registrations: [], errors: [] }; // 没配置钩子是常态
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { registrations: [], errors: [`hooks.json 不是合法 JSON：${String(error)}`] };
  }

  const list = (parsed as { hooks?: unknown }).hooks;
  if (!Array.isArray(list)) {
    return { registrations: [], errors: ["hooks.json 缺少 hooks 数组。"] };
  }

  const registrations: HookRegistration[] = [];
  const errors: string[] = [];
  list.forEach((item, index) => {
    const result = validateRegistration(item, index);
    if (typeof result === "string") errors.push(result);
    else registrations.push(result);
  });
  return { registrations, errors };
}

function validateRegistration(item: unknown, index: number): HookRegistration | string {
  if (typeof item !== "object" || item === null) return `hooks[${index}] 不是对象。`;
  const raw = item as Record<string, unknown>;
  const event = raw.event;
  if (!isHookEvent(event)) {
    return `hooks[${index}].event 非法：${String(event)}（应为 ${"SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Stop"}）。`;
  }
  const command = raw.command;
  const isStringCommand = typeof command === "string" && command.trim() !== "";
  const isArgv =
    Array.isArray(command) &&
    command.length > 0 &&
    command.every((part) => typeof part === "string" && part !== "");
  if (!isStringCommand && !isArgv) {
    return `hooks[${index}].command 必须是非空字符串或字符串数组。`;
  }
  const timeoutMs = raw.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || timeoutMs <= 0)) {
    return `hooks[${index}].timeoutMs 必须是正数。`;
  }
  const registration: HookRegistration = {
    event: event as HookEvent,
    command: command as string | string[],
  };
  if (typeof raw.matcher === "string") registration.matcher = raw.matcher;
  if (typeof timeoutMs === "number") registration.timeoutMs = timeoutMs;
  if (typeof raw.description === "string") registration.description = raw.description;
  return registration;
}
