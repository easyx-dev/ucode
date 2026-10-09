/** 项目列表的 React 绑定：状态与改名都在 SDK projects store，失败由 ErrorToaster 统一提示 */
import type { ProjectSummary, ProjectUpdateRequest } from "@ucode/contracts";

import { useClient } from "../provider";
import { useStore } from "./use-store";

export type ProjectsController = {
  projects: ProjectSummary[];
  /** 重命名（`name` 传 null 即清空，界面回落目录末段） */
  rename: (body: ProjectUpdateRequest) => Promise<ProjectSummary | null>;
};

export function useProjects(): ProjectsController {
  const client = useClient();
  const state = useStore(client.projects);

  return {
    projects: state.data?.projects ?? [],
    rename: client.projects.rename,
  };
}
