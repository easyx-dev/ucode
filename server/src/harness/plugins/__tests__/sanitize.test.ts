/** harness/plugins/sanitize：插件与组件的命名规则 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  sanitizeToken,
  toComponentLabel,
  toComponentToken,
  tokenHashSuffix,
  toPluginToken,
} from "../sanitize";

describe("sanitizeToken", () => {
  it("小写、非字母数字转连字符、折叠并去首尾连字符", () => {
    assert.equal(sanitizeToken("My_Plugin Name"), "my-plugin-name");
    assert.equal(sanitizeToken("--a--b--"), "a-b");
    assert.equal(sanitizeToken("a@@@b"), "a-b");
  });

  it("全被剔掉时返回空串", () => {
    assert.equal(sanitizeToken("插件"), "");
    assert.equal(sanitizeToken("///"), "");
  });
});

describe("toPluginToken", () => {
  it("常规名原样归一", () => {
    assert.equal(toPluginToken("My.Plugin"), "my-plugin");
  });

  it("数字开头补前缀，保证能用作标识的一部分", () => {
    assert.equal(toPluginToken("1plugin"), "p1plugin");
  });

  it("中文等无法归一时用原名哈希兜底，不产出半截 token", () => {
    const token = toPluginToken("插件");
    assert.match(token, /^p-[0-9a-f]{6}$/);
    assert.equal(token, toPluginToken("插件"));
    assert.notEqual(token, toPluginToken("另一个插件"));
  });
});

describe("toComponentToken", () => {
  it("拼成 <plugin>-<component>", () => {
    assert.equal(toComponentToken("my-plugin", "review"), "my-plugin-review");
  });

  it("与已占用 token 冲突时追加内容哈希后缀", () => {
    const taken = new Set(["my-plugin-review"]);
    const token = toComponentToken("my-plugin", "review", taken);
    assert.equal(token, `my-plugin-review-${tokenHashSuffix("my-plugin-review")}`);
    assert.equal(token.length, "my-plugin-review".length + 7);
  });

  it("与内置技能名冲突时同样加后缀", () => {
    const token = toComponentToken("plugin", "create");
    assert.match(token, /^plugin-create-[0-9a-f]{6}$/);
  });

  it("组件名全部不可用时用哈希兜底", () => {
    assert.match(toComponentToken("my-plugin", "技能"), /^my-plugin-[0-9a-f]{6}$/);
  });
});

describe("toComponentLabel", () => {
  it("显示名用冒号分隔，不进底层标识", () => {
    assert.equal(toComponentLabel("my-plugin", "review"), "my-plugin:review");
  });
});
