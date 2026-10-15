/**
 * 浏览器设置分节的渲染单测（服务端渲染，不引 DOM）。
 *
 * 盯两件在静态检查里看不出来的事：连接方式切到 attach 才出现「调试端点」，以及端点与 profile
 * 的值确实回填到输入框里（草稿丢失在长表单里最难发现）。
 * 数据列表依赖 client，不在这一层渲染；真浏览器下的走查另算。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createI18n } from "@ucode/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";

import { SettingsBrowserConnection } from "../settings-browser-connection";

const i18n = createI18n({ lng: "zh-CN", plugins: [initReactI18next] });

const html = (browser: {
  mode: "isolated" | "attach";
  endpoint: string;
  profile: string;
}): string =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(SettingsBrowserConnection, { browser, onPatch: () => {} }),
    ),
  );

describe("SettingsBrowserConnection", () => {
  it("默认只给连接方式与默认 profile，不出现调试端点", () => {
    const markup = html({ mode: "isolated", endpoint: "", profile: "" });
    assert.match(markup, /连接方式/);
    assert.match(markup, /默认 profile/);
    assert.doesNotMatch(markup, /调试端点/);
  });

  it("切到 attach 才出现调试端点，并把风险写在描述里", () => {
    const markup = html({ mode: "attach", endpoint: "http://127.0.0.1:9222", profile: "" });
    assert.match(markup, /调试端点/);
    assert.match(markup, /已登录的站点/);
    // 值要回填，否则用户看不出自己填过什么
    assert.match(markup, /http:\/\/127\.0\.0\.1:9222/);
  });

  it("profile 名回填到输入框", () => {
    assert.match(html({ mode: "isolated", endpoint: "", profile: "work" }), /value="work"/);
  });
});
