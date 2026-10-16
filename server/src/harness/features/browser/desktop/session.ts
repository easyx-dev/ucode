/**
 * 桌面端面板里的那一个页面（CDP 转发）：语义与受管实例完全一致，只是传输换成
 * 「服务端 → 桌面端主进程 → 目标 webContents 的 `debugger`」。
 *
 * 与 Playwright 那条路刻意的三处差别：
 * - **不启动也不关闭任何东西**：页面是用户自己的标签，`close` 只断开（不动标签）；
 * - **没有空闲回收**：实例的生杀不归我们，`isBusy` / `idleMs` 只是接口形状；
 * - **动作走 `Input.*` 真实输入**（Playwright 的 locator 用不上）：坐标、选中、下拉项都靠页面脚本量。
 *
 * 语义一致的部分（编号、ref 失效、遮挡判定、快照文本）来自 `page-ops`，两边只能是同一套。
 */
import {
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_NAVIGATION_TIMEOUT_MS,
  BROWSER_REF_ATTRIBUTE,
  BROWSER_SCREENSHOT_QUALITY,
} from "../../../../constants/browser";
import {
  type BrowserActInput,
  formatEvalResult,
  normalizeRef,
  type ResolvedAct,
  resolveAct,
  scrollDelta,
  toEvalError,
} from "../actions";
import { browserError, toBrowserError } from "../errors";
import {
  assertRefActionable,
  assertRefInSnapshot,
  captureSnapshot,
  documentChanged,
  type Evaluate,
  readDocumentOrigin,
} from "../page-ops";
import {
  documentStateScript,
  elementBoxScript,
  evalScript,
  focusForInputScript,
  selectOptionScript,
} from "../page-scripts";
import type { BrowserSession } from "../session";
import type { SnapshotEntry } from "../snapshot";

/** 一条 CDP 命令的返回值：`Runtime.evaluate` 走的就是这个形状 */
type CdpResult = {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
};

/** 页面里量出来的元素盒子（`elementBoxScript` 的返回值） */
type ElementBox = {
  missing?: boolean;
  /** 视口坐标（鼠标事件用） */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  centerX?: number;
  centerY?: number;
  /** 文档坐标（截图裁剪用） */
  pageX?: number;
  pageY?: number;
};

/** 文档状态（`documentStateScript` 的返回值） */
type DocumentState = { readyState: string; url: string; title: string };

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * 服务端要用的那一层传输：只保留「发命令 + 收事件」，谁在对面转发都行（现在是桌面端主进程）。
 */
export type DesktopPageTransport = {
  send: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  on: (
    listener: (event: { method: string; params: Record<string, unknown> }) => void,
  ) => () => void;
};

export type DesktopSessionInput = {
  transport: DesktopPageTransport;
  /** 创建时的地址，之后由导航事件与每次动作刷新 */
  url: string;
  /** 标签标题（仅用于 open 的返回） */
  title?: string;
};

/** 具名按键的发送参数；没列到的按单字符处理（够覆盖工具描述里举例的那几个） */
const NAMED_KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
};

const keyEvent = (key: string): { key: string; code: string; keyCode: number; text?: string } => {
  const named = NAMED_KEYS[key];
  if (named) return { key, ...named };
  // 单字符按键（含空格）：带上 text 才会真的写进输入框
  const single = key.length === 1;
  return {
    key,
    code: single ? `Key${key.toUpperCase()}` : key,
    keyCode: single ? key.toUpperCase().charCodeAt(0) : 0,
    ...(single ? { text: key } : {}),
  };
};

export const createDesktopSession = (input: DesktopSessionInput): BrowserSession => {
  const { transport } = input;
  let entries: SnapshotEntry[] = [];
  let url = input.url;
  let title = input.title ?? "";
  /** 主 frame 最近一次提交的 loaderId：用来判断「这是新文档」而不是导航前的旧文档 */
  let lastLoaderId: string | null = null;

  const sendCommand = async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
    try {
      return await transport.send<T>(method, params);
    } catch (error) {
      throw toBrowserError(error, `桌面端转发 ${method}`);
    }
  };

  const evaluate: Evaluate = async <T>(script: string): Promise<T> => {
    const out = await sendCommand<CdpResult>("Runtime.evaluate", {
      expression: script,
      returnByValue: true,
      awaitPromise: true,
      timeout: BROWSER_ACTION_TIMEOUT_MS,
    });
    if (out.exceptionDetails) {
      const detail =
        out.exceptionDetails.exception?.description ?? out.exceptionDetails.text ?? "未知错误";
      throw browserError("action_failed", `页面脚本执行失败：${detail.split("\n")[0] ?? detail}`);
    }
    return out.result?.value as T;
  };

  /**
   * 读一次文档状态：地址与标题都从页面自己那儿拿，避免本地缓存与真实状态漂移。
   * 导航提交的那一瞬间旧上下文会被销毁（evaluate 抛「Execution context was destroyed」），重试一次即可，
   * 不该把整个动作判失败。
   */
  const readDocumentState = async (): Promise<DocumentState> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await evaluate<DocumentState>(documentStateScript());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= 1 || !/context|destroyed/i.test(message)) throw error;
        await sleep(100);
      }
    }
  };

  const tabGone = (ref?: string): never => {
    throw browserError("stale_ref", ref ? `ref @${ref} 已不在页面上` : "页面已关闭", {
      hint: "页面可能已变化，请重新调用 browser_snapshot",
    });
  };

  const boxOf = async (ref: string): Promise<ElementBox> => {
    const box = await evaluate<ElementBox>(
      elementBoxScript({ refAttribute: BROWSER_REF_ATTRIBUTE, ref }),
    );
    if (box.missing) tabGone(ref);
    return box;
  };

  const clickAt = async (x?: number, y?: number): Promise<void> => {
    if (x === undefined || y === undefined) {
      throw browserError("action_failed", "量不到元素坐标", { hint: "先 scroll 到目标再试" });
    }
    const base = { x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1, buttons: 1 };
    await sendCommand("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
    await sendCommand("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
  };

  const focusOn = async (ref: string): Promise<void> => {
    const focused = await evaluate<{ missing?: boolean }>(
      focusForInputScript({ refAttribute: BROWSER_REF_ATTRIBUTE, ref }),
    );
    if (focused.missing) tabGone(ref);
  };

  const typeKey = async (key: string): Promise<void> => {
    const event = keyEvent(key);
    await sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: event.key,
      code: event.code,
      windowsVirtualKeyCode: event.keyCode,
      ...(event.text === undefined ? {} : { text: event.text }),
    });
    await sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: event.key,
      code: event.code,
      windowsVirtualKeyCode: event.keyCode,
    });
  };

  const runAction = async (act: ResolvedAct): Promise<string> => {
    switch (act.action) {
      case "click": {
        const box = await boxOf(act.ref);
        await clickAt(box.centerX, box.centerY);
        return `已点击 @${act.ref}`;
      }
      case "fill": {
        // 与 Playwright 的 fill 同一意图：先选中已有内容，再一次性写进去（insertText 是真的输入事件）
        await focusOn(act.ref);
        await sendCommand("Input.insertText", { text: act.text });
        return `已在 @${act.ref} 填入 ${act.text.length} 个字符`;
      }
      case "type": {
        await focusOn(act.ref);
        // 逐字：每个字符一对 keyDown / keyUp，页面上的按键处理能看到
        for (const char of act.text) await typeKey(char);
        return `已在 @${act.ref} 逐字输入 ${act.text.length} 个字符`;
      }
      case "press": {
        if (act.ref) await focusOn(act.ref);
        await typeKey(act.key);
        return `已按键 ${act.key}${act.ref ? `（@${act.ref}）` : ""}`;
      }
      case "select": {
        const picked = await evaluate<{
          missing?: boolean;
          notSelect?: boolean;
          noOption?: boolean;
          value?: string;
          tag?: string;
          options?: string[];
        }>(
          selectOptionScript({
            refAttribute: BROWSER_REF_ATTRIBUTE,
            ref: act.ref,
            value: act.text,
          }),
        );
        if (picked.missing) tabGone(act.ref);
        if (picked.notSelect) {
          throw browserError("action_failed", `@${act.ref} 不是下拉框（是 ${picked.tag}）`, {
            hint: "select 只能用于 <select>；其它控件用 click / fill",
          });
        }
        if (picked.noOption) {
          throw browserError("action_failed", `@${act.ref} 里没有「${act.text}」这一项`, {
            hint: `可选项：${(picked.options ?? []).join(" / ") || "（空）"}`,
          });
        }
        return `已在 @${act.ref} 选择「${picked.value ?? act.text}」`;
      }
      case "eval": {
        try {
          const value = await evaluate<unknown>(evalScript(act.text));
          return `表达式结果：${formatEvalResult(value)}`;
        } catch (error) {
          throw toEvalError(error);
        }
      }
      default: {
        if (act.ref) {
          // 量盒子顺带滚进视口（见 elementBoxScript），与 Playwright 的 scrollIntoViewIfNeeded 同效
          await boxOf(act.ref);
          return `已滚动到 @${act.ref}`;
        }
        const { dx, dy } = scrollDelta(act.direction, act.amount);
        const state = await evaluate<{ viewportWidth?: number; viewportHeight?: number }>(
          "({ viewportWidth: window.innerWidth, viewportHeight: window.innerHeight })",
        );
        await sendCommand("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: Math.round((state.viewportWidth ?? 0) / 2),
          y: Math.round((state.viewportHeight ?? 0) / 2),
          deltaX: dx,
          deltaY: dy,
        });
        return `已滚动 ${dx === 0 ? `${dy}px` : `${dx}px`}`;
      }
    }
  };

  // 导航类事件：编号整体失效（与 Playwright 那条一致），地址跟着更新
  const unsubscribe = transport.on((event) => {
    if (event.method === "Page.frameNavigated") {
      const frame = event.params.frame as
        | { url?: string; parentId?: string; loaderId?: string }
        | undefined;
      // 只有主 frame 算导航；iframe 里的跳转不动我们的编号表
      if (frame && frame.parentId === undefined && typeof frame.url === "string") {
        entries = [];
        url = frame.url;
        if (typeof frame.loaderId === "string") lastLoaderId = frame.loaderId;
      }
    }
    if (event.method === "Page.navigatedWithinDocument" && typeof event.params.url === "string") {
      // 同文档导航（hash / pushState）：地址跟着更新，但文档没换、编号继续有效——与 Playwright 那条一致；
      // 路由后元素真的不在了，由命中检测（编号属性缺失）报 stale_ref 兑住
      url = event.params.url;
    }
  });
  // 事件要发得出来得先把 Page / Runtime 打开（每个目标各自一份状态）
  void sendCommand("Page.enable").catch(() => undefined);
  void sendCommand("Runtime.enable").catch(() => undefined);

  return {
    profile: "desktop",
    mode: "desktop",

    async open({ url: next }) {
      const before = url;
      const loaderBefore = lastLoaderId;
      const result = await sendCommand<{ errorText?: string }>("Page.navigate", { url: next });
      if (result.errorText) {
        throw browserError("navigation_failed", `打开 ${next} 失败：${result.errorText}`, {
          hint: "确认地址可达；桌面端面板里那个标签也会跟着跳",
        });
      }
      /*
        等新文档真的上来（Playwright 那边等的是 domcontentloaded）：`Page.navigate` 在导航**提交前**就返回，
        此时读到的 readyState 与地址还是旧文档的（旧文档通常已 complete），照它判定会立刻返回旧地址，
        随后的动作还会撞上「上下文已销毁」。判据取「主 frame 换了 loaderId」或「地址已经不是原来那个」。
      */
      const deadline = Date.now() + BROWSER_NAVIGATION_TIMEOUT_MS;
      for (;;) {
        const state = await readDocumentState();
        const committed = lastLoaderId !== loaderBefore || state.url !== before;
        if (committed && state.readyState !== "loading") {
          entries = [];
          url = state.url;
          title = state.title;
          return { url, title };
        }
        if (Date.now() > deadline) {
          throw browserError("navigation_failed", `打开 ${next} 超时（页面一直没就绪）`, {
            hint: "地址可能打不开或加载很慢；不做自动等待，可稍后重试",
          });
        }
        await sleep(100);
      }
    },

    async snapshot({ diff = false, compact = false }) {
      const outcome = await captureSnapshot(evaluate, entries, { diff, compact });
      entries = outcome.entries;
      const state = await readDocumentState();
      url = state.url;
      title = state.title;
      return {
        text: outcome.text,
        truncated: outcome.truncated,
        count: outcome.count,
        url,
        title,
      };
    },

    async act(actInput: BrowserActInput) {
      const act = resolveAct(actInput);
      if (act.ref) assertRefInSnapshot(entries, act.ref);
      if (act.ref) await assertRefActionable(evaluate, act.ref);

      const before = { url, origin: await readDocumentOrigin(evaluate) };
      const summary = await runAction(act);
      const state = await readDocumentState();
      url = state.url;
      title = state.title;
      return { summary, url, navigated: await documentChanged(evaluate, before, url) };
    },

    async screenshot({ fullPage = false, ref }) {
      const normalized = normalizeRef(ref);
      const base = { format: "jpeg", quality: BROWSER_SCREENSHOT_QUALITY };
      let shot: { data: string };
      try {
        if (normalized) {
          const box = await boxOf(normalized);
          // clip 是**文档**坐标：元素盒子那两个视口坐标在页面滚动过之后会截到别处
          shot = await sendCommand<{ data: string }>("Page.captureScreenshot", {
            ...base,
            clip: {
              x: box.pageX ?? box.x,
              y: box.pageY ?? box.y,
              width: box.width,
              height: box.height,
              scale: 1,
            },
          });
        } else if (fullPage) {
          const metrics = await sendCommand<{ cssContentSize?: { width: number; height: number } }>(
            "Page.getLayoutMetrics",
          );
          const size = metrics.cssContentSize ?? { width: 0, height: 0 };
          shot = await sendCommand<{ data: string }>("Page.captureScreenshot", {
            ...base,
            clip: {
              x: 0,
              y: 0,
              width: Math.ceil(size.width),
              height: Math.ceil(size.height),
              scale: 1,
            },
            captureBeyondViewport: true,
          });
        } else {
          shot = await sendCommand<{ data: string }>("Page.captureScreenshot", base);
        }
      } catch (error) {
        throw toBrowserError(error, normalized ? `截取 @${normalized}` : "整页截图");
      }
      return { data: shot.data, mimeType: "image/jpeg", url };
    },

    async close() {
      // 页面是用户的标签：这里只断开（不动标签，也不关任何东西）
      unsubscribe();
      entries = [];
    },

    currentUrl: () => url,

    isOpen: () => true,
    isBusy: () => false,
    beginUse: () => undefined,
    endUse: () => undefined,
    idleMs: () => 0,
  };
};
