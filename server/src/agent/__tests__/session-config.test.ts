/**
 * 会话装配层单测：工作目录解析 + 工具装配。
 *
 * 工具装配起一个离线可用的 `ModelRuntime`（dummy provider，不发起任何请求）走真实 pi SDK，
 * 断言 `defaultTools` / 白名单两条路在 pi 侧的实际落点——这也兜住「工具名与 pi 注册名脱节后静默失效」。
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  type AgentSession,
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ProviderConfig, SessionMode } from "@ucode/contracts";

import type { PromptSource } from "../../constants";
import { toProviderConfigInput } from "../../core/provider-config";
import type { PiRuntime } from "../../core/runtime";
import type { SessionRecord } from "../../db/session-repository";
import { env } from "../../env";
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

type SessionSnapshot = { tools: string[]; systemPrompt: string };

const snapshotOf = async (
  mode: SessionMode,
  promptSource: PromptSource = "custom",
): Promise<SessionSnapshot> => {
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
    promptSource,
  });
  const { session }: { session: AgentSession } = await createAgentSession(options);
  const snapshot = { tools: session.getActiveToolNames(), systemPrompt: session.systemPrompt };
  session.dispose();
  return snapshot;
};

describe("buildSessionOptions 工具装配", () => {
  it("TS-01 build 走 defaultTools：codemode 激活，自研工具不被过滤", async () => {
    const { tools } = await snapshotOf("build");
    for (const name of [...DEFAULT_EXTENSION_TOOLS, "webfetch", "websearch"]) {
      assert.ok(tools.includes(name), `build 应启用 ${name}，实际：${tools.join(", ")}`);
    }
    assert.ok(!tools.includes("present_plan"), "build 不应有 present_plan");
  });

  it("TS-02 plan / ask 走只读白名单：不含 codemode 与写盘 / 执行工具", async () => {
    for (const mode of ["plan", "ask"] as const) {
      const { tools } = await snapshotOf(mode);
      for (const name of ["codemode", "bash", "edit", "write"]) {
        assert.ok(!tools.includes(name), `${mode} 不应启用 ${name}，实际：${tools.join(", ")}`);
      }
      assert.ok(tools.includes("webfetch"), `${mode} 应保留联网工具`);
    }
  });
});

describe("buildSessionOptions 系统提示词", () => {
  it("S-01 pi 源：保留 pi 默认提示词与工具指引，并叠加自研身份 / 模式 / 外部内容", async () => {
    const { systemPrompt } = await snapshotOf("ask", "pi");
    assert.ok(systemPrompt.includes("expert coding assistant"), "pi 源应保留 pi 默认前缀");
    // promptGuidelines 随 pi 的 rules 节保留，这正是 pi 源的价值
    assert.ok(systemPrompt.includes("instead of cat or sed"), "pi 源应保留工具指引");
    assert.ok(systemPrompt.includes(catalogFor().modeConstraints.ask), "pi 源应叠加模式约束");
    assert.ok(systemPrompt.includes("<addendum>"), "自研片段应走 addendum 节");
  });

  it("S-02 custom 源：整段替换 pi 默认前缀，模式差异体现在提示词里", async () => {
    for (const mode of ["build", "plan", "ask"] as const) {
      const { systemPrompt } = await snapshotOf(mode, "custom");
      assert.ok(!systemPrompt.includes("expert coding assistant"), `${mode} 残留 pi 默认前缀`);
      assert.ok(!systemPrompt.includes("Pi documentation"), `${mode} 残留 pi 文档节`);
      assert.ok(!systemPrompt.includes("instead of cat or sed"), `${mode} 残留 pi 工具指引`);
      assert.ok(
        systemPrompt.includes(catalogFor().modeConstraints[mode]),
        `${mode} 未包含模式约束`,
      );
    }

    const build = (await snapshotOf("build", "custom")).systemPrompt;
    const ask = (await snapshotOf("ask", "custom")).systemPrompt;
    assert.ok(build.includes("codemode"), "build 工具说明应含 codemode");
    assert.ok(!ask.includes("codemode"), "ask 提示词不应提到 codemode");
  });
});
