/**
 * 思考档位选择器的渲染单测：选择器上必须看得到实际生效的档位。
 *
 * 只做服务端渲染（不引 DOM）：这里盯的是「`auto` 别退化成一个问不出所以然的黑盒」——
 * 选了 `auto` 而模型把 `xhigh` 夹成了别的档位时，界面要跟着实际值走。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createI18n } from "@ucode/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";

import { ThinkingPicker } from "../thinking-picker";

const i18n = createI18n({ lng: "zh-CN", plugins: [initReactI18next] });

const html = (value: "auto" | "low", resolved?: "xhigh" | "high"): string =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(ThinkingPicker, { value, resolved, onSelect: () => {} }),
    ),
  );

/** 去掉标签，只留界面上看得见的文本 */
const text = (value: "auto" | "low", resolved?: "xhigh" | "high"): string =>
  html(value, resolved).replace(/<[^>]+>/g, "|");

describe("思考档位选择器", () => {
  it("`auto` 显示解析后的实际档位", () => {
    assert.match(text("auto", "xhigh"), /自动 · 极高/);
  });

  it("实际档位未知（还没有会话）时只显示「自动」", () => {
    assert.match(text("auto"), /自动/);
    assert.doesNotMatch(text("auto"), /自动 ·/);
  });

  it("选过具体档位就显示它", () => {
    assert.match(text("low", "high"), /低/);
    assert.doesNotMatch(text("low", "high"), /自动/);
  });

  it("触发器是菜单按钮且带得出当前档位", () => {
    // 旧实现用 `select`：Radix 的 item-aligned 定位靠 SelectValue 注册的 `valueNode`，漏掉它弹层会渲在页面末尾。
    // 换成 dropdown-menu 的 radio 组后那条约束不再适用（定位由 Radix 自己算），但触发器不能退化成空按钮
    assert.match(html("auto", "xhigh"), /data-slot="dropdown-menu-trigger"/);
    assert.match(text("auto", "xhigh"), /自动 · 极高/);
  });
});
