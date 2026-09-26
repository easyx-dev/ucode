import type { AgentSdk, DisplayMessage } from "@ucode/sdk";
import { Box, Text, useInput } from "ink";
import { createElement as h, type ReactNode, useEffect, useMemo, useState } from "react";

/**
 * 交互弹窗与消息行。
 *
 * **这里是 `createElement` 而不是 JSX**：TUI 由 Node 直接执行（源码直出，靠原生类型剥离），
 * 而类型剥离**不支持 JSX**（那需要转译）。所以被 Node 直接跑的包一律只用 `.ts`；
 * 只有经打包器处理的 `apps/web` 才用 `.tsx`。
 */

export type InteractionPanelProps = {
  sdk: AgentSdk;
  sessions: { id: string; label: string }[];
};

export function InteractionPanel({ sdk, sessions }: InteractionPanelProps): ReactNode {
  const interaction = sdk.state.interactions[0];
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState(0);

  const options = useMemo(() => {
    if (interaction === undefined) return [] as string[];
    const params = interaction.params as { options?: string[] };
    return params.options ?? [];
  }, [interaction]);

  useEffect(() => {
    setDraft("");
    setSelected(0);
  }, [interaction?.id]);

  useInput(
    (input, key) => {
      if (interaction === undefined) return;

      if (interaction.method === "confirm") {
        if (input === "y" || input === "Y") sdk.respondToInteraction(interaction.id, true);
        else if (input === "n" || input === "N" || key.escape)
          sdk.respondToInteraction(interaction.id, false);
        return;
      }

      if (interaction.method === "select") {
        if (key.upArrow) setSelected((current) => Math.max(0, current - 1));
        else if (key.downArrow) setSelected((current) => Math.min(options.length - 1, current + 1));
        else if (key.return) sdk.respondToInteraction(interaction.id, options[selected] ?? null);
        else if (key.escape) sdk.respondToInteraction(interaction.id, null, { cancelled: true });
        return;
      }

      // input / editor：单行输入（终端里的多行编辑体验有限，先在单行上可用）
      if (key.return) {
        sdk.respondToInteraction(interaction.id, draft);
        return;
      }
      if (key.escape) {
        sdk.respondToInteraction(interaction.id, null, { cancelled: true });
        return;
      }
      if (key.backspace || key.delete) {
        setDraft((current) => current.slice(0, -1));
        return;
      }
      if (input !== "" && !key.ctrl && !key.meta) setDraft((current) => current + input);
    },
    { isActive: interaction !== undefined },
  );

  if (interaction === undefined) return null;

  const params = interaction.params as { title?: string; message?: string; placeholder?: string };
  const sessionLabel = sessions.find((session) => session.id === interaction.sessionId)?.label;
  const title = params.title ?? "需要你的决定";

  const hint =
    interaction.method === "confirm"
      ? "y 允许 / n 拒绝"
      : interaction.method === "select"
        ? "↑↓ 选择 / Enter 确认 / Esc 取消"
        : "Enter 提交 / Esc 取消";

  return h(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: "yellow", paddingX: 1 },
    h(
      Text,
      { color: "yellow" },
      `⚠ ${title}${sessionLabel === undefined ? "" : `（${sessionLabel}）`}`,
    ),
    params.message !== undefined && params.message !== ""
      ? h(Box, { marginTop: 1 }, h(Text, null, params.message))
      : null,
    interaction.method === "select"
      ? h(
          Box,
          { flexDirection: "column", marginTop: 1 },
          options.map((option, index) =>
            h(
              Text,
              { key: option, color: index === selected ? "cyan" : undefined },
              `${index === selected ? "❯ " : "  "}${option}`,
            ),
          ),
        )
      : null,
    interaction.method === "input" || interaction.method === "editor"
      ? h(
          Box,
          { marginTop: 1 },
          h(Text, { color: "cyan" }, `❯ ${draft}`),
          draft === "" && params.placeholder !== undefined
            ? h(Text, { dimColor: true }, ` ${params.placeholder}`)
            : null,
        )
      : null,
    h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, hint)),
  );
}

/** 消息行：不同角色不同颜色；流式尾巴带标记，避免和"已保存"混淆。 */
export function MessageLine({ message }: { message: DisplayMessage }): ReactNode {
  const color =
    message.role === "user"
      ? "green"
      : message.role === "tool"
        ? "magenta"
        : message.role === "notice"
          ? "gray"
          : "white";
  const prefix =
    message.role === "user"
      ? "❯ "
      : message.role === "tool"
        ? "⚙ "
        : message.role === "notice"
          ? "· "
          : "  ";
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { color }, `${prefix}${message.text}`),
    message.streaming === true ? h(Text, { dimColor: true }, " (流式，尚未落盘)") : null,
  );
}
