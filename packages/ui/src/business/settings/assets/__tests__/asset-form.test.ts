/** 资产表单的纯函数：名称规则、提交校验与请求组装 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assetToForm,
  canSubmitAssetForm,
  emptyAssetForm,
  formToSaveRequest,
  isAssetNameValid,
} from "../asset-form";

describe("资产表单", () => {
  it("名称规则与 kind 对应：角色不许数字开头，技能不许连续连字符", () => {
    assert.equal(isAssetNameValid("agent", "code-reviewer"), true);
    assert.equal(isAssetNameValid("agent", "1coder"), false);
    assert.equal(isAssetNameValid("agent", "Code-Reviewer"), false);
    assert.equal(isAssetNameValid("skill", "commit-helper"), true);
    assert.equal(isAssetNameValid("skill", "commit--helper"), false);
    assert.equal(isAssetNameValid("command", "review-diff"), true);
    assert.equal(isAssetNameValid("command", "review.diff"), false);
  });

  it("角色与技能缺说明不能提交，命令可以", () => {
    const form = { ...emptyAssetForm(), name: "demo", body: "正文" };
    assert.equal(canSubmitAssetForm("agent", form, true), false);
    assert.equal(canSubmitAssetForm("skill", form, true), false);
    assert.equal(canSubmitAssetForm("command", form, true), true);
    assert.equal(canSubmitAssetForm("command", { ...form, body: "  " }, true), false);
  });

  it("编辑态不校验名字（名字是定位依据，不允许改）", () => {
    const form = { ...emptyAssetForm(), name: "旧的 名字", description: "说明", body: "正文" };
    assert.equal(canSubmitAssetForm("agent", form, false), true);
  });

  it("工具名按逗号与换行拆分，留空则不写这个字段", () => {
    const base = { ...emptyAssetForm(), name: "demo", description: "说明", body: "正文" };
    const withTools = formToSaveRequest("agent", { ...base, toolsText: "read, grep\nfind" }, []);
    assert.deepEqual(withTools.tools, ["read", "grep", "find"]);

    const without = formToSaveRequest("agent", base, []);
    assert.equal("tools" in without, false);
    assert.equal(without.mode, "subagent");
  });

  it("命令的说明与参数提示可缺省；额外 frontmatter 行原样带上", () => {
    const form = { ...emptyAssetForm(), name: "review", body: "审查 $1" };
    const request = formToSaveRequest("command", form, ["metadata:", "  owner: me"]);
    assert.equal(request.description, undefined);
    assert.deepEqual(request.extraLines, ["metadata:", "  owner: me"]);
  });

  it("详情 → 表单：展示名与文件名相同时留空，思考档位回落空串", () => {
    const form = assetToForm({
      kind: "agent",
      name: "code-reviewer",
      label: "code-reviewer",
      description: "只读审查",
      source: "global",
      editable: true,
      scope: "global",
      path: "/tmp/agents/code-reviewer.md",
      mode: "all",
      tools: ["read", "grep"],
      body: "正文",
      extraLines: [],
      warnings: [],
    });
    assert.equal(form.label, "");
    assert.equal(form.thinking, "");
    assert.equal(form.mode, "all");
    assert.equal(form.toolsText, "read, grep");
  });
});
