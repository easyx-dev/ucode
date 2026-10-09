/**
 * 思考档位文案单测：`auto` 必须带上实际生效的档位（否则「自动」就是个问不出所以然的黑盒），
 * 实际档位未知时（还没有会话）只显示「自动」。
 *
 * 替身 t 原样返回 key 并照做插值，所以断言里读到的就是界面上真正出现的中文。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { THINKING_LEVELS } from "@ucode/contracts";
import type { TFunction } from "i18next";

import { thinkingLevelLabel, thinkingPreferenceLabel } from "../thinking";

const translate = ((key: string, options?: Record<string, unknown>) =>
  key.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(options?.[name] ?? ""),
  )) as unknown as TFunction;

describe("思考档位文案", () => {
  it("自动带上实际生效的档位", () => {
    assert.equal(thinkingPreferenceLabel("auto", "xhigh", translate), "自动 · 极高");
    assert.equal(thinkingPreferenceLabel("auto", "max", translate), "自动 · 最高");
  });

  it("实际档位未知时只显示「自动」", () => {
    assert.equal(thinkingPreferenceLabel("auto", undefined, translate), "自动");
  });

  it("具体档位与档位名一致，7 档都有中文", () => {
    for (const level of THINKING_LEVELS) {
      const label = thinkingLevelLabel(level, translate);
      assert.notEqual(label, level, `${level} 应有本地化文案`);
      assert.equal(thinkingPreferenceLabel(level, undefined, translate), label);
    }
  });
});
