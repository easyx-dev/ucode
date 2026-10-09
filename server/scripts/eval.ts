/**
 * 提示词评测：用真实模型跑一组任务 fixture，抓工具调用、最终回复与落盘结果做断言，按提示词源对比。
 *
 * 这是「持续调优」的依据——换文案、改基线都由它决定取舍，而不是看提示词写得好不好。
 * 不进 `pnpm check`：需要真实端点，模型不按预期行动属于评测结论，不是代码错误；
 * 单次结果有随机性，用 `--attempts` 多跑几次看通过率、`--model` 多个模型横向看。
 * 依赖模型自觉行为的用例标为可选（带 `*`），只报通过率、不计入退出码。
 *
 * 会写盘的用例在隔离的 fixture 工作区（`.tmp/eval/workspace`）里跑，不碰仓库。
 *
 * 用法（默认值与 README 里的测试端点一致）：
 *   pnpm -F @ucode/server eval
 *   pnpm -F @ucode/server eval -- --source custom,pi
 *   pnpm -F @ucode/server eval -- --model deepseek-v4-flash,glm-5 --attempts 3
 *   pnpm -F @ucode/server eval -- --case read-not-cat,edit-in-workspace
 *   pnpm -F @ucode/server eval -- --base-url http://localhost:8317/v1 --api-key devtest
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type AgentSession,
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionMode } from "@ucode/contracts";
import { PROMPT_SOURCES, type PromptSource } from "../src/constants";
import type { PiRuntime } from "../src/core/runtime";
import { env } from "../src/env";
import { buildSessionOptions } from "../src/harness/session-config";
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
  /** 运行目录：`repo`（默认，只读检索用）或 `workspace`（会写盘的用隔离工作区） */
  cwd?: "repo" | "workspace";
  /** 至少要调用到其中一个工具 */
  toolsAny?: string[];
  /** 不得调用到的工具 */
  toolsNone?: string[];
  /** 最终回复至少要包含其中一个片段 */
  textAny?: string[];
  /** 直接断言落盘结果：工作区里的文件应包含某片段（比看回复更硬） */
  fileAfter?: { path: string; contains: string };
  /** 可选用例：依赖模型自觉行为、稳定性不足，只报通过率，不计入退出码 */
  optional?: boolean;
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
    name: "list-files",
    mode: "build",
    prompt: "列出 server/src/harness/prompt/locales 下的所有文件路径。",
    toolsAny: ["find", "ls", "grep"],
    textAny: ["zh-CN"],
  },
  {
    name: "ask-readonly",
    mode: "ask",
    prompt: "把 server/package.json 里的 name 字段改成 foo，改完告诉我。",
    toolsNone: ["edit", "write", "bash"],
  },
  {
    name: "edit-in-workspace",
    mode: "build",
    cwd: "workspace",
    prompt: "把当前目录下 hello.txt 的内容改成 World，改完只说一句结果。",
    toolsAny: ["edit", "write"],
    fileAfter: { path: "hello.txt", contains: "World" },
  },
  {
    name: "plan-present",
    mode: "plan",
    cwd: "workspace",
    optional: true,
    // 断言的是「plan 模式以 present_plan 收尾」，依赖模型自觉调用；实测两源都会漏，故作可选用例
    prompt: "为「给 server 增加一个把使用统计导出为 CSV 的接口」写一份简短计划。",
    toolsAny: ["present_plan"],
    toolsNone: ["edit", "write", "bash"],
  },
  {
    name: "plan-no-present",
    mode: "plan",
    optional: true,
    // 反向用例：没有可落地方案、需用户先拍板方向时不应以 present_plan 收尾；
    // 与 plan-present 互为正反，同样只报通过率、不当门禁
    prompt: "我想给这个项目加个新功能，你觉得加什么好？",
    toolsNone: ["present_plan"],
  },
];

/** 隔离工作区的初始文件；会写盘的用例每次尝试前都重建成这个状态 */
const WORKSPACE_FILES: Record<string, string> = { "hello.txt": "Hello\n" };

const baseUrl = readArg("base-url", "http://localhost:8317/v1");
const apiKey = readArg("api-key", "devtest");
const providerId = "local";
const modelIds = readList("model").length > 0 ? readList("model") : ["deepseek-v4-flash"];
const attempts = Math.max(1, Number(readArg("attempts", "1")) || 1);
const harnessDir = resolve(env.resourceRoot, ".tmp/eval/harness");
const workspaceDir = resolve(env.resourceRoot, ".tmp/eval/workspace");
const REPO_CWD = env.resourceRoot;

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

const prepareWorkspace = (): void => {
  rmSync(workspaceDir, { recursive: true, force: true });
  mkdirSync(workspaceDir, { recursive: true });
  for (const [name, content] of Object.entries(WORKSPACE_FILES)) {
    writeFileSync(resolve(workspaceDir, name), content, "utf8");
  }
};

const cwdOf = (item: EvalCase): string => (item.cwd === "workspace" ? workspaceDir : REPO_CWD);

const openSession = async (
  item: EvalCase,
  source: PromptSource,
  runtime: PiRuntime,
): Promise<AgentSession> => {
  const options = await buildSessionOptions({
    record: undefined,
    cwd: cwdOf(item),
    // 会话也落在评测自己的运行时目录，避免受用户真实数据目录的 skills / 设置影响
    harnessDir,
    mode: item.mode,
    sessionManager: SessionManager.inMemory(),
    runtime,
    websearch: () => ({ provider: "tavily", apiKey: "", baseUrl: "" }),
    permission: {
      listGrants: () => [],
      grant: () => {},
      request: async () => "allow_once" as const,
    },
    // 评测里没有前端可答，question 一律按取消结束，避免挂起
    question: { ask: async () => ({ kind: "cancelled" }) },
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
  if (item.fileAfter) {
    let content = "";
    try {
      content = readFileSync(resolve(cwdOf(item), item.fileAfter.path), "utf8");
    } catch {
      content = "";
    }
    if (!content.includes(item.fileAfter.contains)) {
      failures.push(`${item.fileAfter.path} 未包含 ${item.fileAfter.contains}`);
    }
  }
  return failures;
};

type AttemptResult = { toolsRan: string[]; text: string; failures: string[] };

const attempt = async (
  item: EvalCase,
  source: PromptSource,
  runtime: PiRuntime,
): Promise<AttemptResult> => {
  // 会写盘的用例每次重建成初始状态，重复跑才有意义
  if (item.cwd === "workspace") prepareWorkspace();

  const session = await openSession(item, source, runtime);
  const toolsRan: string[] = [];
  session.subscribe((event) => {
    if (event.type === "tool_execution_start") toolsRan.push(event.toolName);
  });
  try {
    await session.prompt(item.prompt);
    const text = session.getLastAssistantText() ?? "";
    return { toolsRan, text, failures: evaluate(item, toolsRan, text) };
  } finally {
    session.dispose();
  }
};

/** 每个模型的运行时由目标模型单独构造，装配层其余部分与线上共用同一入口 */
const runtimeFor = (modelRuntime: unknown, model: unknown): PiRuntime =>
  ({
    requireRuntime: () => modelRuntime,
    resolveModelRef: () => model,
  }) as unknown as PiRuntime;

const report = (item: EvalCase, results: AttemptResult[]): void => {
  const shown = results.find((entry) => entry.failures.length > 0) ?? results[results.length - 1];
  if (!shown) return;
  console.log(`  工具 ${shown.toolsRan.join(", ") || "无"}`);
  for (const failure of shown.failures) console.log(`    ✗ ${failure}`);
  if (shown.failures.length > 0) {
    const excerpt = shown.text.replace(/\s+/g, " ").slice(0, 400);
    console.log(`    回复：${excerpt}${shown.text.length > 400 ? "…" : ""}`);
  }
};

console.log(`[eval] ${baseUrl}  模型：${modelIds.join(" / ")}`);
console.log(
  `[eval] 源：${wantedSources.join(" / ")}  用例：${cases.map((item) => item.name).join(" / ")}`,
);
console.log(`[eval] 每次尝试 ${attempts} 遍\n`);
if (cases.some((item) => item.optional)) {
  console.log("[eval] 带 * 的用例为可选，只报通过率、不计入退出码\n");
}

let failed = 0;
for (const modelId of modelIds) {
  const { modelRuntime, model } = await createLocalGateway({
    harnessDir,
    baseUrl,
    apiKey,
    modelId,
    providerId,
  });
  if (!model) {
    console.error(`[eval] 模型未注册: ${providerId}/${modelId}`);
    process.exit(1);
  }
  const runtime = runtimeFor(modelRuntime, model);
  console.log(`— ${modelId} —`);

  for (const item of cases) {
    const cells: string[] = [];
    const details: Array<{ source: PromptSource; results: AttemptResult[] }> = [];

    for (const source of wantedSources) {
      const results: AttemptResult[] = [];
      for (let index = 0; index < attempts; index += 1) {
        results.push(await attempt(item, source, runtime));
      }
      const passes = results.filter((entry) => entry.failures.length === 0).length;
      const ok = passes === attempts;
      if (!ok && !item.optional) failed += 1;
      cells.push(
        `${source}=${ok ? "PASS" : "FAIL"}${attempts > 1 ? `(${passes}/${attempts})` : ""}`,
      );
      details.push({ source, results });
    }

    const label = item.optional ? `${item.name}*` : item.name;
    console.log(`${label.padEnd(18)} ${cells.join("  ")}`);
    for (const entry of details) {
      if (entry.results.every((result) => result.failures.length === 0)) continue;
      console.log(`  [${entry.source}]`);
      report(item, entry.results);
    }
  }
  console.log("");
}

console.log(`[eval] ${failed === 0 ? "全部通过" : `${failed} 项未通过`}`);
process.exit(failed === 0 ? 0 : 1);
