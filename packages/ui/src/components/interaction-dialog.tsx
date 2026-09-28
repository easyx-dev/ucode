import { type ReactNode, useEffect, useState } from "react";
import { useAgentStore } from "../context.ts";
import { Button, Modal } from "./primitives.tsx";

/** 弹窗一出现就把光标放进输入框：这是"必须回答才能继续"的场景，少一次点击。 */
function focusOnMount(node: HTMLTextAreaElement | null): void {
  node?.focus();
}

/**
 * 交互弹窗：工具批准 / 提问（服务层把请求广播过来，谁都能答）。
 *
 * 三种形态对应三种输入方式：`select` 选项列表、`confirm` 允许/拒绝、
 * `input`/`editor` 自由输入。**必须先回答再继续**——所以它是模态的，
 * 而不是角落里一条通知（实测里"弹了但没看见"就是这么来的）。
 */
export function InteractionDialog(): ReactNode {
  const interactions = useAgentStore((store) => store.state.interactions);
  const activeSessionId = useAgentStore((store) => store.state.activeSessionId);
  const respond = useAgentStore((store) => store.respond);
  const interaction =
    interactions.find((request) => request.sessionId === activeSessionId) ?? interactions[0];
  const [text, setText] = useState("");

  useEffect(() => {
    setText("");
  }, [interaction?.id]);

  if (interaction === undefined) return null;
  const params = interaction.params as {
    title?: string;
    message?: string;
    placeholder?: string;
    prefill?: string;
    options?: string[];
  };
  const method = interaction.method;

  return (
    <Modal title={params.title ?? "需要你的决定"}>
      {params.message !== undefined && params.message !== "" && (
        <p className="mb-3 whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-content-muted)]">
          {params.message}
        </p>
      )}

      {method === "select" && (
        <div className="flex flex-col gap-1">
          {(params.options ?? []).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => respond(interaction.id, option)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-left text-[13px] transition-colors hover:border-[var(--color-border-active)] hover:bg-[var(--color-surface-raised)]"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {(method === "input" || method === "editor") && (
        <textarea
          ref={focusOnMount}
          className="h-24 w-full resize-none rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-2.5 font-[var(--font-mono)] text-[12px] outline-none focus:border-[var(--color-border-active)]"
          placeholder={params.placeholder ?? ""}
          defaultValue={method === "editor" ? (params.prefill ?? "") : ""}
          onChange={(event) => setText(event.target.value)}
        />
      )}

      {method === "confirm" && (
        <div className="flex justify-end gap-2">
          <Button variant="danger" onClick={() => respond(interaction.id, false)}>
            拒绝
          </Button>
          <Button variant="primary" onClick={() => respond(interaction.id, true)}>
            允许
          </Button>
        </div>
      )}
      {method === "select" && (
        <div className="mt-3 flex justify-end">
          <Button onClick={() => respond(interaction.id, null, true)}>取消</Button>
        </div>
      )}
      {(method === "input" || method === "editor") && (
        <div className="mt-3 flex justify-end gap-2">
          <Button onClick={() => respond(interaction.id, null, true)}>取消</Button>
          <Button variant="primary" onClick={() => respond(interaction.id, text)}>
            提交
          </Button>
        </div>
      )}
    </Modal>
  );
}
