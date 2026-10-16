/**
 * 页面侧脚本单测。
 *
 * 脚本是字符串（见 `page-scripts.ts` 的取舍说明），拿不到类型检查，所以在这一层兜三件事：
 * 语法可解析、不引用模块作用域、结果形状与契约一致。这里用一个极小的假 DOM 跑真实逻辑，
 * 真浏览器下的行为由 `pnpm -F @ucode/server browser:smoke` 覆盖。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyRefsScript,
  collectScript,
  documentIdentityScript,
  evalScript,
  hitTestScript,
} from "../page-scripts";

type FakeElement = {
  tagName: string;
  attributes: Record<string, string>;
  textContent: string;
  rect: { left: number; top: number; width: number; height: number };
  visible: boolean;
  value?: string;
  type?: string;
  checked?: boolean;
  disabled?: boolean;
  labels?: { textContent: string }[];
  selectedOptions?: { textContent: string }[];
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  checkVisibility(): boolean;
  contains(other: FakeElement): boolean;
  ownerDocument: { getElementById(id: string): FakeElement | null };
};

const element = (tagName: string, attributes: Record<string, string> = {}): FakeElement => {
  const el: FakeElement = {
    tagName: tagName.toUpperCase(),
    attributes: { ...attributes },
    textContent: "",
    rect: { left: 10, top: 20, width: 100, height: 40 },
    visible: true,
    getAttribute: (name) => el.attributes[name] ?? null,
    setAttribute: (name, value) => {
      el.attributes[name] = value;
    },
    removeAttribute: (name) => {
      delete el.attributes[name];
    },
    getBoundingClientRect: () => el.rect,
    checkVisibility: () => el.visible,
    contains: (other) => other === el,
    ownerDocument: { getElementById: () => null },
  };
  return el;
};

/** 假 DOM：只支持脚本里用到的那几种选择器形态，其余（大选择器）一律返回全部元素 */
const withDocument = (
  elements: FakeElement[],
  run: () => unknown,
  options: { topOfPoint?: FakeElement | null } = {},
): unknown => {
  const document = {
    querySelectorAll: (selector: string) => {
      const refMatch = /\[([\w-]+)="([^"]+)"\]/.exec(selector);
      if (refMatch) {
        const name = refMatch[1] ?? "";
        const value = refMatch[2] ?? "";
        return elements.filter((el) => el.attributes[name] === value);
      }
      const attributeMatch = /^\[([\w-]+)\]$/.exec(selector);
      if (attributeMatch) {
        const name = attributeMatch[1] ?? "";
        return elements.filter((el) => name in el.attributes);
      }
      return elements;
    },
    getElementById: () => null,
    elementFromPoint: () => options.topOfPoint ?? null,
  };
  const window = { innerWidth: 1280, innerHeight: 800 };
  const globalThisRef = globalThis as unknown as { document: unknown; window: unknown };
  const previousDocument = globalThisRef.document;
  const previousWindow = globalThisRef.window;
  globalThisRef.document = document;
  globalThisRef.window = window;
  try {
    return run();
  } finally {
    globalThisRef.document = previousDocument;
    globalThisRef.window = previousWindow;
  }
};

const run = (script: string): unknown => new Function(`return ${script}`)();

describe("文档身份脚本", () => {
  it("读的是 timeOrigin（SPA 路由不改它，真导航才会）", () => {
    const script = documentIdentityScript();
    assert.match(script, /performance\.timeOrigin/);
    assert.equal(typeof new Function(`return ${script}`)(), "number");
  });
});

describe("eval 表达式包装", () => {
  it("包成 IIFE 调用，表达式按原样嵌进去", () => {
    assert.equal(evalScript("1 + 1"), "(() => (1 + 1))()");
  });

  it("包出来的脚本能直接执行", () => {
    // eslint 之类不参与：这是测试里对生成脚本做的一次真求值
    const run = new Function(`return ${evalScript("1 + 1")}`) as () => number;
    assert.equal(run(), 2);
  });
});

describe("脚本本身", () => {
  const scripts = () => [
    collectScript({ max: 10, nameMaxChars: 20, indexAttribute: "data-i", refAttribute: "data-r" }),
    applyRefsScript({
      indexAttribute: "data-i",
      refAttribute: "data-r",
      pairs: [{ index: 0, ref: "e1" }],
    }),
    hitTestScript({ refAttribute: "data-r", ref: "e1" }),
  ];

  it("都能被解析成可执行函数", () => {
    for (const script of scripts())
      assert.equal(typeof new Function(`return ${script}`), "function");
  });

  it("不引用模块作用域，也不含 tsx 注入的 __name 包装", () => {
    for (const script of scripts()) {
      assert.doesNotMatch(script, /\b__name\b/);
      assert.doesNotMatch(script, /\bBROWSER_|snapshotDefaults|require\(/);
    }
  });
});

describe("采集脚本", () => {
  it("给出 role、名字与状态，并给每个可见元素打上当次序号", () => {
    const input = element("input", { placeholder: "请输入名字" });
    input.value = "测试文本";
    const button = element("button");
    button.textContent = " 问候 ";
    const hidden = element("button");
    hidden.textContent = "看不见";
    hidden.visible = false;

    const result = withDocument([input, button, hidden], () =>
      run(
        collectScript({
          max: 10,
          nameMaxChars: 20,
          indexAttribute: "data-i",
          refAttribute: "data-r",
        }),
      ),
    ) as { role: string; name: string; tag: string; state?: string }[];

    assert.deepEqual(result, [
      { role: "textbox", name: "请输入名字", tag: "input", offscreen: false, state: "值=测试文本" },
      { role: "button", name: "问候", tag: "button", offscreen: false },
    ]);
    assert.equal(input.getAttribute("data-i"), "0");
    assert.equal(button.getAttribute("data-i"), "1");
    assert.equal(hidden.getAttribute("data-i"), null, "不可见元素不参与编号");
  });

  it("上一次快照留下的标记会被清掉", () => {
    const stale = element("button", { "data-i": "0", "data-r": "e1" });
    withDocument([stale], () =>
      run(
        collectScript({
          max: 10,
          nameMaxChars: 20,
          indexAttribute: "data-i",
          refAttribute: "data-r",
        }),
      ),
    );
    assert.equal(stale.getAttribute("data-r"), null);
  });

  it("名字按上限截断", () => {
    const long = element("button");
    long.textContent = "长".repeat(50);
    const result = withDocument([long], () =>
      run(
        collectScript({
          max: 10,
          nameMaxChars: 5,
          indexAttribute: "data-i",
          refAttribute: "data-r",
        }),
      ),
    ) as { name: string }[];
    assert.equal(result[0]?.name, "长长长长长…");
  });
});

describe("写回与命中检测", () => {
  it("按当次序号把 ref 写回元素", () => {
    const first = element("button", { "data-i": "0" });
    const second = element("button", { "data-i": "1" });
    const applied = withDocument([first, second], () =>
      run(
        applyRefsScript({
          indexAttribute: "data-i",
          refAttribute: "data-r",
          pairs: [
            { index: 0, ref: "eaaa" },
            { index: 1, ref: "ebbb" },
          ],
        }),
      ),
    );
    assert.equal(applied, 2);
    assert.equal(first.getAttribute("data-r"), "eaaa");
    assert.equal(second.getAttribute("data-r"), "ebbb");
  });

  it("取噪丢过元素时不会错位：编号只写到有配对的序号上", () => {
    // 序号 1 的元素被取噪丢掉（没有配对）——它不该拿到任何编号，别的元素也不该被顶位
    const kept = element("button", { "data-i": "0" });
    const dropped = element("div", { "data-i": "1" });
    const alsoKept = element("button", { "data-i": "2" });
    const applied = withDocument([kept, dropped, alsoKept], () =>
      run(
        applyRefsScript({
          indexAttribute: "data-i",
          refAttribute: "data-r",
          pairs: [
            { index: 0, ref: "eaaa" },
            { index: 2, ref: "eccc" },
          ],
        }),
      ),
    );
    assert.equal(applied, 2);
    assert.equal(kept.getAttribute("data-r"), "eaaa");
    assert.equal(dropped.getAttribute("data-r"), null);
    assert.equal(alsoKept.getAttribute("data-r"), "eccc");
  });

  it("中心点是目标自己即命中", () => {
    const el = element("button", { "data-r": "e1" });
    const probe = withDocument(
      [el],
      () => run(hitTestScript({ refAttribute: "data-r", ref: "e1" })),
      {
        topOfPoint: el,
      },
    );
    assert.deepEqual(probe, { matched: true, missing: false });
  });

  it("被别的元素盖住时给出遮挡者的描述", () => {
    const el = element("button", { "data-r": "e1" });
    const mask = element("div");
    mask.textContent = "cookie 提示";
    const probe = withDocument(
      [el],
      () => run(hitTestScript({ refAttribute: "data-r", ref: "e1" })),
      {
        topOfPoint: mask,
      },
    ) as { matched: boolean; blocker?: string };
    assert.equal(probe.matched, false);
    assert.match(probe.blocker ?? "", /cookie 提示/);
  });

  it("元素已不在文档里时报 missing（编号失效）", () => {
    const probe = withDocument([], () => run(hitTestScript({ refAttribute: "data-r", ref: "e9" })));
    assert.deepEqual(probe, { matched: false, missing: true });
  });

  it("尺寸为 0 的元素给「不可见」而不是硬等", () => {
    const el = element("button", { "data-r": "e1" });
    el.rect = { left: 0, top: 0, width: 0, height: 0 };
    const probe = withDocument([el], () =>
      run(hitTestScript({ refAttribute: "data-r", ref: "e1" })),
    ) as {
      undecidable?: boolean;
      reason?: string;
    };
    assert.equal(probe.undecidable, true);
    assert.match(probe.reason ?? "", /不可见/);
  });
});
