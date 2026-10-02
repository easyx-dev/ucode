/** config.json 读写的单测：联网搜索配置的合并、沿用、清空与脱敏（阶段 1c） */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { ConfigStore, emptyConfig, publicConfig } from "../store";

const dir = mkdtempSync(join(tmpdir(), "config-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** 每个用例一个新实例；只有需要落盘的用例才会真的写文件 */
const store = () => new ConfigStore(join(dir, "config.json"));

describe("联网搜索配置", () => {
  it("默认是 Tavily，且 key 与实例地址都为空", () => {
    assert.deepEqual(store().get().websearch, { provider: "tavily", apiKey: "", baseUrl: "" });
  });

  it("patch 省略时保持原值", () => {
    assert.equal(store().merge({}).websearch.provider, "tavily");
  });

  it("可以切换服务商", () => {
    const merged = store().merge({ websearch: { provider: "searxng" } });
    assert.equal(merged.websearch.provider, "searxng");
  });

  it("apiKey 留空表示沿用已保存的 key", () => {
    const first = store();
    first.set(first.merge({ websearch: { apiKey: "tvly-secret" } }));

    const reloaded = store();
    assert.equal(reloaded.load().websearch.apiKey, "tvly-secret");
    assert.equal(
      reloaded.merge({ websearch: { provider: "brave" } }).websearch.apiKey,
      "tvly-secret",
    );
  });

  it("实例地址是普通文本：留空即清空，省略才沿用", () => {
    const first = store();
    first.set(first.merge({ websearch: { baseUrl: "http://localhost:8888" } }));

    const reloaded = store();
    reloaded.load();
    assert.equal(
      reloaded.merge({ websearch: { provider: "searxng" } }).websearch.baseUrl,
      "http://localhost:8888",
    );
    assert.equal(reloaded.merge({ websearch: { baseUrl: "" } }).websearch.baseUrl, "");
  });

  it("对外视图带脱敏 key 与实例地址", () => {
    const config = store().merge({
      websearch: { provider: "searxng", apiKey: "tvly-secret", baseUrl: "http://localhost:8888" },
    });
    assert.deepEqual(publicConfig(config).websearch, {
      provider: "searxng",
      apiKeyMasked: "****cret",
      baseUrl: "http://localhost:8888",
      configured: true,
    });

    assert.deepEqual(publicConfig(emptyConfig()).websearch, {
      provider: "tavily",
      apiKeyMasked: "",
      baseUrl: "",
      configured: false,
    });
  });

  it("configured 只看当前 provider 需要的那一项", () => {
    const keyless = publicConfig(store().merge({ websearch: { provider: "searxng" } })).websearch;
    assert.equal(keyless.configured, false);

    const withUrl = publicConfig(
      store().merge({ websearch: { provider: "searxng", baseUrl: "http://127.0.0.1:8888" } }),
    ).websearch;
    assert.equal(withUrl.configured, true);

    // 切到需要 key 的 provider 后，光有实例地址不算配好
    const switched = publicConfig(
      store().merge({
        websearch: { provider: "tavily", baseUrl: "http://127.0.0.1:8888" },
      }),
    ).websearch;
    assert.equal(switched.configured, false);
  });
});

describe("记忆配置", () => {
  it("默认关闭", () => {
    assert.deepEqual(store().get().memory, { enabled: false });
    assert.equal(store().merge({}).memory.enabled, false);
  });

  it("可以开启并落盘、脱敏视图同步", () => {
    const first = store();
    first.set(first.merge({ memory: { enabled: true } }));

    const reloaded = store();
    assert.equal(reloaded.load().memory.enabled, true);
    assert.deepEqual(publicConfig(reloaded.get()).memory, { enabled: true });
  });

  it("省略时不改动", () => {
    const store1 = store();
    store1.set(store1.merge({ memory: { enabled: true } }));
    store1.set(store1.merge({ thinkingLevel: "high" }));
    assert.equal(store1.get().memory.enabled, true);
  });
});
