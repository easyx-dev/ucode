/** project 接口的响应模型 */
import type { ListResult } from "../common";
import type { PermissionMode, ThinkingPreference } from "../constants";

/**
 * 项目：按会话工作目录（cwd）归口的一组偏好，供侧栏展示与新建会话时预填。
 *
 * 它是「这台机器上的某个目录」的概念，不属于任何一份会话记录，故不存在会话文件里；
 * 行随会话创建自动登记（见 `server/src/services/projects`），不提供删除。
 */
export type ProjectSummary = {
  id: string;
  /** 归一化后的绝对路径；项目的自然键，会话按 cwd 归到它上面 */
  path: string;
  /** 展示名；为空时客户端回落目录末段 */
  name: string | null;
  /** 最近一次在该项目里选择的模型；为空表示未记住，或记住的那个已不可用 */
  model: string | null;
  /** 最近一次在该项目里选择的思考档位偏好；为空表示未记住 */
  thinkingLevel: ThinkingPreference | null;
  /** 最近一次在该项目里选择的会话模式；为空表示未记住，或该模式的角色已不存在 */
  mode: string | null;
  /** 最近一次在该项目里选择的权限档位；为空表示未记住 */
  permissionMode: PermissionMode | null;
  /**
   * 项目级记忆开关的覆盖：`null` 表示未设过（跟随全局 `memory.enabled`），
   * 否则是这个目录的显式开关。侧栏项目行据此标「已开启记忆」。
   */
  memoryEnabled: boolean | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * 项目列表。`projects` 的次序就是侧栏里的次序：用户拖拽排出来的，没排过的按登记时间降序接在后面。
 */
export type ProjectListResponse = ListResult & {
  projects: ProjectSummary[];
};
