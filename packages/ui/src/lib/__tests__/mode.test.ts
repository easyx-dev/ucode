/**
 * 本轮参数细线的文案单测：认识的取值走本地化，未校验的记录值原样显示。
 *
 * 记录里的字段来自会话文件（可能手改过），这里盯住「不认识也不吞掉」这一条。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSION_MODES } from "@ucode/contracts";
import type { TFunction } from "i18next";

import { modeChangeText } from "../mode";

/** 替身 t：缺 key 时回退为 key 本身，断言看的就是界面上真正出现的中文 */
const translate = ((key: string) => key) as unknown as TFunction;

describe("本轮参数细线", () => {
  it("只有模式：右侧是模式名", () => {
    assert.deepEqual(modeChangeText({ mode: "plan", at: "t" }, translate), {
      label: "本轮参数",
      detail: "计划",
    });
  });

  it("模式与权限档位都有：一并列出", () => {
    assert.deepEqual(
      modeChangeText({ mode: "build", permissionMode: "full", at: "t" }, translate),
      {
        label: "本轮参数",
        detail: "编码 · 完全访问",
      },
    );
  });

  it("权限档位都在枚举内，逐个数得出来且走本地化", () => {
    for (const mode of PERMISSION_MODES) {
      const text = modeChangeText({ permissionMode: mode, at: "t" }, translate);
      assert.equal(text.label, "本轮参数");
      assert.notEqual(text.detail, mode, "枚举内的取值应走本地化，而不是原样回显");
    }
  });

  it("记录里的档位不认识时原样显示，不静默落到「默认」", () => {
    assert.deepEqual(modeChangeText({ permissionMode: "readonly", at: "t" }, translate), {
      label: "本轮参数",
      detail: "readonly",
    });
  });
});
