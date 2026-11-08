/**
 * 「设计」视图的侧栏：**项目设计稿目录里的稿子清单**（不是图层树——节点树在画布标签里）。
 *
 * 稿子只是文件，但清单只认 `<cwd>/<项目配置目录>/design` 这一层：递归整个项目会把别的会话的工作区
 * （开发时 `APP_HOME` 就在仓库里）、构建产物与临时目录里的 `.design` 一并列出来。放在别处的稿子
 * 仍然能开（项目文件树里点它，或 agent `design_open`），只是不进这份清单。
 *
 * 本会话的稿不在清单里时（放在别处，或还没落盘）单独置顶一行——否则用户第一次进设计模式会看到
 * 「一个文件都没有」，无从下手。
 */

import { cn } from "cn";
import { FileQuestionMark, LayoutTemplate, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../../base/button";
import { Empty } from "../../../base/empty";
import { Spinner } from "../../../base/spinner";
import { useDesignPath } from "../../../hooks/store/use-design";
import { useWorkbench } from "../../../provider/workbench";
import { baseName, relativeToCwd } from "../../../utils/path";
import { useDesignFiles } from "../use-workbench-data";

export function DesignFilesPanel() {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  const sessionId = workbench?.sessionId ?? null;
  /** 已加载的画布状态里的指针（更新更及时），没加载过时为 null */
  const loadedPath = useDesignPath(sessionId);
  const [token, setToken] = useState(0);
  const files = useDesignFiles(sessionId, token);
  /**
   * 本会话当前在改哪份：清单请求里一并给出（画布没挂过时就用它）。
   *
   * 不为此拉整页画面：侧栏要的只是一个路径，而 `design/snapshot` 会把默认落点、
   * 内存文档一并带出来（进一次设计视图就开始算一份稿）。
   */
  const currentPath = loadedPath ?? files.data?.currentPath ?? null;

  const openDesign = workbench?.openDesign;
  const cwd = workbench?.cwd ?? null;

  // 当前稿变了（在别处打开了另一份）就重取一次：侧栏的「当前」标记跟着走。
  // 首次挂载不重取——那一次请求挂载时已经发出去了
  // `null` 起步：挂载那一刻画布状态往往还没到，用挂载值作起点会让「状态刚到」被当成「当前稿变了」，
  // 白多发一次 `design/files`
  const previousPath = useRef<string | null>(null);
  useEffect(() => {
    if (previousPath.current === loadedPath) return;
    const first = previousPath.current === null;
    previousPath.current = loadedPath;
    if (first || loadedPath === null) return;
    setToken((prev) => prev + 1);
  }, [loadedPath]);

  /**
   * 进设计视图时把本会话的稿打开一次（每人一份、只一次）。
   *
   * 用户点了「设计」却看到一片空白会以为模式没生效；之后他手动关掉标签就不再强开。
   * 这一步放在侧栏里而不是模式切换处：侧栏是「设计视图」真正被选中时才挂载的。
   */
  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    if (currentPath === null || openDesign === undefined) return;
    const key = `${sessionId}#${currentPath}`;
    if (autoOpened.current === key) return;
    autoOpened.current = key;
    openDesign(currentPath);
  }, [currentPath, openDesign, sessionId]);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-foreground-subtle">
        <span className="min-w-0 truncate">{t("设计稿")}</span>
        <span className="ml-auto shrink-0 tabular-nums">{listed.length}</span>
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
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-label={t("设计稿列表")}>
          {currentPath !== null && !known ? (
            <li>
              <Row
                name={baseName(currentPath)}
                detail={cwd === null ? currentPath : relativeToCwd(cwd, currentPath)}
                current
                onOpen={() => openDesign?.(currentPath)}
              />
            </li>
          ) : null}
          {listed.map((file) => (
            <li key={file.path}>
              <Row
                name={file.name}
                detail={cwd === null ? file.path : relativeToCwd(cwd, file.path)}
                current={file.path === currentPath}
                onOpen={() => openDesign?.(file.path)}
              />
            </li>
          ))}
          {listed.length === 0 && currentPath === null ? (
            <li>
              <Empty
                className="h-full py-8"
                icon={<LayoutTemplate className="size-7" />}
                title={t("项目里还没有设计稿")}
                hint={t("让 agent 出一版稿子，它会落在项目的设计稿目录下")}
              />
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

/** 一行稿子：文件名 + 相对路径；「本会话」那份靠选中底色区分，不再挂一个「当前」角标 */
function Row({
  name,
  detail,
  current,
  onOpen,
}: {
  name: string;
  detail: string;
  current: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      title={detail}
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-1.5 py-1 pr-2 pl-2 text-left text-xs",
        current
          ? "bg-state-selected text-foreground"
          : "text-foreground-subtle hover:bg-state-hover hover:text-foreground",
      )}
    >
      <LayoutTemplate className="size-icon-xs shrink-0" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </button>
  );
}
