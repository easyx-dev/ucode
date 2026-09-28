import {
  CombinedAutocompleteProvider,
  Container,
  Markdown,
  matchesKey,
  ProcessTerminal,
  SelectList,
  type SlashCommand,
  Spacer,
  TuiMainScreen,
} from "@earendil-works/pi-tui";
import type { AgentSdk, DisplayItem, SessionView, UiRequest } from "@ucode/sdk";
import { toDisplayItems } from "@ucode/sdk";
import { type CommandEffects, runCommand } from "./commands.ts";
import { FramedEditor, PromptFrame, RawLines } from "./components.ts";
import { EDITOR_THEME, MARKDOWN_THEME, SELECT_THEME, tint } from "./theme.ts";
import {
  bannerBox,
  bannerFor,
  buildLine,
  COMMAND_SPECS,
  compactionLine,
  emptyLine,
  errorLine,
  footerLine,
  interactionPrompt,
  isStreaming,
  noticeLine,
  pendingBlock,
  promptHint,
  sessionItems,
  thinkingLine,
  toolBlock,
  turnStartedAt,
  userBlock,
} from "./view.ts";

/**
 * TUI 壳：**复用基座 `@earendil-works/pi-tui` 的组件层**，只把"数据从哪来"换成我们的 SDK（协议 C）。
 *
 * 复用的是三层现成件，而不是自己重写一遍：
 * - `Editor`：多行编辑、历史（↑↓）、撤销、kill-ring、Tab 补全；
 * - `CombinedAutocompleteProvider`：输入 `/` 时的命令提示面板；
 * - `TuiMainScreen` + `Text`/`Markdown`/`Container`/`SelectList`：差分渲染与 CJK 宽度。
 *
 * 分层：`view.ts` 是纯函数（状态 + 宽度 → 文本行），`components.ts` 只提供两个自制件
 * （已排版行、带框输入框），本文件只做"把组件挂到终端 + 把输入接到 SDK"。
 *
 * 两条硬性经验：
 * - **提交后必须自己清空输入框**。`Editor` 不替调用方清空，而"回车了、字还在"会让用户
 *   以为没发出去（实测：接着输入会把两条消息粘成一条）。
 * - **助手正文交给 `Markdown` 组件渲染**，不要自己拼字符串：markdown 的标题、列表、
 *   代码块在终端里要按宽度折行，自己实现等于重写一遍基座。
 */

export type PiTuiOptions = {
  sdk: AgentSdk;
  productName: string;
};

type Notice = { level: "info" | "warn" | "error"; message: string };

/** 终端回滚区有限：只渲染最近 N 项（更早的内容仍在会话文件里）。 */
const MAX_ITEMS = 120;

/** 把命令清单喂给基座的补全器（它按"不带斜杠"的名字匹配，补全时自己加回斜杠）。 */
function slashCommands(): SlashCommand[] {
  return COMMAND_SPECS.map((spec) => ({
    name: spec.name.slice(1),
    description: spec.description,
    ...(spec.args === undefined ? {} : { argumentHint: spec.args }),
  }));
}

export async function runPiTui(options: PiTuiOptions): Promise<number> {
  const { sdk, productName } = options;
  const terminal = new ProcessTerminal();
  const tui = new TuiMainScreen(terminal);

  const root = new Container();
  const transcript = new Container();
  const banner = new RawLines([]);
  const notices = new RawLines([]);
  const build = new RawLines([]);
  const footer = new RawLines([]);
  const editor = new FramedEditor(tui, EDITOR_THEME, { paddingX: 1 });
  /** 正在回答交互请求（`input`/`editor` 档）：这一轮回车是**答案**，不是提问。 */
  let answering: { id: string } | null = null;
  const frame = new PromptFrame({
    editor,
    label: () => (answering === null ? "输入" : "回答提问"),
    hint: () => {
      const view = activeView();
      return promptHint({ running: view?.running === true, answering: answering !== null });
    },
  });
  root.addChild(transcript);
  root.addChild(banner);
  root.addChild(notices);
  root.addChild(build);
  root.addChild(frame);
  root.addChild(footer);
  tui.addChild(root);
  tui.setFocus(frame);
  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(slashCommands(), process.cwd()));

  /** 最近的操作反馈（命令执行结果一类）；成功一次就覆盖掉旧的。 */
  let recentNotices: Notice[] = [];
  let resolveExit: (() => void) | undefined;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  function activeView() {
    const state = sdk.state;
    if (state.activeSessionId === null) return null;
    return state.views[state.activeSessionId] ?? null;
  }

  /**
   * 已经渲染过的块（按展示项 id 复用）。
   *
   * 不复用就会在**每个流式增量**上把整条转录重算一遍（一项一次折行 + 着色），
   * 长会话里这是肉眼可见的卡顿来源。签名变了才重新排版，没变就把旧组件原样放回去。
   */
  const blocks = new Map<
    string,
    { signature: string; node: RawLines | Markdown; markdown: boolean }
  >();

  function linesFor(item: DisplayItem, width: number): string[] | null {
    switch (item.kind) {
      case "user":
        return userBlock(item.text, width);
      case "tool":
        return toolBlock(item, width);
      case "thinking":
        return [thinkingLine(item, width)];
      case "notice":
        return [noticeLine(item.text, width)];
      case "compaction":
        return [compactionLine(item.summary, width)];
      case "pending":
        return pendingBlock(item, width);
      case "assistant":
        return null; // 交给 Markdown 组件
    }
  }

  function signatureOf(item: DisplayItem, width: number): string {
    switch (item.kind) {
      case "user":
        return `${width}|user|${item.text}`;
      case "assistant":
        return `${width}|assistant|${item.markdown}`;
      case "tool":
        return `${width}|tool|${item.toolName}|${item.status}|${JSON.stringify(item.args)}|${item.output}`;
      case "thinking":
        return `${width}|thinking|${item.text}`;
      case "notice":
        return `${width}|notice|${item.text}`;
      case "compaction":
        return `${width}|compaction|${item.summary}`;
      case "pending":
        return `${width}|pending|${JSON.stringify(item.params)}`;
    }
  }

  function blockFor(item: DisplayItem, width: number): RawLines | Markdown {
    const signature = signatureOf(item, width);
    const cached = blocks.get(item.id);
    if (cached !== undefined && cached.signature === signature) return cached.node;

    if (item.kind === "assistant") {
      const node = cached?.markdown === true ? (cached.node as Markdown) : undefined;
      if (node !== undefined) {
        node.setText(item.markdown);
        blocks.set(item.id, { signature, node, markdown: true });
        return node;
      }
      const created = new Markdown(item.markdown, 0, 0, MARKDOWN_THEME, { color: tint.content });
      blocks.set(item.id, { signature, node: created, markdown: true });
      return created;
    }

    const lines = linesFor(item, width) ?? [];
    const node = cached !== undefined && !cached.markdown ? (cached.node as RawLines) : undefined;
    if (node !== undefined) {
      node.setLines(lines);
      blocks.set(item.id, { signature, node, markdown: false });
      return node;
    }
    const created = new RawLines(lines);
    blocks.set(item.id, { signature, node: created, markdown: false });
    return created;
  }

  function readTokens(view: SessionView | null): number | null {
    const usage = view?.usage as { totalTokens?: unknown } | null | undefined;
    return typeof usage?.totalTokens === "number" ? usage.totalTokens : null;
  }

  /** 终端标题：标签页上能看出"这是哪个产品的哪个目录"。只在变化时写一次。 */
  let title = "";
  function syncTitle(cwd: string | null): void {
    const next = cwd === null ? productName : `${productName} — ${cwd}`;
    if (next === title) return;
    title = next;
    terminal.setTitle(next);
  }

  function refresh(): void {
    const state = sdk.state;
    const view = activeView();
    const width = terminal.columns === 0 ? 80 : terminal.columns;
    const now = Date.now();
    syncTicker(view?.running === true);
    syncTitle(view?.state?.cwd ?? null);

    const items = view === null ? [] : toDisplayItems(view);
    const shown = items.length > MAX_ITEMS ? items.slice(-MAX_ITEMS) : items;
    transcript.clear();
    if (shown.length === 0) {
      transcript.addChild(new RawLines([emptyLine(width)]));
    } else {
      if (items.length > shown.length) {
        transcript.addChild(
          new RawLines([noticeLine(`省略较早的 ${items.length - shown.length} 项`, width)]),
        );
      }
      const live = new Set<string>();
      shown.forEach((item, index) => {
        if (index > 0) transcript.addChild(new Spacer(1));
        transcript.addChild(blockFor(item, width));
        live.add(item.id);
      });
      for (const id of [...blocks.keys()]) {
        if (!live.has(id)) blocks.delete(id);
      }
    }

    const bannerText = bannerFor({ connected: state.connected, view, notices: recentNotices });
    banner.setLines(bannerText === null ? [] : bannerBox(bannerText, width));

    notices.setLines(
      recentNotices
        .slice(-4)
        .flatMap((notice) =>
          notice.message.split("\n").map((line) => noticeLine(line, width, notice.level)),
        ),
    );

    const running = view?.running === true;
    build.setLines(
      running
        ? [
            buildLine(
              {
                model: view?.state?.model?.modelId ?? null,
                startedAt: turnStartedAt(view),
                now,
                queued: view?.state?.pendingMessages ?? 0,
                streaming: isStreaming(view),
              },
              width,
            ),
          ]
        : [],
    );

    footer.setLines([
      footerLine(
        {
          cwd: view?.state?.cwd ?? null,
          home: process.env.HOME,
          autonomy: view?.state?.autonomy ?? null,
          model: view?.state?.model?.modelId ?? null,
          tokens: readTokens(view),
          sessionCount: state.sessions.length,
          connected: state.connected,
          trustLevel: state.trustLevel,
          readOnly: view?.readOnly === true,
          hint: "/ 命令",
        },
        width,
      ),
    ]);

    if (view?.lastError != null) {
      transcript.addChild(new Spacer(1));
      transcript.addChild(new RawLines([errorLine(view.lastError.message, width)]));
    }

    tui.requestRender(true);
  }

  function notify(level: Notice["level"], message: string): void {
    recentNotices.push({ level, message });
    refresh();
  }

  /** 成功路径：用"这次做成了什么"覆盖掉旧反馈（包括旧的错误）。 */
  function succeed(message: string): void {
    recentNotices = [{ level: "info", message }];
    refresh();
  }

  function fail(error: unknown, prefix: string): void {
    const message = error instanceof Error ? error.message : String(error);
    recentNotices.push({ level: "error", message: `${prefix}：${message}` });
    refresh();
  }

  const unsubscribe = sdk.subscribe(() => {
    showInteractionIfPending();
    refresh();
  });

  /**
   * 挂上会话。
   *
   * 只挑**本实例拥有**的会话：非 owner 的会话是只读挂载（同一会话只允许一个 writer），
   * 挂上去之后每一次发送都会被拒绝——之前正是因此表现为"发消息完全没反应"。
   * 没有可写的会话就新建一个，这才是用户想要的结果，而不是让他自己去排查权限。
   */
  async function ensureSession(): Promise<void> {
    const state = sdk.state;
    if (state.activeSessionId !== null) return;
    // 会话按更新时间倒序：挑最近一条未归档的作为启动时打开的对象。
    const recent = state.sessions.find((session) => !session.archived);
    if (recent !== undefined) {
      await sdk.attachSession(recent.id);
      return;
    }
    await sdk.createSession({});
  }

  /**
   * 交互请求（工具批准 / `question`）的应答入口。
   *
   * 三档处理：`select` 用选择列表弹窗；`confirm` 给"允许/拒绝"；`input`/`editor` 把编辑器
   * 临时变成"回答这一问"的模式（下一次回车当答案发回，而不是当提问发给模型）。
   */
  let shownRequestId: string | null = null;

  function pendingRequest(): UiRequest | undefined {
    const state = sdk.state;
    const active = state.activeSessionId;
    return (
      state.interactions.find((request) => request.sessionId === active) ?? state.interactions[0]
    );
  }

  function focusEditor(): void {
    tui.setFocus(frame);
  }

  function closeOverlay(): void {
    tui.hideOverlay();
    focusEditor();
  }

  function respond(id: string, value: string | boolean | null, cancelled = false): void {
    answering = null;
    shownRequestId = id;
    sdk.respondToInteraction(id, value, cancelled ? { cancelled: true } : undefined);
    refresh();
  }

  function showInteractionIfPending(): void {
    const request = pendingRequest();
    if (request === undefined || answering !== null || shownRequestId === request.id) return;
    const prompt = interactionPrompt(request);
    if (prompt === null) return;

    if (prompt.kind === "select") {
      shownRequestId = request.id;
      // 选项列表里放不下问题正文，所以问题同时进通知区——否则用户只看到三个选项。
      notify("warn", prompt.title);
      const list = new SelectList(
        prompt.options.map((option) => ({ label: option, value: option })),
        Math.min(prompt.options.length, 8),
        SELECT_THEME,
      );
      list.onSelect = (item) => {
        closeOverlay();
        respond(request.id, item.value);
      };
      list.onCancel = () => {
        closeOverlay();
        respond(request.id, null, true);
      };
      tui.showOverlay(list, {});
      tui.setFocus(list);
      refresh();
      return;
    }

    if (prompt.kind === "confirm") {
      shownRequestId = request.id;
      notify("warn", prompt.message === "" ? prompt.title : `${prompt.title}：${prompt.message}`);
      const list = new SelectList(
        [
          { label: "允许", value: "yes" },
          { label: "拒绝", value: "no" },
        ],
        2,
        SELECT_THEME,
      );
      list.onSelect = (item) => {
        closeOverlay();
        respond(request.id, item.value === "yes");
      };
      list.onCancel = () => {
        closeOverlay();
        respond(request.id, null, true);
      };
      tui.showOverlay(list, {});
      tui.setFocus(list);
      refresh();
      return;
    }

    // input / editor：编辑器变成回答模式
    shownRequestId = request.id;
    answering = { id: request.id };
    if (prompt.prefill !== null) editor.setText(prompt.prefill);
    notify(
      "info",
      `请回答：${prompt.title}${prompt.placeholder === null ? "" : `（${prompt.placeholder}）`}`,
    );
    focusEditor();
    refresh();
  }

  function showSessionPicker(): void {
    const state = sdk.state;
    const items = sessionItems(state.sessions, state.activeSessionId);
    if (items.length === 0) {
      notify("warn", "还没有会话。");
      return;
    }
    const list = new SelectList(items, 10, SELECT_THEME);
    list.onSelect = (item) => {
      closeOverlay();
      void sdk
        .attachSession(item.value)
        .then(() => succeed(`已切换到会话 ${item.value}`))
        .catch((error: unknown) => fail(error, "切换失败"));
    };
    list.onCancel = closeOverlay;
    tui.showOverlay(list, {});
    tui.setFocus(list);
    refresh();
  }

  async function handleSubmit(value: string): Promise<void> {
    const text = value.trim();
    if (text === "") return;
    // 先清空：无论成败，用户敲的那行都已经"被收走了"。
    editor.setText("");

    // 正在回答交互请求：这一行是**答案**，不是发给模型的提问。
    if (answering !== null) {
      const id = answering.id;
      answering = null;
      sdk.respondToInteraction(id, text);
      succeed("已回给 agent");
      return;
    }

    if (!text.startsWith("/")) {
      const sessionId = sdk.state.activeSessionId;
      if (sessionId === null) {
        notify("warn", "没有活动会话，输入 /new 新建。");
        return;
      }
      const view = activeView();
      if (view?.readOnly === true) {
        notify("warn", "这是只读挂载（本实例不是该会话的 owner），输入 /new 开一个新会话。");
        return;
      }
      try {
        const result = await sdk.prompt(sessionId, text);
        if (result.queued) {
          notify("info", `已排队（第 ${result.pendingMessages} 条）：这一轮结束后发送。`);
        }
      } catch (error) {
        fail(error, "发送失败");
      }
      return;
    }

    const [command = "", ...rest] = text.split(/\s+/);
    try {
      const known = await runCommand(sdk, effects, command, rest);
      if (!known) notify("warn", `未知命令 ${command}，输入 /help 查看。`);
    } catch (error) {
      fail(error, "命令失败");
    }
  }

  editor.onSubmit = (value: string) => {
    void handleSubmit(value);
  };

  const effects: CommandEffects = {
    notify,
    succeed,
    showSessionPicker,
    exit: () => resolveExit?.(),
  };

  /** 运行中每秒刷一次（"已经跑了 12.3s"要自己走，否则界面看起来是死的）。 */
  let ticker: NodeJS.Timeout | undefined;
  function syncTicker(running: boolean): void {
    if (running && ticker === undefined) {
      ticker = setInterval(refresh, 1_000);
      ticker.unref();
    } else if (!running && ticker !== undefined) {
      clearInterval(ticker);
      ticker = undefined;
    }
  }

  const removeListener = tui.addInputListener((data: string) => {
    if (matchesKey(data, "ctrl+c")) {
      resolveExit?.();
      return { consume: true };
    }
    return undefined;
  });

  // 终端尺寸变了要重排（方框与右对齐都依赖宽度）。
  const onResize = (): void => refresh();
  process.stdout.on("resize", onResize);

  tui.start();
  try {
    await ensureSession();
    await sdk.listModels().catch(() => undefined);
  } catch (error) {
    fail(error, "初始化会话失败");
  }
  refresh();

  await exited;
  removeListener();
  process.stdout.off("resize", onResize);
  if (ticker !== undefined) clearInterval(ticker);
  unsubscribe();
  tui.stop({ preserveScreen: true });
  return 0;
}
