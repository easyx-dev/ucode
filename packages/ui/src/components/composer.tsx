import type { AutonomyLevel } from "@ucode/sdk";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAgentStore } from "../context.ts";
import {
  commandUsage,
  matchCommands,
  parseSlashCommand,
  SLASH_COMMANDS,
  usageOf,
} from "./command-hints.ts";
import { CommandHints } from "./command-hints-panel.tsx";
import { ArrowUpIcon, StopIcon } from "./icons.tsx";
import { formatTokenCount } from "./insights-format.ts";
import { IconButton, Menu, type MenuItem } from "./primitives.tsx";

/**
 * 输入区（ZCode 的底部那一块）。
 *
 * 两个反直觉但重要的取舍：
 * - **模型与执行模式放在这里，不放在顶栏**：它们改的是"接下来这句话怎么跑"，
 *   手在键盘上时不该去右上角找；
 * - **占位文字随状态变**（新任务 / 追问 / 排队 / 没模型），一句固定的提示等于没提示。
 */

export type ComposerPanel = "tasks" | "plugins" | "usage" | "model";

/** 执行模式的说明：选哪个不只是改个词，界面得说清"放了什么权"。 */
export const AUTONOMY_ITEMS: readonly (MenuItem & { value: AutonomyLevel })[] = [
  {
    value: "confirm",
    label: "变更前确认",
    description: "改动类工具先问你一次（默认）",
  },
  { value: "plan", label: "计划模式", description: "只读：改动类工具对模型不可见" },
  { value: "auto-edit", label: "自动编辑", description: "文件改动直接落盘，命令仍需批准" },
  { value: "full-access", label: "完全访问", description: "全部放行，确认最少（谨慎）" },
];

export function autonomyLabel(level: string | undefined | null): string {
  return AUTONOMY_ITEMS.find((item) => item.value === level)?.label ?? "变更前确认";
}

export function Composer({
  sessionId,
  onOpenPanel,
  productName,
}: {
  sessionId: string;
  onOpenPanel: (panel: ComposerPanel) => void;
  productName: string;
}): ReactNode {
  const draft = useAgentStore((store) => store.drafts[sessionId] ?? "");
  const setDraft = useAgentStore((store) => store.setDraft);
  const send = useAgentStore((store) => store.send);
  const models = useAgentStore((store) => store.state.models);
  const view = useAgentStore((store) => store.state.views[sessionId]);
  const pendingInteractions = useAgentStore(
    (store) => store.state.interactions.filter((item) => item.sessionId === sessionId).length,
  );
  const createSession = useAgentStore((store) => store.createSession);
  const compact = useAgentStore((store) => store.compact);
  const setAutonomy = useAgentStore((store) => store.setAutonomy);
  const setModel = useAgentStore((store) => store.setModel);
  const abort = useAgentStore((store) => store.abort);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const [hintsDismissed, setHintsDismissed] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);

  const running = view?.running === true;
  const readOnly = view?.readOnly === true;
  const modelAvailable = view?.state?.modelAvailable !== false;
  const usage = view?.usage as { totalTokens?: number; cost?: { total?: number } } | undefined;
  const queued = view?.state?.pendingMessages ?? 0;
  const blocked = readOnly || pendingInteractions > 0;
  const hints = hintsDismissed ? [] : matchCommands(draft);
  const hasHistory = (view?.entries.length ?? 0) > 0;

  const runCommand = async (name: string, args: string[]): Promise<void> => {
    switch (name) {
      case "/help":
        setLocalNotice(
          SLASH_COMMANDS.map((command) => `${usageOf(command)} — ${command.description}`).join(
            "\n",
          ),
        );
        return;
      case "/new":
        await createSession(args[0]);
        return;
      case "/compact":
        await compact(sessionId);
        return;
      case "/model":
        onOpenPanel("model");
        return;
      case "/tasks":
        onOpenPanel("tasks");
        return;
      case "/plugins":
        onOpenPanel("plugins");
        return;
      case "/usage":
        onOpenPanel("usage");
        return;
      case "/autonomy": {
        const level = args[0];
        if (level === undefined) {
          setLocalNotice(`用法：${commandUsage("/autonomy") ?? ""}`);
          return;
        }
        await setAutonomy(sessionId, level as AutonomyLevel);
        return;
      }
      default: {
        const usageText = commandUsage(name);
        setLocalNotice(
          usageText === null ? `未知命令 ${name}。输入 / 查看可用命令。` : `用法：${usageText}`,
        );
      }
    }
  };

  const submit = (): void => {
    const command = parseSlashCommand(draft);
    if (command !== null) {
      // 命令由壳自己执行，不进对话——否则模型会收到一条它看不懂的 `/compact`。
      setDraft(sessionId, "");
      setLocalNotice(null);
      void runCommand(command.name, command.args);
      return;
    }
    void send(sessionId);
  };

  const completeCommand = (selected: number): void => {
    const target = hints[selected];
    if (target === undefined) return;
    setDraft(sessionId, `${target.name} `);
    setHintsDismissed(false);
    textarea.current?.focus();
  };

  const autoGrow = (): void => {
    const node = textarea.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
  };
  useEffect(autoGrow, [draft]);

  const placeholder =
    pendingInteractions > 0
      ? "先处理上面的请求…"
      : !modelAvailable
        ? "还没有可用模型：点左下角「模型」配置一个供应商"
        : running
          ? "继续输入以排队后续修改"
          : hasHistory
            ? "提出后续修改要求"
            : `向 ${productName} 提问，输入 / 选择命令或能力`;

  const modelItems: MenuItem[] = [
    { value: "", label: "（默认模型）" },
    ...models.map((model) => ({
      value: `${model.provider}/${model.modelId}`,
      label: model.modelId,
      description: model.provider,
    })),
    { value: "__manage__", label: "管理模型…", description: "供应商、端点与密钥" },
  ];
  const currentModel = view?.state?.model ?? null;

  return (
    <div className="shrink-0 px-6 pb-3">
      <div className="mx-auto w-full max-w-3xl">
        {readOnly && (
          <p className="mb-2 rounded-md bg-[var(--color-warn-soft)] px-2.5 py-1.5 text-[11px] text-[var(--color-warn)]">
            该会话当前只读：写权限在另一个服务端实例手上。用 /new 开一个新会话。
          </p>
        )}
        {!modelAvailable && !readOnly && (
          <p className="mb-2 flex items-center gap-2 rounded-md bg-[var(--color-warn-soft)] px-2.5 py-1.5 text-[11px] text-[var(--color-warn)]">
            还没有可用的模型，发送会被拒绝。
            <button
              type="button"
              className="underline"
              onClick={() => onOpenPanel("model")}
              title="配置供应商：端点 / 密钥 / 模型 ID"
            >
              立即配置
            </button>
          </p>
        )}
        {localNotice !== null && (
          <div className="mb-2 flex items-start gap-2 rounded-md bg-[var(--color-surface-raised)] px-2.5 py-1.5">
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-[var(--font-mono)] text-[11px] leading-4">
              {localNotice}
            </pre>
            <button
              type="button"
              className="shrink-0 text-[10px] text-[var(--color-content-faint)] hover:text-[var(--color-content)]"
              onClick={() => setLocalNotice(null)}
            >
              关闭
            </button>
          </div>
        )}
        <CommandHints
          input={draft}
          selected={hintIndex}
          onHover={setHintIndex}
          onDismiss={() => setHintsDismissed(true)}
          onSelect={(command) => {
            const index = hints.findIndex((candidate) => candidate.name === command.name);
            completeCommand(index < 0 ? 0 : index);
          }}
        />

        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] transition-colors focus-within:border-[var(--color-border-active)]">
          <textarea
            ref={textarea}
            value={draft}
            disabled={blocked}
            rows={2}
            placeholder={placeholder}
            className="block w-full resize-none bg-transparent px-3.5 pt-2.5 text-[13px] leading-6 outline-none placeholder:text-[var(--color-content-faint)] disabled:cursor-not-allowed"
            onChange={(event) => {
              setDraft(sessionId, event.target.value);
              setHintIndex(0);
              setHintsDismissed(false);
              setLocalNotice(null);
              autoGrow();
            }}
            onKeyDown={(event) => {
              if (hints.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHintIndex((current) => (current + 1) % hints.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHintIndex((current) => (current - 1 + hints.length) % hints.length);
                  return;
                }
                // Enter / Tab 先把命令名补全，再交回输入框让用户填参数。
                if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
                  event.preventDefault();
                  completeCommand(hintIndex);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setHintsDismissed(true);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />

          <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
            <Menu
              label={autonomyLabel(view?.state?.autonomy)}
              title="执行模式：这一轮里工具怎么放行"
              direction="up"
              items={AUTONOMY_ITEMS}
              onSelect={(value) => void setAutonomy(sessionId, value as AutonomyLevel)}
            />
            <Menu
              className="min-w-0"
              label={
                <span className="max-w-44 truncate font-[var(--font-mono)]">
                  {currentModel === null
                    ? "默认模型"
                    : `${currentModel.provider}/${currentModel.modelId}`}
                </span>
              }
              title="选择本会话使用的模型"
              direction="up"
              width="w-80"
              items={modelItems.map((item) => ({
                ...item,
                checked:
                  item.value ===
                  (currentModel === null ? "" : `${currentModel.provider}/${currentModel.modelId}`),
              }))}
              onSelect={(value) => {
                if (value === "__manage__") {
                  onOpenPanel("model");
                  return;
                }
                const [provider, modelId] = value.split("/");
                if (provider === undefined || modelId === undefined) return;
                void setModel(sessionId, provider, modelId);
              }}
            />

            <div className="ml-auto flex items-center gap-2 pr-1 text-[11px] text-[var(--color-content-faint)]">
              {usage?.totalTokens !== undefined && (
                <span>{formatTokenCount(usage.totalTokens)} tokens</span>
              )}
              {queued > 0 && <span className="text-[var(--color-warn)]">排队 {queued}</span>}
              <span className="hidden lg:inline">Enter 发送 · Shift+Enter 换行</span>
            </div>

            {running && (
              <IconButton
                className="size-7"
                icon={<StopIcon className="size-3.5" />}
                label="中止本轮"
                onClick={() => void abort(sessionId)}
              />
            )}
            <button
              type="button"
              disabled={draft.trim() === "" || blocked}
              title={running ? "排队：本轮结束后发送" : "发送（Enter）"}
              onClick={submit}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-foreground)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:bg-[var(--color-surface-overlay)] disabled:text-[var(--color-content-faint)]"
            >
              <ArrowUpIcon className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
