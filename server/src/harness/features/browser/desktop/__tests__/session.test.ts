/**
 * 桌面端会话：命令序列（我们发什么 CDP）、编号表跨调用活着、失效与遮挡与 Playwright 那条同一套报错。
 *
 * 用假传输而不是真浏览器：这里要盯的是「我们发的命令对不对、失败怎么报」，真浏览器那侧由
 * `pnpm -F @ucode/desktop browser:smoke`（真实面板 + 真实通道）覆盖。两条合起来才是完整证据。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BROWSER_INDEX_ATTRIBUTE, BROWSER_REF_ATTRIBUTE } from "../../../../../constants/browser";
import { isBrowserError } from "../../errors";
import { createDesktopSession, type DesktopPageTransport } from "../session";

type Command = { method: string; params?: Record<string, unknown> };

const fakeTransport = () => {
  const commands: Command[] = [];
  const answers = new Map<string, (params: Record<string, unknown> | undefined) => unknown>();
  const listeners = new Set<(event: { method: string; params: Record<string, unknown> }) => void>();
  let failNext = "";

  const transport: DesktopPageTransport = {
    send: async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
      commands.push({ method, ...(params === undefined ? {} : { params }) });
      if (failNext === method) {
        failNext = "";
        throw new Error("通道断了");
      }
      return answers.get(method)?.(params) as T;
    },
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    transport,
    commands,
    /** 某个方法的固定回复 */
    answer: (method: string, reply: (params?: Record<string, unknown>) => unknown) =>
      answers.set(method, reply),
    failOnce: (method: string) => {
      failNext = method;
    },
    emit: (method: string, params: Record<string, unknown>) => {
      for (const listener of listeners) listener({ method, params });
    },
    issued: (method: string) => commands.filter((command) => command.method === method),
  };
};

/** 让文档状态与 collect / 量盒子都按「一个按钮」的场景回答 */
const buttonPage = (overrides: { readyState?: () => string; collect?: unknown } = {}) => {
  const fake = fakeTransport();
  /**
   * 按脚本里的标记分派回复：这些标记来自各自的脚本内容（盒子脚本量 centerX、采集脚本带 indexAttribute…），
   * 比「猜表达式文本」稳。
   */
  fake.answer("Runtime.evaluate", (params) => {
    const expression = String(params?.expression ?? "");
    if (expression.includes("readyState")) {
      return {
        result: {
          value: {
            readyState: overrides.readyState?.() ?? "complete",
            url: "https://example.com/form",
            title: "示例页",
          },
        },
      };
    }
    if (expression.includes("elementFromPoint")) {
      return { result: { value: { matched: true, missing: false } } };
    }
    // 盒子脚本里也有 window.innerWidth（可见性判定），所以它先判
    if (expression.includes("centerX")) {
      return {
        result: {
          value: {
            missing: false,
            // 视口坐标与文档坐标故意不同：页面滚动过，截图必须用后者
            x: 10,
            y: 20,
            pageX: 610,
            pageY: 720,
            width: 100,
            height: 40,
            centerX: 60,
            centerY: 40,
          },
        },
      };
    }
    if (expression.includes("window.innerWidth")) {
      return { result: { value: { viewportWidth: 1280, viewportHeight: 800 } } };
    }
    if (expression.includes("selected: selectable")) {
      return { result: { value: { missing: false, selected: true, tag: "input" } } };
    }
    if (expression.includes("pairs")) {
      return { result: { value: 2 } };
    }
    return {
      result: {
        value: overrides.collect ?? [
          { role: "button", name: "登录", tag: "button" },
          { role: "textbox", name: "账号", tag: "input" },
        ],
      },
    };
  });
  return fake;
};

const sessionOn = (fake: ReturnType<typeof buttonPage>) =>
  createDesktopSession({
    transport: fake.transport,
    url: "https://example.com/",
    title: "示例页",
  });

describe("桌面端会话（CDP 转发）", () => {
  it("建会话时就把 Page / Runtime 打开（事件才发得出来）", () => {
    const fake = buttonPage();
    sessionOn(fake);
    assert.deepEqual(
      fake.commands.map((command) => command.method),
      ["Page.enable", "Runtime.enable"],
    );
  });

  it("open：先 Page.navigate 再等文档就绪，返回地址与标题", async () => {
    const fake = buttonPage();
    let ready = "loading";
    fake.answer("Page.navigate", () => ({ frameId: "F1" }));
    fake.answer("Runtime.evaluate", (params) => {
      const expression = String(params?.expression ?? "");
      if (!expression.includes("readyState")) return { result: { value: [] } };
      return {
        result: { value: { readyState: ready, url: "https://example.com/form", title: "示例页" } },
      };
    });

    const session = sessionOn(fake);
    const pending = session.open({ url: "https://example.com/form" });
    // 第一轮还在 loading：等一会儿再让它就绪，验证轮询真的在跑
    setTimeout(() => {
      ready = "complete";
    }, 150);
    const opened = await pending;

    assert.deepEqual(opened, { url: "https://example.com/form", title: "示例页" });
    assert.equal(fake.issued("Page.navigate").length, 1);
    assert.ok(fake.issued("Runtime.evaluate").length >= 2, "应当轮询到就绪");
    assert.equal(session.currentUrl(), "https://example.com/form");
  });

  it("open：导航失败（errorText）立刻报错，不等超时", async () => {
    const fake = buttonPage();
    fake.answer("Page.navigate", () => ({ errorText: "ERR_NAME_NOT_RESOLVED" }));
    await assert.rejects(
      () => sessionOn(fake).open({ url: "https://nope.invalid/" }),
      (error: unknown) => isBrowserError(error) && error.code === "navigation_failed",
    );
  });

  it("snapshot：先采集再写回编号，返回的元素带上 @e 编号", async () => {
    const fake = buttonPage();
    const session = sessionOn(fake);
    const result = await session.snapshot({});

    const evaluates = fake.issued("Runtime.evaluate");
    const collect = String(evaluates[0]?.params?.expression ?? "");
    assert.ok(collect.includes(BROWSER_INDEX_ATTRIBUTE), "采集脚本要带上当次序号属性");
    const apply = String(evaluates[1]?.params?.expression ?? "");
    assert.ok(apply.includes(BROWSER_REF_ATTRIBUTE));
    assert.match(apply, /"pairs":\[\{/, "写回要带序号与编号的配对");

    assert.equal(result.count, 2);
    assert.match(result.text, /button "登录"/);
  });

  it("act click：先量盒子（含滚进视口）再按真实输入点下去", async () => {
    const fake = buttonPage();
    const session = sessionOn(fake);
    const snapshot = await session.snapshot({});
    const ref = snapshot.text.match(/@(\S+)/)?.[1] ?? "";
    fake.commands.length = 0;

    const result = await session.act({ action: "click", ref });

    const mouse = fake.issued("Input.dispatchMouseEvent");
    assert.deepEqual(
      mouse.map((command) => command.params?.type),
      ["mousePressed", "mouseReleased"],
    );
    // 元素盒子里量到中心点 (60, 40)：点的是它，不是别的坐标
    assert.equal(mouse[0]?.params?.x, 60);
    assert.equal(mouse[0]?.params?.y, 40);
    assert.equal(result.summary, `已点击 @${ref}`);
    assert.equal(result.navigated, false);
  });

  it("act fill / type：先聚焦（并选中已有内容），再真的写入", async () => {
    const fake = buttonPage();
    const session = sessionOn(fake);
    const snapshot = await session.snapshot({});
    const ref = snapshot.text.split("\n")[1]?.match(/@(\S+)/)?.[1] ?? "";
    fake.commands.length = 0;

    await session.act({ action: "fill", ref, text: "hello" });
    await session.act({ action: "type", ref, text: "ab" });

    const inserts = fake.issued("Input.insertText");
    assert.equal(inserts.length, 1, "fill 用 insertText 一次写完");
    assert.equal(inserts[0]?.params?.text, "hello");
    // type 逐字：两个字符两对按键
    const keys = fake.issued("Input.dispatchKeyEvent").filter((c) => c.params?.type === "keyDown");
    assert.deepEqual(
      keys.map((command) => command.params?.text),
      ["a", "b"],
    );
  });

  it("act press：具名按键走映射表（Enter → keyCode 13）", async () => {
    const fake = buttonPage();
    const session = sessionOn(fake);
    fake.commands.length = 0;

    await session.act({ action: "press", key: "Enter" });

    const down = fake
      .issued("Input.dispatchKeyEvent")
      .find((command) => command.params?.type === "keyDown");
    assert.equal(down?.params?.key, "Enter");
    assert.equal(down?.params?.windowsVirtualKeyCode, 13);
  });

  it("act select：改 value 并派发事件；不是下拉框时明确报错", async () => {
    const fake = buttonPage();
    fake.answer("Runtime.evaluate", (params) => {
      const expression = String(params?.expression ?? "");
      if (expression.includes("readyState")) {
        return { result: { value: { readyState: "complete", url: "u", title: "t" } } };
      }
      if (expression.includes("elementFromPoint")) {
        return { result: { value: { matched: true, missing: false } } };
      }
      if (expression.includes('el.tagName !== "SELECT"')) {
        return { result: { value: { missing: false, notSelect: true, tag: "div" } } };
      }
      return { result: { value: [{ role: "combobox", name: "城市", tag: "select" }] } };
    });
    const session = sessionOn(fake);
    const snapshot = await session.snapshot({});

    await assert.rejects(
      () =>
        session.act({
          action: "select",
          ref: snapshot.text.match(/@(\S+)/)?.[1] ?? "",
          text: "北京",
        }),
      (error: unknown) =>
        isBrowserError(error) && error.code === "action_failed" && /不是下拉框/.test(error.message),
    );
  });

  it("act scroll：不带 ref 时按方向滚一屏（真实滚轮事件）", async () => {
    const fake = buttonPage();
    const session = sessionOn(fake);
    fake.commands.length = 0;

    const result = await session.act({ action: "scroll", direction: "down" });

    const wheel = fake.issued("Input.dispatchMouseEvent")[0];
    assert.equal(wheel?.params?.type, "mouseWheel");
    assert.equal(wheel?.params?.deltaY, 600);
    assert.equal(result.summary, "已滚动 600px");
  });

  it("编号失效与遮挡：与 Playwright 那条同一套码与提示", async () => {
    const fake = buttonPage();
    const session = sessionOn(fake);

    // 还没快照过：编号表是空的
    await assert.rejects(
      () => session.act({ action: "click", ref: "e1a2" }),
      (error: unknown) =>
        isBrowserError(error) && error.code === "stale_ref" && error.staleRefs === true,
    );

    // 快照里有它，但中心点被遮罩盖住
    fake.answer("Runtime.evaluate", (params) => {
      const expression = String(params?.expression ?? "");
      if (expression.includes("readyState")) {
        return { result: { value: { readyState: "complete", url: "u", title: "t" } } };
      }
      if (expression.includes("elementFromPoint")) {
        return {
          result: { value: { matched: false, missing: false, blocker: 'div "关闭遮罩"' } },
        };
      }
      return { result: { value: [{ role: "button", name: "登录", tag: "button" }] } };
    });
    const snapshot = await session.snapshot({});
    const ref = snapshot.text.match(/@(\S+)/)?.[1] ?? "";
    await assert.rejects(
      () => session.act({ action: "click", ref }),
      (error: unknown) =>
        isBrowserError(error) &&
        error.code === "element_obstructed" &&
        /关闭遮罩/.test(error.message),
    );
  });

  it("导航后编号整体失效（主 frame 才算，iframe 里的跳转不动编号表）", async () => {
    const fake = buttonPage();
    const session = sessionOn(fake);
    const snapshot = await session.snapshot({});
    const ref = snapshot.text.match(/@(\S+)/)?.[1] ?? "";

    // iframe 内的导航：编号表不受影响（快照会把地址刷成文档自己的，所以先记下来）
    const before = session.currentUrl();
    fake.emit("Page.frameNavigated", {
      frame: { url: "https://example.com/inner", parentId: "F1" },
    });
    assert.equal(session.currentUrl(), before, "iframe 不改当前地址");

    // 主 frame 导航：编号表清空，旧编号立刻失效
    fake.emit("Page.frameNavigated", { frame: { url: "https://example.com/next" } });
    assert.equal(session.currentUrl(), "https://example.com/next");
    await assert.rejects(
      () => session.act({ action: "click", ref }),
      (error: unknown) => isBrowserError(error) && error.code === "stale_ref",
    );
  });

  it("screenshot：整页按内容尺寸裁剪，按 ref 时按元素盒子裁", async () => {
    const fake = buttonPage();
    fake.answer("Page.captureScreenshot", () => ({ data: "BASE64" }));
    fake.answer("Page.getLayoutMetrics", () => ({
      cssContentSize: { width: 1280, height: 2400.6 },
    }));
    const session = sessionOn(fake);

    const full = await session.screenshot({ fullPage: true });
    const fullClip = fake.issued("Page.captureScreenshot")[0]?.params?.clip as
      | { width: number; height: number }
      | undefined;
    assert.deepEqual(fullClip, { x: 0, y: 0, width: 1280, height: 2401, scale: 1 });
    assert.equal(full.mimeType, "image/jpeg");
    assert.equal(full.data, "BASE64");

    const snapshot = await session.snapshot({});
    const ref = snapshot.text.match(/@(\S+)/)?.[1] ?? "";
    await session.screenshot({ ref });
    const elementClip = fake.issued("Page.captureScreenshot")[1]?.params?.clip as
      | { width: number; height: number }
      | undefined;
    // 页面滚动过：clip 要用文档坐标（pageX/pageY），用视口坐标会截到元素上方
    assert.deepEqual(elementClip, { x: 610, y: 720, width: 100, height: 40, scale: 1 });
  });

  it("open：第一轮读到旧文档时不会提前返回（Page.navigate 在提交前就返回）", async () => {
    const fake = buttonPage();
    // 初值与会话一致：这才是「导航前那个文档」
    let url = "https://example.com/";
    fake.answer("Page.navigate", () => ({ loaderId: "L2" }));
    fake.answer("Runtime.evaluate", (params) => {
      const expression = String(params?.expression ?? "");
      if (!expression.includes("readyState")) return { result: { value: [] } };
      return { result: { value: { readyState: "complete", url, title: "旧页" } } };
    });

    const session = sessionOn(fake);
    const pending = session.open({ url: "https://example.com/new" });
    // 第二次轮询时新文档才上来（真实时序：提交发生在 navigate 返回之后）
    setTimeout(() => {
      url = "https://example.com/new";
    }, 150);
    const opened = await pending;

    assert.equal(opened.url, "https://example.com/new");
    assert.ok(fake.issued("Runtime.evaluate").length >= 3, "旧文档要跳过，不能一次就认定就绪");
  });

  it("上下文在导航提交时被销毁：重试一次而不是直接失败", async () => {
    const fake = buttonPage();
    let readyStateCalls = 0;
    fake.answer("Page.navigate", () => ({}));
    fake.answer("Runtime.evaluate", (params) => {
      const expression = String(params?.expression ?? "");
      if (!expression.includes("readyState")) return { result: { value: [] } };
      readyStateCalls += 1;
      // 提交那一刻旧上下文被销毁：第一次读文档状态就会抛这个
      if (readyStateCalls === 1) throw new Error("Execution context was destroyed");
      return {
        result: {
          value: { readyState: "complete", url: "https://example.com/new", title: "新页" },
        },
      };
    });

    const session = sessionOn(fake);
    const opened = await session.open({ url: "https://example.com/new" });
    assert.equal(opened.url, "https://example.com/new");
    assert.equal(readyStateCalls, 2, "销毁后应当重试一次");
  });

  it("同文档导航（hash / pushState）也清编号表，与 Playwright 那条一致", async () => {
    const fake = buttonPage();
    const session = sessionOn(fake);
    const snapshot = await session.snapshot({});
    const ref = snapshot.text.match(/@(\S+)/)?.[1] ?? "";

    fake.emit("Page.navigatedWithinDocument", { url: "https://example.com/#section" });
    assert.equal(session.currentUrl(), "https://example.com/#section", "地址跟着变");
    await assert.rejects(
      () => session.act({ action: "click", ref }),
      (error: unknown) => isBrowserError(error) && error.code === "stale_ref",
    );
  });

  it("通道断了：折成工具错误（带「不自动重试」的提示），不挂在超时上", async () => {
    const fake = buttonPage();
    const session = sessionOn(fake);
    fake.failOnce("Runtime.evaluate");

    await assert.rejects(
      () => session.snapshot({}),
      (error: unknown) => isBrowserError(error) && error.code === "action_failed",
    );
  });

  it("close 只断开：退订事件、不动页面（之后的事件不再影响编号表）", async () => {
    const fake = buttonPage();
    const session = sessionOn(fake);
    await session.snapshot({});
    const before = session.currentUrl();
    await session.close();

    fake.emit("Page.frameNavigated", { frame: { url: "https://example.com/gone" } });
    assert.equal(session.currentUrl(), before, "断开后不再跟随导航事件");
  });
});
