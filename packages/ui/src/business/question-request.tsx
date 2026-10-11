/**
 * 提问：question 工具触发时，用户逐步作答后本轮继续。
 *
 * 一次只显示一题（多题时一步一步走）：头部是「进度 + 步点 + 折叠」，正文是题面、作答提示与
 * 选项卡片（含「输入自己的答案」那张），底部左「忽略」右「返回 / 下一步 / 提交」。
 * 折叠只收起选项卡片，题面与底栏留着——收起是为了腾出地方看对话，不是退出作答。
 *
 * 选项里带「（推荐）」的由模型标注（见 question 工具的提示词），标签原样显示，不额外发明推荐语义。
 * 单题内「选项」与「自填」互斥：点了选项就清掉自填，开始打字就清掉已选项，答什么一眼能看清。
 */
import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import type { QuestionInteraction } from "../lib/types";

type QuestionRequestProps = {
  request: QuestionInteraction;
  onRespond: (requestId: string, answers: string[][]) => void;
};

/** 单个问题的作答草稿；自填内容优先于勾选的选项 */
type Draft = { selected: string[]; custom: string };

const emptyDraft = (): Draft => ({ selected: [], custom: "" });

export function QuestionRequest({ request, onRespond }: QuestionRequestProps) {
  return (
    <QuestionPrompt
      // requestId 变化即换一份草稿与步进位置，避免上一题的作答串到下一题
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
  const [drafts, setDrafts] = useState<Draft[]>(() => request.questions.map(emptyDraft));
  const [step, setStep] = useState(0);
  /** 收起只留头部一行：多题时用户常想先回看对话再作答 */
  const [collapsed, setCollapsed] = useState(false);

  const total = request.questions.length;
  const answers = drafts.map((draft) => {
    const custom = draft.custom.trim();
    return custom ? [custom] : [...draft.selected];
  });
  const item = request.questions[step];
  const draft = drafts[step] ?? emptyDraft();
  const isLast = step >= total - 1;
  const answered = (answers[step]?.length ?? 0) > 0;

  const customRef = useRef<HTMLInputElement>(null);

  /** 主按钮：还没到最后一题就往前走，最后一题提交全部作答。不校验是否作答——留空的那题按跳过算 */
  const advance = (): void => {
    if (isLast) onSubmit(answers);
    else setStep((prev) => Math.min(prev + 1, total - 1));
  };

  // Esc 折叠、⌘/Ctrl+Enter 走主按钮：焦点可能在任何子控件上，监听挂在 document 才不至于漏掉。
  // 监听只注册一次，动作走 ref 现取——草稿每次都重建，绑成依赖等于每渲染重注册一遍。
  const advanceRef = useRef<() => void>(() => {});
  advanceRef.current = advance;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCollapsed((prev) => !prev);
        return;
      }
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      advanceRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggle = (label: string): void => {
    const isMultiple = item?.multiple ?? false;
    setDrafts((prev) =>
      prev.map((current, index) => {
        if (index !== step) return current;
        // 单选点了第二次就取消，方便「改主意」；多选按累积
        const selected = current.selected.includes(label)
          ? current.selected.filter((value) => value !== label)
          : isMultiple
            ? [...current.selected, label]
            : [label];
        return { selected, custom: "" };
      }),
    );
  };

  const setCustom = (value: string): void => {
    setDrafts((prev) =>
      prev.map((current, index) => (index === step ? { selected: [], custom: value } : current)),
    );
  };

  const source = request.sourceSessionId
    ? t("来自子智能体「{{description}}」", {
        description: request.sourceDescription ?? request.sourceSessionId,
      })
    : null;

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {total > 0 ? (
          <span className="text-xs font-medium">
            {t("{{current}}/{{total}} 个问题", { current: step + 1, total })}
          </span>
        ) : null}
        {/* 步点兼作跳题入口：点哪一段就跳到哪一题 */}
        <span className="ml-auto flex items-center gap-0.5">
          {request.questions.map((question, index) => (
            <button
              key={`${question.header}:${question.question}`}
              type="button"
              aria-label={t("跳到第 {{index}} 题", { index: index + 1 })}
              aria-current={index === step}
              title={question.header}
              onClick={() => setStep(index)}
              className="rounded-full px-0.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span
                className={cn(
                  "block h-1 w-4 rounded-full",
                  (answers[index]?.length ?? 0) > 0
                    ? "bg-info"
                    : index === step
                      ? "bg-foreground"
                      : "bg-foreground-subtle/20",
                )}
              />
            </button>
          ))}
        </span>
        <button
          type="button"
          className="rounded-md p-0.5 text-foreground-subtle outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          title={collapsed ? t("展开") : t("收起")}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          <ChevronDown
            className={cn("size-icon-base transition-transform", collapsed && "rotate-180")}
          />
        </button>
      </div>

      {!item ? null : (
        <>
          <div className="space-y-2 px-3 pt-3">
            {source ? <p className="text-xs text-foreground-subtle">{source}</p> : null}
            <p className="text-sm font-medium">{item.question}</p>
            {collapsed ? null : (
              <p className="text-xs text-foreground-subtle">
                {item.multiple ? t("选择多个答案") : t("选择一个答案")}
              </p>
            )}
          </div>

          {collapsed ? null : (
            <fieldset
              className="m-0 min-w-0 space-y-1.5 border-0 px-3 py-2.5"
              aria-label={item.question}
            >
              {item.options.map((option) => {
                const selected =
                  draft.custom.trim().length === 0 && draft.selected.includes(option.label);
                return (
                  <button
                    key={`${option.label}:${option.description}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(option.label)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-state-hover",
                    )}
                  >
                    <Mark selected={selected} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-foreground-subtle">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}

              {/* 自填那张也是卡片：与选项互斥，点圆圈或直接打字都算选中它 */}
              <div
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  draft.custom.trim().length > 0 ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <button
                  type="button"
                  aria-label={t("输入自己的答案")}
                  aria-pressed={draft.custom.trim().length > 0}
                  onClick={() => {
                    if (draft.custom.trim().length > 0) setCustom("");
                    else customRef.current?.focus();
                  }}
                  className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Mark selected={draft.custom.trim().length > 0} />
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t("输入自己的答案")}</span>
                  <input
                    ref={customRef}
                    value={draft.custom}
                    onChange={(event) => setCustom(event.target.value)}
                    placeholder={t("输入你的答案…")}
                    className="mt-0.5 w-full bg-transparent text-xs outline-none placeholder:text-foreground-subtle"
                  />
                </span>
              </div>
            </fieldset>
          )}
        </>
      )}

      {/* 底栏跟题目无关地常驻：题目为空或选项多到要滚动时，它都是唯一的出口 */}
      <div className="sticky bottom-0 mt-auto flex items-center gap-2 border-t border-border bg-popover px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          title={t("放弃这组问题，本轮按没有答复继续")}
          onClick={() => onSubmit(request.questions.map(() => []))}
        >
          {t("忽略")}
        </Button>
        {step > 0 ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            title={t("回到上一个问题")}
            onClick={() => setStep((prev) => Math.max(prev - 1, 0))}
          >
            {t("返回")}
          </Button>
        ) : null}
        <Button
          size="sm"
          className={step > 0 ? undefined : "ml-auto"}
          title={isLast ? t("提交全部作答") : t("看下一个问题")}
          onClick={advance}
        >
          {isLast ? t("提交") : t("下一步")}
          <span className="ml-1 text-xs opacity-70">⌘⏎</span>
        </Button>
      </div>
    </>
  );
}

/** 选项前的圆点：选中时是实心点 + 主色圆环 */
function Mark({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-icon-base shrink-0 items-center justify-center rounded-full border transition-colors",
        selected ? "border-primary" : "border-foreground-subtle/40",
      )}
    >
      {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
    </span>
  );
}
