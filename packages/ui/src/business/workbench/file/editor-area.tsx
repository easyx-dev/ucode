/**
 * 编辑器区：标签条 + 激活文档的内容。
 *
 * 每个文档用 `key` 挂载，切标签即重置文档内的局部状态（展示方式、折叠的 hunk）；没有标签时给
 * 空态，不做成空白。标签条与内容各自滚动：标签横滚、内容纵滚。
 *
 * **浏览器标签是例外**：它的载体是宿主的一个 `<webview>`，卸载即销毁那个页面（滚动位置、表单、SPA 状态
 * 全没，agent 正驱动的目标也会消失）。所以浏览器标签全部常驻，切标签只切可见性。
 */
import { FilePlus2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Empty } from "../../../base/empty";
import { useWorkbench } from "../../../provider/workbench";
import { DesignCanvas } from "../design/design-canvas";
import { ChangesStack } from "../git/changes-stack";
import { GitFileDiff } from "../git/git-file-diff";
import { CommitDetail } from "../git/git-history";
import type { GitReview } from "../git/use-git-review";
import { TerminalView } from "../terminal/terminal-view";
import { EditorTabs } from "./editor-tabs";
import { FileContent } from "./file-content";

export function EditorArea({
  review,
  onBack,
  onCollapse,
}: {
  review: GitReview;
  /** 窄屏专用：回到列表页（桌面端不传，两栏并排时没有「返回」这回事） */
  onBack?: () => void;
  /** 窄屏专用：收起整个工作台抽屉（桌面端不传，退出入口在活动栏） */
  onCollapse?: () => void;
}) {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  if (!workbench) return null;

  const doc = workbench.docs.find((item) => item.id === workbench.activeDocId) ?? null;
  /** 浏览器面由宿主注入（桌面端才有 webview；web 端为 null，也就不会有这类标签） */
  const browser = workbench.browser;
  const browserDocs =
    browser === null ? [] : workbench.docs.filter((item) => item.kind === "browser");

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <EditorTabs onBack={onBack} onCollapse={onCollapse} />
      <div className="flex min-h-0 flex-1 flex-col">
        {doc === null ? (
          <Empty
            className="h-full"
            icon={<FilePlus2 className="size-7" />}
            title={t("打开文件")}
            hint={t("在左侧项目树里选一个文件")}
          />
        ) : doc.kind === "browser" ? // 浏览器标签在下面常驻渲染，这里不再挂一份
        null : (
          <div key={doc.id} className="flex min-h-0 flex-1 flex-col">
            {doc.kind === "file" ? (
              <FileContent path={doc.path} />
            ) : doc.kind === "diff" ? (
              <GitFileDiff
                target={{
                  path: doc.path,
                  file: doc.file,
                  source: doc.source,
                  ...(doc.commit ? { commit: doc.commit } : {}),
                }}
                reloadToken={review.reloadToken}
              />
            ) : doc.kind === "changes" ? (
              <ChangesStack path={doc.path} reloadToken={review.reloadToken} />
            ) : doc.kind === "commit" ? (
              <CommitDetail path={doc.path} commit={doc.commit} reloadToken={review.reloadToken} />
            ) : doc.kind === "design" ? (
              // 清标签发生在切换会话之后的 effect 里：这一帧旧会话的标签可能还在，先不画它的画布
              doc.sessionId === workbench.sessionId ? (
                <DesignCanvas />
              ) : null
            ) : (
              <TerminalView terminalId={doc.terminalId} />
            )}
          </div>
        )}

        {browserDocs.map((item) => (
          <div
            key={item.id}
            className={
              item.id === workbench.activeDocId ? "flex min-h-0 flex-1 flex-col" : "hidden"
            }
          >
            {browser?.renderTab(item.tabId, { active: item.id === workbench.activeDocId })}
          </div>
        ))}
      </div>
    </div>
  );
}
