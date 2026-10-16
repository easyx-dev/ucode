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
import { DiffDisplayControls } from "../../../base/diff-controls";
import { Spinner } from "../../../base/spinner";
import { useDiffPreferences } from "../../../hooks/use-diff-prefs";
import { useWorkbench } from "../../../provider/workbench";
import { HOVER_ACTION_CLASS } from "../../../utils/hover-actions";
import { resolveFromCwd, shortenPath } from "../../../utils/path";
import { AttachmentImage } from "../../attachment/attachment-image";
import { PatchDiff } from "../../markdown/patch-diff";
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

/** 路径展示的字符预算：超出后只留尾部（`…/chat/tool/working-indicator.tsx`） */
const PATH_MAX_CHARS = 42;

/** patch 交给库渲染的行数预算；超过就退回纯文本（库不做虚拟滚动，一次铺几万行会占满主线程） */
const MAX_DIFF_LINES = 1000;

/**
 * 入参里的路径：工作台可用时做成按钮，点开右侧预览（路径相对会话工作目录解析）。
 *
 * 长路径留尾部：前缀（家目录、仓库根）几乎不携带信息，切掉它才看得见「哪个文件的哪里」；
 * 容器再窄时用「右对齐 + 裁左边」兜住，被裁掉的一侧正好是那块没信息量的前缀，尾部始终在。
 */
function PathLabel({ path, range }: { path: string; range?: string }) {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  const text = (
    <span
      className="shrink-0 font-mono text-xs whitespace-nowrap text-foreground-subtlest"
      title={path}
    >
      {shortenPath(path, PATH_MAX_CHARS)}
    </span>
  );
  return (
    <>
      <span className="flex min-w-0 justify-end overflow-hidden rounded-sm">
        {workbench ? (
          <button
            type="button"
            className="rounded-sm text-left font-mono text-xs text-foreground-subtlest hover:text-foreground hover:underline"
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
      </span>
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
  // 预算按 patch 行数算而不是改动量：编辑距离那道闸门只管比对，管不到渲染
  const diffLines = useMemo(() => (diff ? diff.patch.split("\n").length : 0), [diff]);
  const output = (entry.result ?? "").trimEnd();
  const { mode, wrap, selectMode, toggleWrap } = useDiffPreferences();

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
        {/* 改动卡片有 diff 时先撑开：状态图标与小三角一律贴右沿，超预算退回纯文本那支也一样 */}
        {diff !== null ? <span className="flex-1" /> : null}
        {/* 改动卡片把 diff 的展示方式摆在头部：改完就想看改动，不必再跑一趟 git 面板。
            靠右对齐、悬停卡片或展开时才现：控件一直占着位置（opacity 而不是 display），出现时不挤动路径；
            键盘 Tab 进来的那一刻也现（focus-within），触屏没有悬停态则常驻（HOVER_ACTION_CLASS）。
            `group-hover/card` 管卡片那圈内边距，`group-hover/tool` 管行本身 */}
        {diff !== null && diffLines <= MAX_DIFF_LINES ? (
          <DiffDisplayControls
            className={cn(
              HOVER_ACTION_CLASS,
              "group-hover/tool:opacity-100 group-hover/card:opacity-100 group-data-[state=open]/tool:opacity-100 focus-within:opacity-100",
            )}
            mode={mode}
            wrap={wrap}
            onSelectMode={selectMode}
            onToggleWrap={toggleWrap}
          />
        ) : null}
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
            "size-icon-sm shrink-0 text-foreground-subtle opacity-0 transition group-hover/tool:opacity-100 group-hover/card:opacity-100 group-data-[state=open]/tool:opacity-100",
            open && "rotate-90",
          )}
        />
      </div>

      <CollapsibleContent>
        <div className="space-y-2 py-1 pr-1.5 pl-6">
          {entry.images && entry.images.length > 0 ? (
            <div className="space-y-1">
              {entry.images.map((image) => (
                <AttachmentImage
                  key={image.id}
                  alt={t("工具产出的图片")}
                  className="my-1 block"
                  url={image.url}
                />
              ))}
              {/* 正文已被清理的卡片里，模型与用户看到的东西不一致，说一句免得「它明明看得见」 */}
              {entry.pruned ? (
                <p className="text-xs text-foreground-subtle">
                  {t("图片仍保留，但模型已不再看到它")}
                </p>
              ) : null}
            </div>
          ) : null}
          {diff !== null ? (
            diffLines > MAX_DIFF_LINES ? (
              <>
                <p className="text-xs text-foreground-subtle">
                  {t("改动过大，只给纯文本 diff（{{value}} 行）", { value: diffLines })}
                </p>
                <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs leading-relaxed whitespace-pre">
                  {diff.patch}
                </pre>
              </>
            ) : (
              // 高度照工具卡的惯例收在 `max-h-96` 内滚动；展示方式由头部那两个控件决定。
              // `tool-diff` 是样式钩子（见 `styles/third-party.css`）：卡片里的行号不是文件位置
              <div className="tool-diff max-h-96 overflow-y-auto">
                <PatchDiff data={diff} mode={mode} wrap={wrap} />
              </div>
            )
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
