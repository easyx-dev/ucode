/**
 * 会话装配层单测：工作目录解析 + 工具装配。
 *
 * 工具装配起一个离线可用的 `ModelRuntime`（dummy provider，不发起任何请求）走真实 pi SDK，
 * 断言 `defaultTools` / 白名单两条路在 pi 侧的实际落点——这也兜住「工具名与 pi 注册名脱节后静默失效」。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  type AgentSession,
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { brand } from "@ucode/brand/values";
import type { ProviderConfig, SessionMode } from "@ucode/contracts";

import type { PromptSource } from "../../constants";
import { toProviderConfigInput } from "../../core/provider-config";
import type { PiRuntime } from "../../core/runtime";
import type { SessionRecord } from "../../db/session-repository";
import { env } from "../../env";
import {
  type AgentProfile,
  type AgentRegistry,
  agentRules,
  loadAgentRegistry,
  PRIMARY_PROFILES,
  primaryCapability,
  type ResolvedCapability,
  resolveSubagentCapability,
  subagentProfile,
} from "../agents";
import { MemoryService } from "../memory";
import { rememberFact } from "../memory/store";
import { buildFullPrompt, buildPromptOverlay } from "../prompt";
import { catalogFor } from "../prompt/locales";
import { buildSessionOptions, resolveSessionCwd } from "../session-config";
import { DEFAULT_EXTENSION_TOOLS } from "../tools";

const recordWith = (patch: Partial<SessionRecord>): SessionRecord => ({
  id: "s1",
  name: null,
  cwd: null,
  model: null,
  thinkingLevel: null,
  mode: "build",
  parentSessionId: null,
  agent: null,
  forkedFromId: null,
  goalState: null,
  childCount: 0,
  sourcePath: null,
  preview: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  ...patch,
});

describe("resolveSessionCwd", () => {
  it("绑定目录的会话用那个目录", () => {
    assert.equal(resolveSessionCwd(recordWith({ cwd: "/project" })), "/project");
  });

  it("未绑定目录的会话用工作区（由 id 派生）", () => {
    assert.equal(resolveSessionCwd(recordWith({})), `${env.workspaceRoot}/s1`);
  });
});

/** 只构造会话、不提问，因此不需要凭证与网络 */
const provider: ProviderConfig = {
  id: "dummy",
  api: "openai-completions",
  apiKey: "test",
  baseUrl: "http://127.0.0.1:9/v1",
  models: [
    {
      id: "m",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
};

const root = mkdtempSync(join(tmpdir(), "session-config-test-"));
const cwd = join(root, "cwd");

type SessionSnapshot = { tools: string[]; allTools: string[]; systemPrompt: string };

const sessionOf = async (
  mode: SessionMode,
  promptSource: PromptSource = "custom",
  memory?: MemoryService,
  subagent?: { profile: AgentProfile; capability: ResolvedCapability },
  agentRegistry?: AgentRegistry,
): Promise<AgentSession> => {
  const modelRuntime = await ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerProvider(provider.id, toProviderConfigInput(provider));
  await modelRuntime.setRuntimeApiKey(provider.id, provider.apiKey);
  const model = modelRuntime.getModel(provider.id, "m");
  assert.ok(model, "dummy 模型未注册");

  // 只用到三个方法，装配层不关心 PiRuntime 的其余行为
  const runtime = {
    requireRuntime: () => modelRuntime,
    resolveModelRef: () => model,
    getStatus: () => ({ thinkingLevel: "off" }),
  } as unknown as PiRuntime;

  const options = await buildSessionOptions({
    record: undefined,
    cwd,
    // 用测试自己的 pi 目录，别去读用户真实的数据目录
    agentDir: join(root, "pi"),
    mode,
    sessionManager: SessionManager.inMemory(),
    runtime,
    websearch: () => ({ provider: "tavily", apiKey: "", baseUrl: "" }),
    permission: { listGrants: () => [], grant: () => {}, request: async () => "deny" as const },
    question: { ask: async () => ({ kind: "cancelled" }) },
    // 与真实会话池一致：主会话提供 subagent 钩子（子会话的工具集本就不含 subagent，不受影响）
    subagents: { spawn: async () => ({ sessionId: "sub-test", text: "" }) },
    ...(subagent
      ? {
          profile: subagent.profile,
          capability: subagent.capability,
          parentRules: () => agentRules(PRIMARY_PROFILES[mode]),
        }
      : {}),
    ...(memory ? { memory } : {}),
    ...(agentRegistry ? { agentRegistry } : {}),
    promptSource,
  });
  const { session }: { session: AgentSession } = await createAgentSession(options);
  return session;
};

const snapshotOf = async (
  mode: SessionMode,
  promptSource: PromptSource = "custom",
  memory?: MemoryService,
  subagent?: { profile: AgentProfile; capability: ResolvedCapability },
): Promise<SessionSnapshot> => {
  const session = await sessionOf(mode, promptSource, memory, subagent);
  const snapshot = {
    tools: session.getActiveToolNames(),
    allTools: session.getAllTools().map((tool) => tool.name),
    systemPrompt: session.systemPrompt,
  };
  session.dispose();
  return snapshot;
};

/** 从会话里 subagent 工具的 schema 取 agent 可选角色；兼容单值 Literal 与 Union */
const agentOptionsOf = (session: AgentSession): string[] => {
  const tool = session.getAllTools().find((item) => item.name === "subagent");
  const agent = (
    tool?.parameters as {
      properties?: { agent?: { const?: string; anyOf?: { const?: string }[] } };
    }
  )?.properties?.agent;
  if (!agent) return [];
  if (typeof agent.const === "string") return [agent.const];
  return (agent.anyOf ?? [])
    .map((item) => item.const)
    .filter((value): value is string => typeof value === "string");
};

describe("buildSessionOptions 工具装配", () => {
  it("TS-01 build 走 defaultTools：codemode 激活，自研工具不被过滤", async () => {
    const { tools } = await snapshotOf("build");
    for (const name of [...DEFAULT_EXTENSION_TOOLS, "webfetch", "websearch", "question"]) {
      assert.ok(tools.includes(name), `build 应启用 ${name}，实际：${tools.join(", ")}`);
    }
    assert.ok(!tools.includes("present_plan"), "build 不应有 present_plan");
  });

  it("TS-02 plan / ask 走只读白名单：不含 codemode 与写盘 / 执行工具", async () => {
    for (const mode of ["plan", "ask"] as const) {
      const { tools, allTools } = await snapshotOf(mode);
      for (const name of ["codemode", "bash", "edit", "write"]) {
        assert.ok(!tools.includes(name), `${mode} 不应启用 ${name}，实际：${tools.join(", ")}`);
      }
      assert.ok(!allTools.includes("tool_search"), `${mode} 不应注册 tool_search`);
      assert.ok(tools.includes("webfetch"), `${mode} 应保留联网工具`);
      assert.ok(tools.includes("question"), `${mode} 应保留提问工具`);
    }
  });

  it("TS-04 tool_search 只注册不激活：无 deferred 服务器时不进默认工具集", async () => {
    const { tools, allTools } = await snapshotOf("build");
    assert.ok(
      allTools.includes("tool_search"),
      "build 应注册 tool_search 供 deferred 服务器按需激活",
    );
    assert.ok(
      !tools.includes("tool_search"),
      `无 deferred 服务器时不应激活，实际：${tools.join(", ")}`,
    );
  });
});

describe("buildSessionOptions 的 session_start", () => {
  // MCP 扩展在 `session_start` 时才连接服务器；build 会话必须能触发这一步（pool 也依赖它）
  it("build 触发 bindExtensions 不抛错", async () => {
    const session = await sessionOf("build");
    await assert.doesNotReject(() => session.bindExtensions({}));
    session.dispose();
  });
});

describe("buildSessionOptions 项目记忆", () => {
  const memoryAppDir = join(root, "memory-app");
  const enabledMemory = new MemoryService(() => ({ enabled: true }), memoryAppDir);
  const disabledMemory = new MemoryService(() => ({ enabled: false }), memoryAppDir);

  it("开启后 build 注册 remember / forget，并把索引注入上下文与提示词", async () => {
    rememberFact(cwd, { title: "包管理器", content: "项目统一用 pnpm。" }, memoryAppDir);

    const { tools, systemPrompt } = await snapshotOf("build", "custom", enabledMemory);
    for (const name of ["remember", "forget"]) {
      assert.ok(tools.includes(name), `build 应启用 ${name}，实际：${tools.join(", ")}`);
    }
    assert.ok(systemPrompt.includes("[包管理器](包管理器.md)"), "索引应注入上下文");
    assert.ok(systemPrompt.includes("## 项目记忆"), "提示词应含记忆分节");
  });

  it("未开启时不注册记忆工具、不注入记忆分节", async () => {
    const { tools, systemPrompt } = await snapshotOf("build", "custom", disabledMemory);
    for (const name of ["remember", "forget"]) {
      assert.ok(!tools.includes(name), `未开启不应有 ${name}`);
    }
    assert.ok(!systemPrompt.includes("## 项目记忆"), "未开启不应拼入记忆分节");
  });

  it("plan / ask 即使开启也不注册记忆工具", async () => {
    for (const mode of ["plan", "ask"] as const) {
      const { tools } = await snapshotOf(mode, "custom", enabledMemory);
      for (const name of ["remember", "forget"]) {
        assert.ok(!tools.includes(name), `${mode} 不应有 ${name}`);
      }
    }
  });
});

describe("buildSessionOptions 系统提示词", () => {
  // 断言只用我们自己的目录文案，不依赖 pi 的提示词措辞——pi 升级不该让这里误报
  const catalog = catalogFor();

  it("S-01 pi 源：叠加自研片段而非整段替换，pi 默认正文仍在", async () => {
    const overlay = buildPromptOverlay({ mode: "ask" });
    const { systemPrompt } = await snapshotOf("ask", "pi");
    assert.ok(systemPrompt.includes(overlay), "pi 源应原样包含叠加片段");
    assert.ok(!systemPrompt.includes(catalog.identity(brand.name)), "pi 源不应使用自研整段身份");
    assert.ok(systemPrompt.length > overlay.length, "pi 源应保留 pi 默认正文（比叠加片段长）");
  });

  it("S-02 custom 源：用自研整段替换 pi 默认正文", async () => {
    for (const mode of ["build", "plan", "ask"] as const) {
      const { systemPrompt } = await snapshotOf(mode, "custom");
      assert.ok(
        systemPrompt.includes(buildFullPrompt({ mode })),
        `${mode} 应原样包含自研整段提示词`,
      );
      assert.ok(
        !systemPrompt.includes(catalog.overlayIdentity(brand.name)),
        `${mode} 不应走 pi 源叠加路径`,
      );
    }

    const build = (await snapshotOf("build", "custom")).systemPrompt;
    const ask = (await snapshotOf("ask", "custom")).systemPrompt;
    assert.ok(build.includes("codemode"), "build 工具说明应含 codemode");
    assert.ok(!ask.includes("codemode"), "ask 提示词不应提到 codemode");
  });
});

describe("buildSessionOptions 子智能体装配", () => {
  const childOf = (parentMode: SessionMode, slug: "general" | "explore") => {
    const profile = subagentProfile(slug);
    return {
      profile,
      capability: resolveSubagentCapability(profile, primaryCapability(parentMode)),
    };
  };

  it("SUB-01 explore 在 build 父下只读，且不注册 subagent", async () => {
    const { tools, allTools } = await snapshotOf(
      "build",
      "custom",
      undefined,
      childOf("build", "explore"),
    );
    for (const name of ["edit", "write", "bash", "subagent", "present_plan"]) {
      assert.ok(!tools.includes(name), `explore 子会话不应启用 ${name}，实际：${tools.join(", ")}`);
    }
    assert.ok(tools.includes("read"));
    assert.ok(!allTools.includes("subagent"), "子会话不应注册 subagent（禁递归）");
  });

  it("SUB-01 plan 父派 general：被交集收窄为只读", async () => {
    const { tools } = await snapshotOf("plan", "custom", undefined, childOf("plan", "general"));
    for (const name of ["edit", "write", "bash", "subagent"]) {
      assert.ok(!tools.includes(name), `plan 下的 general 不应启用 ${name}`);
    }
    assert.ok(tools.includes("read"));
  });

  it("SUB-01 build 父派 general：保留写盘能力，但无 subagent", async () => {
    const { tools } = await snapshotOf("build", "custom", undefined, childOf("build", "general"));
    assert.ok(tools.includes("edit") && tools.includes("bash"));
    assert.ok(!tools.includes("subagent"));
  });

  it("角色声明的模型不可用时装配报错，不静默回落默认模型", async () => {
    const runtime = {
      resolveModelRef: () => null,
      getStatus: () => ({ thinkingLevel: "off" }),
      requireRuntime: () => assert.fail("校验应在建会话前就拦住"),
    } as unknown as PiRuntime;

    await assert.rejects(
      buildSessionOptions({
        record: undefined,
        cwd,
        mode: "build",
        sessionManager: SessionManager.inMemory(),
        runtime,
        profile: PRIMARY_PROFILES.build,
        capability: { ...primaryCapability("build"), model: "nope/model" },
        websearch: () => ({ provider: "tavily", apiKey: "", baseUrl: "" }),
        permission: {
          listGrants: () => [],
          grant: () => {},
          request: async () => "deny" as const,
        },
      }),
      /角色指定的模型不可用/,
    );
  });

  it("注册表里的隐藏角色仍进 agent 入参枚举，只是不进描述", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "session-config-agents-"));
    mkdirSync(join(agentDir, "agents"));
    writeFileSync(
      join(agentDir, "agents", "secret.md"),
      ["---", 'description: "隐藏角色"', "advertise: false", "---", "正文"].join("\n"),
    );

    const session = await sessionOf(
      "build",
      "custom",
      undefined,
      undefined,
      loadAgentRegistry(agentDir),
    );
    const tool = session.getAllTools().find((item) => item.name === "subagent");
    assert.ok(tool, "主会话应注册 subagent");
    assert.ok(agentOptionsOf(session).includes("secret"), "隐藏角色也应能被模型按名调用");
    assert.doesNotMatch(tool.description, /secret/);
    session.dispose();
  });

  it("子会话提示词用子角色约束", async () => {
    const catalog = catalogFor();
    const { systemPrompt } = await snapshotOf(
      "build",
      "custom",
      undefined,
      childOf("build", "explore"),
    );
    assert.ok(systemPrompt.includes(catalog.subagentConstraints.explore));
  });
});
