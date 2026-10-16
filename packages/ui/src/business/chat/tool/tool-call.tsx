/**
 * 单次工具调用的展示：标题 + 入参摘要压在一行（32px 高），展开后才出输出 / diff。
 * 不自带底色与外框，直接铺在页面底色上，靠 hover 高亮说明可点。
 */
import { cn } from "cn";
import type { TFunction } from "i18next";
import {
  AppWindow,
  Bot,
  CheckCircle2,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderTree,
  Globe,
  type LucideIcon,
  Pencil,
  Search,
  Terminal,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../base/collapsible";
import { Spinner } from "../../../base/spinner";
import { useWorkbench } from "../../../provider/workbench";
import { resolveFromCwd } from "../../../utils/path";
import { AttachmentImage } from "../../attachment/attachment-image";
import { type DiffRow, type DiffRowType, DiffView } from "../../markdown/diff-view";
import type { ToolEntry } from "../message/chat-nodes";
import { type ToolInput, type ToolKind, toolDiff, toolInputOf, toolKindOf } from "./tool-view";

const KIND_ICON: Record<ToolKind, LucideIcon> = {
  read: FileText,
  write: FilePlus2,
  edit: Pencil,
  command: Terminal,
  search: Search,
  list: FolderTree,
  network: Globe,
  agent: Bot,
  browser: AppWindow,
  other: Wrench,
};

/** 工具名的中文标题；上下文分组与聚合摘要也要用，故对外导出 */
export const toolTitleOf = (name: string, t: TFunction): string => {
  switch (name) {
    case "read":
      return t("读取");
    case "write":
      return t("写入");
    case "edit":
      return t("编辑");
    case "bash":
      return t("Shell");
    case "powershell":
      return t("PowerShell");
    case "grep":
      return t("搜索");
    case "find":
      return t("查找");
    case "ls":
      return t("列出");
    case "webfetch":
      return t("获取网页");
    case "websearch":
      return t("联网搜索");
    case "subagent":
      return t("子智能体");
    case "question":
      return t("提问");
    case "tool_search":
      return t("搜索工具");
    case "remember":
    case "forget":
      return t("记忆");
    case "browser_open":
      return t("打开页面");
    case "browser_snapshot":
      return t("页面快照");
    case "browser_act":
      return t("页面操作");
    case "browser_screenshot":
      return t("截图");
    case "browser_close":
      return t("关闭浏览器");
    default:
      // 没登记的（MCP 工具等）直接显示工具名：总比一律「工具」让人看不出调了什么
      return name;
  }
};

/**
 * 入参里的路径：工作台可用时做成按钮，点开右侧预览（路径相对会话工作目录解析）。
 * 合成在一个完整路径上，因为它只是展示元素，不参与布局。
 */
function PathLabel({ path, range }: { path: string; range?: string }) {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  const text = (
    <span className="truncate font-mono text-xs text-foreground-subtlest" title={path}>
      {path}
    </span>
  );
  return (
    <>
      {workbench ? (
        <button
          type="button"
          className="truncate rounded-sm text-left font-mono text-xs text-foreground-subtlest hover:text-foreground hover:underline"
          title={t("预览 {{path}}", { path })}
          onClick={(event) => {
            // 工具行本身可展开，路径点击不应该顺带把行打开 / 收起
            event.stopPropagation();
            workbench.openFile(resolveFromCwd(workbench.cwd, path));
          }}
        >
          {text}
        </button>
      ) : (
        text
      )}
      {range ? <span className="shrink-0 font-mono text-xs text-warning">:{range}</span> : null}
    </>
  );
}

export function InputLabel({ input }: { input: ToolInput }) {
  const { t } = useTranslation();
  switch (input.type) {
    case "path":
      return <PathLabel path={input.path} range={input.range} />;
    case "command":
      return (
        <span className="truncate font-mono text-xs text-foreground-subtlest" title={input.command}>
          {input.command}
        </span>
      );
    case "pattern":
      return (
        <>
          <span
            className="truncate font-mono text-xs text-foreground-subtlest"
            title={input.pattern}
          >
            /{input.pattern}/
          </span>
          {input.scope ? (
            <span className="truncate text-xs text-foreground-subtle" title={input.scope}>
              {input.scope}
            </span>
          ) : null}
        </>
      );
    case "url":
      return (
        <span className="truncate font-mono text-xs text-foreground-subtlest" title={input.url}>
          {input.url}
        </span>
      );
    case "query":
      return (
        <span className="truncate font-mono text-xs text-foreground-subtlest" title={input.query}>
          {input.query}
        </span>
      );
    case "action":
      return (
        <>
          <span className="shrink-0 font-mono text-xs text-foreground-subtlest">
            {input.action}
          </span>
          {input.target ? (
            <span
              className="truncate font-mono text-xs text-foreground-subtle"
              title={input.target}
            >
              {input.target}
            </span>
          ) : null}
        </>
      );
    case "screenshot":
      return (
        <span className="truncate font-mono text-xs text-foreground-subtlest">
          {/* 默认只截视口（`fullPage` 缺省为 false）：没给 ref 也没要整页时不能写成「整页」 */}
          {input.ref ?? (input.fullPage ? t("整页") : t("视口"))}
        </span>
      );
    default:
      return null;
  }
}

function OutputView({ text, isError }: { text: string; isError?: boolean }) {
  return (
    <pre
      className={cn(
        "max-h-96 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap",
        isError && "text-destructive",
      )}
    >
      {text}
    </pre>
  );
}

/** 工具 diff 只有行类型与文本，交给统一的 `DiffView` 铺开（行号由 git 面板传入） */
const toDiffRows = (lines: readonly { type: DiffRowType; text: string }[]): DiffRow[] =>
  lines.map((line) => ({ type: line.type, text: line.text }));

type ToolCallProps = {
  entry: ToolEntry;
  /** 行内尾部：收起状态下也看得见的入口（如子智能体的「查看进度」） */
  trailing?: ReactNode;
};

export function ToolCall({ entry, trailing }: ToolCallProps) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[toolKindOf(entry.name)];
  const input = toolInputOf(entry.name, entry.args);
  const args = useMemo(
    () => (typeof entry.args === "object" && entry.args !== null ? entry.args : null),
    [entry.args],
  );
  const showArgs = input.type === "none" && args !== null && Object.keys(args).length > 0;
  const diff = useMemo(() => toolDiff(entry.name, entry.args), [entry.name, entry.args]);
  const output = (entry.result ?? "").trimEnd();

  // 一律默认折叠：失败与执行中由状态图标提示，要不要看细节由用户决定
  const [open, setOpen] = useState(false);

  const hasBody = diff !== null || showArgs || output !== "" || (entry.images?.length ?? 0) > 0;
  const statusLabel = entry.running ? t("执行中") : entry.isError ? t("失败") : t("完成");

  return (
    <Collapsible className="group/tool" open={open} onOpenChange={setOpen}>
      {/* 工具名那一截是展开触发器；路径按钮是它的兄弟而非子元素——按钮里不能再套按钮 */}
      <div className="flex h-8 w-full items-center gap-2">
        <CollapsibleTrigger className="group flex shrink-0 items-center gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none">
          <Icon className="size-icon-sm shrink-0 text-foreground-subtle" />
          <span className="shrink-0 text-xs text-foreground-subtle">
            {toolTitleOf(entry.name, t)}
          </span>
        </CollapsibleTrigger>
        <span className="flex min-w-0 shrink items-center gap-1.5">
          <InputLabel input={input} />
          {entry.skill ? (
            <span
              className="truncate rounded-xs bg-muted px-1 text-xs text-foreground-subtle"
              title={t("技能 {{name}}", { name: entry.skill.name })}
            >
              {t("技能 {{name}}", { name: entry.skill.name })}
            </span>
          ) : null}
        </span>
        {trailing}
        <span
          className="flex shrink-0 items-center"
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
        >
          {entry.running ? (
            <Spinner className="text-foreground-subtle" />
          ) : entry.isError ? (
            <TriangleAlert className="size-icon-sm text-destructive" />
          ) : (
            <CheckCircle2 className="size-icon-sm text-foreground-subtlest" />
          )}
        </span>
        <ChevronRight
          className={cn(
            "size-icon-sm shrink-0 text-foreground-subtle opacity-0 transition group-hover/tool:opacity-100 group-data-[state=open]:opacity-100",
            open && "rotate-90",
          )}
        />
      </div>

      <CollapsibleContent>
        <div className="space-y-2 py-1 pr-1.5 pl-6">
          {entry.images?.map((image) => (
            <div key={image.id} className="space-y-1">
              <AttachmentImage alt={t("工具产出的图片")} className="my-1 block" url={image.url} />
              {/* 清理过正文的卡片里，模型与用户看到的东西不一致，说明一句免得「它明明看得见」 */}
              {entry.pruned ? (
                <p className="text-xs text-foreground-subtle">
                  {t("这段输出已从模型上下文清理，图片仍保留")}
                </p>
              ) : null}
            </div>
          ))}
          {diff !== null ? (
            <DiffView rows={toDiffRows(diff)} className="max-h-96 overflow-y-auto" />
          ) : null}
          {showArgs ? (
            <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {JSON.stringify(args, null, 2)}
            </pre>
          ) : null}
          {diff === null && output !== "" ? (
            <OutputView text={output} isError={entry.isError} />
          ) : null}
          {!hasBody && !entry.running ? (
            <p className="text-xs text-foreground-subtle">{t("（无输出）")}</p>
          ) : null}
          {!hasBody && entry.running ? (
            <p className="text-xs text-foreground-subtle">{t("执行中")}</p>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
