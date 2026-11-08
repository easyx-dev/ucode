/**
 * 「设计」视图的主区：**项目设计稿目录里的稿子清单**（不是图层树——节点树在画布标签里）。
 *
 * 设计视图没有侧栏：点活动栏的「设计」先落到这份清单，点一份即打开它的画布；画布占满主区，
 * 标签条左端的返回箭头回到这里。
 *
 * 稿子只是文件，但清单只认 `<cwd>/<项目配置目录>/design` 这一层：递归整个项目会把别的会话的工作区
 * （开发时 `APP_HOME` 就在仓库里）、构建产物与临时目录里的 `.design` 一并列出来。放在别处的稿子
 * 仍然能开（文件树里点它，或 agent `design_open`），只是不进这份清单。
 *
 * 本会话的稿不在清单里时（放在别处，或还没落盘）单独置顶一行——否则用户会以为自己的稿不见了。
 */

import { cn } from "cn";
import { FileQuestionMark, LayoutTemplate, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../../base/button";
import { Empty } from "../../../base/empty";
import { Spinner } from "../../../base/spinner";
import { useWorkbench } from "../../../provider/workbench";
import { baseName, dirName, relativeToCwd } from "../../../utils/path";
import { relativeTimeLabel } from "../../../utils/time";
import { useDesignFiles } from "../use-workbench-data";

export function DesignFilesList() {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  const sessionId = workbench?.sessionId ?? null;
  const [token, setToken] = useState(0);
  const files = useDesignFiles(sessionId, token);
  const openDesign = workbench?.openDesign;
  const cwd = workbench?.cwd ?? null;
  /**
   * 本会话当前在改哪份：清单请求里一并给出（画布没挂过也准）。
   *
   * 不为此拉整页画面：清单要的只是一个路径，而 `design/snapshot` 会把默认落点、
   * 内存文档一并带出来（进一次设计视图就开始算一份稿）。
   */
  const currentPath = files.data?.currentPath ?? null;

  if (sessionId === null) {
    return (
      <Empty
        className="h-full"
        icon={<FileQuestionMark className="size-7" />}
        title={t("还没有会话")}
        hint={t("设计稿挂在会话上：先发一条消息，画布才有地方落稿")}
      />
    );
  }

  const listed = files.data?.files ?? [];
  const known = listed.some((file) => file.path === currentPath);
  /** 置顶那一行也算进数量：不然清单上看得见三行、头上写「2」 */
  const rowCount = listed.length + (currentPath !== null && !known ? 1 : 0);
  /** 目录用相对 cwd 的写法（`~` 那类缩写是给绝对路径用的，这里的行本来就是项目内的） */
  const dirOf = (path: string) => dirName(cwd === null ? path : relativeToCwd(cwd, path));

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 text-xs text-foreground-subtle">
        <span className="min-w-0 truncate">{t("设计稿")}</span>
        <span className="ml-auto shrink-0 tabular-nums">{rowCount}</span>
        <IconButton
          className="shrink-0 text-foreground-subtle hover:text-foreground"
          disabled={files.loading}
          label={t("刷新设计稿列表")}
          size="icon-xs"
          onClick={() => setToken((prev) => prev + 1)}
        >
          <RefreshCw className="size-icon-sm" />
        </IconButton>
      </div>

      {files.loading && listed.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : listed.length === 0 && currentPath === null ? (
        <Empty
          className="flex-1"
          icon={<LayoutTemplate className="size-7" />}
          title={t("项目里还没有设计稿")}
          hint={t("让 agent 出一版稿子，它会落在项目的设计稿目录下")}
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-label={t("设计稿列表")}>
          {currentPath !== null && !known ? (
            <li>
              <Row
                name={baseName(currentPath)}
                // 不在目录里的稿子：它落在哪是这一行唯一有用的信息，时间反而没有
                meta={dirOf(currentPath)}
                current
                onOpen={() => openDesign?.(currentPath)}
              />
            </li>
          ) : null}
          {listed.map((file) => (
            <li key={file.path}>
              <Row
                name={file.name}
                meta={relativeTimeLabel(file.updatedAt)}
                current={file.path === currentPath}
                onOpen={() => openDesign?.(file.path)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 一行稿子：文件名一行、元信息（改动时间，或稿子不在设计稿目录时的目录）一行。
 *
 * 两行而不是「名字靠左、目录顶到最右」：清单铺在主区，宽度随面板走，单行会把路径甩到很远的地方，
 * 读起来像两个无关的字段。高亮铺满整行、直角——与工作台其余列表同一口径；
 * 「本会话当前在改的那份」靠选中底色区分，不挂「当前」角标。
 */
function Row({
  name,
  meta,
  current,
  onOpen,
}: {
  name: string;
  meta: string;
  current: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2.5 px-4 py-2 text-left",
        current
          ? "bg-state-selected text-foreground"
          : "text-foreground-subtle hover:bg-state-hover hover:text-foreground",
      )}
    >
      <LayoutTemplate className="size-icon-sm shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-5 text-foreground">{name}</span>
        {meta === "" ? null : (
          <span className="truncate text-xs leading-4 text-foreground-subtle">{meta}</span>
        )}
      </span>
    </button>
  );
}
