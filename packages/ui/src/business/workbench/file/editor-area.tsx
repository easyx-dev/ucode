/**
 * 编辑器区：标签条 + 激活文档的内容。
 *
 * 每个文档用 `key` 挂载，切标签即重置文档内的局部状态（展示方式、折叠的 hunk）；没有标签时给
 * 空态，不做成空白。标签条与内容各自滚动：标签横滚、内容纵滚。
 */
import { FilePlus2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkbench } from "../../../provider/workbench";
import { ChangesStack } from "../git/changes-stack";
import { GitFileDiff } from "../git/git-file-diff";
import { CommitDetail } from "../git/git-history";
import type { GitReview } from "../git/use-git-review";
import { PanelEmpty } from "../panel-empty";
import { EditorTabs } from "./editor-tabs";
import { FileContent } from "./file-content";

export function EditorArea({ review, onBack }: { review: GitReview; onBack?: () => void }) {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  if (!workbench) return null;

  const doc = workbench.docs.find((item) => item.id === workbench.activeDocId) ?? null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <EditorTabs onBack={onBack} />
      {doc === null ? (
        <PanelEmpty
          icon={<FilePlus2 className="size-7" />}
          title={t("打开文件")}
          hint={t("在左侧项目树里选一个文件")}
        />
      ) : (
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
          ) : (
            <CommitDetail path={doc.path} commit={doc.commit} reloadToken={review.reloadToken} />
          )}
        </div>
      )}
    </div>
  );
}
