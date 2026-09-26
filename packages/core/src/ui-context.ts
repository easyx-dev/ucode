import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { ServerMessage, UiMethod } from "@ucode/protocol";
import type { UiBroker } from "./ui-broker.ts";

/**
 * 把基座的 `ExtensionUIContext` 桥到协议 C 的交互面（spec §4.6）。
 *
 * 这是"人类交互中转"的实现点：插件或闸门说"我要问用户一个问题"，
 * 核心层把问题变成 `ui.request` 发给控制层，等 `ui.response` 回来，再把答案交回去。
 *
 * 两条可靠性要求不同的路：
 * - **阻塞式**（select / confirm / input / editor）：必须配对，丢一次权限确认会让 agent 永久挂起；
 * - **通知式**（notify / status / widget / title / editor 文本）：发完即忘，可以丢。
 *
 * 无法承载的交互（`custom`：要求控制层渲染任意 TUI 组件）**走降级而不是挂起**——
 * 直接以明确错误返回，让调用方自己处置（spec §5.2 第 3 条）。
 */

export type UiContextOptions = {
  sessionId: string;
  broker: UiBroker;
  /** 发通知类消息给这个会话的所有挂载者。 */
  broadcast: (message: ServerMessage) => void;
};

export function createExtensionUiContext(options: UiContextOptions): ExtensionUIContext {
  const { sessionId, broker, broadcast } = options;

  const ask = async (
    method: UiMethod,
    params: Record<string, unknown>,
  ): Promise<string | boolean | null> => {
    const outcome = await broker.request({
      sessionId,
      method,
      params: params as never,
      origin: "question",
    });
    if (outcome.status === "answered") return outcome.value;
    return null; // 超时 / 无承载 / 撤回：都返回"没答"，由调用方决定语义
  };

  const ui = {
    async select(title: string, options_: string[]): Promise<string | undefined> {
      const value = await ask("select", { title, options: options_ });
      return typeof value === "string" ? value : undefined;
    },

    async confirm(title: string, message: string): Promise<boolean> {
      const value = await ask("confirm", { title, message });
      return value === true;
    },

    async input(title: string, placeholder?: string): Promise<string | undefined> {
      const value = await ask("input", {
        title,
        ...(placeholder === undefined ? {} : { placeholder }),
      });
      return typeof value === "string" ? value : undefined;
    },

    async editor(title: string, prefill?: string): Promise<string | undefined> {
      const value = await ask("editor", { title, ...(prefill === undefined ? {} : { prefill }) });
      return typeof value === "string" ? value : undefined;
    },

    notify(message: string, type?: "info" | "warning" | "error"): void {
      const level = type === "warning" ? "warn" : (type ?? "info");
      broadcast({ type: "ui.notify", level, message, sessionId });
    },

    setStatus(key: string, text: string | undefined): void {
      broadcast({ type: "ui.status", key, value: text ?? null, sessionId });
    },

    setTitle(title: string): void {
      broadcast({ type: "ui.title", value: title });
    },

    setEditorText(text: string): void {
      broadcast({ type: "ui.set_editor_text", value: text, sessionId });
    },

    pasteToEditor(text: string): void {
      broadcast({ type: "ui.set_editor_text", value: text, sessionId });
    },

    getEditorText(): string {
      // 编辑器内容属于控制层；核心层不持有它。
      return "";
    },

    /** 控制层渲染不了终端组件：显式降级，不挂起。 */
    async custom(): Promise<never> {
      throw new Error("这条通路不支持自定义终端组件（交互降级）。");
    },

    onTerminalInput(): () => void {
      return () => undefined;
    },

    setWorkingMessage(): void {},
    setWorkingVisible(): void {},
    setWorkingIndicator(): void {},
    setHiddenThinkingLabel(): void {},
    setWidget(): void {},
    setFooter(): void {},
    setHeader(): void {},
    addAutocompleteProvider(): void {},
    setEditorComponent(): void {},
    getEditorComponent(): undefined {
      return undefined;
    },
    getToolsExpanded(): boolean {
      return false;
    },
    setToolsExpanded(): void {},
    getAllThemes(): { name: string; path: string | undefined }[] {
      return [];
    },
    getTheme(): undefined {
      return undefined;
    },
    setTheme(): { success: boolean; error?: string } {
      return { success: false, error: "主题由控制层负责，核心层不做主题管理。" };
    },
  };

  // 基座的 UI 接口包含大量只在 TUI 宿主里才有意义的成员（组件工厂、主题、快捷键……）。
  // 我们是 headless 宿主：实现有语义的那些，其余留空——因此这里一次性收敛类型。
  return ui as unknown as ExtensionUIContext;
}
