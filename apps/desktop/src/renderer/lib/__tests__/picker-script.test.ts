/** 点选脚本能被解析，摘要文本的字段、省略与截断符合预期 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { elementSummaryText, type PickedElement, pickerScript } from "../picker-script";

const script = pickerScript({ highlight: "resolved-highlight", rootId: "test-picker-root" });

const picked = (overrides: Partial<PickedElement> = {}): PickedElement => ({
  tag: "button",
  role: "button",
  name: "问候",
  selector: '[data-testid="greet"]',
  text: "问候",
  nearbyText: "",
  attributes: [
    { name: "data-testid", value: "greet" },
    { name: "class", value: "btn primary" },
  ],
  rect: { x: 120.4, y: 64.2, width: 72.6, height: 32.1 },
  style: {
    color: "foreground-value",
    background: "background-value",
    font: "14px Inter",
    weight: "600",
    display: "inline-flex",
  },
  html: '<button data-testid="greet">问候</button>',
  ...overrides,
});

const page = { url: "http://127.0.0.1:5173/", title: "示例页" };

describe("点选脚本", () => {
  it("是一段能求值成函数的字符串，且没有构建期注入的名字包装", () => {
    assert.equal(typeof new Function(`return ${script}`), "function");
    // esbuild 的 keepNames 会把函数包成 __name(...)，那种字符串注入页面会直接报 __name is not defined
    assert.doesNotMatch(script, /\b__name\b/);
  });

  it("不引用模块作用域（注入页面时那里什么都没有）", () => {
    assert.doesNotMatch(script, /elementSummaryText|PickedElement|LABELS|import\s|require\(/);
  });

  it("选择器优先用能直接在仓库里搜到的特征（测试 id、id、name）", () => {
    // 页面侧的优先顺序写在脚本里，这里按字符串确认它确实考虑了这几个特征，而不是只给结构路径
    assert.match(script, /data-testid/);
    assert.match(script, /\[name=/);
    assert.match(script, /nth-of-type/);
  });
});

describe("元素摘要", () => {
  it("字段区说清是哪个元素：页面、元素、选择器、位置、样式、属性", () => {
    const text = elementSummaryText(picked(), page);
    assert.match(text, /^【页面元素】示例页（http:\/\/127\.0\.0\.1:5173\/）/);
    assert.match(text, /- 元素：button "问候"（<button>）/);
    assert.match(text, /- 选择器：\[data-testid="greet"\]/);
    assert.match(text, /- 位置：x=120, y=64, 73 × 32/);
    assert.match(text, /- 样式：颜色 foreground-value；背景 background-value；字体 14px Inter/);
    assert.match(text, /- 属性：data-testid="greet" class="btn primary"/);
    assert.match(text, /```html/);
  });

  it("空值整行不写（不占上下文）", () => {
    const text = elementSummaryText(
      picked({
        nearbyText: "",
        attributes: [],
        style: { color: "", background: "", font: "", weight: "", display: "" },
      }),
      page,
    );
    assert.doesNotMatch(text, /- 附近：/);
    assert.doesNotMatch(text, /- 属性：/);
    assert.doesNotMatch(text, /- 样式：/);
  });

  it("没有标题时用「(无标题)」而不是空括号", () => {
    const text = elementSummaryText(picked(), { url: "http://x/", title: "" });
    assert.match(text, /^【页面元素】\(无标题\)（http:\/\/x\/）/);
  });

  it("文本与可访问名相同时不重复一行；不同才带上", () => {
    assert.equal(elementSummaryText(picked(), page).match(/- 文本：/g), null);
    assert.match(
      elementSummaryText(picked({ name: "登录", text: "登录以继续" }), page),
      /- 文本：登录以继续/,
    );
  });

  it("附近文本单独一行（列表项靠它说清是「哪一条」）", () => {
    const text = elementSummaryText(picked({ nearbyText: "已选 12 条 · 共 38 条" }), page);
    assert.match(text, /- 附近：已选 12 条 · 共 38 条/);
  });

  it("文本、附近文本与 HTML 片段都截断", () => {
    const text = elementSummaryText(
      picked({
        text: `t${"x".repeat(400)}`,
        nearbyText: `n${"y".repeat(400)}`,
        html: `<div>${"z".repeat(2_000)}</div>`,
      }),
      page,
    );
    const html = text.split("```html")[1] ?? "";
    assert.ok(html.length < 1_600, `HTML 片段应当被截断，实际 ${html.length}`);
    assert.doesNotMatch(text, /x{300}/, "文本行截到 200");
    assert.doesNotMatch(text, /y{300}/, "附近文本截到 160");
  });

  it("没有 HTML 片段时不留空代码块", () => {
    assert.doesNotMatch(elementSummaryText(picked({ html: "" }), page), /```html/);
  });
});
