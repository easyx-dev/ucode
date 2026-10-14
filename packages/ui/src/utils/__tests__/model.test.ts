/**
 * 模型 / 供应商显示名单测：目录里给的名称优先（pi 缺省时名称就等于 id），
 * 只有目录里查不到时才回落原 ID——会话记的模型可能已经被改配置换掉了；
 * 条目没记 provider 时退一步按 model id 在目录里找名称。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CatalogProvider } from "@ucode/contracts";

import { modelNamesOf, modelRefText } from "../model";

const provider = (patch: Partial<CatalogProvider>): CatalogProvider => ({
  id: "local",
  name: "本地",
  baseUrl: "http://localhost:8317/v1",
  api: "openai-completions",
  source: "custom",
  available: true,
  authSource: "stored",
  authName: "Local key",
  customized: true,
  models: [
    { id: "ucas-max", name: "Claude 5.5 Sonnet", reasoning: true, vision: true },
    // 没自定义名称的模型：服务端下发的 name 就是 id
    { id: "ucas-mini", name: "ucas-mini", reasoning: false, vision: false },
  ],
  ...patch,
});

const names = modelNamesOf([provider({})]);

describe("模型与供应商显示名", () => {
  it("两段都用目录里的名称", () => {
    assert.equal(names.refLabel("local/ucas-max"), "本地 · Claude 5.5 Sonnet");
    assert.equal(names.providerName("local"), "本地");
    assert.equal(names.modelName("local", "ucas-max"), "Claude 5.5 Sonnet");
  });

  it("没自定义名称的模型显示原 ID", () => {
    assert.equal(names.refLabel("local/ucas-mini"), "本地 · ucas-mini");
  });

  it("目录里查不到的段回落原 ID，而不是留空或报错", () => {
    assert.equal(names.refLabel("gone/ucas-max"), "gone · ucas-max");
    assert.equal(names.refLabel("local/gone"), "本地 · gone");
    assert.equal(modelNamesOf([]).refLabel("local/ucas-max"), "local · ucas-max");
  });

  it("没记 provider 的条目按 model id 在目录里找名称，找不到仍按原 ID", () => {
    assert.equal(names.modelName(undefined, "ucas-max"), "Claude 5.5 Sonnet");
    assert.equal(names.modelName(undefined, "ucas-mini"), "ucas-mini");
    assert.equal(names.modelName(undefined, "gone"), "gone");
  });

  it("不是 provider/model 形式的引用原样返回", () => {
    assert.equal(names.refLabel("ucas-max"), "ucas-max");
    assert.equal(names.refLabel("/ucas-max"), "/ucas-max");
  });

  it("拼法与设置页草稿共用一处", () => {
    assert.equal(modelRefText("本地", "ucas-max"), "本地 · ucas-max");
  });
});
