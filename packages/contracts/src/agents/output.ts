/** agents 域的响应模型：内置与自定义角色，供选择器渲染 */
import type { AgentKind, AgentSource } from "../constants";

export type AgentView = {
  /** 角色 slug；主会话用它作 `mode`，子会话用它作 `agent` */
  slug: string;
  /** 展示名 */
  label: string;
  /** 角色说明；供界面展示与模型挑选 */
  description: string;
  kind: AgentKind;
  source: AgentSource;
  /** 是否对选择器隐藏（`hidden: true`）；隐藏项仍可按名调用 */
  hidden?: boolean;
};

export type AgentsListResponse = {
  /** 主会话角色：内置 build / plan / ask 与自定义 primary */
  primary: AgentView[];
  /** 子角色：内置 general / explore 与自定义 subagent */
  subagents: AgentView[];
};
