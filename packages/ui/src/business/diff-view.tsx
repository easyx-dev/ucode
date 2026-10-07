/**
 * diff 行渲染：工具调用里的改动与工作台的 git 面板共用。
 *
 * 只认「行级语义」——新增 / 删除 / 上下文用设计 token 的 success / destructive / muted 上色，
 * 不叠语法高亮（两套着色叠在一起只会更难读）。
 * 行号是可选信息：给了就多出两列（旧 / 新），没给就退回 `+/-/空格` 的行首标记。
 */
import { cn } from "cn";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** 单次展开最多渲染的行数；超出后折叠，避免大文件撑出上千个节点 */
const MAX_DIFF_LINES = 200;

const SIGN_BY_TYPE: Record<DiffRowType, string> = { add: "+", del: "-", ctx: " " };

export type DiffRowType = "add" | "del" | "ctx";

export type DiffRow = {
  type: DiffRowType;
  text: string;
  /** 旧侧行号；无此信息时为 null */
  oldLine?: number | null;
  /** 新侧行号；无此信息时为 null */
  newLine?: number | null;
};

export function DiffView({
  rows,
  /** 是否允许展开全部行；缺省按 `MAX_DIFF_LINES` 折叠 */
  expandable = true,
  /** 滚动容器上的补充样式；默认只在横向上滚动，纵向交给外层 */
  className,
}: {
  rows: readonly DiffRow[];
  expandable?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("（无内容）")}</p>;
  }

  const showNumbers = rows.some((row) => row.oldLine != null || row.newLine != null);
  const visible = expandable && !showAll ? rows.slice(0, MAX_DIFF_LINES) : rows;
  const hidden = rows.length - visible.length;
  // diff 行无自然 id：位置 + 类型组合即身份；先生成 key 再渲染，避免直接用数组下标作 key
  const keyed = visible.map((row, position) => ({ key: `${position}:${row.type}`, row }));

  return (
    <>
      <div
        className={cn(
          "overflow-x-auto rounded-md bg-muted/50 py-1 font-mono text-xs leading-relaxed",
          className,
        )}
      >
        {keyed.map(({ key, row }) => (
          <div
            key={key}
            className={cn(
              "flex px-2 whitespace-pre",
              row.type === "add" && "bg-success/10 text-success",
              row.type === "del" && "bg-destructive/10 text-destructive",
              row.type === "ctx" && "text-muted-foreground",
            )}
          >
            {showNumbers ? (
              <>
                <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground/60">
                  {row.oldLine ?? ""}
                </span>
                <span className="w-10 shrink-0 select-none pr-3 text-right text-muted-foreground/60">
                  {row.newLine ?? ""}
                </span>
              </>
            ) : (
              <span className="w-3 shrink-0 select-none" aria-hidden>
                {SIGN_BY_TYPE[row.type]}
              </span>
            )}
            <span className="min-w-0 flex-1">{row.text || " "}</span>
          </div>
        ))}
      </div>
      {hidden > 0 ? (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => setShowAll(true)}
        >
          {t("显示全部 {{value}} 行", { value: rows.length })}
        </button>
      ) : null}
    </>
  );
}
