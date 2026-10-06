/**
 * 提问记录：把一次 `question` 调用与用户的答复排成一段独立内容。
 *
 * 它不并进工具聚合行——聚合行只报「用了几个什么工具」，而提问的价值恰恰在问了什么、选了什么，
 * 并进去之后事后就看不到了。排版按「问题 + 选项（选中的标出）+ 自行输入的答案」展开。
 */
import type { QuestionItem } from "@ucode/contracts";
import type { TFunction } from "i18next";
import { Check, MessageCircleQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatFooter } from "../lib/chat-nodes";
import type { ChatItem } from "../lib/types";
import { MessageFooter } from "./message-footer";

type QuestionFormProps = {
  questions: QuestionItem[];
  /** 与 `questions` 同序的答复；未答复时为空数组 */
  answers: string[][];
  /** 是否已有结果；区分「还在等」与「已结束但没答」 */
  settled: boolean;
  /** 本轮以此收尾时的页脚 */
  footer?: ChatFooter;
  /** 从该条消息分叉（仅主对话） */
  onFork?: (item: ChatItem) => void;
};

/** 单条选项：选中的用勾与正文色（并带上它的说明），未选中的淡一档，保留「当时还能选什么」的上下文 */
function Choice({
  label,
  description,
  chosen,
}: {
  label: string;
  description?: string;
  chosen: boolean;
}) {
  return (
    <li className="flex items-start gap-1.5">
      <span className="mt-px flex size-3.5 shrink-0 items-center justify-center">
        {chosen ? <Check className="size-3.5 text-success" /> : null}
      </span>
      <span className="min-w-0 space-y-0.5">
        <span
          className={
            chosen ? "block text-xs text-foreground" : "block text-xs text-muted-foreground/70"
          }
        >
          {label}
        </span>
        {chosen && description ? (
          <span className="block text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </li>
  );
}

/** 标题：还在等就报「提问中」；已结束却没答复（本轮被中断）不能继续装作在等 */
const headerOf = (settled: boolean, answered: boolean, t: TFunction): string => {
  if (!settled) return t("提问中");
  return answered ? t("已提问") : t("未回答");
};

export function QuestionForm({ questions, answers, settled, footer, onFork }: QuestionFormProps) {
  const { t } = useTranslation();
  const answered = answers.some((picked) => picked.some((value) => value.trim() !== ""));

  return (
    <>
      <div className="rounded-lg bg-muted/40 px-3 py-2.5 ring-1 ring-foreground/10">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MessageCircleQuestion aria-hidden className="size-3.5 shrink-0" />
          {headerOf(settled, answered, t)}
        </div>
        <div className="space-y-3">
          {questions.map((question, index) => {
            const picked = (answers[index] ?? []).filter((value) => value.trim() !== "");
            // 用户能自行输入答案，所以答案里可能有选项之外的文本，一并列出来
            const extra = picked.filter(
              (value) => !question.options.some((option) => option.label === value),
            );
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: 问题没有自然 id，顺序即身份
                key={`${index}:${question.header}`}
                className="space-y-1"
              >
                <div className="text-xs font-medium text-foreground">{question.header}</div>
                <p className="text-sm leading-relaxed text-foreground/90">{question.question}</p>
                <ul className="space-y-0.5">
                  {question.options.map((option) => (
                    <Choice
                      key={option.label}
                      label={option.label}
                      description={option.description}
                      chosen={picked.includes(option.label)}
                    />
                  ))}
                  {extra.map((value) => (
                    <Choice key={value} label={value} chosen />
                  ))}
                </ul>
                {settled && picked.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("（未回答）")}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {footer ? (
        <MessageFooter item={footer.item} durationMs={footer.durationMs} onFork={onFork} />
      ) : null}
    </>
  );
}
