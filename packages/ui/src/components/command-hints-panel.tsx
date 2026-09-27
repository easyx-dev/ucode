import type { ReactNode } from "react";
import {
  COMMAND_PANEL_HINT,
  COMMAND_PANEL_TITLE,
  matchCommands,
  type SlashCommand,
  usageOf,
} from "./command-hints.ts";

/**
 * 输入 `/` 时浮出的命令面板（对齐 zcode 的 `MentionPanel` / `SlashCommandPlugin`）。
 *
 * 交互也照抄 zcode 那一套：↑↓ 移动、Enter / Tab 选中、Esc 关闭、点击选中。
 * 这些是用户已经形成的肌肉记忆，换一套只会让人按错。
 */
export function CommandHints({
  input,
  selected,
  onSelect,
  onHover,
  onDismiss,
}: {
  input: string;
  selected: number;
  onSelect: (command: SlashCommand) => void;
  onHover: (index: number) => void;
  onDismiss: () => void;
}): ReactNode {
  const matches = matchCommands(input);
  if (matches.length === 0) return null;

  return (
    <div
      className="mb-1.5 overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] shadow-lg"
      role="listbox"
      aria-label={COMMAND_PANEL_TITLE}
    >
      <div className="flex items-baseline gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5">
        <span className="text-[11px] font-semibold text-[var(--color-content)]">
          {COMMAND_PANEL_TITLE}
        </span>
        <span className="text-[10px] text-[var(--color-content-muted)]">{COMMAND_PANEL_HINT}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto text-[10px] text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
        >
          Esc 关闭
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto py-1">
        {matches.map((command, index) => (
          <li key={command.name}>
            <button
              type="button"
              role="option"
              aria-selected={index === selected}
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(command)}
              className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left ${
                index === selected
                  ? "bg-[var(--color-accent-soft)]"
                  : "hover:bg-[var(--color-surface-raised)]"
              }`}
            >
              <span className="shrink-0 font-[var(--font-mono)] text-xs text-[var(--color-accent)]">
                {usageOf(command)}
              </span>
              <span className="truncate text-[11px] text-[var(--color-content-muted)]">
                {command.description}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="border-t border-[var(--color-border-subtle)] px-3 py-1.5 text-[10px] text-[var(--color-content-muted)]">
        技能与子智能体在「插件」面板里查看与安装。
      </p>
    </div>
  );
}
