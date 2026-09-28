import type { AgentSdk, AutonomyLevel } from "@ucode/sdk";
import { helpText } from "./view.ts";

/**
 * 斜杠命令的**实现**。
 *
 * 命令清单在 `view.ts`（`COMMAND_SPECS`，帮助文本与补全的唯一来源），实现在这里，
 * 装配与渲染在 `app.ts`——三者分开是为了让"加了命令却忘了写帮助"这类漂移在结构上不可能发生。
 * 本模块不认识终端：通知与选择列表由调用方注入，因此命令的行为可以单独推演。
 */

export type CommandEffects = {
  notify: (level: "info" | "warn" | "error", message: string) => void;
  /** 成功路径：用"这次做成了什么"覆盖旧反馈。 */
  succeed: (message: string) => void;
  /** 打开会话选择列表（`/sessions`）。 */
  showSessionPicker: () => void;
  /** 退出（`/quit`）。 */
  exit: () => void;
};

/** 命令处理。返回 false 表示"不认识这条命令"。 */
export async function runCommand(
  sdk: AgentSdk,
  effects: CommandEffects,
  command: string,
  rest: readonly string[],
): Promise<boolean> {
  const { notify, succeed } = effects;
  switch (command) {
    case "/help":
      notify("info", helpText());
      return true;
    case "/new": {
      const { sessionId } = await sdk.createSession(rest[0] === undefined ? {} : { cwd: rest[0] });
      succeed(`已新建会话 ${sessionId}`);
      return true;
    }
    case "/sessions":
      effects.showSessionPicker();
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
      else {
        succeed(
          `已${outcome.created ? "添加" : "覆盖"}供应商 ${id}（模型 ${model}），并设为默认模型`,
        );
      }
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
      notify("info", "自动化任务的界面在 Web/桌面壳（协议 task.* 命令已就绪）；TUI 暂不提供面板。");
      return true;
    case "/quit":
      effects.exit();
      return true;
    default:
      return false;
  }
}
