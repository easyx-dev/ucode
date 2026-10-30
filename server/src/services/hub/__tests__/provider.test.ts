/** 中继 provider 注入：provider 形状、清单解析、幂等键与整条写入流程（清单拉取用替身，不连网） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type AppConfigPatchInput,
  ERROR_CODES,
  type HubProviderResponse,
  type ProviderConfig,
} from "@ucode/contracts";

import type { RawModelEntry } from "../../../config/provider-models";
import {
  createHubProviderInjector,
  type HubModelLister,
  hubModelBaseUrl,
  relayModelsOf,
  relayProviderOf,
  relayProviderOutcome,
  withRelayProvider,
} from "../provider";

const HUB_URL = "https://hub.example.com";
const DEVICE_TOKEN = "device-token-1";

const entry = (id: string, patch: Partial<RawModelEntry> = {}): RawModelEntry => ({
  id,
  name: id,
  contextWindow: null,
  maxTokens: null,
  ...patch,
});

/** 配置里已有的一条普通 provider（用它的 apiKey 验证写入不会丢） */
const userProvider = (patch: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: "user-openai",
  api: "openai-completions",
  apiKey: "sk-user",
  baseUrl: "https://api.openai.com/v1",
  models: [
    {
      id: "gpt-4o",
      reasoning: false,
      input: ["text"],
      maxTokens: 8192,
      contextWindow: 128_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
  ...patch,
});

describe("hubModelBaseUrl", () => {
  it("拼上 /v1 并去掉中继地址末尾的斜杠", () => {
    assert.equal(hubModelBaseUrl(HUB_URL), "https://hub.example.com/v1");
    assert.equal(hubModelBaseUrl(`${HUB_URL}/`), "https://hub.example.com/v1");
    assert.equal(hubModelBaseUrl(`${HUB_URL}/relay//`), "https://hub.example.com/relay/v1");
    assert.equal(hubModelBaseUrl(`  ${HUB_URL}  `), "https://hub.example.com/v1");
  });
});

describe("relayModelsOf", () => {
  it("按 id 关键词推断能力与读图，成本记 0（计价在中继侧）", () => {
    const models = relayModelsOf([entry("claude-sonnet-4-5"), entry("o3-mini")]);

    assert.deepEqual(
      models.map((model) => ({
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        input: model.input,
        cost: model.cost,
      })),
      [
        {
          id: "claude-sonnet-4-5",
          name: undefined,
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
        {
          id: "o3-mini",
          name: undefined,
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    );
  });

  it("展示名与 id 不同时才保留，窗口与输出上限取条目自带的、缺了按默认值", () => {
    const [named, plain] = relayModelsOf([
      entry("glm-4.6", { name: "GLM 4.6", contextWindow: 200_000, maxTokens: 64_000 }),
      entry("unknown-model"),
    ]);

    assert.equal(named?.name, "GLM 4.6");
    assert.equal(named?.contextWindow, 200_000);
    assert.equal(named?.maxTokens, 64_000);
    assert.equal(plain?.contextWindow, 128_000);
    assert.equal(plain?.maxTokens, 8192);
  });
});

describe("relayProviderOf", () => {
  it("id 与名称固定，凭证用设备令牌，其余字段即中继端点", () => {
    const models = relayModelsOf([entry("glm-4.6")]);
    const provider = relayProviderOf({
      baseUrl: hubModelBaseUrl(HUB_URL),
      deviceToken: DEVICE_TOKEN,
      models,
    });

    assert.deepEqual(provider, {
      id: "relay",
      name: "中继",
      baseUrl: "https://hub.example.com/v1",
      api: "openai-completions",
      apiKey: DEVICE_TOKEN,
      models,
    });
  });
});

describe("relayProviderOutcome / withRelayProvider", () => {
  const relay = relayProviderOf({
    baseUrl: "https://hub.example.com/v1",
    deviceToken: DEVICE_TOKEN,
    models: relayModelsOf([entry("glm-4.6")]),
  });
  const relayBaseUrl = relay.baseUrl ?? "";

  it("按同 id 的既有条目区分新建 / 更新 / 覆盖", () => {
    assert.equal(relayProviderOutcome([userProvider()], relayBaseUrl), "created");
    assert.equal(
      relayProviderOutcome([userProvider({ id: "relay", baseUrl: relayBaseUrl })], relayBaseUrl),
      "updated",
    );
    assert.equal(
      relayProviderOutcome(
        [userProvider({ id: "relay", baseUrl: "https://other.example.com/v1" })],
        relayBaseUrl,
      ),
      "overwritten",
    );
  });

  it("幂等：同 id 原位替换，其余 provider 与顺序都不动", () => {
    const others = [userProvider(), userProvider({ id: "second" })];
    const twice = withRelayProvider(withRelayProvider(others, relay), relay);

    assert.deepEqual(
      twice.map((provider) => provider.id),
      ["user-openai", "second", "relay"],
    );
    assert.deepEqual(twice[2], relay);
  });
});

describe("createHubProviderInjector", () => {
  /** 记录调用参数并返回预设清单的替身：不连网 */
  const listerOf = (
    entries: RawModelEntry[],
  ): { lister: HubModelLister; calls: Array<{ baseUrl: string; deviceToken: string }> } => {
    const calls: Array<{ baseUrl: string; deviceToken: string }> = [];
    return {
      calls,
      lister: async (input) => {
        calls.push(input);
        return entries;
      },
    };
  };

  const injectorOf = (options: {
    providers?: ProviderConfig[];
    entries?: RawModelEntry[];
  }): { add: () => Promise<HubProviderResponse>; patches: AppConfigPatchInput[] } => {
    const patches: AppConfigPatchInput[] = [];
    const { lister } = listerOf(options.entries ?? [entry("glm-4.6")]);
    const injector = createHubProviderInjector({
      getProviders: () => options.providers ?? [],
      applyConfig: async (patch) => {
        patches.push(patch);
      },
      listModels: lister,
    });
    return {
      patches,
      // 地址与设备令牌都在这里注入，用例只关心写入结果
      add: () => injector.add({ url: HUB_URL, deviceToken: DEVICE_TOKEN }),
    };
  };

  it("缺地址或设备令牌时给出各自的中文原因", async () => {
    const { lister } = listerOf([entry("glm-4.6")]);
    const deps = { getProviders: () => [], applyConfig: async () => {}, listModels: lister };
    const injector = createHubProviderInjector(deps);

    await assert.rejects(
      () => injector.add({ url: null, deviceToken: DEVICE_TOKEN }),
      (error: Error & { code?: string }) => error.code === ERROR_CODES.hubNotConfigured,
    );
    await assert.rejects(
      () => injector.add({ url: HUB_URL, deviceToken: null }),
      (error: Error & { code?: string }) => error.code === ERROR_CODES.hubNotBound,
    );
  });

  it("清单为空时报「中继没有可用的模型」，不写占位模型", async () => {
    const { add, patches } = injectorOf({ entries: [] });

    await assert.rejects(
      add,
      (error: Error & { code?: string }) => error.code === ERROR_CODES.hubModelsEmpty,
    );
    assert.deepEqual(patches, []);
  });

  it("首次写入：按中继地址拼端点拉清单，patch 带上原有的 provider", async () => {
    const providers = [userProvider()];
    const patches: AppConfigPatchInput[] = [];
    const { lister, calls } = listerOf([entry("glm-4.6"), entry("qwen3-coder")]);
    const injector = createHubProviderInjector({
      getProviders: () => providers,
      applyConfig: async (patch) => {
        patches.push(patch);
      },
      listModels: lister,
    });

    const result = await injector.add({ url: `${HUB_URL}/`, deviceToken: DEVICE_TOKEN });

    assert.deepEqual(calls, [{ baseUrl: "https://hub.example.com/v1", deviceToken: DEVICE_TOKEN }]);
    assert.deepEqual(result, {
      providerId: "relay",
      baseUrl: "https://hub.example.com/v1",
      models: ["glm-4.6", "qwen3-coder"],
      outcome: "created",
    });

    const written = patches[0]?.providers ?? [];
    assert.deepEqual(
      written.map((provider) => provider.id),
      ["user-openai", "relay"],
    );
    // patch 的 providers 是全量替换语义：原有 provider 的 key 必须原样带上，否则会被清掉
    assert.equal(written[0]?.apiKey, "sk-user");
    assert.equal(written[1]?.apiKey, DEVICE_TOKEN);
  });

  it("重复调用只更新同一份 provider，不产生第二条", async () => {
    const first = injectorOf({ providers: [userProvider()] });
    await first.add();
    const written = (first.patches[0]?.providers ?? []) as ProviderConfig[];

    const second = injectorOf({ providers: written });
    const result = await second.add();

    assert.equal(result.outcome, "updated");
    assert.deepEqual(
      (second.patches[0]?.providers ?? []).map((provider) => provider.id),
      ["user-openai", "relay"],
    );
  });

  it("同 id 但端点在别处时标明覆盖", async () => {
    const { add } = injectorOf({
      providers: [userProvider({ id: "relay", baseUrl: "https://other.example.com/v1" })],
    });

    assert.equal((await add()).outcome, "overwritten");
  });
});
