/** 项目空间的响应模型：已登记的目录集合 */
import type { ListResult } from "../common";

export type Project = {
  id: string;
  /** 展示名；为 null 时客户端回落目录名（`basename(path)`） */
  name: string | null;
  /** 已归一化（realpath）的绝对目录路径，全局唯一 */
  path: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectListResponse = ListResult & {
  projects: Project[];
};

export type ProjectDeleteResponse = {
  projectId: string;
  deleted: boolean;
};
