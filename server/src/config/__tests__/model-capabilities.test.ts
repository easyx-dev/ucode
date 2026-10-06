/**
 * 模型能力推断的单测：分层优先级、id 关键词规则与无依据时的回落。
 *
 * 推断结果会直接写进用户配置（设置页拉到列表后保存），所以这里盯的是「拿不准时保守」——
 * 没有依据就不给推理 / 视觉能力，窗口取与 schema 默认值一致的值。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inferFromModelId, inferModelCapabilities } from "../model-capabilities";

describe("按模型 id 推断", () => {
  it("识别推理模型的命名标记", () => {
    assert.equal(inferFromModelId("o3-mini").reasoning, true);
    assert.equal(inferFromModelId("deepseek-r1").reasoning, true);
    assert.equal(inferFromModelId("qwen3-235b-thinking").reasoning, true);
    assert.equal(inferFromModelId("gpt-4o").reasoning, undefined);
  });

  it("识别视觉能力的标记与家族", () => {
    assert.equal(inferFromModelId("qwen2.5-vl-72b").vision, true);
    assert.equal(inferFromModelId("claude-sonnet-4").vision, true);
    assert.equal(inferFromModelId("glm-4v-plus").vision, true);
    assert.equal(inferFromModelId("deepseek-r1").vision, undefined);
  });

  it("大小写都能命中", () => {
    assert.equal(inferFromModelId("O3-Mini").reasoning, true);
  });
});

describe("能力分层", () => {
  it("无任何线索时取默认值并标注 default", () => {
    const capabilities = inferModelCapabilities("mystery-model", {});
    assert.deepEqual(capabilities, {
      reasoning: false,
      vision: false,
      contextWindow: 128000,
      maxTokens: 8192,
      source: "default",
    });
  });

  it("id 关键词命中时标注 heuristic", () => {
    const capabilities = inferModelCapabilities("o3-mini", {});
    assert.equal(capabilities.reasoning, true);
    assert.equal(capabilities.source, "heuristic");
  });

  it("已保存配置优先于上游元数据", () => {
    const capabilities = inferModelCapabilities("gpt-4o", {
      configured: { reasoning: false, vision: true, contextWindow: 64_000, maxTokens: 4096 },
      upstream: { reasoning: null, vision: null, contextWindow: 1_000_000, maxTokens: null },
    });
    assert.equal(capabilities.source, "configured");
    assert.equal(capabilities.contextWindow, 64000);
    assert.equal(capabilities.maxTokens, 4096);
  });

  it("上游元数据优先于 id 推断与内置目录", () => {
    const capabilities = inferModelCapabilities("gpt-4o", {
      upstream: { reasoning: null, vision: null, contextWindow: 1_000_000, maxTokens: null },
      catalog: { reasoning: false, vision: true, contextWindow: 128_000, maxTokens: 16_384 },
    });
    assert.equal(capabilities.source, "upstream");
    assert.equal(capabilities.contextWindow, 1_000_000);
    // 上游没给的项由下层补齐
    assert.equal(capabilities.maxTokens, 16384);
    assert.equal(capabilities.vision, true);
  });

  it("内置目录优先于 id 推断", () => {
    const capabilities = inferModelCapabilities("custom-model", {
      catalog: { reasoning: true, vision: false, contextWindow: 200_000, maxTokens: 64_000 },
    });
    assert.equal(capabilities.source, "catalog");
    assert.equal(capabilities.reasoning, true);
    assert.equal(capabilities.contextWindow, 200000);
  });
});
