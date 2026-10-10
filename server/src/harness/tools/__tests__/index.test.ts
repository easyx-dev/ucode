/**
 * 自研工具装配单测：内置清单齐平、按可用工具名注册、工具自带提示词片段。
 *
 * 工具选择由角色能力决定，这里只盯 `buildCustomTools` 的产出。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WebsearchConfig } from "@ucode/contracts";

import { parseCustomAgent } from "../../agents";
import type { SubagentHooks } from "../../subagents";
import type { GoalToolHooks } from "../goal";
import { GOAL_BLOCKED_TOOL } from "../goal";
import { buildCustomTools, DEFAULT_BUILTIN_TOOLS, GOAL_TOOL_NAMES } from "../index";
import type { QuestionHooks } from "../question";

const readConfig = (): WebsearchConfig => ({ provider: "tavily", apiKey: "", baseUrl: "" });
const question: QuestionHooks = { ask: async () => ({ kind: "cancelled" }) };
const subagents: SubagentHooks = {
  spawn: async () => ({ sessionId: "sub-x", text: "ok" }),
};

const BUILD_NAMES = [
  ...DEFAULT_BUILTIN_TOOLS,
  "codemode",
  "webfetch",
  "websearch",
  "question",
  "subagent",
];
const PLAN_NAMES = [
  "read",
  "grep",
  "find",
  "ls",
  "webfetch",
  "websearch",
  "question",
  "present_plan",
];

const build = buildCustomTools({
  names: BUILD_NAMES,
  readWebsearchConfig: readConfig,
  question,
  subagents,
});
const plan = buildCustomTools({ names: PLAN_NAMES, readWebsearchConfig: readConfig, question });

const goal: GoalToolHooks = { complete: () => {}, block: () => {} };
/** 有 active 目标时装配层会把这些名字并进可用集合（见 `session-config`） */
const withGoal = buildCustomTools({
  names: [...BUILD_NAMES, ...GOAL_TOOL_NAMES],
  readWebsearchConfig: readConfig,
  question,
  subagents,
  goal,
});
/** 角色白名单只声明其中一个：两个工具各按自己的名字判定，不该整对挂上 */
const withBlockedOnly = buildCustomTools({
  names: [...BUILD_NAMES, GOAL_BLOCKED_TOOL],
  readWebsearchConfig: readConfig,
  question,
  subagents,
  goal,
});

const namesOf = (tools: readonly { name: string }[]): string[] =>
  tools.map((tool) => tool.name).sort();

/** 从 subagent 的参数 schema 取 agent 可选角色；兼容单值 Literal 与 Union 两种形状 */
const agentOptions = (tool: { parameters?: unknown }): string[] => {
  const agent = (
    tool.parameters as { properties?: { agent?: { const?: string; anyOf?: { const?: string }[] } } }
  )?.properties?.agent;
  if (!agent) return [];
  if (typeof agent.const === "string") return [agent.const];
  return (agent.anyOf ?? [])
    .map((item) => item.const)
    .filter((value): value is string => typeof value === "string");
};

describe("buildCustomTools", () => {
  it("内置清单包含只读检索工具，不含未启用的 powershell", () => {
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
      assert.ok(DEFAULT_BUILTIN_TOOLS.includes(name), `缺少内置工具 ${name}`);
    }
    assert.ok(!DEFAULT_BUILTIN_TOOLS.includes("powershell"));
  });

  it("build 只注册联网、提问与子智能体工具", () => {
    assert.deepEqual(namesOf(build), ["question", "subagent", "webfetch", "websearch"]);
  });

  it("present_plan 只在提供了该工具的集合里注册", () => {
    assert.ok(namesOf(plan).includes("present_plan"));
    assert.ok(!namesOf(build).includes("present_plan"));
  });

  it("集合里没有 subagent 时不注册（子会话能力交集的落点）", () => {
    assert.ok(!namesOf(plan).includes("subagent"));
  });

  it("subagent 工具按传入角色生成描述，隐藏角色只进枚举不进描述", () => {
    const visible = parseCustomAgent(
      "reviewer",
      ["---", 'description: "评审改动"', "---", "正文"].join("\n"),
    ).profile;
    const hidden = parseCustomAgent(
      "secret",
      ["---", 'description: "隐藏角色"', "advertise: false", "---", "正文"].join("\n"),
    ).profile;
    const tools = buildCustomTools({
      names: ["subagent"],
      readWebsearchConfig: readConfig,
      subagents,
      subagentProfiles: [visible, hidden],
    });
    const tool = tools.find((item) => item.name === "subagent");
    assert.ok(tool, "应注册 subagent");
    assert.match(tool.description, /reviewer/);
    assert.doesNotMatch(tool.description, /secret/);
    // 隐藏角色仍必须进 `agent` 入参枚举，否则等于不可调用
    assert.deepEqual(agentOptions(tool).sort(), ["reviewer", "secret"]);
  });

  it("目标结算工具只在注入钩子时注册", () => {
    assert.ok(!namesOf(build).includes("goal_complete"), "无钩子不注册");
    assert.deepEqual(
      namesOf(withGoal).filter((name) => (GOAL_TOOL_NAMES as readonly string[]).includes(name)),
      ["goal_blocked", "goal_complete"],
    );
  });

  it("只声明一个目标工具时只挂那一个", () => {
    assert.deepEqual(
      namesOf(withBlockedOnly).filter((name) => name.startsWith("goal_")),
      ["goal_blocked"],
    );
  });

  it("自研工具都带系统提示词片段", () => {
    for (const tool of [...build, ...plan, ...withGoal, ...withBlockedOnly]) {
      assert.ok(tool.description.length > 0, `${tool.name} 缺少 description`);
      assert.ok(tool.promptSnippet, `${tool.name} 缺少 promptSnippet`);
    }
  });
});
