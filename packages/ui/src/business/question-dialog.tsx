/** 提问弹窗：question 工具触发时，用户选择选项或自填答案后本轮继续 */

import { cn } from "cn";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../base/dialog";
import { Input } from "../base/input";
import type { QuestionInteraction } from "../lib/types";

type QuestionDialogProps = {
  /** 当前待答提问；为空或不是提问时不展示 */
  request: QuestionInteraction | null;
  onRespond: (requestId: string, answers: string[][]) => void;
};

/** 单个问题的作答草稿；自填内容优先于勾选的选项 */
type Draft = { selected: string[]; custom: string };

export function QuestionDialog({ request, onRespond }: QuestionDialogProps) {
  return (
    <Dialog open={Boolean(request)}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        {request ? (
          <QuestionForm
            // requestId 变化即换一份草稿，避免上一题的作答串到下一题
            key={request.requestId}
            request={request}
            onSubmit={(answers) => onRespond(request.requestId, answers)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function QuestionForm({
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
  const isComplete = answers.every((answer) => answer.length > 0);

  const submit = (): void => {
    if (isComplete) onSubmit(answers);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("需要你回答")}</DialogTitle>
        <DialogDescription>
          {request.sourceSessionId ? (
            <span className="mb-1 block text-xs text-muted-foreground">
              {t("来自子智能体「{{description}}」的请求：", {
                description: request.sourceDescription ?? request.sourceSessionId,
              })}
            </span>
          ) : null}
          {t("agent 需要你的输入才能继续；选择一个选项，或自行填写答案。")}
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-1 max-h-[55vh] space-y-4 overflow-y-auto px-1">
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
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  submit();
                }}
                placeholder={t("也可以直接输入你的答案")}
              />
            </div>
          );
        })}
      </div>

      <DialogFooter className="sm:justify-between">
        <Button variant="ghost" onClick={() => onSubmit(request.questions.map(() => []))}>
          {t("跳过回答")}
        </Button>
        <Button disabled={!isComplete} onClick={submit}>
          {t("提交回答")}
        </Button>
      </DialogFooter>
    </>
  );
}
