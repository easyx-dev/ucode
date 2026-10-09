/**
 * 配置变更分级的单测：判定真实改动落在哪些字段上，决定保存后要不要重建运行时。
 *
 * 分级比对的是「变更后」与「当前」配置，而不是 patch 里出现了哪些键 ——
 * 客户端保存时提交的是全量 patch（见 `packages/ui/src/lib/config-draft.ts` 的 `toUpdatePayload`）。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { classifyConfigChange } from "../classify";
import { ConfigStore } from "../store";

const dir = mkdtempSync(join(tmpdir(), "config-classify-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const store = () => new ConfigStore(join(dir, "config.json"));

/** 一次保存：把 patch 合并进当前配置，返回（当前配置, 变更后配置）*/
const save = (patch: Parameters<ConfigStore["merge"]>[0]) => {
  const config = store();
  const current = config.merge({
    providers: [{ id: "openai", api: "openai-completions", apiKey: "sk-1" }],
    defaultModel: "openai/gpt-4o",
    websearch: { provider: "tavily", apiKey: "tvly-1" },
    memory: { enabled: true },
  });
  config.set(current);
  return { current, next: config.merge(patch) };
};

describe("配置变更分级", () => {
  it("只有联网搜索变化时归为 lazy", () => {
    const { current, next } = save({ websearch: { apiKey: "tvly-2" } });
    assert.equal(classifyConfigChange(next, current), "lazy");
  });

  it("全量重提交同一份配置也归为 lazy", () => {
    const { current } = save({});
    const config = store();
    config.set(current);
    const next = config.merge({});
    assert.equal(classifyConfigChange(next, current), "lazy");
  });

  it("provider 的 key 变化要重建", () => {
    const { current, next } = save({
      providers: [{ id: "openai", api: "openai-completions", apiKey: "sk-2" }],
    });
    assert.equal(classifyConfigChange(next, current), "runtime");
  });

  it("默认模型变化要重建", () => {
    const { current, next } = save({ defaultModel: "openai/gpt-4o-mini" });
    assert.equal(classifyConfigChange(next, current), "runtime");
  });

  it("记忆开关变化要重建（工具与索引在装配时读入）", () => {
    const { current, next } = save({ memory: { enabled: false } });
    assert.equal(classifyConfigChange(next, current), "runtime");
  });
});
