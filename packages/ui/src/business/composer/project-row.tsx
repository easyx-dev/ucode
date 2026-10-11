/**
 * 输入卡上方的条：项目（草稿态可切换、已有会话只读）与当前分支（只读）。
 *
 * 分支只在确实是 git 仓库且拿得到分支名时渲染——非仓库、分离头指针、状态还没回来都不显示。
 */
import { Folder, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGitStatus } from "../../hooks/use-workbench-data";
import { abbreviateHome } from "../../lib/path";
import { PROJECT_CHIP_CLASS, ProjectPicker } from "./project-picker";

/** 只读 chip：与可点的那枚同形，但不给悬停反馈 */
const READONLY_CHIP_CLASS =
  "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-foreground-subtle [&_svg]:size-icon-sm";

type ProjectRowProps = {
  /** 草稿态（还没有会话）：项目可切换 */
  draft: boolean;
  /** 当前工作目录（取分支用）；没有绑定时为 undefined */
  cwdPath?: string;
  /** 项目展示名；助理区显示成文案 */
  projectName: string;
  /** 草稿态选中的项目路径；小助理为 null */
  projectPath: string | null;
  onSelectProject: (path: string | null) => void;
};

export function ProjectRow({
  draft,
  cwdPath,
  projectName,
  projectPath,
  onSelectProject,
}: ProjectRowProps) {
  const { t } = useTranslation();
  const git = useGitStatus(cwdPath ?? null);
  const branch = git.data?.isRepo ? (git.data.branch ?? null) : null;

  return (
    <div className="flex items-center gap-1 px-2 py-2">
      {draft ? (
        <ProjectPicker name={projectName} path={projectPath} onSelect={onSelectProject} />
      ) : (
        <span
          className={cwdPath ? READONLY_CHIP_CLASS : PROJECT_CHIP_CLASS}
          title={cwdPath ? abbreviateHome(cwdPath) : undefined}
        >
          <Folder />
          {projectName}
        </span>
      )}
      {branch ? (
        <span className={READONLY_CHIP_CLASS} title={t("当前分支")}>
          <GitBranch />
          {branch}
        </span>
      ) : null}
    </div>
  );
}
