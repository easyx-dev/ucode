import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  type EditorTheme,
  matchesKey,
  ProcessTerminal,
  SelectList,
  type SelectListTheme,
  type SlashCommand,
  Text,
  TuiMainScreen,
} from "@earendil-works/pi-tui";
import type { AgentSdk, AutonomyLevel } from "@ucode/sdk";
import {
  bannerFor,
  COMMAND_SPECS,
  helpText,
  hintLine,
  sessionItems,
  statusLine,
  transcriptLines,
} from "./view.ts";

/**
 * TUI 壳：**复用基座 `@earendil-works/pi-tui` 的组件层**，只把"数据从哪来"换成我们的 SDK（协议 C）。
 *
 * 复用的是三层现成件，而不是自己重写一遍：
 * - `Editor`：多行编辑、历史（↑↓）、撤销、kill-ring、Tab 补全；
 * - `CombinedAutocompleteProvider`：输入 `/` 时的命令提示面板（"没有命令提示"那条反馈的正解）；
 * - `TuiMainScreen` + `Text`/`Container`/`SelectList`：差分渲染与 CJK 宽度。
 *
 * 分层：`view.ts` 是纯函数（状态 → 文本行），这里只做"把组件挂到终端 + 把输入接到 SDK"。
 * 因此渲染逻辑可脱离终端单测，本文件只承担 I/O 与命令分发。
 *
 * 一条硬性经验：**提交后必须自己清空输入框**。`Editor` 不替调用方清空，
 * 而"回车了、字还在"会让用户以为没发出去（实测：接着输入会把两条消息粘成一条）。
 */

export type PiTuiOptions = {
  sdk: AgentSdk;
  productName: string;
};

type Notice = { level: "info" | "warn" | "error"; message: string };

const ANSI = {
  reset: "\u001B[0m",
  dim: "\u001B[2m",
  bold: "\u001B[1m",
  red: "\u001B[31m",
  yellow: "\u001B[33m",
  cyan: "\u001B[36m",
} as const;

const SELECT_THEME: SelectListTheme = {
  selectedPrefix: (text) => `${ANSI.cyan}${text}${ANSI.reset}`,
  selectedText: (text) => `${ANSI.bold}${text}${ANSI.reset}`,
  description: (text) => `${ANSI.dim}${text}${ANSI.reset}`,
  scrollInfo: (text) => `${ANSI.dim}${text}${ANSI.reset}`,
  noMatch: (text) => `${ANSI.dim}${text}${ANSI.reset}`,
};

const EDITOR_THEME: EditorTheme = {
  borderColor: (text) => `${ANSI.dim}${text}${ANSI.reset}`,
  selectList: SELECT_THEME,
};

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
  const noticesBlock = new Container();
  const banner = new Text("");
  const hint = new Text("");
  const status = new Text("");
  const editor = new Editor(tui, EDITOR_THEME, { paddingX: 1 });
  root.addChild(transcript);
  root.addChild(noticesBlock);
  root.addChild(banner);
  root.addChild(hint);
  root.addChild(status);
  root.addChild(editor);
  tui.addChild(root);
  tui.setFocus(editor);
  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(slashCommands(), process.cwd()));

  /** 最近的操作反馈；成功一次就清掉，避免陈旧的错误一直挂在屏幕上。 */
  let notices: Notice[] = [];
  let resolveExit: (() => void) | undefined;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  function activeView() {
    const state = sdk.state;
    if (state.activeSessionId === null) return null;
    return state.views[state.activeSessionId] ?? null;
  }

  function refresh(): void {
    const state = sdk.state;
    const view = activeView();
    const width = terminal.columns === 0 ? 80 : terminal.columns;

    transcript.clear();
    if (view === null) {
      transcript.addChild(new Text("(没有活动会话。输入 /new 新建。)"));
    } else {
      for (const line of transcriptLines(view, { width })) transcript.addChild(new Text(line));
    }

    noticesBlock.clear();
    for (const notice of notices.slice(-4)) {
      const mark = notice.level === "error" ? "✗" : notice.level === "warn" ? "⚠" : "·";
      const color =
        notice.level === "error" ? ANSI.red : notice.level === "warn" ? ANSI.yellow : ANSI.dim;
      for (const line of notice.message.split("\n")) {
        noticesBlock.addChild(new Text(`${color}${mark} ${line}${ANSI.reset}`));
      }
    }

    const bannerText = bannerFor({ connected: state.connected, view, notices });
    banner.setText(bannerText === null ? "" : `${ANSI.yellow}${bannerText}${ANSI.reset}`);

    const running = view?.running === true;
    hint.setText(
      `${ANSI.dim}${hintLine({
        running,
        streaming: view !== null && view.streaming.text.trim() !== "",
      })}${ANSI.reset}`,
    );

    status.setText(
      statusLine({
        productName,
        connected: state.connected,
        trustLevel: state.trustLevel,
        sessionCount: state.sessions.length,
        view,
        model: view?.state?.model?.modelId ?? null,
      }),
    );
    tui.requestRender(true);
  }

  function notify(level: Notice["level"], message: string): void {
    notices.push({ level, message });
    refresh();
  }

  /** 成功路径：用"这次做成了什么"覆盖掉旧反馈（包括旧的错误）。 */
  function succeed(message: string): void {
    notices = [{ level: "info", message }];
    refresh();
  }

  function fail(error: unknown, prefix: string): void {
    const message = error instanceof Error ? error.message : String(error);
    notices.push({ level: "error", message: `${prefix}：${message}` });
    refresh();
  }

  const unsubscribe = sdk.subscribe(() => refresh());

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
    const owned = state.sessions.find((session) => session.owned && !session.archived);
    if (owned !== undefined) {
      await sdk.attachSession(owned.id);
      return;
    }
    await sdk.createSession({});
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
      tui.hideOverlay();
      tui.setFocus(editor);
      void sdk
        .attachSession(item.value)
        .then(() => succeed(`已切换到会话 ${item.value}`))
        .catch((error: unknown) => fail(error, "切换失败"));
    };
    list.onCancel = () => {
      tui.hideOverlay();
      tui.setFocus(editor);
      refresh();
    };
    tui.showOverlay(list, {});
    tui.setFocus(list);
    refresh();
  }

  /** 命令处理。返回 false 表示"不认识这条命令"。 */
  async function runCommand(command: string, rest: string[]): Promise<boolean> {
    switch (command) {
      case "/help":
        notify("info", helpText());
        return true;
      case "/new": {
        const sessionId = await sdk.createSession(rest[0] === undefined ? {} : { cwd: rest[0] });
        succeed(`已新建会话 ${sessionId}`);
        return true;
      }
      case "/sessions":
        showSessionPicker();
        return true;
      case "/model": {
        const sessionId = sdk.state.activeSessionId;
        if (sessionId === null) {
          notify("warn", "没有活动会话，输入 /new 新建。");
          return true;
        }
        const target = rest[0];
        if (target === undefined) {
          const models = sdk.state.models;
          notify(
            models.length === 0 ? "warn" : "info",
            models.length === 0
              ? "还没有可用的模型：用 /provider <id> <baseUrl> <模型> [密钥] 添加一个供应商。"
              : `可用模型（用 /model 供应商/模型 切换）：\n${models
                  .map((model) => `  ${model.provider}/${model.modelId}`)
                  .join("\n")}`,
          );
          return true;
        }
        const [provider, modelId] = target.split("/");
        if (provider === undefined || modelId === undefined) {
          notify("warn", "用法：/model 供应商/模型Id（不带参数则列出可选模型）");
          return true;
        }
        await sdk.setModel(sessionId, provider, modelId);
        succeed(`已切换到 ${provider}/${modelId}`);
        return true;
      }
      case "/provider": {
        const [id, baseUrl, model, apiKey] = rest;
        if (id === undefined || baseUrl === undefined || model === undefined) {
          notify(
            "warn",
            "用法：/provider <id> <baseUrl> <模型> [密钥]\n" +
              "  例：/provider my-proxy http://127.0.0.1:8000/v1 gpt-4o-mini sk-xxx\n" +
              "  id 不要与基座内置供应商同名（内置目录会与之合并，模型会被换掉）。",
          );
          return true;
        }
        const outcome = await sdk.addProvider({
          id,
          baseUrl,
          models: [{ id: model, name: model, input: ["text"] }],
          ...(apiKey === undefined ? {} : { apiKey }),
          makeDefault: true,
        });
        if (outcome.warning !== null) notify("warn", outcome.warning);
        else
          succeed(
            `已${outcome.created ? "添加" : "覆盖"}供应商 ${id}（模型 ${model}），并设为默认模型`,
          );
        return true;
      }
      case "/autonomy": {
        const sessionId = sdk.state.activeSessionId;
        if (sessionId === null) {
          notify("warn", "没有活动会话，输入 /new 新建。");
          return true;
        }
        const level = rest[0];
        if (level === undefined) {
          notify("warn", "用法：/autonomy confirm | auto-edit | plan | full-access");
          return true;
        }
        await sdk.setAutonomy(sessionId, level as AutonomyLevel);
        succeed(`自主级别已设为 ${level}`);
        return true;
      }
      case "/tasks":
        notify(
          "info",
          "自动化任务的界面在 Web/桌面壳（协议 task.* 命令已就绪）；TUI 暂不提供面板。",
        );
        return true;
      case "/quit":
        resolveExit?.();
        return true;
      default:
        return false;
    }
  }

  async function handleSubmit(value: string): Promise<void> {
    const text = value.trim();
    if (text === "") return;
    // 先清空：无论成败，用户敲的那行都已经"被收走了"。
    editor.setText("");

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
        await sdk.prompt(sessionId, text);
      } catch (error) {
        fail(error, "发送失败");
      }
      return;
    }

    const [command = "", ...rest] = text.split(/\s+/);
    try {
      const known = await runCommand(command, rest);
      if (!known) notify("warn", `未知命令 ${command}，输入 /help 查看。`);
    } catch (error) {
      fail(error, "命令失败");
    }
  }

  editor.onSubmit = (value: string) => {
    void handleSubmit(value);
  };

  const removeListener = tui.addInputListener((data: string) => {
    if (matchesKey(data, "ctrl+c")) {
      resolveExit?.();
      return { consume: true };
    }
    return undefined;
  });

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
  unsubscribe();
  tui.stop({ preserveScreen: true });
  return 0;
}
