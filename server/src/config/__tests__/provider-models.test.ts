/**
 * 拉取 provider 模型列表的单测：响应形态解析、能力补齐与错误映射。
 *
 * 全部用被替换的全局 fetch 在进程内应答，不打真实网络（用户配置里有真 key，不能拿去压上游）。
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { ApiType, CatalogModel, ProviderModel } from "@ucode/contracts";
import { providerModelSchema } from "@ucode/contracts";

import { fetchProviderModels, parseProviderModels } from "../provider-models";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** 替换全局 fetch：记下请求，用给定的响应体与状态码在进程内应答 */
const stubJson = (
  body: string,
  status = 200,
): { calls: Array<{ url: string; init: RequestInit }> } => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls };
};

const stubFetch = (payload: unknown, status = 200) => stubJson(JSON.stringify(payload), status);

/** 让 fetch 以网络层异常失败（超时 / 连接被拒） */
const stubThrow = (error: Error): void => {
  globalThis.fetch = (async () => {
    throw error;
  }) as typeof fetch;
};

const query = (overrides: Partial<Parameters<typeof fetchProviderModels>[0]> = {}) => ({
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  api: "openai-completions" as ApiType,
  ...overrides,
});

describe("响应形态解析", () => {
  it("接受 OpenAI 兼容的 { data: [{ id }] }", () => {
    const models = parseProviderModels({
      object: "list",
      data: [{ id: "gpt-4o", object: "model" }, { id: "gpt-4o-mini" }],
    });
    assert.deepEqual(
      models.map((model) => model.id),
      ["gpt-4o", "gpt-4o-mini"],
    );
  });

  it("接受 { models: [...] } 与裸数组，字符串条目按 id 处理", () => {
    assert.deepEqual(
      parseProviderModels({ models: ["a", "b"] }).map((model) => model.id),
      ["a", "b"],
    );
    assert.deepEqual(
      parseProviderModels([{ id: "x", name: "X 模型" }, "y"]).map((model) => ({
        id: model.id,
        name: model.name,
      })),
      [
        { id: "x", name: "X 模型" },
        { id: "y", name: "y" },
      ],
    );
  });

  it("按出现顺序去重，丢弃没有 id 的条目", () => {
    const models = parseProviderModels({
      data: [{ id: "a" }, { id: "a", name: "重复" }, { object: "model" }, null, 42, { model: "b" }],
    });
    assert.deepEqual(
      models.map((model) => model.id),
      ["a", "b"],
    );
  });

  it("读取条目自带的窗口与输出上限（各家键名不一）", () => {
    const models = parseProviderModels({
      data: [
        { id: "a", context_length: 200000, max_output_tokens: 64000 },
        { id: "b", max_model_len: 32768, max_tokens: 4096 },
        { id: "c", context_window: "128000" },
      ],
    });
    assert.deepEqual(models[0]?.contextWindow, 200000);
    assert.deepEqual(models[0]?.maxTokens, 64000);
    assert.deepEqual(models[1]?.contextWindow, 32768);
    assert.deepEqual(models[1]?.maxTokens, 4096);
    // 非数字的声明忽略，不猜
    assert.equal(models[2]?.contextWindow, null);
  });

  it("形态不认识时返回空数组", () => {
    assert.deepEqual(parseProviderModels({ error: { message: "no key" } }), []);
    assert.deepEqual(parseProviderModels("<html></html>"), []);
    assert.deepEqual(parseProviderModels(null), []);
  });
});

describe("请求构造与成功路径", () => {
  it("请求 {baseUrl}/models（去尾部斜杠）并带上 Bearer", async () => {
    const { calls } = stubFetch({ data: [{ id: "gpt-4o" }] });
    const result = await fetchProviderModels(query({ baseUrl: "https://api.example.com/v1/" }));

    assert.equal(result.url, "https://api.example.com/v1/models");
    assert.equal(calls[0]?.url, "https://api.example.com/v1/models");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer sk-test");
    assert.ok(typeof result.latencyMs === "number");
  });

  it("能力按 id 推断且能直接落成配置条目", async () => {
    stubFetch({ data: [{ id: "o3-mini" }, { id: "qwen2.5-vl-72b", name: "Qwen VL" }] });
    const result = await fetchProviderModels(query());

    const [first, second] = result.models;
    assert.equal(first?.capabilitySource, "heuristic");
    assert.equal(first?.reasoning, true);
    assert.equal(first?.configured, false);
    assert.equal(second?.vision, true);
    assert.equal(second?.name, "Qwen VL");
    // 回落值与 providerModelSchema 的默认值一致：保存后行为不漂移
    const parsed = providerModelSchema.parse({
      id: first?.id,
      reasoning: first?.reasoning,
      contextWindow: first?.contextWindow,
      maxTokens: first?.maxTokens,
    });
    assert.equal(parsed.contextWindow, first?.contextWindow);
  });

  it("配置里已有的同 id 模型以保存值为准并标记 configured", async () => {
    const saved: ProviderModel = {
      id: "gpt-4o",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 64_000,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    stubFetch({ data: [{ id: "gpt-4o", context_length: 1_000_000 }] });
    const result = await fetchProviderModels(query({ configuredModels: [saved] }));

    assert.equal(result.models[0]?.configured, true);
    assert.equal(result.models[0]?.capabilitySource, "configured");
    assert.equal(result.models[0]?.contextWindow, 64000);
  });

  it("内置目录条目作为次级来源参与推断", async () => {
    const catalog: CatalogModel = {
      id: "builtin-model",
      name: "Builtin",
      reasoning: true,
      vision: true,
      contextWindow: 200_000,
      maxTokens: 64_000,
    };
    stubFetch({ data: [{ id: "builtin-model" }] });
    const result = await fetchProviderModels(query({ catalogModels: [catalog] }));

    assert.equal(result.models[0]?.capabilitySource, "catalog");
    assert.equal(result.models[0]?.reasoning, true);
    assert.equal(result.models[0]?.vision, true);
  });

  it("超过上限时截断并标注 truncated", async () => {
    const data = Array.from({ length: 501 }, (_, index) => ({ id: `model-${index}` }));
    stubFetch({ data });
    const result = await fetchProviderModels(query());

    assert.equal(result.models.length, 500);
    assert.equal(result.truncated, true);
  });
});

describe("错误映射", () => {
  it("非 openai-completions 的 api 直接拒绝", async () => {
    await assert.rejects(
      fetchProviderModels(query({ api: "anthropic-messages" })),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "unsupported_api");
        assert.match(error.message, /openai-completions/);
        return true;
      },
    );
  });

  it("401 给出鉴权提示", async () => {
    stubJson(JSON.stringify({ error: { message: "invalid api key" } }), 401);
    await assert.rejects(fetchProviderModels(query()), (error: Error & { code?: string }) => {
      assert.equal(error.code, "upstream_error");
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /apiKey/);
      return true;
    });
  });

  it("404 提示 baseUrl 可能缺路径段", async () => {
    stubJson("{}", 404);
    await assert.rejects(fetchProviderModels(query()), /baseUrl/);
  });

  it("200 但返回 HTML 时说明不是 JSON", async () => {
    stubJson("<html><body>502 Bad Gateway</body></html>");
    await assert.rejects(fetchProviderModels(query()), /不是 JSON/);
  });

  it("返回 JSON 但没有模型列表时如实报错", async () => {
    stubFetch({ error: { message: "unsupported" } });
    await assert.rejects(fetchProviderModels(query()), /没有可识别的模型列表/);
  });

  it("超时说明耗时并带上地址", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    stubThrow(timeout);
    await assert.rejects(fetchProviderModels(query()), (error: Error & { code?: string }) => {
      assert.equal(error.code, "upstream_unreachable");
      assert.match(error.message, /超时（20 秒）/);
      assert.match(error.message, /\/models/);
      return true;
    });
  });

  it("连接失败报上游不可达", async () => {
    stubThrow(new Error("fetch failed"));
    await assert.rejects(fetchProviderModels(query()), (error: Error & { code?: string }) => {
      assert.equal(error.code, "upstream_unreachable");
      assert.match(error.message, /无法连接/);
      return true;
    });
  });
});
