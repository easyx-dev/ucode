import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addProviderConfig,
  configureProvider,
  deleteProviderConfig,
  listAvailableModels,
  listProviderSummaries,
} from "./models.ts";

/**
 * 供应商配置（F-5.3）的核心层行为。
 *
 * 这里用**临时数据层目录**跑真实读写：这些函数的价值恰恰在"写进去之后基座怎么看它"，
 * 用桩替掉 ModelRuntime 就把要验的东西验没了。
 */

const dirs: string[] = [];

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "providers-"));
  dirs.push(dir);
  await rm(dir, { recursive: true, force: true });
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })),
  );
});

describe("供应商配置", () => {
  it("写入后能读回来，且密钥只回报「有」不回读明文", async () => {
    const dir = await freshDir();
    await addProviderConfig(dir, {
      id: "my-proxy",
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKey: "sk-secret-value",
      models: [{ id: "gpt-4o-mini", name: "gpt-4o-mini", input: ["text"] }],
      makeDefault: true,
    });

    const { providers, configFile } = await listProviderSummaries(dir);
    expect(providers).toHaveLength(1);
    const provider = providers[0];
    expect(provider?.id).toBe("my-proxy");
    expect(provider?.hasApiKey).toBe(true);
    // 密钥本身不得出现在返回形状里
    expect(JSON.stringify(providers)).not.toContain("sk-secret-value");
    expect(configFile.endsWith("models.json")).toBe(true);

    // 磁盘上确实写了密钥（这是唯一该有它的地方）
    const raw = await readFile(join(dir, "models.json"), "utf8");
    expect(raw).toContain("sk-secret-value");

    // 默认模型写进 settings.json
    const settings = JSON.parse(await readFile(join(dir, "settings.json"), "utf8")) as {
      defaultProvider?: string;
      defaultModel?: string;
    };
    expect(settings).toEqual({ defaultProvider: "my-proxy", defaultModel: "gpt-4o-mini" });
  });

  it("覆盖写时不给密钥就保留原来那把（否则改模型列表会把凭据抹掉）", async () => {
    const dir = await freshDir();
    await addProviderConfig(dir, {
      id: "p",
      baseUrl: "http://x/v1",
      apiKey: "sk-keep-me",
      models: [{ id: "m1" }],
    });
    await addProviderConfig(dir, {
      id: "p",
      baseUrl: "http://x/v1",
      models: [{ id: "m1" }, { id: "m2" }],
    });

    const raw = JSON.parse(await readFile(join(dir, "models.json"), "utf8")) as {
      providers: Record<string, { apiKey?: string; models: { id: string }[] }>;
    };
    expect(raw.providers.p?.apiKey).toBe("sk-keep-me");
    expect(raw.providers.p?.models.map((model) => model.id)).toEqual(["m1", "m2"]);
  });

  it("created 区分新增与覆盖", async () => {
    const dir = await freshDir();
    const first = await addProviderConfig(dir, {
      id: "p",
      baseUrl: "http://x/v1",
      models: [{ id: "m1" }],
    });
    expect(first.created).toBe(true);
    const second = await addProviderConfig(dir, {
      id: "p",
      baseUrl: "http://x/v1",
      models: [{ id: "m1" }],
    });
    expect(second.created).toBe(false);
  });

  it("删除：删掉了返回 true，本来就没有返回 false", async () => {
    const dir = await freshDir();
    await addProviderConfig(dir, { id: "p", baseUrl: "http://x/v1", models: [{ id: "m1" }] });
    expect(await deleteProviderConfig(dir, "p")).toBe(true);
    expect(await deleteProviderConfig(dir, "p")).toBe(false);
    expect((await listProviderSummaries(dir)).providers).toEqual([]);
  });

  it("与基座内置供应商同名时给出漂移告警（这是「发消息没反应」的成因）", async () => {
    const dir = await freshDir();
    const outcome = await addProviderConfig(dir, {
      id: "deepseek",
      baseUrl: "http://127.0.0.1:8317/v1",
      apiKey: "k",
      models: [{ id: "deepseek-v4-flash", name: "deepseek-v4-flash", input: ["text"] }],
    });
    expect(outcome.warning).not.toBeNull();
    expect(outcome.warning).toContain("deepseek");
    // 基座内置目录被并进来，因此解析出的模型多于声明
    expect(outcome.provider.models.length).toBeGreaterThan(1);
  });

  it("不与内置重名时没有告警", async () => {
    const dir = await freshDir();
    const outcome = await addProviderConfig(dir, {
      id: "test-proxy",
      baseUrl: "http://127.0.0.1:8317/v1",
      apiKey: "k",
      models: [{ id: "deepseek-v4-flash", name: "deepseek-v4-flash", input: ["text"] }],
    });
    expect(outcome.warning).toBeNull();
    expect(outcome.provider.models.map((model) => model.id)).toEqual(["deepseek-v4-flash"]);
  });

  it("没配任何供应商时可用模型为空（界面据此提示去配）", async () => {
    const dir = await freshDir();
    expect(await listAvailableModels(dir)).toEqual([]);
  });

  it("configureProvider 仍可写入（CLI 之外的旧调用点）", async () => {
    const dir = await freshDir();
    await configureProvider(dir, "legacy", {
      baseUrl: "http://x/v1",
      models: [{ id: "m" }],
    });
    expect((await listProviderSummaries(dir)).providers.map((p) => p.id)).toEqual(["legacy"]);
  });
});
