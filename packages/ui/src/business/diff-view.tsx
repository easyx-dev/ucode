/**
 * 消息流里的行内 diff 渲染（工具调用的改动）。
 *
 * git diff 已改由 `@git-diff-view/react` 渲染（见 `workbench/git-file-diff.tsx`），这里是另一类输入：
 * 工具参数里的「旧文本 / 新文本」在客户端比出的一小段改动，形态固定、不需要折起或并排。
 * 只认行级语义——新增 / 删除 / 上下文用语义 token 的 success / destructive / muted 上色，
 * 不叠语法高亮；行号可选，给了就出两列（旧 / 新），没给就退回 `+/-/空格` 的行首标记。
 */
import { cn } from "cn";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export type DiffRowType = "add" | "del" | "ctx";

export type DiffRow = {
  type: DiffRowType;
  text: string;
  /** 旧侧行号；无此信息时为 null */
  oldLine?: number | null;
  /** 新侧行号；无此信息时为 null */
  newLine?: number | null;
};

/** 单次展开最多渲染的行数；超出后折叠，避免大文件撑出上千个节点 */
const MAX_DIFF_LINES = 200;

const SIGN_BY_TYPE: Record<DiffRowType, string> = { add: "+", del: "-", ctx: " " };

const toneOf = (type: DiffRowType): string => {
  switch (type) {
    case "add":
      return "bg-success/10 text-success";
    case "del":
      return "bg-destructive/10 text-destructive";
    default:
      return "text-foreground-subtle";
  }
};

const gutter = "shrink-0 select-none text-right text-foreground-subtlest";

function DiffRowView({ row, showNumbers }: { row: DiffRow; showNumbers: boolean }) {
  return (
    <div className={cn("flex w-max min-w-full px-2 whitespace-pre", toneOf(row.type))}>
      {showNumbers ? (
        <>
          <span className={cn(gutter, "w-10 pr-2")}>{row.oldLine ?? ""}</span>
          <span className={cn(gutter, "w-10 pr-3")}>{row.newLine ?? ""}</span>
        </>
      ) : (
        <span className="w-3 shrink-0 select-none" aria-hidden>
          {SIGN_BY_TYPE[row.type]}
        </span>
      )}
      <span>{row.text || " "}</span>
    </div>
  );
}

export function DiffView({
  rows,
  /** 是否允许展开全部行；缺省按 `MAX_DIFF_LINES` 折叠 */
  expandable = true,
  className,
}: {
  rows: readonly DiffRow[];
  expandable?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  if (rows.length === 0) {
    return <p className="text-xs text-foreground-subtle">{t("（无内容）")}</p>;
  }

  const showNumbers = rows.some((row) => row.oldLine != null || row.newLine != null);
  const visible = expandable && !showAll ? rows.slice(0, MAX_DIFF_LINES) : rows;
  const hidden = rows.length - visible.length;

  return (
    <>
      <div
        className={cn(
          "w-max min-w-full overflow-x-auto rounded-md bg-muted/50 py-1 font-mono text-xs leading-relaxed",
          className,
        )}
      >
        {visible.map((row, position) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: diff 行无自然 id，位置 + 类型即身份
          <DiffRowView key={`${position}:${row.type}`} row={row} showNumbers={showNumbers} />
        ))}
      </div>
      {hidden > 0 ? (
        <button
          type="button"
          className="text-xs text-foreground-subtle hover:text-foreground hover:underline"
          onClick={() => setShowAll(true)}
        >
          {t("显示全部 {{value}} 行", { value: rows.length })}
        </button>
      ) : null}
    </>
  );
}
