import type { ProviderSummary } from "@ucode/sdk";
import { describe, expect, it } from "vitest";
import {
  emptyProviderForm,
  providerDriftNotice,
  providerSummaryLine,
  validateProviderForm,
} from "./model-config-format.ts";

function provider(over: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    id: "ds-proxy",
    baseUrl: "http://127.0.0.1:8080/v1",
    api: "openai-completions",
    hasApiKey: true,
    models: [{ id: "deepseek-v4-flash", name: "deepseek-v4-flash", available: true }],
    declared: ["deepseek-v4-flash"],
    ...over,
  };
}

describe("供应商表单校验", () => {
  it("合法表单通过", () => {
    expect(
      validateProviderForm({
        id: "my-proxy",
        baseUrl: "http://127.0.0.1:8080/v1",
        apiKey: "sk-x",
        model: "gpt-4o-mini",
      }),
    ).toBeNull();
  });

  it("id 不能空、不能带空格", () => {
    expect(validateProviderForm({ ...emptyProviderForm(), id: "" })?.field).toBe("id");
    expect(
      validateProviderForm({
        ...emptyProviderForm(),
        id: "my proxy",
        baseUrl: "http://x/v1",
        model: "m",
      })?.field,
    ).toBe("id");
  });

  it("端点必须是 http/https 的合法 URL", () => {
    const base = { ...emptyProviderForm(), id: "p", model: "m" };
    expect(validateProviderForm({ ...base, baseUrl: "" })?.field).toBe("baseUrl");
    expect(validateProviderForm({ ...base, baseUrl: "127.0.0.1:8080" })?.field).toBe("baseUrl");
    expect(validateProviderForm({ ...base, baseUrl: "ftp://x/v1" })?.field).toBe("baseUrl");
  });

  it("模型 id 必填", () => {
    expect(
      validateProviderForm({ ...emptyProviderForm(), id: "p", baseUrl: "http://x/v1" })?.field,
    ).toBe("model");
  });

  it("密钥可以留空（本地端点常常不需要）", () => {
    expect(
      validateProviderForm({
        id: "p",
        baseUrl: "http://x/v1",
        apiKey: "",
        model: "m",
      }),
    ).toBeNull();
  });
});

describe("供应商摘要", () => {
  it("只报有没有密钥，不出现密钥本身", () => {
    const line = providerSummaryLine(provider());
    expect(line).toContain("有密钥");
    expect(line).toContain("http://127.0.0.1:8080/v1");
    expect(line).not.toContain("sk-");
  });

  it("没配端点时如实说", () => {
    expect(providerSummaryLine(provider({ baseUrl: "" }))).toContain("（未填端点）");
  });
});

describe("声明与解析的漂移", () => {
  it("一致时不提示", () => {
    expect(providerDriftNotice(provider())).toBeNull();
  });

  it("基座多解析出内置模型时提示（这是「发出去没反应」的成因）", () => {
    const notice = providerDriftNotice(
      provider({
        id: "deepseek",
        declared: ["deepseek-v4-flash"],
        models: [
          { id: "deepseek-flash", name: "deepseek-flash", available: true },
          { id: "deepseek-v4-flash", name: "deepseek-v4-flash", available: true },
        ],
      }),
    );
    expect(notice).toContain("deepseek-flash");
    expect(notice).toContain("换个 id");
  });

  it("声明的模型没被采纳时也提示", () => {
    const notice = providerDriftNotice(provider({ declared: ["ghost-model"], models: [] }));
    expect(notice).toContain("（无）");
  });
});
