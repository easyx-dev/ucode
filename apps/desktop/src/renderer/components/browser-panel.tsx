/**
 * 工作台里的浏览器标签：Electron 的 `<webview>` + 一条浏览器工具条。
 *
 * 这里只是「用户自己也能用的浏览器」那一半——地址栏、后退 / 前进、刷新、开发者工具，以及「元素选择」：
 * 点它进点选模式，在页面上点一个元素，摘要就落到当前会话的输入框里（见 `useComposerInsert`）。
 * 另一半是 agent 驱动（见 docs/browser.md）：这一格把自己是谁、开着哪个页面报给主进程，
 * 由它转给服务端；服务端驱动的是`active` 的那一个，所以你在这一块里看到的就是 agent 正在做的事。
 *
 * guest 用独立 partition（`persist:<slug>-browser`）：站点 cookie 不与外壳页（`app://desktop`）混在一个
 * cookie jar 里；数据落盘后可整体清理，不牵动应用自身。
 */

import { brand } from "@ucode/brand";
import { IconButton } from "@ucode/ui/base/button";
import { Input } from "@ucode/ui/base/input";
import { useComposerInsert } from "@ucode/ui/provider";
import { resolveCssColor } from "@ucode/ui/utils/color";
import type { WebviewTag } from "electron";
import { ArrowLeft, ArrowRight, Bug, MousePointer2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBrowserTabReport } from "../lib/browser-tabs";
import { elementSummaryText, type PickedElement, pickerScript } from "../lib/picker-script";

/** 所有浏览器标签共用一个 cookie jar 与存储（像同一个浏览器里的多个标签） */
const BROWSER_PARTITION = `persist:${brand.slug}-browser`;

/** 点选模式在页面里留的根节点 id：重复进入时要清掉上一次的残留，所以取一个不易撞上页面元素的 id */
const PICKER_ROOT_ID = `${brand.slug}-picker-root`;

const isLoadable = (value: string): boolean => /^(https?|file):\/\//.test(value);

/** 地址栏里显示的当前地址；about:blank 之类没什么可看的就不显示 */
const shownUrl = (value: string): string =>
  value === "" || value.startsWith("about:") ? "" : value;

export function BrowserPanel({ tabId, active }: { tabId: string; active: boolean }) {
  const { t } = useTranslation();
  const viewRef = useRef<WebviewTag | null>(null);
  /** 选中页面元素后落到当前会话的输入框（工作台注入，见 `useComposerInsert`） */
  const insertPickedContext = useComposerInsert();
  /** 地址栏里的内容：跟着导航事件走，用户输入时是本地的编辑值 */
  const [address, setAddress] = useState("");
  /** 页面的真实地址（地址栏会滤掉 about:blank 之类）；上报给服务端的是它 */
  const [currentUrl, setCurrentUrl] = useState("");
  /** guest 的 webContents id：服务端驱动时就按它发命令 */
  const [webContentsId, setWebContentsId] = useState<number | null>(null);
  /** 页面标题；空串表示还没拿到（占位文案在渲染时取，换语言跟着变） */
  const [title, setTitle] = useState("");
  /** 前进 / 后退能不能点：webview 没有变更事件，只能在这些时点重读一次 */
  const [history, setHistory] = useState({ back: false, forward: false });
  const [loading, setLoading] = useState(false);
  /** 正在点选元素：页面上有高亮，这里给一句状态，别让用户以为点不动 */
  const [picking, setPicking] = useState(false);

  const syncHistory = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    try {
      setHistory({ back: view.canGoBack(), forward: view.canGoForward() });
    } catch {
      // 页面还没挂上：先当不能前进后退，dom-ready 之后会再同步一次
    }
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return undefined;
    const onNavigate = (event: Electron.DidNavigateEvent | Electron.DidNavigateInPageEvent) => {
      setAddress(shownUrl(event.url));
      setCurrentUrl(event.url);
      syncHistory();
    };
    const onTitle = (event: Electron.PageTitleUpdatedEvent) => setTitle(event.title);
    const onStart = () => setLoading(true);
    const onStop = () => {
      setLoading(false);
      syncHistory();
    };
    /** guest 挂上后才有 webContents id；崩溃重建会换一个，所以每次都重读 */
    const onReady = () => {
      syncHistory();
      setWebContentsId(view.getWebContentsId());
      setCurrentUrl(view.getURL());
    };

    view.addEventListener("did-navigate", onNavigate);
    view.addEventListener("did-navigate-in-page", onNavigate);
    view.addEventListener("page-title-updated", onTitle);
    view.addEventListener("did-start-loading", onStart);
    view.addEventListener("did-stop-loading", onStop);
    view.addEventListener("dom-ready", onReady);
    return () => {
      view.removeEventListener("did-navigate", onNavigate);
      view.removeEventListener("did-navigate-in-page", onNavigate);
      view.removeEventListener("page-title-updated", onTitle);
      view.removeEventListener("did-start-loading", onStart);
      view.removeEventListener("did-stop-loading", onStop);
      view.removeEventListener("dom-ready", onReady);
    };
  }, [syncHistory]);

  const submit = () => {
    const value = address.trim();
    if (value === "") return;
    // 地址栏输入的是搜索词时按默认搜索引擎走（多数站点不给 http:// 前缀就会被当相对路径）
    const target = isLoadable(value)
      ? value
      : `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
    viewRef.current?.loadURL(target).catch(() => undefined);
  };

  /**
   * 点选元素：进点选模式 → 页面里悬停高亮、点击采集（Esc 取消）→ 摘要落进当前输入框。
   * 采集脚本注入页面主世界执行，它返回的 Promise 就是结果本身，不需要另开一条通道。
   */
  const pickElement = async () => {
    const view = viewRef.current;
    if (!view || picking) return;
    setPicking(true);
    try {
      // 高亮色按语义 token 解析：页面里读不到应用的 CSS 变量，只能在这里算好带进去
      const highlight = resolveCssColor("var(--primary)") ?? "currentColor";
      const picked = (await view.executeJavaScript(
        pickerScript({ highlight, rootId: PICKER_ROOT_ID }),
        true,
      )) as PickedElement | null;
      // null = 用户按了 Esc：什么都不做
      if (picked)
        insertPickedContext({
          kind: "pageElement",
          // 芯片上给可访问名；没有就退成标签名，总比一枚空芯片强
          label: picked.name.trim() || `<${picked.tag}>`,
          text: elementSummaryText(picked, { url: currentUrl, title }),
          meta: { url: currentUrl, title, selector: picked.selector },
        });
    } catch {
      /*
        点选期间页面导航或被关掉时，executeJavaScript 会以「上下文已销毁」拒绝——这时确实没有可插入的内容，
        什么都不做就好。不接住的话它会变成一条未处理的 rejection，用户看不到任何提示。
      */
    } finally {
      setPicking(false);
    }
  };

  // 把这一格报给主进程（它转给服务端）：服务端驱动的是 active 的那一个
  useBrowserTabReport({ id: tabId, title, url: currentUrl, webContentsId, active });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <IconButton
          label={t("后退")}
          disabled={!history.back}
          onClick={() => viewRef.current?.goBack()}
        >
          <ArrowLeft />
        </IconButton>
        <IconButton
          label={t("前进")}
          disabled={!history.forward}
          onClick={() => viewRef.current?.goForward()}
        >
          <ArrowRight />
        </IconButton>
        <IconButton label={t("刷新")} disabled={loading} onClick={() => viewRef.current?.reload()}>
          <RotateCw />
        </IconButton>
        <Input
          className="h-7 min-w-0 flex-1"
          value={address}
          placeholder={t("输入网址")}
          aria-label={t("地址栏")}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <IconButton label={t("选择页面元素")} pressed={picking} onClick={() => void pickElement()}>
          <MousePointer2 className="size-icon-sm" />
        </IconButton>
        <IconButton
          label={t("开发者工具")}
          onClick={() => {
            const view = viewRef.current;
            if (!view) return;
            if (view.isDevToolsOpened()) view.closeDevTools();
            else view.openDevTools();
          }}
        >
          <Bug className="size-icon-sm" />
        </IconButton>
      </div>

      {/* 标签标题放在这里而不是标签条上：标签条的标题由 doc 决定，面板只报自己这一格是什么页面 */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-foreground-subtle">
        <span className="min-w-0 truncate">{title === "" ? t("新标签") : title}</span>
        {loading ? <span className="shrink-0">{t("加载中…")}</span> : null}
        {picking ? (
          <span className="shrink-0 text-foreground">{t("在页面上点一个元素（Esc 取消）")}</span>
        ) : null}
      </div>

      <webview
        ref={viewRef}
        src="about:blank"
        partition={BROWSER_PARTITION}
        allowpopups={false}
        className="min-h-0 w-full flex-1"
      />
    </div>
  );
}
