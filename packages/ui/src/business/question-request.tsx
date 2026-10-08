/** 提问：question 工具触发时，用户选择选项或自填答案后本轮继续 */
import { cn } from "cn";
import { MessageCircleQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import { Input } from "../base/input";
import type { QuestionInteraction } from "../lib/types";

type QuestionRequestProps = {
  request: QuestionInteraction;
  onRespond: (requestId: string, answers: string[][]) => void;
};

/** 单个问题的作答草稿；自填内容优先于勾选的选项 */
type Draft = { selected: string[]; custom: string };

export function QuestionRequest({ request, onRespond }: QuestionRequestProps) {
  return (
    <QuestionPrompt
      // requestId 变化即换一份草稿与展开态，避免上一题的作答串到下一题
      key={request.requestId}
      request={request}
      onSubmit={(answers) => onRespond(request.requestId, answers)}
    />
  );
}

function QuestionPrompt({
  request,
  onSubmit,
}: {
  request: QuestionInteraction;
  onSubmit: (answers: string[][]) => void;
}) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    request.questions.map(() => ({ selected: [], custom: "" })),
  );
  /** 收起只留一行摘要：多题时内容很长，用户常想先回看对话再作答 */
  const [collapsed, setCollapsed] = useState(false);

  // Esc 收起：焦点可能在任何子控件上，监听挂在 document 才不至于漏掉
  useEffect(() => {
    if (collapsed) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setCollapsed(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [collapsed]);

  const toggle = (index: number, label: string): void => {
    const isMultiple = request.questions[index]?.multiple ?? false;
    setDrafts((prev) =>
      prev.map((draft, i) => {
        if (i !== index) return draft;
        if (isMultiple) {
          return {
            ...draft,
            selected: draft.selected.includes(label)
              ? draft.selected.filter((item) => item !== label)
              : [...draft.selected, label],
          };
        }
        return { ...draft, selected: draft.selected.includes(label) ? [] : [label] };
      }),
    );
  };

  const setCustom = (index: number, value: string): void => {
    setDrafts((prev) =>
      prev.map((draft, i) => (i === index ? { ...draft, custom: value } : draft)),
    );
  };

  const answerOf = (draft: Draft): string[] => {
    const custom = draft.custom.trim();
    return custom ? [custom] : [...draft.selected];
  };

  const answers = drafts.map(answerOf);
  const answered = answers.filter((answer) => answer.length > 0).length;
  const unansweredHeaders = request.questions
    .filter((_, index) => (answers[index]?.length ?? 0) === 0)
    .map((item) => item.header);
  const total = request.questions.length;

  if (collapsed) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <MessageCircleQuestion aria-hidden className="size-3.5 shrink-0 text-warning" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {t("已答 {{answered}} / {{total}} 题", { answered, total })}
          {unansweredHeaders.length > 0 ? (
            <>
              {" · "}
              {t("待答：{{headers}}", { headers: unansweredHeaders.join("、") })}
            </>
          ) : null}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setCollapsed(false)}>
          {t("展开")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-3 pt-2.5 pb-3">
      <p className="text-xs text-muted-foreground">
        {request.sourceSessionId ? (
          <span className="block">
            {t("来自子智能体「{{description}}」的请求：", {
              description: request.sourceDescription ?? request.sourceSessionId,
            })}
          </span>
        ) : null}
        {t("agent 需要你的输入才能继续；选择一个选项，或自行填写答案。")}
      </p>

      <div className="max-h-[40vh] space-y-4 overflow-y-auto pr-1">
        {request.questions.map((item, index) => {
          const draft = drafts[index] ?? { selected: [], custom: "" };
          return (
            <div key={`${item.header}:${item.question}`} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {item.header}
                </span>
                {item.multiple ? (
                  <span className="text-xs text-muted-foreground">{t("可多选")}</span>
                ) : null}
              </div>
              <p className="text-sm">{item.question}</p>
              <fieldset className="m-0 min-w-0 space-y-1.5 border-0 p-0" aria-label={item.question}>
                {item.options.map((option) => {
                  const selected = draft.selected.includes(option.label);
                  return (
                    <button
                      key={`${option.label}:${option.description}`}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggle(index, option.label)}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50",
                      )}
                    >
                      <span className="text-sm font-medium">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </fieldset>
              <Input
                value={draft.custom}
                aria-label={t("也可以直接输入你的答案")}
                onChange={(event) => setCustom(index, event.target.value)}
                onKeyDown={(event) => {
                  // 只在自填框中允许 Enter 提交：选项按钮上的 Enter 属于选择，不该顺带提交
                  if (event.key !== "Enter" || unansweredHeaders.length > 0) return;
                  event.preventDefault();
                  onSubmit(answers);
                }}
                placeholder={t("也可以直接输入你的答案")}
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={() => setCollapsed(true)}>
          {t("收起")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onSubmit(request.questions.map(() => []))}>
          {t("跳过回答")}
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          disabled={unansweredHeaders.length > 0}
          onClick={() => onSubmit(answers)}
        >
          {t("提交回答")}
        </Button>
      </div>
    </div>
  );
}
