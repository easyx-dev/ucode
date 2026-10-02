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
import { brand } from "@ucode/brand/values";
import type { ProviderConfig, SessionMode } from "@ucode/contracts";

import type { PromptSource } from "../../constants";
import { toProviderConfigInput } from "../../core/provider-config";
import type { PiRuntime } from "../../core/runtime";
import type { SessionRecord } from "../../db/session-repository";
import { env } from "../../env";
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
    question: { ask: async () => ({ kind: "cancelled" }) },
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
    for (const name of [...DEFAULT_EXTENSION_TOOLS, "webfetch", "websearch", "question"]) {
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
      assert.ok(tools.includes("question"), `${mode} 应保留提问工具`);
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
