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
  createdAt: string;
  updatedAt: string;
};

export type ProjectListResponse = ListResult & {
  projects: ProjectSummary[];
};
