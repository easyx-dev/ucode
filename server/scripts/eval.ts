/**
 * 提示词评测：用真实模型跑一组任务 fixture，抓工具调用与最终回复做断言，按提示词源对比。
 *
 * 这是「持续调优」的依据——换文案、改基线都由它决定取舍，而不是看提示词写得好不好。
 * 不进 `pnpm check`：需要真实端点，模型不按预期行动属于评测结论，不是代码错误。
 *
 * 用法（默认值与 README 里的测试端点一致）：
 *   pnpm -F @ucode/server eval
 *   pnpm -F @ucode/server eval -- --source pi,custom
 *   pnpm -F @ucode/server eval -- --case read-not-cat,ask-readonly
 *   pnpm -F @ucode/server eval -- --base-url http://localhost:8317/v1 --api-key devtest --model deepseek-v4-flash
 */
import { resolve } from "node:path";

import {
  type AgentSession,
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionMode } from "@ucode/contracts";

import { buildSessionOptions } from "../src/agent/session-config";
import { PROMPT_SOURCES, type PromptSource } from "../src/constants";
import type { PiRuntime } from "../src/core/runtime";
import { env } from "../src/env";
import { createLocalGateway } from "./lib/local-gateway";

const args = process.argv.slice(2);
const readArg = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : fallback;
};
const readList = (name: string): string[] =>
  readArg(name, "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

type EvalCase = {
  name: string;
  mode: SessionMode;
  prompt: string;
  /** 至少要调用到其中一个工具 */
  toolsAny?: string[];
  /** 不得调用到的工具 */
  toolsNone?: string[];
  /** 最终回复至少要包含其中一个片段 */
  textAny?: string[];
};

/** 每类用例只覆盖一个可判定的行为点，避免一条失败说不清是哪条提示词在起作用 */
const CASES: EvalCase[] = [
  {
    name: "read-not-cat",
    mode: "build",
    prompt: "读取 server/package.json，只回答其中的 name 字段值。",
    toolsAny: ["read"],
    toolsNone: ["bash"],
    textAny: ["@ucode/server"],
  },
  {
    name: "search-tool",
    mode: "build",
    prompt: "在整个仓库里找出哪份代码定义了 buildSessionOptions，只给出文件路径。",
    toolsAny: ["grep", "find"],
    textAny: ["session-config"],
  },
  {
    name: "ask-readonly",
    mode: "ask",
    prompt: "把 server/package.json 里的 name 字段改成 foo，改完告诉我。",
    toolsNone: ["edit", "write", "bash"],
  },
  {
    name: "plan-present",
    mode: "plan",
    prompt: "为「给 server 增加一个健康检查接口」写一份简短计划。",
    toolsAny: ["present_plan"],
  },
];

const baseUrl = readArg("base-url", "http://localhost:8317/v1");
const apiKey = readArg("api-key", "devtest");
const modelId = readArg("model", "deepseek-v4-flash");
const providerId = "local";
const agentDir = resolve(env.repoRoot, ".tmp/eval/agent");

// 未命中就报错退出：静默回落到默认源 / 空用例会让评测假报通过，比跑错更误导
const requestedSources = readList("source");
const unknownSources = requestedSources.filter(
  (value) => !(PROMPT_SOURCES as readonly string[]).includes(value),
);
if (unknownSources.length > 0) {
  console.error(
    `[eval] 未知提示词源：${unknownSources.join(", ")}（可选：${PROMPT_SOURCES.join(" / ")}）`,
  );
  process.exit(1);
}
const wantedSources =
  requestedSources.length > 0 ? (requestedSources as PromptSource[]) : [env.promptSource];

const caseFilter = readList("case");
const unknownCases = caseFilter.filter((name) => !CASES.some((item) => item.name === name));
if (unknownCases.length > 0) {
  console.error(
    `[eval] 未知用例：${unknownCases.join(", ")}（可选：${CASES.map((item) => item.name).join(" / ")}）`,
  );
  process.exit(1);
}
const cases =
  caseFilter.length > 0 ? CASES.filter((item) => caseFilter.includes(item.name)) : CASES;

const { modelRuntime, model } = await createLocalGateway({
  agentDir,
  baseUrl,
  apiKey,
  modelId,
  providerId,
});
if (!model) {
  console.error(`[eval] 模型未注册: ${providerId}/${modelId}`);
  process.exit(1);
}

/** 评测只关心提示词与工具行为，权限一律放行；装配层其余部分与线上共用同一入口 */
const runtime = {
  requireRuntime: () => modelRuntime,
  resolveModelRef: () => model,
  getStatus: () => ({ thinkingLevel: "off" }),
} as unknown as PiRuntime;

type Attempt = {
  source: PromptSource;
  ok: boolean;
  toolsRan: string[];
  failures: string[];
  /** 最终回复，失败时截断展示，便于判断是提示词问题还是模型跑偏 */
  text: string;
};

const openSession = async (item: EvalCase, source: PromptSource): Promise<AgentSession> => {
  const options = await buildSessionOptions({
    record: undefined,
    cwd: env.repoRoot,
    // 会话也落在评测自己的 agent 目录，避免受用户真实数据目录的 skills / 设置影响
    agentDir,
    mode: item.mode,
    sessionManager: SessionManager.inMemory(),
    runtime,
    websearch: () => ({ provider: "tavily", apiKey: "", baseUrl: "" }),
    permission: {
      listGrants: () => [],
      grant: () => {},
      request: async () => "allow_once" as const,
    },
    promptSource: source,
  });
  const { session } = await createAgentSession(options);
  return session;
};

const evaluate = (item: EvalCase, toolsRan: string[], text: string): string[] => {
  const failures: string[] = [];
  if (item.toolsAny?.length && !item.toolsAny.some((name) => toolsRan.includes(name))) {
    failures.push(`未调用 ${item.toolsAny.join(" / ")}（实际：${toolsRan.join(", ") || "无"}）`);
  }
  for (const name of item.toolsNone ?? []) {
    if (toolsRan.includes(name)) failures.push(`不应调用 ${name}`);
  }
  if (item.textAny?.length && !item.textAny.some((fragment) => text.includes(fragment))) {
    failures.push(`回复未包含 ${item.textAny.join(" / ")}`);
  }
  return failures;
};

const attempt = async (item: EvalCase, source: PromptSource): Promise<Attempt> => {
  const session = await openSession(item, source);
  const toolsRan: string[] = [];
  session.subscribe((event) => {
    if (event.type === "tool_execution_start") toolsRan.push(event.toolName);
  });
  try {
    await session.prompt(item.prompt);
    const text = session.getLastAssistantText() ?? "";
    const failures = evaluate(item, toolsRan, text);
    return { source, ok: failures.length === 0, toolsRan, failures, text };
  } finally {
    session.dispose();
  }
};

console.log(`[eval] ${providerId}/${modelId} @ ${baseUrl}`);
console.log(`[eval] cwd=${env.repoRoot}`);
console.log(
  `[eval] 源：${wantedSources.join(" / ")}，用例：${cases.map((item) => item.name).join(" / ")}\n`,
);

let failed = 0;
for (const item of cases) {
  const attempts: Attempt[] = [];
  for (const source of wantedSources) attempts.push(await attempt(item, source));

  const row = attempts.map((entry) => `${entry.source}=${entry.ok ? "PASS" : "FAIL"}`).join("  ");
  console.log(`${item.name.padEnd(16)} ${row}`);
  for (const entry of attempts) {
    console.log(`  ${entry.source}：工具 ${entry.toolsRan.join(", ") || "无"}`);
    for (const failure of entry.failures) console.log(`    ✗ ${failure}`);
    if (!entry.ok) {
      const excerpt = entry.text.replace(/\s+/g, " ").slice(0, 400);
      console.log(`    回复：${excerpt}${entry.text.length > 400 ? "…" : ""}`);
    }
  }
  failed += attempts.filter((entry) => !entry.ok).length;
}

console.log(`\n[eval] ${failed === 0 ? "全部通过" : `${failed} 项未通过`}`);
process.exit(failed === 0 ? 0 : 1);
