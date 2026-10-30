/**
 * 5 个浏览器工具（源方案 §4）：open / snapshot / act / screenshot / close。
 *
 * 三条口径写在描述里，因为模型只能从描述知道这些：
 * 编号按语义哈希生成、导航后整体失效（必须先重新快照）；元素被遮挡或编号失效**立刻失败**、
 * 不自动等待也不自动重试；截图是确认视觉结果的唯一手段（headless 下模型看不到像素）。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { BrowserConfig } from "@ucode/contracts";
import { Type } from "typebox";

import { BROWSER_DEFAULT_PROFILE } from "../../../constants/browser";
import { browserActParameters } from "./actions";
import { browserError } from "./errors";
import type { BrowserHooks } from "./hooks";
import type { BrowserSession } from "./session";

export const BROWSER_TOOL_NAMES = [
  "browser_open",
  "browser_snapshot",
  "browser_act",
  "browser_screenshot",
  "browser_close",
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

/** 是否是浏览器工具：只读角色的规则文案要把它与写盘 / 执行命令分开说 */
export const isBrowserTool = (name: string): boolean =>
  (BROWSER_TOOL_NAMES as readonly string[]).includes(name);

/**
 * 浏览器工具里的**观察面**：打开页面、看元素、截图、断开。只读角色放行这几个
 * （打开页面落回默认规则的按站点审批），其余（`browser_act`：点击 / 输入 / 滚动）会改变页面状态，仍阻断。
 *
 * 写成白名单而不是列出要禁的：以后新增的浏览器工具默认落在阻断侧。
 */
export const BROWSER_OBSERVE_TOOL_NAMES = [
  "browser_open",
  "browser_snapshot",
  "browser_screenshot",
  "browser_close",
] as const;

/** 会改变页面状态的浏览器工具：只在**受管实例**（自启的 Chromium）里对只读角色放行 */
export const BROWSER_ACT_TOOL_NAME = "browser_act";

/** 是否是只读角色也放行的浏览器工具（观察面） */
export const isObservingBrowserTool = (name: string): boolean =>
  (BROWSER_OBSERVE_TOOL_NAMES as readonly string[]).includes(name);

/** 只有 http(s) 能开：`file://` 等于把本机文件读面交给模型，要读文件用 read 工具 */
const assertAllowedUrl = (url: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw browserError("blocked_target", `地址无法解析：${url}`, {
      hint: "传完整的 http/https 地址",
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw browserError("blocked_target", `只允许 http/https，收到 ${parsed.protocol}`, {
      hint: "回环与私网地址可以开（本地自测常用），file:// 与 data: 一律拒绝",
    });
  }
};

/** 工具调用期间标记实例为「在用」：空闲回收不会把正在跑的动作关掉 */
const withBrowserSession = async <T>(
  session: BrowserSession,
  run: () => Promise<T>,
): Promise<T> => {
  session.beginUse();
  try {
    return await run();
  } finally {
    session.endUse();
  }
};

const openTool = (browser: BrowserHooks, settings: () => BrowserConfig) =>
  defineTool({
    name: "browser_open",
    label: "browser_open",
    description:
      "打开一个 http/https 地址，返回标题与最终 URL。打开后先用 browser_snapshot 拿元素编号，再用 browser_act 操作。" +
      "桌面端工作台里开着浏览器标签时，驱动的是**你当前在看的那个标签**（在同一个页面里打开地址），" +
      "不另起浏览器——这样你就能直接看着 agent 操作；想强制用受管的独立浏览器，就传 profile 或 cdpEndpoint。" +
      "同一会话反复调用会复用同一个实例。attach 模式下传 cdpEndpoint 可以连你自己启动的调试实例" +
      "（只操作新建的标签，不动你已打开的页面）。",
    promptSnippet: "在受管浏览器里打开地址并拿到元素编号",
    promptGuidelines: [
      "改完前端要在浏览器里自证时：browser_open 打开本地地址 → browser_snapshot 拿编号 → browser_act 操作 → browser_screenshot 确认视觉结果。",
      "browser_open 只接受 http/https；本地自测用 http://127.0.0.1:<port>。",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "要打开的完整地址（http/https）" }),
      profile: Type.Optional(
        Type.String({
          description:
            "浏览器数据目录名（如 work）。**给了就把这份数据长期保留**（登录态跨会话保留，可反复用）；" +
            "不传则用临时目录，实例关掉即删。同名 profile 的多个会话共用同一份数据（cookie 也共用），" +
            "不同名字之间互相隔离",
        }),
      ),
      cdpEndpoint: Type.Optional(
        Type.String({
          description:
            "已启动的调试实例端点，如 http://127.0.0.1:9222；给了就走 attach，不自己启动",
        }),
      ),
      executablePath: Type.Optional(
        Type.String({ description: "指定浏览器可执行文件；不传则自动探测" }),
      ),
      headless: Type.Optional(Type.Boolean({ description: "是否无头，默认 true" })),
    }),
    annotations: { openWorldHint: true },
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      assertAllowedUrl(params.url);
      const config = settings();
      // 工具入参优先于配置：这一次调用要连哪里、用哪份数据，模型可以当场决定
      const mode = params.cdpEndpoint ? "attach" : config.mode;
      const endpoint = params.cdpEndpoint ?? config.endpoint;
      if (mode === "attach" && !endpoint) {
        throw browserError("attach_failed", "选了 attach 但没有调试端点", {
          hint: "在设置里填端点（如 http://127.0.0.1:9222），或在 browser_open 里传 cdpEndpoint",
        });
      }
      // 「给了名字」= 想长期保留：临时目录与持久化目录是两种数据面，不能混用同一个名字
      const requested = (params.profile ?? "").trim() || config.profile;
      const profile = requested || BROWSER_DEFAULT_PROFILE;
      const persistent = requested !== "";
      // 模型显式要受管的浏览器：给了 profile / 端点 / 可执行文件 / 无头开关任一（否则桌面端开着标签就驱动它）
      const managedRequested = Boolean(
        (params.profile ?? "").trim() ||
          params.cdpEndpoint ||
          params.executablePath ||
          params.headless !== undefined,
      );
      const session = browser.acquire({
        sessionId: ctx.sessionManager.getSessionId(),
        profile,
        persist: persistent,
        mode,
        managedRequested,
        ...(mode === "attach" ? { endpoint } : {}),
        ...(params.executablePath ? { executablePath: params.executablePath } : {}),
        ...(params.headless === undefined ? {} : { headless: params.headless }),
      });
      const opened = await withBrowserSession(session, () => session.open({ url: params.url }));
      const kept =
        session.mode === "desktop"
          ? "在桌面端面板的那个浏览器标签里打开（数据用的是该标签自己的 cookie），它不会关闭你的标签"
          : persistent
            ? `数据长期保留在 profile「${profile}」里（同名会话共用，含登录态）`
            : "本次用临时数据目录，实例关掉即删";
      return {
        content: [
          {
            type: "text",
            text:
              `已打开 ${opened.url}${opened.title ? `（标题：${opened.title}）` : ""}；${kept}；` +
              "下一步用 browser_snapshot 拿元素编号。",
          },
        ],
        details: {
          profile: session.mode === "desktop" ? null : profile,
          persistent,
          url: opened.url,
          title: opened.title,
        },
      };
    },
  });

const snapshotTool = (browser: BrowserHooks) =>
  defineTool({
    name: "browser_snapshot",
    label: "browser_snapshot",
    description:
      '获取当前页面的可交互元素列表，每行形如 `@e1a2 button "登录"`。' +
      "编号按元素的可访问名生成，页面多出弹层时已有编号不会错位；**页面导航后编号整体失效**，必须重新快照。" +
      "列表可能因条数或字符上限被截断，截断时说明里会写清楚；需要关注被截掉的部分时，先 scroll 再快照。",
    promptSnippet: "获取带 @e 编号的页面元素列表",
    promptGuidelines: [
      "操作前先 browser_snapshot；不要凭猜测的 ref 调用 browser_act。",
      "browser_act 失败并提示编号失效时，重新 browser_snapshot，不要重试同一个 ref。",
    ],
    parameters: Type.Object({
      diff: Type.Optional(
        Type.Boolean({
          description:
            "只回传与上次快照相比的变化（默认关）。开启后页面当前状态不再完整呈现，只适合连续小步操作",
        }),
      ),
      compact: Type.Optional(
        Type.Boolean({
          description:
            "取噪：丢掉没有名字的通用容器与视口外的元素（默认关）。页面很长、或列表里全是空容器时能明显省 token；代价是被丢掉的元素不会出现在结果里",
        }),
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = browser.current(ctx.sessionManager.getSessionId());
      const result = await withBrowserSession(session, () =>
        session.snapshot({ diff: params.diff ?? false, compact: params.compact ?? false }),
      );
      return {
        content: [{ type: "text", text: result.text || "（页面上没有可交互元素）" }],
        details: {
          url: result.url,
          title: result.title,
          count: result.count,
          truncated: result.truncated,
        },
      };
    },
  });

const actTool = (browser: BrowserHooks) =>
  defineTool({
    name: "browser_act",
    label: "browser_act",
    description:
      "对 @e 编号的元素执行一个动作：click / fill / type / press / select / scroll / eval。" +
      "不做自动等待也不自动重试：元素被遮挡、不可见或编号失效会立刻失败，" +
      "失败信息里给出原因与下一步（该重新快照还是该先滚动）。",
    promptSnippet: "对元素执行点击 / 输入 / 按键 / 选择 / 滚动，或在页面里求值表达式",
    promptGuidelines: [
      "fill 覆盖内容、type 逐字输入（触发按键事件）、press 按键；select 传选项的 value 或可见文本。",
      "动作之后需要确认页面变了没有：把新 URL 与结果摘要当作判断依据，必要时再快照或截图。",
      "要核对计算值（高度 / 间距 / 字号这类「比数字」的场景）用 eval 传表达式，如 " +
        "(() => { const s = getComputedStyle(document.querySelector('.x')); return { h: s.height }; })()；" +
        "多句要写成 IIFE（eval 只包一层求值，不接裸的多语句）。",
    ],
    parameters: browserActParameters,
    annotations: { destructiveHint: true, openWorldHint: true },
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = browser.current(ctx.sessionManager.getSessionId());
      const result = await withBrowserSession(session, () => session.act(params));
      const moved = result.navigated ? "（页面已跳转，之前的元素编号已失效，需要重新快照）" : "";
      return {
        content: [{ type: "text", text: `${result.summary}${moved}；当前地址：${result.url}` }],
        details: { url: result.url, navigated: result.navigated },
      };
    },
  });

const screenshotTool = (browser: BrowserHooks) =>
  defineTool({
    name: "browser_screenshot",
    label: "browser_screenshot",
    description:
      "截取整页或某个 @e 元素的画面（jpeg）。元素列表看不出布局、样式、图片是否正常，" +
      "要确认视觉结果时用它；只看某个区域就传 ref，避免大图占满上下文。",
    promptSnippet: "截图确认视觉结果",
    promptGuidelines: ["改动样式或布局后用 browser_screenshot 自证，别只看元素列表下结论。"],
    parameters: Type.Object({
      fullPage: Type.Optional(Type.Boolean({ description: "是否整页（默认只截视口）" })),
      ref: Type.Optional(Type.String({ description: "只截这个元素，如 @e1a2" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const session = browser.current(ctx.sessionManager.getSessionId());
      const shot = await withBrowserSession(session, () =>
        session.screenshot({
          fullPage: params.fullPage ?? false,
          ...(params.ref ? { ref: params.ref } : {}),
        }),
      );
      return {
        content: [
          { type: "image", data: shot.data, mimeType: shot.mimeType },
          { type: "text", text: `截图地址：${shot.url}` },
        ],
        details: { url: shot.url, ref: params.ref ?? null },
      };
    },
  });

const closeTool = (browser: BrowserHooks) =>
  defineTool({
    name: "browser_close",
    label: "browser_close",
    description:
      "关闭本会话的浏览器。我们自己启动的实例会连进程一起关掉；attach 到你的调试实例、或驱动的是桌面端面板里的" +
      "标签时只断开连接，不会关掉你的浏览器。同一个 profile 还有别的会话在用时进程保留。",
    promptSnippet: "关闭浏览器释放资源",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const session = browser.current(ctx.sessionManager.getSessionId());
      const wasDesktop = session.mode === "desktop";
      const result = browser.release(ctx.sessionManager.getSessionId(), { closeWhenUnused: true });
      const text = result.closed
        ? "已关闭浏览器实例"
        : wasDesktop
          ? "已断开与桌面端浏览器标签的连接（标签本身留着，你还能继续用）"
          : `已释放引用；还有 ${result.remainingHolders} 个会话在用同一个 profile，实例保留（空闲后会自动回收）`;
      return { content: [{ type: "text", text }], details: { closed: result.closed } };
    },
  });

export const createBrowserTools = (browser: BrowserHooks, settings: () => BrowserConfig) => [
  openTool(browser, settings),
  snapshotTool(browser),
  actTool(browser),
  screenshotTool(browser),
  closeTool(browser),
];
