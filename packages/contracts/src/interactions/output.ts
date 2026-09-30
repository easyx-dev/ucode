/** 交互请求与回答的响应模型 */

/** 一条待回答的权限审批：随 `interaction_request` 事件下发，也可经 `interactions/list` 补齐 */
export type PermissionInteraction = {
  requestId: string;
  kind: "permission";
  sessionId: string;
  /** 触发审批的工具名，如 `read` / `bash` */
  tool: string;
  /** 规则匹配到的对象：路径 / 命令 / URL，展示给用户判断 */
  subject: string;
  /** 本次授权覆盖的范围：规则类 ask 是规则串，越界检查是父目录通配 */
  scope: string;
  createdAt: string;
};

/** 待回答的交互请求；后续 question 通道并入这里的联合 */
export type PendingInteraction = PermissionInteraction;

export type InteractionListResponse = {
  interactions: PendingInteraction[];
};

export type InteractionRespondResponse = {
  requestId: string;
  /** 是否命中一条待回答请求并已生效；重复回答或已超时则为 false */
  resolved: boolean;
};
