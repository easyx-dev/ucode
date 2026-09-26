import type { AgentSdk, DisplayMessage } from "@ucode/sdk";
import { Box, Text, useInput } from "ink";
import { type ReactElement, useEffect, useMemo, useState } from "react";

/**
 * 交互弹窗：把协议 C 的阻塞式交互（confirm / select / input）渲染成终端里的一次问答。
 *
 * 可靠性要求与通知完全不同：**不能丢也不能重复应答**——丢一次权限确认会让 agent 永久挂起。
 * 因此这里只做"把用户的决定发回去"，不做超时判断（超时由核心层按降级策略处置）。
 */

export type InteractionPanelProps = {
  sdk: AgentSdk;
  sessions: { id: string; label: string }[];
};

export function InteractionPanel({ sdk, sessions }: InteractionPanelProps): ReactElement | null {
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
      const method = interaction.method;

      if (method === "confirm") {
        if (input === "y" || input === "Y") sdk.respondToInteraction(interaction.id, true);
        else if (input === "n" || input === "N" || key.escape)
          sdk.respondToInteraction(interaction.id, false);
        return;
      }

      if (method === "select") {
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

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">
        ⚠ {title}
        {sessionLabel === undefined ? "" : `（${sessionLabel}）`}
      </Text>
      {params.message !== undefined && params.message !== "" && (
        <Box marginTop={1}>
          <Text>{params.message}</Text>
        </Box>
      )}
      {interaction.method === "select" && (
        <Box flexDirection="column" marginTop={1}>
          {options.map((option, index) => (
            <Text key={option} color={index === selected ? "cyan" : undefined}>
              {index === selected ? "❯ " : "  "}
              {option}
            </Text>
          ))}
        </Box>
      )}
      {(interaction.method === "input" || interaction.method === "editor") && (
        <Box marginTop={1}>
          <Text color="cyan">❯ {draft}</Text>
          {draft === "" && params.placeholder !== undefined && (
            <Text dimColor> {params.placeholder}</Text>
          )}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {interaction.method === "confirm"
            ? "y 允许 / n 拒绝"
            : interaction.method === "select"
              ? "↑↓ 选择 / Enter 确认 / Esc 取消"
              : "Enter 提交 / Esc 取消"}
        </Text>
      </Box>
    </Box>
  );
}

/** 消息行：不同角色不同颜色；流式尾巴带标记，避免和"已保存"混淆。 */
export function MessageLine({ message }: { message: DisplayMessage }): ReactElement {
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
  return (
    <Box flexDirection="column">
      <Text color={color}>
        {prefix}
        {message.text}
      </Text>
      {message.streaming === true && <Text dimColor> (流式，尚未落盘)</Text>}
    </Box>
  );
}
