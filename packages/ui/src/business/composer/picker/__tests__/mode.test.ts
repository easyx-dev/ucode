/**
 * 模式 / 权限档位文案的单测：选择器里的 slug 都映射到当前语言，未收录的自定义角色 slug 回落原值。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSION_MODES } from "@ucode/contracts";
import type { TFunction } from "i18next";

import { modeLabel } from "../mode";
import { permissionModeLabel } from "../permission";

/** 替身 t：缺 key 时回退为 key 本身，断言看的就是界面上真正出现的中文 */
const translate = ((key: string) => key) as unknown as TFunction;

describe("模式文案", () => {
  it("内置模式走本地化", () => {
    assert.equal(modeLabel("build", translate), "编码");
    assert.equal(modeLabel("plan", translate), "计划");
    assert.equal(modeLabel("ask", translate), "问答");
  });

  it("自定义角色的 slug 原样显示", () => {
    assert.equal(modeLabel("reviewer", translate), "reviewer");
  });
});

describe("权限档位文案", () => {
  it("枚举内的取值都走本地化，逐个数得出来", () => {
    for (const mode of PERMISSION_MODES) {
      assert.notEqual(permissionModeLabel(mode, translate), mode);
    }
  });
});
