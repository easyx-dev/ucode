/**
 * 模型 / 供应商草稿的校验单测：数字字段与必填项在保存前就被拦下。
 *
 * i18n 只当字符串透传：断言盯的是「哪个字段出错」，不是文案本身。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TFunction } from "i18next";

import { createDraftProvider, type DraftProvider, validateDrafts } from "../config-draft";

const t = ((key: string) => key) as unknown as TFunction;

const withModel = (patch: Partial<DraftProvider["models"][number]>): DraftProvider[] => {
  const provider = createDraftProvider();
  return [{ ...provider, models: [{ ...provider.models[0]!, ...patch }] }];
};

describe("供应商 / 模型草稿校验", () => {
  it("正常草稿通过", () => {
    assert.equal(validateDrafts(withModel({}), t), null);
  });

  it("数字字段留空表示用默认值，不算错", () => {
    assert.equal(
      validateDrafts(withModel({ contextWindow: "", contextBudget: "", maxTokens: "" }), t),
      null,
    );
  });

  it("上下文预算填了负数就拦下来，而不是静默丢弃或发到服务端报错", () => {
    assert.match(validateDrafts(withModel({ contextBudget: "-5" }), t) ?? "", /要填正整数/);
  });

  it("上下文窗口 / 最大输出填了非正整数同样拦下", () => {
    assert.match(validateDrafts(withModel({ contextWindow: "3.5" }), t) ?? "", /要填正整数/);
    assert.match(validateDrafts(withModel({ maxTokens: "abc" }), t) ?? "", /要填正整数/);
  });

  it("内置供应商只看 key，不受自定义供应商的必填项约束", () => {
    const provider = createDraftProvider();
    const builtin: DraftProvider = {
      ...provider,
      source: "builtin",
      baseUrl: "",
      models: [],
      apiKey: "sk-test",
    };
    assert.equal(validateDrafts([builtin], t), null);
  });
});
